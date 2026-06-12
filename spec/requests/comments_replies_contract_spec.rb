# frozen_string_literal: true

RSpec.describe "Video shorts comments direct replies contract" do
  fab!(:admin)

  def direct_reply(parent, raw:, user: Fabricate(:user))
    reply =
      Fabricate(
        :post,
        topic: parent.topic,
        user: user,
        raw: raw,
        cooked: "<p>#{raw}</p>",
        reply_to_post_number: parent.post_number,
      )
    PostReply.create!(post: parent, reply: reply)
    reply
  end

  it "characterizes core direct replies array shape for the comments adapter" do
    parent = Fabricate(:post, raw: "Video source post")
    first_reply = direct_reply(parent, raw: "Visible direct reply")
    second_reply = direct_reply(parent, raw: "Second visible reply")
    hidden_reply = direct_reply(parent, raw: "Hidden reply")
    hidden_reply.update_columns(
      hidden: true,
      hidden_at: Time.zone.now,
      hidden_reason_id: Post.hidden_reasons[:flag_threshold_reached],
    )

    get "/posts/#{parent.id}/replies.json"

    expect(response.status).to eq(200)
    replies = response.parsed_body
    reply_ids = replies.map { |reply| reply["id"] }

    expect(replies).to be_an(Array)
    expect(reply_ids).to eq([first_reply.id, second_reply.id])
    expect(reply_ids).not_to include(hidden_reply.id)
    expect(replies.first).to include(
      "id" => first_reply.id,
      "username" => first_reply.user.username,
      "cooked" => "<p>Visible direct reply</p>",
      "post_number" => first_reply.post_number,
      "reply_count" => 0,
    )
    expect(replies.first).to include("created_at", "avatar_template")
  end

  it "defines adapter pagination expectations against the core array shape" do
    parent = Fabricate(:post, raw: "Video source post")
    child_posts = 21.times.map { |index| direct_reply(parent, raw: "Reply #{index + 1}") }

    get "/posts/#{parent.id}/replies.json", params: { after: parent.post_number }

    expect(response.status).to eq(200)
    replies = response.parsed_body
    next_after = replies.last["post_number"]

    expect(replies.size).to eq(20)
    expect(replies.map { |reply| reply["id"] }).to eq(child_posts.first(20).map(&:id))
    expect(replies.length == 20).to eq(true)
    expect(next_after).to eq(child_posts[19].post_number)

    get "/posts/#{parent.id}/replies.json", params: { after: next_after }

    expect(response.status).to eq(200)
    expect(response.parsed_body.map { |reply| reply["id"] }).to eq([child_posts.last.id])
  end
end
