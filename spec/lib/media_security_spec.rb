# frozen_string_literal: true

require_relative "../../lib/discourse_video_shorts/media/origin_policy"
require_relative "../../lib/discourse_video_shorts/media/redirect_policy"
require_relative "../../lib/discourse_video_shorts/media/hls_policy"

RSpec.describe DiscourseVideoShorts do
  MediaSecuritySnapshot = Struct.new(:revision, :external_media_enabled, :origins, keyword_init: true) do
    def allowed_origin?(origin)
      origins.include?(origin)
    end
  end

  def snapshot(revision: 7, enabled: true, origins: ["https://media.example"])
    MediaSecuritySnapshot.new(revision:, external_media_enabled: enabled, origins: origins.freeze).freeze
  end

  describe DiscourseVideoShorts::Media::OriginPolicy do
    it "normalizes only exact HTTPS origins" do
      expect(described_class.normalize_origin("https://MEDIA.example:443/")).to eq("https://media.example")
      expect(described_class.normalize_origin("https://media.example:8443")).to eq("https://media.example:8443")
      expect(described_class.normalize_origin("http://media.example")).to be_nil
      expect(described_class.normalize_origin("https://media.example/path")).to be_nil
      expect(described_class.normalize_origin("https://*.example")).to be_nil
      expect(described_class.normalize_origin("https://user@media.example")).to be_nil
    end

    it "uses the immutable policy revision and exact origin membership" do
      policy = described_class.new(snapshot: snapshot)

      expect(policy.allowed_url?("https://media.example/video.mp4")).to be(true)
      expect(policy.allowed_url?("https://sub.media.example/video.mp4")).to be(false)
      expect(policy.allowed_url?("https://media.example/video.mp4", revision: 8)).to be(false)
      expect { policy.authorize!("https://media.example/video.mp4", revision: 8) }.to raise_error(described_class::Denied)
    end
  end

  describe DiscourseVideoShorts::Media::RedirectPolicy do
    it "requires every observable redirect hop to remain approved" do
      policy = DiscourseVideoShorts::Media::OriginPolicy.new(
        snapshot: snapshot(origins: ["https://media.example", "https://cdn.example"]),
      )
      redirects = described_class.new(origin_policy: policy)

      expect(redirects.authorize_chain!(["https://media.example/video.mp4", "https://cdn.example/video.mp4"])).to eq(
        ["https://media.example", "https://cdn.example"],
      )
      expect { redirects.authorize_chain!([]) }.to raise_error(described_class::Denied, "unobservable_redirect")
      expect { redirects.authorize_chain!(["https://media.example/video.mp4", "http://cdn.example/video.mp4"]) }.to raise_error(described_class::Denied)
    end
  end

  describe DiscourseVideoShorts::Media::HlsPolicy do
    it "authorizes manifest, variant, segment, init, subtitle, and key URLs against one revision snapshot" do
      hls = described_class.new(snapshot: snapshot(origins: ["https://media.example", "https://cdn.example"]))
      manifest = hls.authorize_manifest!("https://media.example/master.m3u8")

      expect(manifest).to eq("https://media.example/master.m3u8")
      %w[variant.m3u8 segment.ts init.mp4 subtitles.vtt key.bin].each do |resource|
        expect(hls.authorize_resource!("https://cdn.example/#{resource}", base_url: manifest)).to eq(
          "https://cdn.example/#{resource}",
        )
      end
      expect { hls.authorize_resource!("https://evil.example/key.bin", base_url: manifest) }.to raise_error(described_class::Denied, "unapproved_origin")
      expect { hls.authorize_resource!("segment.ts", base_url: "http://media.example/master.m3u8") }.to raise_error(described_class::Denied)
    end
  end

  describe DiscourseVideoShorts::MediaExtractor do
    fab!(:user)

    before { SiteSetting.authorized_extensions = (SiteSetting.authorized_extensions.split("|") + ["mp4"]).uniq.join("|") }

    def extract(raw:, uploads: [], policy: nil)
      post = Fabricate(:post, raw: raw, cooked: raw)
      uploads.each { |upload| Fabricate(:upload_reference, target: post, upload: upload) }
      described_class.extract_media_for_visible_post(post.reload, Guardian.new(user), policy_snapshot: policy)
    end

    it "allows canonical Bilibili and YouTube normal, Shorts, and share links" do
      bilibili = extract(raw: "https://www.bilibili.com/video/BV1Q541167Qg")
      normal = extract(raw: "https://www.youtube.com/watch?v=dQw4w9WgXcQ")
      shorts = extract(raw: "https://www.youtube.com/shorts/dQw4w9WgXcQ")
      share = extract(raw: "https://youtu.be/dQw4w9WgXcQ")

      expect(bilibili).to include(kind: "bilibili", identity: "v1:bilibili:BV1Q541167Qg")
      [normal, shorts, share].each { |media| expect(media).to include(kind: "youtube", identity: "v1:youtube:dQw4w9WgXcQ") }
    end

    it "allows uploaded MP4 and policy-approved direct MP4/HLS without exposing URL identity input" do
      upload = Fabricate(:video_upload, extension: "mp4", original_filename: "clip.mp4")
      native = extract(raw: "native", uploads: [upload])
      external = extract(raw: "https://media.example/clip.mp4?token=secret", policy: snapshot)
      hls = extract(raw: "https://media.example/master.m3u8?token=secret#fragment", policy: snapshot)

      expect(native).to include(kind: "upload_mp4")
      expect(external).to include(kind: "external_mp4", policy_revision: 7, required_origins: ["https://media.example"])
      expect(hls).to include(
        kind: "external_hls",
        url: "https://media.example/master.m3u8?token=secret",
        policy_revision: 7,
        required_origins: ["https://media.example"],
      )
      [external, hls].each do |media|
        expect(media[:identity]).to start_with("v1:external:")
        expect(media[:identity]).not_to include("media.example", "secret")
      end
    end

    it "fails closed for HTTP, unapproved origins, disabled policy, and malformed URLs" do
      expect(extract(raw: "http://media.example/clip.mp4", policy: snapshot)).to include(kind: "fallback", fallback_reason: "https_required")
      expect(extract(raw: "https://evil.example/clip.mp4", policy: snapshot)).to include(kind: "fallback", fallback_reason: "unapproved_origin")
      expect(extract(raw: "https://media.example/clip.mp4", policy: snapshot(enabled: false))).to include(
        kind: "fallback",
        fallback_reason: "external_media_disabled",
      )
      expect(extract(raw: "https://media.example/download", policy: snapshot)).to be_nil
      expect(extract(raw: "https://media.example/%zz.mp4", policy: snapshot)).to include(kind: "fallback", fallback_reason: "invalid_media_url")
    end
  end
end
