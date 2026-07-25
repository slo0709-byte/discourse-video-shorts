# frozen_string_literal: true
RSpec.describe "Video shorts authoritative comment count" do
  fab!(:admin)
  fab!(:user)

  before { SiteSetting.video_shorts_enabled = true }

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

  it "returns only the authoritative visible descendant count and is repeatable" do
    source = Fabricate(:post, raw: "Video source post")
    direct = direct_reply(source, raw: "Visible direct reply")
    nested = direct_reply(direct, raw: "Visible nested reply")
    hidden = direct_reply(source, raw: "Hidden direct reply")
    deleted = direct_reply(nested, raw: "Deleted nested reply")
    hidden.update_columns(
      hidden: true,
      hidden_at: Time.zone.now,
      hidden_reason_id: Post.hidden_reasons[:flag_threshold_reached],
    )
    deleted.trash!(admin)

    2.times do
      get "/video-shorts/comments/count.json", params: { post_id: source.id }

      expect(response.status).to eq(200)
      expect(response.parsed_body).to eq("count" => 2)
    end
  end

  it "counts native topic replies without PostReply rows and deduplicates descendants" do
    topic = Fabricate(:topic)
    source = Fabricate(:post, topic: topic, post_number: 1, raw: "Video source post")
    native_top_level =
      Fabricate(
        :post,
        topic: topic,
        raw: "Native top-level reply",
        reply_to_post_number: nil,
      )
    nested = direct_reply(native_top_level, raw: "Nested reply")

    expect(PostReply.exists?(post: source, reply: native_top_level)).to eq(false)
    expect(PostReply.exists?(post: native_top_level, reply: nested)).to eq(true)

    get "/video-shorts/comments/count.json", params: { post_id: source.id }

    expect(response.status).to eq(200)
    expect(response.parsed_body).to eq("count" => 2)
  end

  it "counts an explicit direct reply even when its reply metadata is absent" do
    source = Fabricate(:post, raw: "Video source post")
    explicit_reply =
      Fabricate(:post, topic: source.topic, raw: "Explicit edge only", reply_to_post_number: nil)
    PostReply.create!(post: source, reply: explicit_reply)

    get "/video-shorts/comments/count.json", params: { post_id: source.id }

    expect(response.status).to eq(200)
    expect(response.parsed_body).to eq("count" => 1)
  end

  it "does not disclose a source post the current user cannot see" do
    group = Fabricate(:group)
    category = Fabricate(:private_category, group: group)
    source = Fabricate(:post, topic: Fabricate(:topic, category: category))
    direct_reply(source, raw: "Private reply")

    get "/video-shorts/comments/count.json", params: { post_id: source.id }

    expect(response.status).to eq(404)
    expect(response.body).not_to include("count")

    group.add(user)
    sign_in(user)
    get "/video-shorts/comments/count.json", params: { post_id: source.id }

    expect(response.status).to eq(200)
    expect(response.parsed_body).to eq("count" => 1)
  end

  it "returns the same non-disclosing response for malformed, missing, and deleted source posts" do
    deleted_source = Fabricate(:post)
    deleted_source.trash!(admin)

    [nil, "not-a-number", "1.5", "-1", "0", "999999999", ["1"], { id: "1" }].each do |post_id|
      get "/video-shorts/comments/count.json", params: { post_id: post_id }

      expect(response.status).to eq(404)
      expect(response.body).not_to include("count")
    end

    get "/video-shorts/comments/count.json", params: { post_id: deleted_source.id }

    expect(response.status).to eq(404)
    expect(response.body).not_to include("count")
  end

  it "returns 404 while the plugin is disabled" do
    SiteSetting.video_shorts_enabled = false

    get "/video-shorts/comments/count.json", params: { post_id: Fabricate(:post).id }

    expect(response.status).to eq(404)
  end
end
