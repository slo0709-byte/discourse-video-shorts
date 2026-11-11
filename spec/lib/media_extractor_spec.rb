# frozen_string_literal: true

RSpec.describe DiscourseVideoShorts::MediaExtractor do
  fab!(:user)

  before do
    SiteSetting.authorized_extensions =
      (SiteSetting.authorized_extensions.split("|") + %w[mp4 webm mov m4v]).uniq.join("|")
    SiteSetting.video_shorts_hls_allowed_origins = "https://stream.example.com"
  end

  def extract(raw:, cooked: nil, uploads: [])
    post = Fabricate(:post, raw: raw, cooked: cooked || raw)
    uploads.each { |upload| Fabricate(:upload_reference, target: post, upload: upload) }
    described_class.extract_media_for_visible_post(post.reload, Guardian.new(user))
  end

  it "prefers native uploaded video descriptors over provider links" do
    upload = Fabricate(:video_upload, extension: "mp4", original_filename: "clip.mp4")

    descriptor =
      extract(raw: "https://www.bilibili.com/video/BV1Q541167Qg", uploads: [upload])

    expect(descriptor).to include(
      provider: "native",
      renderability: "native",
      dedupe_key: "native:upload:#{upload.id}",
    )
    expect(descriptor[:upload]).to include(
      id: upload.id,
      sha1: upload.sha1,
      extension: "mp4",
      original_filename: "clip.mp4",
    )
    expect(descriptor).not_to have_key(:video_url)
  end

  it "does not treat native uploads as playable when their extension is not allowed by Discourse settings" do
    upload = Fabricate(:video_upload, extension: "mp4", original_filename: "clip.mp4")
    SiteSetting.authorized_extensions = "jpg|png"

    descriptor = extract(raw: "native upload", uploads: [upload])

    expect(descriptor).to be_nil
  end

  it "returns HLS descriptors for HTTPS M3U8 links" do
    descriptor = extract(raw: "https://stream.example.com/path/video.m3u8")

    expect(descriptor).to include(
      provider: "hls",
      renderability: "hls",
      hls_url: "https://stream.example.com/path/video.m3u8",
      dedupe_key: start_with("hls:"),
    )
    expect(descriptor).not_to have_key(:fallback)
  end

  it "falls back to the topic for non-HTTPS M3U8 links" do
    descriptor = extract(raw: "http://stream.example.com/path/video.m3u8")

    expect(descriptor).to include(
      provider: "hls",
      renderability: "fallback",
      fallback: "post",
      fallback_reason: "hls_requires_https",
      dedupe_key: start_with("hls:invalid:"),
    )
    expect(descriptor).not_to have_key(:hls_url)
  end

  it "allows a cross-origin HTTPS M3U8 origin without an allowlist entry" do
    descriptor = extract(raw: "https://untrusted.example.com/path/video.m3u8")

    expect(descriptor).to include(
      provider: "hls",
      renderability: "hls",
      hls_url: "https://untrusted.example.com/path/video.m3u8",
      dedupe_key: start_with("hls:"),
    )
    expect(descriptor).not_to have_key(:fallback)
  end

  it "preserves an HTTPS HLS query while removing its fragment" do
    descriptor = extract(raw: "https://stream.example.com/live/video.m3u8?token=x#fragment")

    expect(descriptor).to include(
      provider: "hls",
      renderability: "hls",
      hls_url: "https://stream.example.com/live/video.m3u8?token=x",
    )
  end

  it "normalizes canonical Bilibili links as iframe candidates" do
    descriptor =
      extract(raw: "https://www.bilibili.com/video/BV1Q541167Qg?from=search#reply")

    expect(descriptor).to include(
      provider: "bilibili",
      renderability: "iframe_candidate",
      embed_url: "https://player.bilibili.com/player.html?bvid=BV1Q541167Qg&page=1",
      dedupe_key: "bilibili:BV1Q541167Qg:page:1",
    )
    expect(descriptor).not_to have_key(:fallback)
  end

  it "does not classify bad Bilibili hosts as Bilibili" do
    descriptor = extract(raw: "https://evil.example/video/BV1Q541167Qg")

    expect(descriptor).to be_nil
  end

  it "returns Bilibili fallback for valid host with invalid BVID" do
    descriptor = extract(raw: "https://www.bilibili.com/video/not-a-bvid")

    expect(descriptor).to include(
      provider: "bilibili",
      renderability: "fallback",
      fallback: "post",
    )
    expect(descriptor[:dedupe_key]).to start_with("bilibili:invalid:")
    expect(descriptor).not_to have_key(:embed_url)
  end

  it "normalizes cooked Bilibili iframe bvid and page as an iframe candidate while stripping extra params" do
    descriptor =
      extract(
        raw: "embedded",
        cooked:
          '<iframe src="https://player.bilibili.com/player.html?bvid=BV1Q541167Qg&page=3&autoplay=1#x"></iframe>',
      )

    expect(descriptor).to include(
      provider: "bilibili",
      renderability: "iframe_candidate",
      embed_url: "https://player.bilibili.com/player.html?bvid=BV1Q541167Qg&page=3",
      dedupe_key: "bilibili:BV1Q541167Qg:page:3",
    )
    expect(descriptor).not_to have_key(:fallback)
  end

  it "normalizes escaped cooked Bilibili iframe text as an iframe candidate" do
    descriptor =
      extract(
        raw: "embedded",
        cooked:
          "&lt;iframe src=&quot;https://player.bilibili.com/player.html?bvid=BV1Q541167Qg&amp;page=2&quot;&gt;&lt;/iframe&gt;",
      )

    expect(descriptor).to include(
      provider: "bilibili",
      renderability: "iframe_candidate",
      embed_url: "https://player.bilibili.com/player.html?bvid=BV1Q541167Qg&page=2",
      dedupe_key: "bilibili:BV1Q541167Qg:page:2",
    )
    expect(descriptor).not_to have_key(:fallback)
  end

  it "defaults cooked Bilibili iframe page to 1 and rejects aid-only iframes as fallback" do
    missing_page =
      extract(
        raw: "embedded",
        cooked: '<iframe src="https://player.bilibili.com/player.html?bvid=BV1Q541167Qg"></iframe>',
      )
    descriptor =
      extract(
        raw: "embedded",
        cooked: '<iframe src="https://player.bilibili.com/player.html?aid=123&cid=456"></iframe>',
      )

    expect(missing_page).to include(
      renderability: "iframe_candidate",
      embed_url: "https://player.bilibili.com/player.html?bvid=BV1Q541167Qg&page=1",
      dedupe_key: "bilibili:BV1Q541167Qg:page:1",
    )
    expect(descriptor).to include(provider: "bilibili", renderability: "fallback")
    expect(descriptor[:dedupe_key]).to start_with("bilibili:invalid:")
    expect(descriptor).not_to have_key(:embed_url)
  end

  it "rejects non-HTTPS Bilibili iframe sources as provider fallback" do
    descriptor =
      extract(
        raw: "embedded",
        cooked: '<iframe src="http://player.bilibili.com/player.html?bvid=BV1Q541167Qg"></iframe>',
      )

    expect(descriptor).to include(provider: "bilibili", renderability: "fallback")
    expect(descriptor[:dedupe_key]).to start_with("bilibili:invalid:")
    expect(descriptor).not_to have_key(:embed_url)
  end

  it "returns iframe candidates for already-cooked YouTube and Vimeo embeds" do
    youtube =
      extract(
        raw: "embedded",
        cooked: '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ?start=30"></iframe>',
      )
    vimeo =
      extract(
        raw: "embedded",
        cooked: '<iframe src="https://player.vimeo.com/video/786646692?badge=0"></iframe>',
      )

    expect(youtube).to include(
      provider: "youtube",
      renderability: "iframe_candidate",
      embed_url: "https://www.youtube.com/embed/dQw4w9WgXcQ",
      dedupe_key: "youtube:dQw4w9WgXcQ",
    )
    expect(youtube).not_to have_key(:fallback)
    expect(vimeo).to include(
      provider: "vimeo",
      renderability: "iframe_candidate",
      embed_url: "https://player.vimeo.com/video/786646692",
      dedupe_key: "vimeo:786646692",
    )
    expect(vimeo).not_to have_key(:fallback)
  end

  it "normalizes raw YouTube page URLs to iframe candidates and keeps raw Vimeo URLs as fallback" do
    youtube = extract(raw: "https://www.youtube.com/watch?v=dQw4w9WgXcQ")
    short = extract(raw: "https://www.youtube.com/shorts/dQw4w9WgXcQ")
    share = extract(raw: "https://youtu.be/dQw4w9WgXcQ?t=30")
    vimeo = extract(raw: "https://vimeo.com/786646692")

    expect(youtube).to include(
      provider: "youtube",
      renderability: "iframe_candidate",
      embed_url: "https://www.youtube.com/embed/dQw4w9WgXcQ",
      dedupe_key: "youtube:dQw4w9WgXcQ",
    )
    expect(short).to include(
      renderability: "iframe_candidate",
      embed_url: "https://www.youtube.com/embed/dQw4w9WgXcQ",
    )
    expect(share).to include(
      renderability: "iframe_candidate",
      embed_url: "https://www.youtube.com/embed/dQw4w9WgXcQ",
    )
    expect(vimeo).to include(provider: "vimeo", renderability: "fallback")
    expect(vimeo[:dedupe_key]).to start_with("vimeo:raw:")
  end

  it "does not recognize TikTok and Douyin links as video sources" do
    tiktok =
      extract(raw: "https://www.tiktok.com/@scout2015/video/6718335390845095173")
    douyin = extract(raw: "https://www.douyin.com/video/7380000000000000001")

    expect(tiktok).to be_nil
    expect(douyin).to be_nil
  end

  it "rejects non-HTTPS and non-allowlisted YouTube iframe sources as provider fallback" do
    non_https =
      extract(
        raw: "embedded",
        cooked: '<iframe src="http://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>',
      )
    apex =
      extract(
        raw: "embedded",
        cooked: '<iframe src="https://youtube.com/embed/dQw4w9WgXcQ"></iframe>',
      )

    expect(non_https).to include(provider: "youtube", renderability: "fallback")
    expect(non_https[:dedupe_key]).to start_with("youtube:raw:")
    expect(apex).to include(provider: "youtube", renderability: "fallback")
    expect(apex[:dedupe_key]).to start_with("youtube:raw:")
  end

  it "returns unsupported intended-video fallback only for unknown video file URLs" do
    descriptor = extract(raw: "https://example.invalid/videos/unsupported-sample.mp4?token=x#frag")

    expect(descriptor).to include(provider: "unsupported", renderability: "fallback", fallback: "post")
    expect(descriptor[:dedupe_key]).to start_with("unsupported:")
    expect(descriptor[:normalized_url]).to eq(
      "https://example.invalid/videos/unsupported-sample.mp4",
    )
  end

  it "rejects arbitrary links, generic video paths, images, audio, documents, and arbitrary iframes" do
    samples = [
      "https://example.invalid/video/123",
      "https://example.invalid/image.png",
      "https://example.invalid/audio.mp3",
      "https://example.invalid/file.pdf",
      "javascript:alert(1)",
      '<iframe src="https://example.invalid/embed/123"></iframe>',
    ]

    samples.each { |raw| expect(extract(raw: raw)).to be_nil }
  end
end
