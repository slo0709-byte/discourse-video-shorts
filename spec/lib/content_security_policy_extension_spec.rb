# frozen_string_literal: true

RSpec.describe DiscourseVideoShorts::ContentSecurityPolicySourceExtension do
  def parse(policy)
    policy
      .split(";")
      .map do |entry|
        directive, *sources = entry.split
        [directive, sources]
      end
      .to_h
  end

  it "uses exact iframe origins while allowing HTTPS media sources" do
    directives = parse(ContentSecurityPolicy.policy)

    expect(directives["frame-src"]).to include(
      "'self'",
      "https://www.youtube.com",
      "https://www.youtube-nocookie.com",
      "https://player.bilibili.com",
      "https://www.bilibili.com",
      "https://player.vimeo.com",
      "https://www.tiktok.com",
      "https://open.douyin.com",
    )
    expect(directives["frame-src"]).not_to include("https:", "http:")
    expect(directives["media-src"]).to include("'self'", "blob:", "https:")
    expect(directives["media-src"]).not_to include("http:")
  end

  it "reflects normalized HLS origins immediately while rejecting unsafe setting values" do
    SiteSetting.video_shorts_hls_allowed_origins =
      "https://MEDIA.example.com:443/hls/index.m3u8|http://insecure.example.com|https://trusted.example.com@evil.example.com|https://*.example.com"

    directives = parse(ContentSecurityPolicy.policy)

    expect(directives["media-src"]).to include("https://media.example.com")
    expect(directives["media-src"]).not_to include(
      "http://insecure.example.com",
      "https://evil.example.com",
      "https://*.example.com",
    )

    SiteSetting.video_shorts_hls_allowed_origins = "https://replacement.example.com/path"
    updated_directives = parse(ContentSecurityPolicy.policy)

    expect(updated_directives["media-src"]).to include("https://replacement.example.com")
    expect(updated_directives["media-src"]).not_to include("https://media.example.com")
  end

  it "keeps normalized HTTPS native upload CDN origins in media-src" do
    global_setting :cdn_url, "https://CDN.example.com/assets"
    global_setting :s3_cdn_url, "https://uploads.example.com/site"

    expect(parse(ContentSecurityPolicy.policy)["media-src"]).to include(
      "https://cdn.example.com",
      "https://uploads.example.com",
    )
  end

  it "does not make unrelated pending directives extendable" do
    builder = ContentSecurityPolicy::Builder.new(base_url: Discourse.base_url)

    builder << { connect_src: ["https://unexpected.example.com"] }

    expect(parse(builder.build)).not_to have_key("connect-src")
  end
end
