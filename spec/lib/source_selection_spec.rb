# frozen_string_literal: true

RSpec.describe DiscourseVideoShorts::SourceSelection do
  fab!(:admin)
  fab!(:user)

  let(:guardian) { Guardian.new }

  before do
    SiteSetting.video_shorts_enabled = true
    SiteSetting.video_shorts_youtube_enabled = true
    SiteSetting.video_shorts_bilibili_enabled = true
    SiteSetting.video_shorts_tiktok_enabled = true
    SiteSetting.video_shorts_douyin_enabled = true
    SiteSetting.video_shorts_source_category_ids = ""
    SiteSetting.video_shorts_source_tag_names = ""
    SiteSetting.video_shorts_page_size = 20
    SiteSetting.video_shorts_candidate_scan_limit = 500
    SiteSetting.tagging_enabled = true
  end

  def resolve(viewer: nil, page_size: nil, candidate_scan_limit: nil)
    described_class.new(
      guardian: Guardian.new(viewer),
      page_size: page_size,
      candidate_scan_limit: candidate_scan_limit,
    ).resolve
  end

  it "clamps requested and configured limits for endpoint use" do
    SiteSetting.video_shorts_page_size = 99
    SiteSetting.video_shorts_candidate_scan_limit = 5000

    result = resolve(page_size: 500, candidate_scan_limit: 5000)

    expect(result.page_size).to eq(50)
    expect(result.candidate_scan_limit).to eq(1000)
  end

  it "returns staff-only warnings for empty source settings" do
    anonymous_result = resolve
    staff_result = resolve(viewer: admin)

    expect(anonymous_result.posts).to be_empty
    expect(anonymous_result.warnings).to be_empty
    expect(staff_result.posts).to be_empty
    expect(staff_result.warnings).to include({ code: :no_source_settings })
  end

  it "uses topic-level OR semantics across exact categories and tags" do
    category = Fabricate(:category)
    other_category = Fabricate(:category)
    tag = Fabricate(:tag, name: "clips")
    category_post = Fabricate(:post, topic: Fabricate(:topic, category: category))
    tagged_post = Fabricate(:post, topic: Fabricate(:topic, category: other_category, tags: [tag]))
    excluded_post = Fabricate(:post, topic: Fabricate(:topic, category: other_category))

    SiteSetting.video_shorts_source_category_ids = category.id.to_s
    SiteSetting.video_shorts_source_tag_names = tag.name

    expect(resolve.posts).to contain_exactly(category_post, tagged_post)
    expect(resolve.posts).not_to include(excluded_post)
  end

  it "lets replies inherit topic category and tag sources" do
    category = Fabricate(:category)
    tag = Fabricate(:tag, name: "reply-source")
    categorized_topic = Fabricate(:topic, category: category)
    tagged_topic = Fabricate(:topic, tags: [tag])
    category_reply = Fabricate(:post, topic: categorized_topic, post_number: 2)
    tagged_reply = Fabricate(:post, topic: tagged_topic, post_number: 2)

    SiteSetting.video_shorts_source_category_ids = category.id.to_s
    SiteSetting.video_shorts_source_tag_names = tag.name

    expect(resolve.posts).to include(category_reply, tagged_reply)
  end

  it "does not include subcategories for category sources in v1" do
    parent = Fabricate(:category)
    child = Fabricate(:category, parent_category: parent)
    parent_post = Fabricate(:post, topic: Fabricate(:topic, category: parent))
    child_post = Fabricate(:post, topic: Fabricate(:topic, category: child))

    SiteSetting.video_shorts_source_category_ids = parent.id.to_s

    expect(resolve.posts).to contain_exactly(parent_post)
    expect(resolve.posts).not_to include(child_post)
  end

  it "excludes non-regular posts while keeping closed and archived visible topics" do
    category = Fabricate(:category)
    regular_topic = Fabricate(:topic, category: category)
    closed_topic = Fabricate(:topic, category: category, closed: true)
    archived_topic = Fabricate(:topic, category: category, archived: true)
    regular_post = Fabricate(:post, topic: regular_topic)
    closed_post = Fabricate(:post, topic: closed_topic)
    archived_post = Fabricate(:post, topic: archived_topic)
    small_action = Fabricate(:post, topic: regular_topic, post_type: Post.types[:small_action])

    SiteSetting.video_shorts_source_category_ids = category.id.to_s

    expect(resolve.posts).to contain_exactly(regular_post, closed_post, archived_post)
    expect(resolve.posts).not_to include(small_action)
  end

  it "requires Guardian visibility for private configured sources without anonymous leakage" do
    public_category = Fabricate(:category)
    private_category = Fabricate(:private_category, group: Fabricate(:group))
    public_post = Fabricate(:post, topic: Fabricate(:topic, category: public_category))
    private_post = Fabricate(:post, topic: Fabricate(:topic, category: private_category))

    SiteSetting.video_shorts_source_category_ids = [public_category.id, private_category.id, 99_999].join(
      "|",
    )

    anonymous_result = resolve
    staff_result = resolve(viewer: admin)

    expect(anonymous_result.posts).to contain_exactly(public_post)
    expect(anonymous_result.posts).not_to include(private_post)
    expect(anonymous_result.warnings).to be_empty
    expect(staff_result.warnings).to include({ code: :invalid_category_ids, ids: [99_999] })
  end

  it "ignores tag sources when tags are disabled and warns only staff" do
    tag = Fabricate(:tag, name: "disabled-tags")
    tagged_post = Fabricate(:post, topic: Fabricate(:topic, tags: [tag]))
    SiteSetting.video_shorts_source_tag_names = tag.name
    SiteSetting.tagging_enabled = false

    anonymous_result = resolve
    staff_result = resolve(viewer: admin)

    expect(anonymous_result.posts).not_to include(tagged_post)
    expect(anonymous_result.warnings).to be_empty
    expect(staff_result.warnings).to include({ code: :tagging_disabled })
  end

  it "builds a deterministic source-scope digest independent of requested page size" do
    category = Fabricate(:category)
    SiteSetting.video_shorts_source_category_ids = category.id.to_s

    digest_a = resolve(page_size: 1).source_scope_digest
    digest_b = resolve(page_size: 50).source_scope_digest
    SiteSetting.video_shorts_source_category_ids = ""
    digest_c = resolve(page_size: 50).source_scope_digest

    expect(digest_a).to eq(digest_b)
    expect(digest_a).not_to eq(digest_c)
  end

  it "includes provider support settings in the cursor scope" do
    category = Fabricate(:category)
    SiteSetting.video_shorts_source_category_ids = category.id.to_s

    enabled_digest = resolve.cursor_scope_digest
    SiteSetting.video_shorts_youtube_enabled = false
    youtube_disabled_digest = resolve.cursor_scope_digest
    SiteSetting.video_shorts_youtube_enabled = true
    SiteSetting.video_shorts_bilibili_enabled = false
    bilibili_disabled_digest = resolve.cursor_scope_digest
    SiteSetting.video_shorts_bilibili_enabled = true
    SiteSetting.video_shorts_tiktok_enabled = false
    tiktok_disabled_digest = resolve.cursor_scope_digest
    SiteSetting.video_shorts_tiktok_enabled = true
    SiteSetting.video_shorts_douyin_enabled = false
    douyin_disabled_digest = resolve.cursor_scope_digest

    expect(enabled_digest).not_to eq(youtube_disabled_digest)
    expect(enabled_digest).not_to eq(bilibili_disabled_digest)
    expect(enabled_digest).not_to eq(tiktok_disabled_digest)
    expect(enabled_digest).not_to eq(douyin_disabled_digest)
    expect(youtube_disabled_digest).not_to eq(bilibili_disabled_digest)
    expect(tiktok_disabled_digest).not_to eq(douyin_disabled_digest)
  end
end
