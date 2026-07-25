# frozen_string_literal: true

require "uri"

RSpec.describe "Discourse video shorts admin diagnostics" do
  fab!(:admin)
  fab!(:user)
  fab!(:moderator)

  before do
    SiteSetting.video_shorts_enabled = true
    SiteSetting.video_shorts_source_category_ids = ""
    SiteSetting.video_shorts_source_tag_names = ""
    SiteSetting.video_shorts_page_size = 20
    SiteSetting.video_shorts_candidate_scan_limit = 500
    SiteSetting.tagging_enabled = true
    SiteSetting.authorized_extensions =
      (SiteSetting.authorized_extensions.split("|") + %w[mp4 webm mov m4v]).uniq.join("|")
  end

  def make_text_post(category:, raw:, cooked: raw)
    topic = Fabricate(:topic, category: category, title: "Video diagnostics #{SecureRandom.hex(3)}")
    Fabricate(:post, topic: topic, raw: raw, cooked: cooked)
  end

  def make_tagged_text_post(tag:, raw:, cooked: raw)
    topic = Fabricate(:topic, tags: [tag], title: "Video diagnostics #{SecureRandom.hex(3)}")
    Fabricate(:post, topic: topic, raw: raw, cooked: cooked)
  end

  def make_upload_post(category:)
    post = make_text_post(category: category, raw: "native upload")
    upload = Fabricate(:video_upload, extension: "mp4", original_filename: "diagnostics.mp4")
    Fabricate(:upload_reference, target: post, upload: upload)
    post
  end

  def warning_codes(body)
    body.dig("sources", "warnings").map { |warning| warning["code"] }
  end

  it "rejects anonymous, regular user, and moderator requests" do
    get "/admin/plugins/discourse-video-shorts/diagnostics.json"
    expect(response.status).to eq(404)

    sign_in(user)
    get "/admin/plugins/discourse-video-shorts/diagnostics.json"
    expect(response.status).to eq(404)

    sign_in(moderator)
    get "/admin/plugins/discourse-video-shorts/diagnostics.json"
    expect(response.status).to eq(404)
  end

  it "returns admin-only source and provider diagnostics" do
    category = Fabricate(:category)
    make_text_post(category: category, raw: "https://www.youtube.com/shorts/dQw4w9WgXcQ?feature=share")
    make_text_post(category: category, raw: "https://www.bilibili.com/video/BV1Q541167Qg?tracking=secret")
    SiteSetting.video_shorts_source_category_ids = "#{category.id}|999999"
    sign_in(admin)

    get "/admin/plugins/discourse-video-shorts/diagnostics.json"

    expect(response.status).to eq(200)
    body = response.parsed_body
    expect(body["enabled"]).to eq(true)
    expect(body.dig("sources", "configured", "category_ids")).to include(category.id, 999_999)
    expect(body.dig("sources", "configured", "categories")).to include(
      include("id" => category.id, "name" => category.name, "slug" => category.slug),
    )
    expect(body.dig("sources", "effective", "category_ids")).to include(category.id)
    expect(body.dig("sources", "effective", "categories")).to include(
      include("id" => category.id, "name" => category.name, "slug" => category.slug),
    )
    expect(body.dig("sources", "warnings")).to include(include("code" => "invalid_category_ids"))
    expect(body.dig("providers", "counts")).to include(
      include("name" => "youtube", "count" => 1),
      include("name" => "bilibili", "count" => 1),
    )
    expect(body["samples"].length).to eq(2)
    expect(body["samples"]).to all(
      include(
        "category" => include("id" => category.id, "name" => category.name, "slug" => category.slug),
      ),
    )
  end

  it "serializes invalid tag warnings without hiding effective tag sources" do
    tag = Fabricate(:tag, name: "diagnostics-clips")
    make_tagged_text_post(tag: tag, raw: "https://www.youtube.com/shorts/dQw4w9WgXcQ")
    SiteSetting.video_shorts_source_tag_names = "#{tag.name}|Missing-Diagnostics-Tag"
    sign_in(admin)

    get "/admin/plugins/discourse-video-shorts/diagnostics.json"

    expect(response.status).to eq(200)
    body = response.parsed_body
    expect(body.dig("sources", "configured", "tag_names")).to eq(
      %w[diagnostics-clips missing-diagnostics-tag],
    )
    expect(body.dig("sources", "configured", "tags")).to include(include("name" => "diagnostics-clips"))
    expect(body.dig("sources", "effective", "tag_names")).to eq(["diagnostics-clips"])
    expect(body.dig("sources", "effective", "tags")).to include(include("name" => "diagnostics-clips"))
    expect(body.dig("sources", "warnings")).to include(
      include("code" => "invalid_tag_names", "names" => ["missing-diagnostics-tag"]),
    )
    expect(body["samples"]).to include(include("tags" => include(include("name" => "diagnostics-clips"))))
    expect(warning_codes(body)).not_to include("no_effective_sources")
  end

  it "serializes no-effective-source warnings for invalid configured sources" do
    SiteSetting.video_shorts_source_category_ids = "999999"
    SiteSetting.video_shorts_source_tag_names = "missing-diagnostics-tag"
    sign_in(admin)

    get "/admin/plugins/discourse-video-shorts/diagnostics.json"

    expect(response.status).to eq(200)
    body = response.parsed_body
    expect(warning_codes(body)).to include(
      "invalid_category_ids",
      "invalid_tag_names",
      "no_effective_sources",
    )
    expect(body.dig("sources", "warnings")).to include(
      include("code" => "invalid_category_ids", "ids" => [999_999]),
      include("code" => "invalid_tag_names", "names" => ["missing-diagnostics-tag"]),
    )
    expect(body.dig("feed", "sample_size")).to eq(0)
    expect(body["samples"]).to eq([])
  end

  it "serializes tagging-disabled warnings" do
    tag = Fabricate(:tag, name: "diagnostics-disabled-tag")
    SiteSetting.video_shorts_source_tag_names = tag.name
    SiteSetting.tagging_enabled = false
    sign_in(admin)

    get "/admin/plugins/discourse-video-shorts/diagnostics.json"

    expect(response.status).to eq(200)
    expect(warning_codes(response.parsed_body)).to include("tagging_disabled", "no_effective_sources")
  end

  it "counts native, provider iframe, fallback, and unsupported diagnostics outcomes" do
    category = Fabricate(:category)
    unsupported_url = "https://example.invalid/videos/unsupported-sample.mp4?token=x"
    make_upload_post(category: category)
    make_text_post(category: category, raw: "https://www.youtube.com/shorts/dQw4w9WgXcQ")
    make_text_post(category: category, raw: "https://www.bilibili.com/video/BV1Q541167Qg")
    make_text_post(
      category: category,
      raw: "embedded vimeo",
      cooked: '<iframe src="https://player.vimeo.com/video/786646692?badge=0"></iframe>',
    )
    make_text_post(category: category, raw: "https://vimeo.com/786646692")
    make_text_post(category: category, raw: unsupported_url)
    SiteSetting.video_shorts_source_category_ids = category.id.to_s
    sign_in(admin)

    get "/admin/plugins/discourse-video-shorts/diagnostics.json", params: { sample_size: 100, scan_limit: 999 }

    expect(response.status).to eq(200)
    body = response.parsed_body
    expect(body.dig("feed", "requested_sample_size")).to eq(25)
    expect(body.dig("feed", "scan_limit")).to eq(999)
    expect(body.dig("providers", "counts")).to include(
      include("name" => "native", "count" => 1),
      include("name" => "youtube", "count" => 1),
      include("name" => "bilibili", "count" => 1),
      include("name" => "vimeo", "count" => 2),
      include("name" => "fallback", "count" => 0),
      include("name" => "unsupported", "count" => 1),
    )
    expect(body.dig("renderability", "counts")).to include(
      include("name" => "native", "count" => 1),
      include("name" => "iframe_candidate", "count" => 3),
      include("name" => "fallback", "count" => 2),
    )
    expect(response.body).not_to include(URI.parse(unsupported_url).query)
    expect(body["samples"].all? { |sample| sample["media"].exclude?("dedupe_key") }).to eq(true)
    expect(body["samples"].all? { |sample| sample["media"].exclude?("upload_id") }).to eq(true)
    expect(body["samples"].all? { |sample| sample["media"].exclude?("video_url") }).to eq(true)
    expect(response.body).not_to include("diagnostics.mp4")
  end

  it "defaults malformed sampling parameters to configured feed limits" do
    sign_in(admin)

    get "/admin/plugins/discourse-video-shorts/diagnostics.json",
        params: {
          sample_size: "not-a-number",
          scan_limit: "also-not-a-number",
        }

    expect(response.status).to eq(200)
    expect(response.parsed_body.dig("feed", "requested_sample_size")).to eq(10)
    expect(response.parsed_body.dig("feed", "scan_limit")).to eq(500)
  end

  it "finds HLS candidates beyond the first 100 configured posts" do
    category = Fabricate(:category)
    hls_post = make_text_post(category: category, raw: "https://stream.example.com/diagnostics.m3u8")
    100.times { make_text_post(category: category, raw: "not a video candidate") }
    SiteSetting.video_shorts_source_category_ids = category.id.to_s
    SiteSetting.video_shorts_candidate_scan_limit = 101
    SiteSetting.video_shorts_hls_allowed_origins = "https://stream.example.com"
    sign_in(admin)

    get "/admin/plugins/discourse-video-shorts/diagnostics.json"

    expect(response.status).to eq(200)
    body = response.parsed_body
    expect(body.dig("feed", "scan_limit")).to eq(101)
    expect(body.dig("providers", "counts")).to include(include("name" => "hls", "count" => 1))
    expect(body.dig("renderability", "counts")).to include(include("name" => "hls", "count" => 1))
    expect(body["samples"]).to include(include("post_id" => hls_post.id))
  end

  it "reports upload and HLS delivery guidance for CDN-backed video traffic" do
    SiteSetting.video_shorts_hls_allowed_origins =
      "https://stream.example.com|https://segments.example.com/path"
    sign_in(admin)

    get "/admin/plugins/discourse-video-shorts/diagnostics.json"

    expect(response.status).to eq(200)
    expect(response.parsed_body["delivery"]).to include(
      "native_uploads" =>
        include(
          "object_storage_enabled" => SiteSetting.enable_s3_uploads,
          "s3_cdn_url" => SiteSetting.Upload.s3_cdn_url.presence,
          "site_cdn_url" => GlobalSetting.cdn_url.presence,
        ),
      "hls" =>
        include(
          "requires_https" => true,
          "allowed_origins" => ["https://stream.example.com", "https://segments.example.com"],
          "media_csp_sources" => include("'self'", "blob:", "https://stream.example.com"),
          "recommendation" => include("HTTPS"),
        ),
    )
  end

  it "does not expose raw iframe markup, signed cursors, or token-like provider query params" do
    category = Fabricate(:category)
    unsafe_provider_url = "https://www.youtube.com/embed/dQw4w9WgXcQ?token=secret"
    make_text_post(
      category: category,
      raw: "embedded",
      cooked: "<p>&lt;iframe src=\"#{unsafe_provider_url}\"&gt;&lt;/iframe&gt;</p>",
    )
    SiteSetting.video_shorts_source_category_ids = category.id.to_s
    sign_in(admin)

    get "/admin/plugins/discourse-video-shorts/diagnostics.json"

    expect(response.status).to eq(200)
    expect(response.body).not_to include("<iframe")
    expect(response.body).not_to include("&lt;iframe")
    expect(response.body).not_to include("next_cursor")
    expect(response.body).not_to include(URI.parse(unsafe_provider_url).query)
  end
end
