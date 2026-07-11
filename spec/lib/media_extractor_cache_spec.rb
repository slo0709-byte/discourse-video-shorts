# frozen_string_literal: true

RSpec.describe DiscourseVideoShorts::MediaExtractorCache do
  fab!(:user)

  before do
    SiteSetting.authorized_extensions =
      (SiteSetting.authorized_extensions.split("|") + ["mp4"]).uniq.join("|")
  end

  def make_post(raw:, cooked: raw)
    Fabricate(:post, raw:, cooked:)
  end

  def extract(post, snapshot: DiscourseVideoShorts::Policy::Snapshot.current)
    described_class.extract_media_for_visible_post(
      post.reload,
      Guardian.new(user),
      policy_snapshot: snapshot,
    )
  end

  it "returns a cached current-schema descriptor without invoking the extractor again" do
    post = make_post(raw: "https://www.youtube.com/shorts/dQw4w9WgXcQ")
    custom_field_count = PostCustomField.where(post_id: post.id).count
    first = extract(post)

    expect(first).to include(
      kind: "youtube",
      identity: "v1:youtube:dQw4w9WgXcQ",
      url: "https://www.youtube.com/embed/dQw4w9WgXcQ",
      required_origins: [],
      policy_revision: nil,
      fallback_reason: nil,
    )
    DiscourseVideoShorts::MediaExtractor.expects(:extract_media_for_visible_post).never

    expect(extract(post)).to eq(first)

    expect(PostCustomField.where(post_id: post.id).count).to eq(custom_field_count)
  end

  it "invalidates a cached descriptor when raw or cooked source content changes" do
    post = make_post(raw: "https://www.youtube.com/shorts/dQw4w9WgXcQ")
    expect(extract(post)).to include(kind: "youtube", identity: "v1:youtube:dQw4w9WgXcQ")

    post.update!(
      raw: "https://www.bilibili.com/video/BV1Q541167Qg",
      cooked: "https://www.bilibili.com/video/BV1Q541167Qg",
    )

    expect(extract(post)).to include(
      kind: "bilibili",
      identity: "v1:bilibili:BV1Q541167Qg",
      url: "https://player.bilibili.com/player.html?bvid=BV1Q541167Qg&page=1",
    )
  end

  it "re-evaluates external media when the origin policy revision changes" do
    policy = DiscourseVideoShorts::OriginPolicy.current
    policy.update!(
      origins: ["https://media.example"],
      external_media_enabled: true,
      actor: user,
    )
    post = make_post(raw: "https://media.example/video.mp4")

    expect(extract(post)).to include(
      kind: "external_mp4",
      url: "https://media.example/video.mp4",
      policy_revision: 1,
    )

    policy.update!(
      origins: ["https://cdn.example"],
      external_media_enabled: true,
      actor: user,
    )

    expect(extract(post)).to include(
      kind: "fallback",
      fallback_reason: "unapproved_origin",
    )
  end

  it "does not write persistent post custom fields on a cold extraction" do
    post = make_post(raw: "https://www.youtube.com/watch?v=dQw4w9WgXcQ")

    expect { extract(post) }.not_to change { PostCustomField.where(post_id: post.id).count }
  end
end
