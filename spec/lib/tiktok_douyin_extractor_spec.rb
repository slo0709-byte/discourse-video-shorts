# frozen_string_literal: true

RSpec.describe DiscourseVideoShorts::TikTokDouyinExtractor do
  def extract(raw:, cooked: raw)
    post = Fabricate(:post, raw: raw, cooked: cooked)

    described_class.extract(post)
  end

  it "normalizes a canonical TikTok post URL to the official player" do
    descriptor =
      extract(
        raw:
          "https://www.tiktok.com/@scout2015/video/6718335390845095173?is_from_webapp=1#comments",
      )

    expect(descriptor).to include(
      provider: "tiktok",
      renderability: "iframe_candidate",
      embed_url:
        "https://www.tiktok.com/player/v1/6718335390845095173?autoplay=0&loop=1&rel=0",
      dedupe_key: "tiktok:6718335390845095173",
    )
  end

  it "reuses the native Discourse TikTok lazy-video marker" do
    descriptor =
      extract(
        raw: "https://www.tiktok.com/@scout2015/video/6718335390845095173",
        cooked: <<~HTML,
          <div
            class="tiktok-onebox lazy-video-container"
            data-video-id="6718335390845095173"
            data-provider-name="tiktok">
          </div>
        HTML
      )

    expect(descriptor).to include(
      provider: "tiktok",
      renderability: "iframe_candidate",
      embed_url:
        "https://www.tiktok.com/player/v1/6718335390845095173?autoplay=0&loop=1&rel=0",
    )
  end

  it "normalizes a cooked TikTok embed while discarding untrusted player parameters" do
    descriptor =
      extract(
        raw: "embedded",
        cooked:
          '<iframe src="https://www.tiktok.com/player/v1/6718335390845095173?autoplay=1&token=secret"></iframe>',
      )

    expect(descriptor).to include(
      provider: "tiktok",
      renderability: "iframe_candidate",
      embed_url:
        "https://www.tiktok.com/player/v1/6718335390845095173?autoplay=0&loop=1&rel=0",
    )
    expect(descriptor[:embed_url]).not_to include("token", "secret")
  end

  it "normalizes a canonical Douyin video URL to the official player" do
    descriptor =
      extract(
        raw:
          "https://www.douyin.com/video/7380000000000000001?previous_page=web_code_link#reply",
      )

    expect(descriptor).to include(
      provider: "douyin",
      renderability: "iframe_candidate",
      embed_url:
        "https://open.douyin.com/player/video?vid=7380000000000000001&autoplay=0",
      dedupe_key: "douyin:7380000000000000001",
    )
  end

  it "normalizes an official cooked Douyin iframe while discarding extra parameters" do
    descriptor =
      extract(
        raw: "embedded",
        cooked:
          '<iframe src="https://open.douyin.com/player/video?vid=7380000000000000001&autoplay=1&token=secret"></iframe>',
      )

    expect(descriptor).to include(
      provider: "douyin",
      renderability: "iframe_candidate",
      embed_url:
        "https://open.douyin.com/player/video?vid=7380000000000000001&autoplay=0",
    )
    expect(descriptor[:embed_url]).not_to include("token", "secret")
  end

  it "keeps unresolved platform short links as original-topic fallbacks" do
    tiktok = extract(raw: "https://vm.tiktok.com/ZMexample/")
    douyin = extract(raw: "https://v.douyin.com/example/")

    expect(tiktok).to include(
      provider: "tiktok",
      renderability: "fallback",
      fallback: "post",
      fallback_reason: "tiktok_short_link_requires_canonical_url",
    )
    expect(douyin).to include(
      provider: "douyin",
      renderability: "fallback",
      fallback: "post",
      fallback_reason: "douyin_short_link_requires_canonical_url",
    )
  end

  it "rejects deceptive authorities, hosts, and nonnumeric video identifiers" do
    samples = [
      "https://www.tiktok.com.evil.example/@user/video/6718335390845095173",
      "https://www.tiktok.com:444/@user/video/6718335390845095173",
      "https://user:pass@www.tiktok.com/@user/video/6718335390845095173",
      "https://www.tiktok.com/@user/video/not-a-video-id",
      "https://open.douyin.com.evil.example/player/video?vid=7380000000000000001",
      "https://open.douyin.com:444/player/video?vid=7380000000000000001",
      "https://user:pass@www.douyin.com/video/7380000000000000001",
      "https://open.douyin.com/player/video?vid%5B%5D=7380000000000000001&vid=7380000000000000001",
      "https://open.douyin.com/player/video?vid=7380000000000000001&vid=7380000000000000001",
      "https://www.douyin.com/video/not-a-video-id",
    ]

    samples.each { |raw| expect(extract(raw: raw)).to be_nil }
  end
end
