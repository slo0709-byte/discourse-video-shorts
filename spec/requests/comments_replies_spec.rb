# frozen_string_literal: true

RSpec.describe "Video shorts comment branch replies" do
  fab!(:admin)
  fab!(:user)

  before { SiteSetting.video_shorts_enabled = true }

  def reply_to(parent, raw:, user: Fabricate(:user))
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

  it "returns one flattened, post-number-ordered branch with core post payloads" do
    source = Fabricate(:post, raw: "Video source")
    parent = reply_to(source, raw: "Parent comment")
    unrelated = reply_to(source, raw: "Unrelated comment")
    child = reply_to(parent, raw: "Child reply")
    grandchild = reply_to(child, raw: "Grandchild reply")
    deeper = reply_to(grandchild, raw: "Deeper reply")
    reply_to(unrelated, raw: "Unrelated nested reply")
    PostActionCreator.like(Fabricate(:user), child)

    get "/video-shorts/comments/replies.json",
        params: {
          post_id: parent.id,
          after: parent.post_number,
        }

    expect(response.status).to eq(200)
    expect(response.parsed_body.keys).to contain_exactly("posts", "has_more", "next_after")
    expect(response.parsed_body["posts"].map { |post| post["id"] }).to eq(
      [child.id, grandchild.id, deeper.id],
    )
    expect(response.parsed_body).to include("has_more" => false, "next_after" => deeper.post_number)
    expect(response.parsed_body["posts"].first).to include(
      "username" => child.user.username,
      "cooked" => "<p>Child reply</p>",
      "post_number" => child.post_number,
      "reply_to_post_number" => parent.post_number,
      "created_at" => child.created_at.as_json,
      "avatar_template" => child.user.avatar_template,
    )
    like_action =
      response.parsed_body["posts"].first["actions_summary"].find do |action|
        action["id"] == PostActionType.types[:like]
      end
    expect(like_action["count"]).to eq(1)
  end

  it "excludes hidden and deleted descendants without pruning their visible descendants" do
    source = Fabricate(:post, raw: "Video source")
    parent = reply_to(source, raw: "Parent comment")
    hidden = reply_to(parent, raw: "Hidden child")
    visible_below_hidden = reply_to(hidden, raw: "Visible below hidden")
    deleted = reply_to(parent, raw: "Deleted child")
    visible_below_deleted = reply_to(deleted, raw: "Visible below deleted")
    hidden.update_columns(
      hidden: true,
      hidden_at: Time.zone.now,
      hidden_reason_id: Post.hidden_reasons[:flag_threshold_reached],
    )
    deleted.trash!(admin)

    get "/video-shorts/comments/replies.json", params: { post_id: parent.id }

    expect(response.status).to eq(200)
    expect(response.parsed_body["posts"].map { |post| post["id"] }).to eq(
      [visible_below_hidden.id, visible_below_deleted.id],
    )
  end

  it "paginates flattened descendants in bounded pages of 20" do
    source = Fabricate(:post, raw: "Video source")
    parent = reply_to(source, raw: "Parent comment")
    branch_parent = parent
    descendants =
      21.times.map do |index|
        branch_parent = reply_to(branch_parent, raw: "Reply #{index + 1}")
      end

    get "/video-shorts/comments/replies.json",
        params: {
          post_id: parent.id,
          after: parent.post_number,
        }

    expect(response.status).to eq(200)
    expect(response.parsed_body["posts"].map { |post| post["id"] }).to eq(
      descendants.first(20).map(&:id),
    )
    expect(response.parsed_body).to include(
      "has_more" => true,
      "next_after" => descendants[19].post_number,
    )

    get "/video-shorts/comments/replies.json",
        params: {
          post_id: parent.id,
          after: response.parsed_body["next_after"],
        }

    expect(response.status).to eq(200)
    expect(response.parsed_body).to include(
      "has_more" => false,
      "next_after" => descendants.last.post_number,
    )
    expect(response.parsed_body["posts"].map { |post| post["id"] }).to eq(
      [descendants.last.id],
    )
  end

  it "does not disclose a branch in a topic the current user cannot see" do
    group = Fabricate(:group)
    category = Fabricate(:private_category, group: group)
    source = Fabricate(:post, topic: Fabricate(:topic, category: category))
    parent = reply_to(source, raw: "Private parent")
    reply_to(parent, raw: "Private descendant")

    get "/video-shorts/comments/replies.json", params: { post_id: parent.id }

    expect(response.status).to eq(404)
    expect(response.body).not_to include("Private descendant")

    group.add(user)
    sign_in(user)
    get "/video-shorts/comments/replies.json", params: { post_id: parent.id }

    expect(response.status).to eq(200)
    expect(response.parsed_body["posts"].map { |post| post["cooked"] }).to eq(
      ["<p>Private descendant</p>"],
    )
  end

  it "returns a non-disclosing 404 for malformed, missing, and inaccessible parent ids" do
    deleted_parent = Fabricate(:post)
    deleted_parent.trash!(admin)

    [nil, "not-a-number", "1.5", "-1", "0", "999999999", ["1"], { id: "1" }].each do |post_id|
      get "/video-shorts/comments/replies.json", params: { post_id: post_id }

      expect(response.status).to eq(404)
      expect(response.body).not_to include("posts")
    end

    get "/video-shorts/comments/replies.json", params: { post_id: deleted_parent.id }

    expect(response.status).to eq(404)
  end

  it "rejects malformed cursors without disclosing the parent" do
    parent = Fabricate(:post)

    ["not-a-number", "1.5", "-1", ["1"], { id: "1" }].each do |after|
      get "/video-shorts/comments/replies.json", params: { post_id: parent.id, after: after }

      expect(response.status).to eq(404)
      expect(response.body).not_to include("posts")
    end
  end

  it "returns 404 while the plugin is disabled" do
    SiteSetting.video_shorts_enabled = false

    get "/video-shorts/comments/replies.json", params: { post_id: Fabricate(:post).id }

    expect(response.status).to eq(404)
  end
end
