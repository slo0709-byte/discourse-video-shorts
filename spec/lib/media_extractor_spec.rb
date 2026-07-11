# frozen_string_literal: true

RSpec.describe DiscourseVideoShorts::MediaExtractor do
  ExtractorPolicySnapshot = Struct.new(:revision, :external_media_enabled, :origins, keyword_init: true) do
    def allowed_origin?(origin)
      origins.include?(origin)
    end
  end

  fab!(:user)

  before do
    SiteSetting.authorized_extensions =
      (SiteSetting.authorized_extensions.split("|") + ["mp4"]).uniq.join("|")
  end

  def snapshot(revision: 7, enabled: true, origins: ["https://media.example"])
    ExtractorPolicySnapshot.new(revision:, external_media_enabled: enabled, origins: origins.freeze).freeze
  end

  def extract(raw:, cooked: nil, uploads: [], policy: nil)
    post = Fabricate(:post, raw:, cooked: cooked || raw)
    uploads.each { |upload| Fabricate(:upload_reference, target: post, upload:) }
    described_class.extract_media_for_visible_post(post.reload, Guardian.new(user), policy_snapshot: policy)
  end

  it "returns a playable fixed-schema uploaded MP4 descriptor before provider links" do
    upload = Fabricate(:video_upload, extension: "mp4", original_filename: "clip.mp4")

    descriptor = extract(raw: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", uploads: [upload])

    expect(descriptor).to eq(
      kind: "upload_mp4",
      identity: "v1:upload:#{upload.id}:#{upload.sha1}",
      url: UrlHelper.cook_url(upload.url, secure: upload.secure?, local: true),
      required_origins: [],
      policy_revision: nil,
      fallback_reason: nil,
    )
  end

  it "does not classify an upload as playable when MP4 is no longer authorized" do
    upload = Fabricate(:video_upload, extension: "mp4", original_filename: "clip.mp4")
    SiteSetting.authorized_extensions = "jpg|png"

    expect(extract(raw: "native upload", uploads: [upload])).to be_nil
  end

  it "normalizes YouTube watch, Shorts, share, and cooked embed URLs" do
    urls = [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://www.youtube.com/shorts/dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ?t=30",
    ]

    urls.each do |url|
      expect(extract(raw: url)).to include(
        kind: "youtube",
        identity: "v1:youtube:dQw4w9WgXcQ",
        url: "https://www.youtube.com/embed/dQw4w9WgXcQ",
        required_origins: [],
        policy_revision: nil,
        fallback_reason: nil,
      )
    end

    expect(
      extract(raw: "embedded", cooked: '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ?start=30"></iframe>'),
    ).to include(kind: "youtube", identity: "v1:youtube:dQw4w9WgXcQ", url: "https://www.youtube.com/embed/dQw4w9WgXcQ")
  end

  it "normalizes canonical and cooked Bilibili links" do
    canonical = extract(raw: "https://www.bilibili.com/video/BV1Q541167Qg?from=search#reply")
    cooked = extract(
      raw: "embedded",
      cooked: '<iframe src="https://player.bilibili.com/player.html?bvid=BV1Q541167Qg&amp;page=3"></iframe>',
    )

    [canonical, cooked].each do |descriptor|
      expect(descriptor).to include(
        kind: "bilibili",
        identity: "v1:bilibili:BV1Q541167Qg",
        url: "https://player.bilibili.com/player.html?bvid=BV1Q541167Qg&page=1",
        required_origins: [],
        policy_revision: nil,
        fallback_reason: nil,
      )
    end
  end

  it "returns a policy-bound MP4 descriptor without URL data in its identity" do
    descriptor = extract(raw: "https://media.example/clip.mp4?token=secret#fragment", policy: snapshot)

    expect(descriptor).to include(
      kind: "external_mp4",
      url: "https://media.example/clip.mp4?token=secret",
      required_origins: ["https://media.example"],
      policy_revision: 7,
      fallback_reason: nil,
    )
    expect(descriptor[:identity]).to start_with("v1:external:")
    expect(descriptor[:identity]).not_to include("media.example", "secret")
  end

  it "returns a policy-bound HLS descriptor" do
    expect(extract(raw: "https://media.example/master.m3u8", policy: snapshot)).to include(
      kind: "external_hls",
      url: "https://media.example/master.m3u8",
      required_origins: ["https://media.example"],
      policy_revision: 7,
      fallback_reason: nil,
    )
  end

  it "fails closed for HTTP, unapproved origins, and disabled external media" do
    expect(extract(raw: "http://media.example/clip.mp4", policy: snapshot)).to include(
      kind: "fallback", fallback_reason: "https_required",
    )
    expect(extract(raw: "https://evil.example/clip.mp4", policy: snapshot)).to include(
      kind: "fallback", fallback_reason: "unapproved_origin",
    )
    expect(extract(raw: "https://media.example/clip.mp4", policy: snapshot(enabled: false))).to include(
      kind: "fallback", fallback_reason: "external_media_disabled",
    )
  end

  it "fails closed for malformed and invalid provider URLs" do
    expect(extract(raw: "https://media.example/%zz.mp4", policy: snapshot)).to include(
      kind: "fallback", fallback_reason: "invalid_media_url",
    )
    expect(extract(raw: "https://www.youtube.com/watch?v=bad")).to include(
      kind: "fallback", fallback_reason: "invalid_youtube_url",
    )
  end
end
