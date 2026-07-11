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
    SiteSetting.video_shorts_canary_group_ids = ""
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

  it "returns admin-only source and media diagnostics" do
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
    expect(body.dig("media", "kinds")).to include(
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

  it "counts descriptor kinds without exposing media identities" do
    category = Fabricate(:category)
    unsupported_url = "https://example.invalid/videos/unsupported-sample.mp4?token=x"
    make_upload_post(category: category)
    make_text_post(category: category, raw: "https://www.youtube.com/shorts/dQw4w9WgXcQ")
    make_text_post(category: category, raw: "https://www.bilibili.com/video/BV1Q541167Qg")
    make_text_post(category: category, raw: unsupported_url)
    SiteSetting.video_shorts_source_category_ids = category.id.to_s
    sign_in(admin)

    get "/admin/plugins/discourse-video-shorts/diagnostics.json", params: { sample_size: 100, scan_limit: 999 }

    expect(response.status).to eq(200)
    body = response.parsed_body
    expect(body.dig("feed", "requested_sample_size")).to eq(25)
    expect(body.dig("feed", "scan_limit")).to eq(250)
    expect(body.dig("media", "kinds")).to include(
      include("name" => "upload_mp4", "count" => 1),
      include("name" => "youtube", "count" => 1),
      include("name" => "bilibili", "count" => 1),
      include("name" => "fallback", "count" => 1),
    )
    expect(body).not_to have_key("providers")
    expect(body).not_to have_key("renderability")
    expect(response.body).not_to include(URI.parse(unsupported_url).query)
    expect(body["samples"]).to all(
      include("media" => include("kind", "required_origins", "policy_revision", "fallback_reason")),
    )
    expect(body["samples"].all? { |sample| sample["media"].exclude?("identity") }).to eq(true)
    expect(body["samples"].all? { |sample| sample["media"].exclude?("url") }).to eq(true)
    expect(response.body).not_to include("diagnostics.mp4")
  end

  it "defaults malformed sampling parameters" do
    sign_in(admin)

    get "/admin/plugins/discourse-video-shorts/diagnostics.json",
        params: {
          sample_size: "not-a-number",
          scan_limit: "also-not-a-number",
        }

    expect(response.status).to eq(200)
    expect(response.parsed_body.dig("feed", "requested_sample_size")).to eq(10)
    expect(response.parsed_body.dig("feed", "scan_limit")).to eq(100)
  end

  it "reports upload and HLS delivery guidance for CDN-backed video traffic" do
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
          "recommendation" => include("CDN"),
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
  it "denies origin policy writes to anonymous and non-admin users" do
    patch "/admin/plugins/discourse-video-shorts/origins.json",
          params: { origins: ["https://media.example"], external_media_enabled: true }
    expect(response.status).to eq(404)

    sign_in(user)
    patch "/admin/plugins/discourse-video-shorts/origins.json",
          params: { origins: ["https://media.example"], external_media_enabled: true }
    expect(response.status).to eq(404)

    sign_in(moderator)
    patch "/admin/plugins/discourse-video-shorts/origins.json",
          params: { origins: ["https://media.example"], external_media_enabled: true }
    expect(response.status).to eq(404)
  end

  it "rejects non-exact HTTPS origins without changing the policy revision" do
    sign_in(admin)

    get "/admin/plugins/discourse-video-shorts/origins.json"
    revision = response.parsed_body["revision"]

    patch "/admin/plugins/discourse-video-shorts/origins.json",
          params: { origins: ["http://media.example", "https://*.example.com"], external_media_enabled: true }

    expect(response.status).to eq(422)
    expect(response.parsed_body).to include("errors" => include("origin must be a normalized HTTPS origin"))

    get "/admin/plugins/discourse-video-shorts/origins.json"
    expect(response.parsed_body["revision"]).to eq(revision)
  end

  it "writes a monotonic audited external-media policy revision" do
    sign_in(admin)

    patch "/admin/plugins/discourse-video-shorts/origins.json",
          params: { origins: ["https://media.example"], external_media_enabled: true }

    expect(response.status).to eq(200)
    first = response.parsed_body
    expect(first).to include(
      "external_media_enabled" => true,
      "origins" => ["https://media.example"],
      "updated_by_id" => admin.id,
    )

    patch "/admin/plugins/discourse-video-shorts/origins.json",
          params: { origins: ["https://cdn.example"], external_media_enabled: false }

    expect(response.status).to eq(200)
    second = response.parsed_body
    expect(second["revision"]).to eq(first["revision"] + 1)

    audit = DiscourseVideoShorts::OriginPolicyRevision.order(:revision).last
    expect(audit).to have_attributes(
      revision: second["revision"],
      external_media_enabled: false,
      origins: ["https://cdn.example"],
      changed_by_id: admin.id,
    )
  end

  it "accepts PUT through the same audited origin-policy write path" do
    sign_in(admin)

    put "/admin/plugins/discourse-video-shorts/origins.json",
        params: { origins: ["https://media.example"], external_media_enabled: true },
        as: :json

    expect(response.status).to eq(200)
    expect(response.parsed_body).to include(
      "revision" => 1,
      "external_media_enabled" => true,
      "origins" => ["https://media.example"],
      "updated_by_id" => admin.id,
    )
    expect(DiscourseVideoShorts::OriginPolicyRevision.last).to have_attributes(
      revision: 1,
      changed_by_id: admin.id,
    )
  end
  it "coerces JSON and form boolean values while rejecting arbitrary strings" do
    sign_in(admin)

    patch "/admin/plugins/discourse-video-shorts/origins.json",
          params: { origins: ["https://media.example"], external_media_enabled: true },
          as: :json
    expect(response.status).to eq(200)
    expect(response.parsed_body["external_media_enabled"]).to eq(true)

    patch "/admin/plugins/discourse-video-shorts/origins.json",
          params: { origins: ["https://media.example"], external_media_enabled: "false" }
    expect(response.status).to eq(200)
    expect(response.parsed_body["external_media_enabled"]).to eq(false)

    revision = response.parsed_body["revision"]
    patch "/admin/plugins/discourse-video-shorts/origins.json",
          params: { origins: ["https://media.example"], external_media_enabled: "enabled" }
    expect(response.status).to eq(422)
    expect(response.parsed_body).to include(
      "errors" => include("external_media_enabled must be true or false"),
    )

    get "/admin/plugins/discourse-video-shorts/origins.json"
    expect(response.parsed_body["revision"]).to eq(revision)
  end

  it "keeps diagnostics policy and fallback data free of URL query data" do
    sign_in(admin)

    patch "/admin/plugins/discourse-video-shorts/origins.json",
          params: { origins: ["https://media.example"], external_media_enabled: true }
    get "/admin/plugins/discourse-video-shorts/diagnostics.json"

    expect(response.status).to eq(200)
    body = response.parsed_body
    expect(body).to include(
      "kill_switch" => include("active"),
      "canary" => include("enabled", "group_ids"),
      "policy" => include(
        "external_media_enabled" => true,
        "origins" => ["https://media.example"],
        "revision" => be_a(Integer),
        "updated_at" => be_a(String),
      ),
      "runtime" => include("heartbeat", "delta", "authorization_lease", "resources"),
    )
    expect(response.body).not_to include("?")
  end
end
