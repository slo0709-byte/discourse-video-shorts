# frozen_string_literal: true

RSpec.describe "Video shorts direct comments" do
  fab!(:admin)
  fab!(:user)

  before { SiteSetting.video_shorts_enabled = true }

  def create_reply(topic:, raw:, reply_to_post_number: nil, user: Fabricate(:user))
    Fabricate(
      :post,
      topic: topic,
      user: user,
      raw: raw,
      cooked: "<p>#{raw}</p>",
      reply_to_post_number: reply_to_post_number,
    )
  end

  it "returns native topic replies and explicit source replies while excluding nested replies" do
    source = Fabricate(:post, raw: "Video source")
    topic_reply = create_reply(topic: source.topic, raw: "Native topic reply")
    explicit_reply =
      create_reply(
        topic: source.topic,
        raw: "Explicit source reply",
        reply_to_post_number: source.post_number,
      )
    nested_reply =
      create_reply(
        topic: source.topic,
        raw: "Nested reply",
        reply_to_post_number: topic_reply.post_number,
      )

    get "/video-shorts/comments/direct.json", params: { post_id: source.id }

    expect(response.status).to eq(200)
    expect(response.parsed_body.keys).to contain_exactly("posts", "has_more", "next_after")
    expect(response.parsed_body["posts"].map { |post| post["id"] }).to eq(
      [topic_reply.id, explicit_reply.id],
    )
    expect(response.parsed_body["posts"].map { |post| post["id"] }).not_to include(nested_reply.id)
    expect(response.parsed_body).to include(
      "has_more" => false,
      "next_after" => explicit_reply.post_number,
    )
  end

  it "keeps hidden comments out of the direct surface and authoritative count" do
    source = Fabricate(:post, raw: "Video source")
    visible =
      create_reply(
        topic: source.topic,
        raw: "Visible direct reply",
        reply_to_post_number: source.post_number,
      )
    nested =
      create_reply(
        topic: source.topic,
        raw: "Visible nested reply",
        reply_to_post_number: visible.post_number,
      )
    PostReply.create!(post: visible, reply: nested)
    hidden =
      create_reply(
        topic: source.topic,
        raw: "Hidden direct reply",
        reply_to_post_number: source.post_number,
      )
    hidden.update_columns(
      hidden: true,
      hidden_at: Time.zone.now,
      hidden_reason_id: Post.hidden_reasons[:flag_threshold_reached],
    )

    get "/video-shorts/comments/direct.json", params: { post_id: source.id }

    expect(response.status).to eq(200)
    expect(response.parsed_body["posts"].map { |post| post["id"] }).to eq([visible.id])

    get "/video-shorts/comments/count.json", params: { post_id: source.id }

    expect(response.status).to eq(200)
    expect(response.parsed_body).to eq("count" => 2)
  end

  it "never returns the source post as its own comment when after is zero" do
    source = Fabricate(:post, raw: "Video source")
    reply = create_reply(topic: source.topic, raw: "Native topic reply")

    get "/video-shorts/comments/direct.json", params: { post_id: source.id, after: 0 }

    expect(response.status).to eq(200)
    expect(response.parsed_body["posts"].map { |post| post["id"] }).to eq([reply.id])
  end

  it "uses the source post relationship when the video source is not the topic opener" do
    topic = Fabricate(:topic)
    Fabricate(:post, topic: topic, post_number: 1)
    source = Fabricate(:post, topic: topic, post_number: 2, raw: "Embedded video")
    source_reply =
      create_reply(
        topic: topic,
        raw: "Source reply",
        reply_to_post_number: source.post_number,
      )
    create_reply(topic: topic, raw: "Unrelated topic reply")

    get "/video-shorts/comments/direct.json", params: { post_id: source.id }

    expect(response.status).to eq(200)
    expect(response.parsed_body["posts"].map { |post| post["id"] }).to eq([source_reply.id])
  end

  it "returns a non-disclosing 404 for malformed and inaccessible source ids" do
    group = Fabricate(:group)
    category = Fabricate(:private_category, group: group)
    source = Fabricate(:post, topic: Fabricate(:topic, category: category))

    [nil, "invalid", "0", "-1", [source.id]].each do |post_id|
      get "/video-shorts/comments/direct.json", params: { post_id: post_id }
      expect(response.status).to eq(404)
    end

    get "/video-shorts/comments/direct.json", params: { post_id: source.id }
    expect(response.status).to eq(404)

    group.add(user)
    sign_in(user)
    get "/video-shorts/comments/direct.json", params: { post_id: source.id }
    expect(response.status).to eq(200)
  end

  it "returns 404 while the plugin is disabled" do
    SiteSetting.video_shorts_enabled = false

    get "/video-shorts/comments/direct.json", params: { post_id: Fabricate(:post).id }

    expect(response.status).to eq(404)
  end
end
