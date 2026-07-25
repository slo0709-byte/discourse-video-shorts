# frozen_string_literal: true

RSpec.describe DiscourseVideoShorts::MediaExtractorCache do
  fab!(:user)

  before do
    SiteSetting.authorized_extensions =
      (SiteSetting.authorized_extensions.split("|") + %w[mp4 webm mov m4v]).uniq.join("|")
    SiteSetting.video_shorts_hls_allowed_origins = "https://stream.example.com"
  end

  def make_post(raw:, cooked: raw)
    Fabricate(:post, raw: raw, cooked: cooked)
  end

  def extract(post)
    described_class.extract_media_for_visible_post(post.reload, Guardian.new(user))
  end

  it "returns a cached descriptor without invoking the extractor again" do
    post = make_post(raw: "https://www.youtube.com/shorts/dQw4w9WgXcQ")
    first = extract(post)

    DiscourseVideoShorts::MediaExtractor.expects(:extract_media_for_visible_post).never

    expect(extract(post)).to eq(first)
  end

  it "ignores stale cached descriptors when post content changes" do
    post = make_post(raw: "https://www.youtube.com/shorts/dQw4w9WgXcQ")

    expect(extract(post)).to include(provider: "youtube")

    post.update!(
      raw: "https://www.bilibili.com/video/BV1Q541167Qg",
      cooked: "https://www.bilibili.com/video/BV1Q541167Qg",
    )

    expect(extract(post)).to include(
      provider: "bilibili",
      dedupe_key: "bilibili:BV1Q541167Qg:page:1",
    )
  end

  it "ignores malformed cached custom field payloads" do
    post = make_post(raw: "https://stream.example.com/path/video.m3u8")
    post.custom_fields[described_class::CUSTOM_FIELD] = "{not-json"
    post.save_custom_fields

    expect(extract(post)).to include(provider: "hls", renderability: "hls")
  end

  it "keeps HTTPS HLS playable when the optional origins setting changes" do
    post = make_post(raw: "https://stream.example.com/path/video.m3u8")

    expect(extract(post)).to include(provider: "hls", renderability: "hls")

    SiteSetting.video_shorts_hls_allowed_origins = ""

    expect(extract(post)).to include(provider: "hls", renderability: "hls")
  end
end
