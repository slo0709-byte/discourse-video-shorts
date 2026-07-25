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

  def make_text_post(category:, raw: "Plain text", cooked: nil, created_at: Time.zone.now)
    topic = Fabricate(:topic, category: category, title: "Text topic #{SecureRandom.hex(3)}")
    Fabricate(:post, topic: topic, raw: raw, cooked: cooked || raw, created_at: created_at)
  end

  def direct_reply(parent, raw:)
    reply =
      Fabricate(
        :post,
        topic: parent.topic,
        raw: raw,
        cooked: "<p>#{raw}</p>",
        reply_to_post_number: parent.post_number,
      )
    PostReply.create!(post: parent, reply: reply)
    reply
  end

  def hide_post(post)
    post.update_columns(
      hidden: true,
      hidden_at: Time.zone.now,
      hidden_reason_id: Post.hidden_reasons[:flag_threshold_reached],
    )
  end

  it "returns a public native upload feed item with authorized URL fields" do
    category = Fabricate(:category)
    post = make_video_post(category: category)
    SiteSetting.video_shorts_source_category_ids = category.id.to_s

    get "/videos.json"

    expect(response.status).to eq(200)
    item = response.parsed_body["items"].first
    expect(item).to include("topic_id" => post.topic_id, "post_id" => post.id)
    expect(item["message_bus_last_id"]).to be_a(Integer)
    expect(item["media"]).to include(
      "provider" => "native",
      "renderability" => "native",
      "dedupe_key" => "native:upload:#{post.uploads.first.id}",
    )
    expect(item["media"]["video_url"]).to be_present
  end

  it "serializes a category-backed visual accent color for comments chrome" do
    category = Fabricate(:category, color: "0F766E")
    make_video_post(category: category)
    SiteSetting.video_shorts_source_category_ids = category.id.to_s

    get "/videos.json"

    item = response.parsed_body["items"].first
    expect(item["visual_accent_color"]).to eq("#0F766E")
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

  it "serializes Guardian-scoped native topic capabilities" do
    category = Fabricate(:category)
    make_video_post(category: category)
    SiteSetting.video_shorts_source_category_ids = category.id.to_s

    sign_in(admin)
    get "/videos.json"
    expect(response.parsed_body.dig("items", 0, "topic_details")).to include(
      "can_edit_staff_notes" => true,
    )

    sign_in(user)
    get "/videos.json"
    expect(response.parsed_body.dig("items", 0, "topic_details")).to include(
      "can_edit_staff_notes" => false,
    )
  end

  it "serializes the complete OP topic discussion as visible video comments" do
    category = Fabricate(:category)
    video_post = create_post(category: category, raw: "Native video with discussion")
    upload = Fabricate(:video_upload, extension: "mp4", original_filename: "clip.mp4")
    Fabricate(:upload_reference, target: video_post, upload: upload)
    first_direct_reply = direct_reply(video_post, raw: "First direct reply with enough detail")
    direct_reply(video_post, raw: "Second direct reply with enough detail")
    nested_reply = direct_reply(first_direct_reply, raw: "Nested reply with enough detail")
    direct_reply(nested_reply, raw: "Floor reply with enough detail")
    native_top_level_reply = Fabricate(
      :post,
      topic: video_post.topic,
      raw: "Native top-level topic reply",
      cooked: "<p>Native top-level topic reply</p>",
    )
    SiteSetting.video_shorts_source_category_ids = category.id.to_s

    direct_reply_count = PostReply.where(post: video_post).count
    visible_descendant_count = 5
    visible_topic_comment_count = video_post.topic.reload.posts_count - 1

    get "/videos.json"

    item = response.parsed_body["items"].find { |feed_item| feed_item["post_id"] == video_post.id }
    expect(response.status).to eq(200)
    expect(item).to be_present
    expect(direct_reply_count).to eq(2)
    expect(native_top_level_reply.reply_to_post_number).to be_nil
    expect(visible_descendant_count).to eq(visible_topic_comment_count)
    expect(item["counts"]["reply_count"]).to eq(visible_descendant_count)
  end

  it "uses one batch comment-count traversal for all emitted feed posts" do
    category = Fabricate(:category)
    first_video = make_video_post(category: category, created_at: 2.minutes.ago)
    second_video = make_video_post(category: category, created_at: 1.minute.ago)
    direct_reply(first_video, raw: "First video reply")
    direct_reply(second_video, raw: "Second video reply")
    SiteSetting.video_shorts_source_category_ids = category.id.to_s

    allow(DiscourseVideoShorts::CommentCount).to receive(:call).and_call_original

    get "/videos.json"

    expect(response.status).to eq(200)
    expect(DiscourseVideoShorts::CommentCount).to have_received(:call).once
    counts_by_post_id =
      response.parsed_body["items"].to_h do |item|
        [item["post_id"], item.dig("counts", "reply_count")]
      end
    expect(counts_by_post_id).to include(first_video.id => 1, second_video.id => 1)
  end

  it "excludes hidden OP video comments from the feed reply count" do
    category = Fabricate(:category)
    video_post = create_post(category: category, raw: "Native video with hidden discussion")
    upload = Fabricate(:video_upload, extension: "mp4", original_filename: "clip.mp4")
    Fabricate(:upload_reference, target: video_post, upload: upload)
    first_visible_reply = direct_reply(video_post, raw: "Visible direct reply with enough detail")
    hidden_direct_reply = direct_reply(video_post, raw: "Hidden direct reply with enough detail")
    hidden_nested_reply = direct_reply(first_visible_reply, raw: "Hidden nested reply with enough detail")
    visible_nested_reply = direct_reply(first_visible_reply, raw: "Visible nested reply with enough detail")
    hide_post(hidden_direct_reply)
    hide_post(hidden_nested_reply)
    SiteSetting.video_shorts_source_category_ids = category.id.to_s

    get "/videos.json"

    item = response.parsed_body["items"].find { |feed_item| feed_item["post_id"] == video_post.id }
    expect(response.status).to eq(200)
    expect(item).to be_present
    expect(video_post.topic.reload.posts_count).to be > 3
    expect(item["counts"]["reply_count"]).to eq(2)
    expect(item["counts"]["reply_count"]).to eq([first_visible_reply, visible_nested_reply].count)
  end

  it "serializes non-OP video replies as visible descendant comments" do
    category = Fabricate(:category)
    topic_post = create_post(category: category, raw: "Topic root before a video reply")
    video_post = direct_reply(topic_post, raw: "Native video reply with discussion")
    upload = Fabricate(:video_upload, extension: "mp4", original_filename: "clip.mp4")
    Fabricate(:upload_reference, target: video_post, upload: upload)
    first_direct_reply = direct_reply(video_post, raw: "First direct reply to the video reply")
    second_direct_reply = direct_reply(video_post, raw: "Second direct reply to the video reply")
    nested_reply = direct_reply(first_direct_reply, raw: "Nested reply to the first direct reply")
    floor_reply = direct_reply(nested_reply, raw: "Floor reply to the nested reply")
    SiteSetting.video_shorts_source_category_ids = category.id.to_s

    direct_reply_count = PostReply.where(post: video_post).count
    visible_descendant_count = [
      first_direct_reply,
      second_direct_reply,
      nested_reply,
      floor_reply,
    ].count

    get "/videos.json"

    item = response.parsed_body["items"].find { |feed_item| feed_item["post_id"] == video_post.id }
    expect(response.status).to eq(200)
    expect(item).to be_present
    expect(direct_reply_count).to eq(2)
    expect(direct_reply_count).to be < visible_descendant_count
    expect(item["counts"]["reply_count"]).to eq(visible_descendant_count)
  end

  it "pins visible descendant counts and source-post permissions" do
    group = Fabricate(:group)
    group.add(user)
    category = Fabricate(:private_category, group: group)
    video_post = make_video_post(category: category, raw: "Private video with discussion")
    direct = direct_reply(video_post, raw: "Visible direct reply")
    nested = direct_reply(direct, raw: "Visible nested reply")
    deleted = direct_reply(nested, raw: "Deleted descendant reply")
    deleted.trash!(admin)
    direct_reply(
      Fabricate(:post, topic: video_post.topic, raw: "Native top-level reply"),
      raw: "Native top-level descendant",
    )
    SiteSetting.video_shorts_source_category_ids = category.id.to_s

    sign_in(user)
    get "/videos.json"

    expect(response.status).to eq(200)
    item = response.parsed_body["items"].find { |candidate| candidate["post_id"] == video_post.id }
    expect(item["counts"]["reply_count"]).to eq(4)
    expect(item["actions"]).to include("can_like" => true, "can_reply" => true)
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

  it "keeps an unlisted HTTPS HLS source playable without leaking it into the excerpt" do
    category = Fabricate(:category)
    hls_url = "https://untrusted.example.com/live/private-video.m3u8"
    post =
      make_text_post(
        category: category,
        raw: hls_url,
        cooked:
          "<p>Watch from the topic</p><p><a href=\"#{hls_url}\" class=\"onebox\">#{hls_url}</a></p>",
      )
    SiteSetting.video_shorts_source_category_ids = category.id.to_s
    SiteSetting.video_shorts_hls_allowed_origins = ""

    get "/videos.json"

    item = response.parsed_body["items"].first
    expect(item).to include("post_id" => post.id)
    expect(item["media"]).to include(
      "provider" => "hls",
      "renderability" => "hls",
      "hls_url" => hls_url,
    )
    expect(item["excerpt"]).to include("Watch from the topic")
    expect(item["excerpt"]).not_to include("m3u8", "untrusted.example.com", "<a")
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

  it "loads feed candidates only once while preserving scoped pagination" do
    category = Fabricate(:category)
    older = make_video_post(category: category, created_at: 2.minutes.ago)
    newer = make_video_post(category: category, created_at: 1.minute.ago)
    SiteSetting.video_shorts_source_category_ids = category.id.to_s

    expect_any_instance_of(DiscourseVideoShorts::SourceSelection).not_to receive(:candidate_posts)

    get "/videos.json", params: { page_size: 1 }

    expect(response.status).to eq(200)
    expect(response.parsed_body["items"].map { |item| item["post_id"] }).to eq([newer.id])
    expect(response.parsed_body["next_cursor"]).to be_present
    expect(response.parsed_body["scan_limit_reached"]).to eq(false)

    get "/videos.json", params: { page_size: 1, cursor: response.parsed_body["next_cursor"] }

    expect(response.status).to eq(200)
    expect(response.parsed_body["items"].map { |item| item["post_id"] }).to eq([older.id])
    expect(response.parsed_body["next_cursor"]).to be_nil
    expect(response.parsed_body["scan_limit_reached"]).to eq(false)
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

  it "reuses cached media extraction descriptors across feed requests" do
    category = Fabricate(:category)
    post = make_video_post(category: category)
    upload = post.uploads.first
    SiteSetting.video_shorts_source_category_ids = category.id.to_s

    DiscourseVideoShorts::MediaExtractor
      .expects(:extract_media_for_visible_post)
      .once
      .returns(
        provider: "native",
        renderability: "native",
        dedupe_key: "native:upload:#{upload.id}",
        upload: {
          id: upload.id,
          sha1: upload.sha1,
          extension: upload.extension,
          original_filename: upload.original_filename,
          filesize: upload.filesize,
          secure: upload.secure?,
        },
      )

    2.times do
      get "/videos.json"
      expect(response.status).to eq(200)
      expect(response.parsed_body["items"].first["media"]).to include(
        "provider" => "native",
        "dedupe_key" => "native:upload:#{upload.id}",
      )
    end
  end
end
