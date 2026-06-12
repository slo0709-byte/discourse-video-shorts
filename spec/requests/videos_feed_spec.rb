# frozen_string_literal: true

RSpec.describe "Discourse video shorts feed" do
  fab!(:admin)
  fab!(:user)

  before do
    SiteSetting.video_shorts_enabled = true
    SiteSetting.video_shorts_source_category_ids = ""
    SiteSetting.video_shorts_source_tag_names = ""
    SiteSetting.video_shorts_page_size = 20
    SiteSetting.video_shorts_candidate_scan_limit = 500
    SiteSetting.authorized_extensions =
      (SiteSetting.authorized_extensions.split("|") + %w[mp4 webm mov m4v]).uniq.join("|")
  end

  def make_video_post(category:, raw: "Native video", created_at: Time.zone.now)
    upload = Fabricate(:video_upload, extension: "mp4", original_filename: "clip.mp4")
    topic = Fabricate(:topic, category: category, title: "Video topic #{SecureRandom.hex(3)}")
    post = Fabricate(:post, topic: topic, raw: raw, cooked: raw, created_at: created_at)
    Fabricate(:upload_reference, target: post, upload: upload)
    post
  end

  def make_text_post(category:, raw: "Plain text", created_at: Time.zone.now)
    topic = Fabricate(:topic, category: category, title: "Text topic #{SecureRandom.hex(3)}")
    Fabricate(:post, topic: topic, raw: raw, cooked: raw, created_at: created_at)
  end

  it "returns a public native upload feed item with authorized URL fields" do
    category = Fabricate(:category)
    post = make_video_post(category: category)
    SiteSetting.video_shorts_source_category_ids = category.id.to_s

    get "/videos.json"

    expect(response.status).to eq(200)
    item = response.parsed_body["items"].first
    expect(item).to include("topic_id" => post.topic_id, "post_id" => post.id)
    expect(item["media"]).to include(
      "provider" => "native",
      "renderability" => "native",
      "dedupe_key" => "native:upload:#{post.uploads.first.id}",
    )
    expect(item["media"]["video_url"]).to be_present
  end

  it "serializes native post action summary fields for frontend action wiring" do
    category = Fabricate(:category)
    make_video_post(category: category)
    SiteSetting.video_shorts_source_category_ids = category.id.to_s
    sign_in(user)

    get "/videos.json"

    item = response.parsed_body["items"].first
    expect(item["native_action_summary"]).to be_an(Array)
    expect(item["native_action_summary"]).to include(
      include("id" => PostActionType.types[:like], "can_act" => true),
    )
  end

  it "excludes private category videos for anonymous users" do
    public_category = Fabricate(:category)
    private_category = Fabricate(:private_category, group: Fabricate(:group))
    public_post = make_video_post(category: public_category)
    private_post = make_video_post(category: private_category)
    SiteSetting.video_shorts_source_category_ids = [public_category.id, private_category.id].join("|")

    get "/videos.json"

    post_ids = response.parsed_body["items"].map { |item| item["post_id"] }
    expect(post_ids).to include(public_post.id)
    expect(post_ids).not_to include(private_post.id)
  end

  it "omits videos after access is revoked between cursor pages" do
    group = Fabricate(:group)
    group.add(user)
    public_category = Fabricate(:category)
    private_category = Fabricate(:private_category, group: group)
    public_post = make_video_post(category: public_category, created_at: 2.minutes.ago)
    private_post = make_video_post(category: private_category, created_at: 1.minute.ago)
    SiteSetting.video_shorts_source_category_ids = [public_category.id, private_category.id].join("|")
    sign_in(user)

    get "/videos.json", params: { page_size: 1 }

    expect(response.status).to eq(200)
    expect(response.parsed_body["items"].map { |item| item["post_id"] }).to eq([private_post.id])
    cursor = response.parsed_body["next_cursor"]
    group.remove(user)

    get "/videos.json", params: { page_size: 10, cursor: cursor }

    expect(response.status).to eq(200)
    post_ids = response.parsed_body["items"].map { |item| item["post_id"] }
    expect(post_ids).to include(public_post.id)
    expect(post_ids).not_to include(private_post.id)
    expect(response.body).not_to include("Video Shorts Private QA")
  end

  it "returns anonymous-safe empty JSON when no source is configured" do
    get "/videos.json"

    expect(response.status).to eq(200)
    expect(response.parsed_body).to include(
      "items" => [],
      "next_cursor" => nil,
      "scan_limit_reached" => false,
    )
    expect(response.body).not_to include("Video Shorts Private QA")
  end

  it "serializes known embeddable providers with sanitized embed URLs" do
    category = Fabricate(:category)
    post =
      make_text_post(
        category: category,
        raw: "https://www.bilibili.com/video/BV1Q541167Qg?tracking=1#fragment",
      )
    SiteSetting.video_shorts_source_category_ids = category.id.to_s

    get "/videos.json"

    item = response.parsed_body["items"].first
    expect(item).to include("post_id" => post.id)
    expect(item["media"]).to include(
      "provider" => "bilibili",
      "renderability" => "iframe_candidate",
      "embed_url" => "https://player.bilibili.com/player.html?bvid=BV1Q541167Qg&page=1",
      "dedupe_key" => "bilibili:BV1Q541167Qg:page:1",
    )
    expect(item["media"]).not_to have_key("fallback")
  end

  it "serializes YouTube iframe candidates with embed_url" do
    category = Fabricate(:category)
    post =
      make_text_post(
        category: category,
        raw: '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ?start=30"></iframe>',
      )
    SiteSetting.video_shorts_source_category_ids = category.id.to_s

    get "/videos.json"

    item = response.parsed_body["items"].first
    expect(item).to include("post_id" => post.id)
    expect(item["media"]).to include(
      "provider" => "youtube",
      "renderability" => "iframe_candidate",
      "embed_url" => "https://www.youtube.com/embed/dQw4w9WgXcQ",
      "dedupe_key" => "youtube:dQw4w9WgXcQ",
    )
    expect(item["media"]).not_to have_key("fallback")
  end

  it "serializes escaped provider iframes as embeds without leaking iframe markup into excerpt" do
    category = Fabricate(:category)
    post =
      make_text_post(
        category: category,
        raw: "embedded",
        cooked:
          "<p>Watch this</p><p>&lt;iframe src=&quot;https://player.bilibili.com/player.html?bvid=BV1Q541167Qg&amp;page=2&quot;&gt;&lt;/iframe&gt;</p>",
      )
    SiteSetting.video_shorts_source_category_ids = category.id.to_s

    get "/videos.json"

    item = response.parsed_body["items"].first
    expect(item).to include("post_id" => post.id)
    expect(item["media"]).to include(
      "provider" => "bilibili",
      "renderability" => "iframe_candidate",
      "embed_url" => "https://player.bilibili.com/player.html?bvid=BV1Q541167Qg&page=2",
      "dedupe_key" => "bilibili:BV1Q541167Qg:page:2",
    )
    expect(item["media"]).not_to have_key("fallback")
    expect(item["excerpt"]).to include("Watch this")
    expect(item["excerpt"]).not_to include("iframe")
    expect(item["excerpt"]).not_to include("player.bilibili.com")
  end

  it "scans past non-video candidates and resumes after scan-limit cursors" do
    category = Fabricate(:category)
    video = make_video_post(category: category, created_at: 2.minutes.ago)
    make_text_post(category: category, created_at: 1.minute.ago)
    SiteSetting.video_shorts_source_category_ids = category.id.to_s

    get "/videos.json", params: { page_size: 1, scan_limit: 1 }

    expect(response.status).to eq(200)
    expect(response.parsed_body["items"]).to eq([])
    expect(response.parsed_body["scan_limit_reached"]).to eq(true)
    cursor = response.parsed_body["next_cursor"]
    expect(cursor).to be_present

    get "/videos.json", params: { page_size: 1, scan_limit: 10, cursor: cursor }

    expect(response.status).to eq(200)
    expect(response.parsed_body["items"].map { |item| item["post_id"] }).to eq([video.id])
  end

  it "rejects tampered and source-scope-mismatched cursors with 400 JSON" do
    category = Fabricate(:category)
    make_video_post(category: category, created_at: 2.minutes.ago)
    make_video_post(category: category, created_at: 1.minute.ago)
    SiteSetting.video_shorts_source_category_ids = category.id.to_s

    get "/videos.json", params: { page_size: 1 }
    cursor = response.parsed_body["next_cursor"]

    get "/videos.json", params: { cursor: "#{cursor}x" }
    expect(response.status).to eq(400)
    expect(response.parsed_body).to include("error" => "invalid_cursor")

    get "/videos.json", params: { page_size: 1 }
    valid_cursor = response.parsed_body["next_cursor"]
    SiteSetting.video_shorts_source_category_ids = Fabricate(:category).id.to_s

    get "/videos.json", params: { cursor: valid_cursor }
    expect(response.status).to eq(400)
    expect(response.parsed_body).to include("error" => "invalid_cursor")
  end

  it "does not invalidate a cursor when only page size changes" do
    category = Fabricate(:category)
    older = make_video_post(category: category, created_at: 2.minutes.ago)
    make_video_post(category: category, created_at: 1.minute.ago)
    SiteSetting.video_shorts_source_category_ids = category.id.to_s

    get "/videos.json", params: { page_size: 1 }
    cursor = response.parsed_body["next_cursor"]

    get "/videos.json", params: { page_size: 50, cursor: cursor }

    expect(response.status).to eq(200)
    expect(response.parsed_body["items"].map { |item| item["post_id"] }).to include(older.id)
  end

  it "returns the disabled JSON contract when the plugin setting is off" do
    SiteSetting.video_shorts_enabled = false

    get "/videos.json"

    expect(response.status).to eq(404)
    expect(response.media_type).to eq("application/json")
  end

  it "does not issue per-item like or bookmark lookup queries" do
    category = Fabricate(:category)
    3.times { |index| make_video_post(category: category, created_at: index.minutes.ago) }
    SiteSetting.video_shorts_source_category_ids = category.id.to_s
    sign_in(user)

    queries = track_sql_queries { get "/videos.json" }

    per_post_action_queries = queries.grep(/FROM "post_actions".*"post_id" = \d/m)
    per_bookmark_queries = queries.grep(/FROM "bookmarks".*"bookmarkable_id" = \d/m)
    expect(per_post_action_queries).to be_empty
    expect(per_bookmark_queries).to be_empty
  end
end
