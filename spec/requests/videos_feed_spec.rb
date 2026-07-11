# frozen_string_literal: true

RSpec.describe "Discourse video shorts feed" do
  fab!(:user)

  before do
    SiteSetting.video_shorts_enabled = true
    SiteSetting.video_shorts_source_category_ids = ""
    SiteSetting.video_shorts_source_tag_names = ""
    SiteSetting.video_shorts_page_size = 20
    SiteSetting.video_shorts_candidate_scan_limit = 500
    SiteSetting.authorized_extensions =
      (SiteSetting.authorized_extensions.split("|") + ["mp4"]).uniq.join("|")
    allow(DiscourseVideoShorts::MediaExtractorCache).to receive(:extract_media_for_visible_post) do |post, _guardian, policy_snapshot:|
      {
        kind: "upload_mp4",
        identity: "upload:#{post.id}",
        url: "/uploads/#{post.id}.mp4",
        required_origins: [],
        policy_revision: 0,
        fallback_reason: nil,
      }
    end
  end

  def post_in(category:, created_at: Time.zone.now)
    topic = Fabricate(:topic, category: category)
    Fabricate(:post, topic: topic, created_at: created_at)
  end
  def uploaded_mp4_post_in(category:, secure: false)
    post = post_in(category: category)
    upload = Fabricate(:video_upload, extension: "mp4", original_filename: "clip.mp4")
    upload.update!(secure: true) if secure
    Fabricate(:upload_reference, target: post, upload: upload)
    [post, upload]
  end


  def tag_topic(topic, tag)
    TopicTag.create!(topic: topic, tag: tag)
  end

  it "does not expose secure uploads from Guardian-invisible posts" do
    public_category = Fabricate(:category)
    group = Fabricate(:group)
    private_category = Fabricate(:private_category, group: group)
    public_post, = uploaded_mp4_post_in(category: public_category)
    private_post, private_upload = uploaded_mp4_post_in(category: private_category, secure: true)
    SiteSetting.authorized_extensions =
      (SiteSetting.authorized_extensions.split("|") + ["mp4"]).uniq.join("|")
    SiteSetting.video_shorts_source_category_ids = [public_category.id, private_category.id].join("|")
    allow(DiscourseVideoShorts::MediaExtractorCache).to receive(:extract_media_for_visible_post).and_call_original

    get "/videos.json"

    expect(response).to have_http_status(:ok)
    expect(response.parsed_body.fetch("items").map { |item| item.fetch("post_id") }).to contain_exactly(public_post.id)
    expect(response.body).not_to include(private_post.id.to_s)
    expect(response.body).not_to include(UrlHelper.cook_url(private_upload.url, secure: true, local: true))
  end

  it "matches configured categories or tags and includes replies" do
    category = Fabricate(:category)
    other_category = Fabricate(:category)
    tag = Fabricate(:tag, name: "shorts-source")
    category_post = post_in(category: category, created_at: 3.minutes.ago)
    tagged_topic = Fabricate(:topic, category: other_category)
    parent = Fabricate(:post, topic: tagged_topic)
    tagged_reply = Fabricate(:post, topic: tagged_topic, reply_to_post_number: parent.post_number, created_at: 2.minutes.ago)
    PostReply.create!(post: parent, reply: tagged_reply)
    tag_topic(tagged_topic, tag)
    excluded = post_in(category: other_category, created_at: 1.minute.ago)
    SiteSetting.video_shorts_source_category_ids = category.id.to_s
    SiteSetting.video_shorts_source_tag_names = tag.name

    get "/videos.json"

    expect(response.parsed_body.fetch("items").map { |item| item.fetch("post_id") }).to include(tagged_reply.id, category_post.id)
    expect(response.body).not_to include(excluded.id.to_s)
  end

  it "returns the fixed item, action, count, and media schema" do
    category = Fabricate(:category)
    post_in(category: category)
    SiteSetting.video_shorts_source_category_ids = category.id.to_s

    get "/videos.json"

    body = response.parsed_body
    expect(body.keys).to contain_exactly("schema_version", "feed_revision", "items", "next_cursor", "scan")
    item = body.fetch("items").first
    expect(item.keys).to contain_exactly("topic_id", "post_id", "post_number", "topic_url", "post_url", "title", "excerpt", "username", "avatar_template", "created_at", "counts", "actions", "media")
    expect(item.fetch("counts").keys).to contain_exactly("like_count", "reply_count", "bookmark_count")
    expect(item.fetch("actions").keys).to contain_exactly("liked", "bookmarked", "can_like", "can_bookmark", "can_reply", "can_flag", "share_url")
    expect(item.fetch("media").keys).to contain_exactly("kind", "identity", "url", "required_origins", "policy_revision", "fallback_reason")
  end

  it "serializes excerpts as plain text instead of escaped markup" do
    category = Fabricate(:category)
    post = post_in(category: category)
    url = "https://example.invalid/videos/unsupported.mp4?token=private#fragment"
    post.update_columns(raw: url, cooked: PrettyText.cook(url))
    SiteSetting.video_shorts_source_category_ids = category.id.to_s

    get "/videos.json"

    excerpt = response.parsed_body.fetch("items").first.fetch("excerpt")
    expect(excerpt).to eq(url)
    expect(excerpt).not_to include("<a")
  end
  it "serializes a playable authorized URL for uploaded MP4 media" do
    category = Fabricate(:category)
    post, upload = uploaded_mp4_post_in(category: category)
    SiteSetting.authorized_extensions =
      (SiteSetting.authorized_extensions.split("|") + ["mp4"]).uniq.join("|")
    SiteSetting.video_shorts_source_category_ids = category.id.to_s
    allow(DiscourseVideoShorts::MediaExtractorCache).to receive(:extract_media_for_visible_post).and_call_original

    get "/videos.json"

    media = response.parsed_body.fetch("items").find { |item| item.fetch("post_id") == post.id }.fetch("media")
    expect(media).to eq(
      "kind" => "upload_mp4",
      "identity" => "v1:upload:#{upload.id}:#{upload.sha1}",
      "url" => UrlHelper.cook_url(upload.url, secure: upload.secure?, local: true),
      "required_origins" => [],
      "policy_revision" => nil,
      "fallback_reason" => nil,
    )
  end

  it "orders newest first, clamps page and scan limits, and continues after an empty bounded scan" do
    category = Fabricate(:category)
    posts = 3.times.map { |index| post_in(category: category, created_at: (index + 1).minutes.ago) }
    SiteSetting.video_shorts_source_category_ids = category.id.to_s
    allow(DiscourseVideoShorts::MediaExtractorCache).to receive(:extract_media_for_visible_post).and_return(nil)

    get "/videos.json", params: { page_size: 99, scan_limit: 1 }

    expect(response).to have_http_status(:ok)
    expect(response.parsed_body).to include("items" => [], "scan" => include("candidates_scanned" => 1, "scan_limit_reached" => true, "end_reached" => false))
    expect(response.parsed_body.fetch("next_cursor")).to be_present
    expect(posts).not_to be_empty
  end

  it "deduplicates media identities across pages without embedding identities in the cursor" do
    category = Fabricate(:category)
    post_in(category: category, created_at: 2.minutes.ago)
    post_in(category: category, created_at: 1.minute.ago)
    SiteSetting.video_shorts_source_category_ids = category.id.to_s
    allow(DiscourseVideoShorts::MediaExtractorCache).to receive(:extract_media_for_visible_post).and_return(
      { kind: "upload_mp4", identity: "same-media", url: "/uploads/same-media.mp4", required_origins: [], policy_revision: 0, fallback_reason: nil },
    )

    get "/videos.json", params: { page_size: 1 }
    cursor = response.parsed_body.fetch("next_cursor")
    get "/videos.json", params: { page_size: 1, cursor: cursor }

    expect(response.parsed_body.fetch("items")).to eq([])
    expect(response.parsed_body.fetch("next_cursor")).to be_nil
  end

  it "keeps cursor bytes bounded as pages advance and rejects missing cursor state" do
    category = Fabricate(:category)
    8.times { |index| post_in(category: category, created_at: index.minutes.ago) }
    SiteSetting.video_shorts_source_category_ids = category.id.to_s

    cursors = []
    cursor = nil
    7.times do
      get "/videos.json", params: { page_size: 1, cursor: cursor }.compact
      cursor = response.parsed_body.fetch("next_cursor")
      break if cursor.blank?

      cursors << cursor
    end

    expect(cursors.length).to be > 3
    expect(cursors.map(&:bytesize).max - cursors.map(&:bytesize).min).to be < 32

    verifier = Rails.application.message_verifier("discourse_video_shorts_cursor")
    payload = verifier.verify(cursors.first)
    expect(payload).to include("state_id")
    expect(payload).not_to have_key("seen_identities")
    Discourse.cache.delete(
      "#{DiscourseVideoShorts::Feed::CURSOR_STATE_KEY_PREFIX}#{payload.fetch("state_id")}",
    )

    get "/videos.json", params: { cursor: cursors.first }
    expect(response).to have_http_status(:bad_request)
    expect(response.parsed_body).to eq("error" => "invalid_cursor")
  end

  it "uses one immutable policy snapshot throughout a request" do
    category = Fabricate(:category)
    2.times { post_in(category: category) }
    SiteSetting.video_shorts_source_category_ids = category.id.to_s
    snapshot = DiscourseVideoShorts::Policy::Snapshot.current

    allow(DiscourseVideoShorts::Policy::Snapshot).to receive(:current).and_return(snapshot)
    observed_snapshots = []
    allow(DiscourseVideoShorts::MediaExtractorCache).to receive(:extract_media_for_visible_post) do |post, _guardian, policy_snapshot:|
      observed_snapshots << policy_snapshot
      {
        kind: "upload_mp4",
        identity: "upload:#{post.id}",
        url: "/uploads/#{post.id}.mp4",
        required_origins: [],
        policy_revision: policy_snapshot.revision,
        fallback_reason: nil,
      }
    end

    get "/videos.json"
    expect(DiscourseVideoShorts::Policy::Snapshot).to have_received(:current).once

    expect(response).to have_http_status(:ok)
    expect(observed_snapshots).to all(be(snapshot))
  end

  it "rejects tampered, user-bound, and source-revision cursors" do
    category = Fabricate(:category)
    replacement_category = Fabricate(:category)
    other_user = Fabricate(:user)
    post_in(category: category)
    post_in(category: category)
    SiteSetting.video_shorts_source_category_ids = category.id.to_s
    sign_in(user)
    get "/videos.json", params: { page_size: 1 }
    cursor = response.parsed_body.fetch("next_cursor")

    expect(cursor).to be_present

    get "/videos.json", params: { cursor: "#{cursor}tampered" }
    expect(response).to have_http_status(:bad_request)
    expect(response.parsed_body).to eq("error" => "invalid_cursor")
    sign_in(other_user)
    get "/videos.json", params: { cursor: cursor }
    expect(response).to have_http_status(:bad_request)
    expect(response.parsed_body).to eq("error" => "invalid_cursor")

    sign_in(user)

    SiteSetting.video_shorts_source_category_ids = replacement_category.id.to_s
    get "/videos.json", params: { cursor: cursor }
    expect(response).to have_http_status(:bad_request)
    expect(response.parsed_body).to eq("error" => "invalid_cursor")
  end

  it "is terminal only at candidate EOF and returns a terminal empty feed with no sources" do
    get "/videos.json"

    expect(response).to have_http_status(:ok)
    expect(response.parsed_body).to include("items" => [], "next_cursor" => nil, "scan" => include("end_reached" => true, "scan_limit_reached" => false))
  end
end
