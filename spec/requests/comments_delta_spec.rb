# frozen_string_literal: true

RSpec.describe "Video shorts comment snapshots and deltas" do
  fab!(:user)
  before { SiteSetting.video_shorts_enabled = true }

  def reply_to(parent, number)
    reply =
      Fabricate(
        :post,
        topic: parent.topic,
        user: user,
        raw: "Comment #{number}",
        cooked: "<p>Comment #{number}</p>",
        reply_to_post_number: parent.post_number,
      )
    PostReply.create!(post: parent, reply: reply)
    reply
  end

  def bulk_replies_to(parent, count)
    started_at = Time.zone.now
    rows =
      count.times.map do |index|
        number = index + 1
        created_at = started_at + number.fdiv(1000)

        {
          topic_id: parent.topic_id,
          user_id: user.id,
          post_number: parent.post_number + number,
          post_type: Post.types[:regular],
          raw: "Comment #{number}",
          cooked: "<p>Comment #{number}</p>",
          reply_to_post_number: parent.post_number,
          created_at: created_at,
          updated_at: created_at,
          last_version_at: created_at,
        }
      end

    inserted = Post.insert_all!(rows, returning: %w[id post_number])
    ids = inserted.rows.map(&:first)
    PostReply.insert_all!(
      ids.map do |reply_post_id|
        {
          post_id: parent.id,
          reply_post_id: reply_post_id,
          created_at: started_at,
          updated_at: started_at,
        }
      end,
    )
    Post.where(id: ids).order(:post_number).to_a
  end

  def record_change(post, operation, source)
    DiscourseVideoShorts::Comments::ChangeRecorder.record(
      post: post,
      operation: operation,
      source_post_ids: [source.id],
    )
  end

  it "does not expose comment snapshots outside the canary audience" do
    source = Fabricate(:post, user: user, raw: "Video source")
    reply_to(source, 1)
    canary_group = Fabricate(:group)
    SiteSetting.video_shorts_canary_group_ids = canary_group.id.to_s

    get "/videos/posts/#{source.id}/comments.json"
    expect(response.status).to eq(404)

    sign_in(user)
    get "/videos/posts/#{source.id}/comments.json"
    expect(response.status).to eq(403)
    expect(response.parsed_body).to eq("error" => "forbidden")
  end

  it "paginates all visible descendants ASC while returning the absolute visible count" do
    sign_in(user)
    source = Fabricate(:post, user: user, raw: "Video source")
    comments = bulk_replies_to(source, 201)
    nested = reply_to(comments.first, 202)

    get "/videos/posts/#{source.id}/comments.json", params: { limit: 100 }

    expect(response.status).to eq(200)
    first_page = response.parsed_body
    expect(first_page).to include(
      "schema_version" => 1,
      "source_post_id" => source.id,
      "has_more" => true,
      "visible_reply_count" => 202,
    )
    expect(first_page.fetch("comments").map { |comment| comment.fetch("id") }).to eq(
      [*comments, nested].sort_by { |post| [post.created_at, post.id] }.first(100).map(&:id),
    )

    get "/videos/posts/#{source.id}/comments.json", params: { cursor: first_page.fetch("next_cursor"), limit: 100 }

    expect(response.status).to eq(200)
    expect(response.parsed_body.fetch("visible_reply_count")).to eq(202)
    expect(response.parsed_body.fetch("comments").length).to eq(100)
    get "/videos/posts/#{source.id}/comments.json", params: { cursor: response.parsed_body.fetch("next_cursor"), limit: 100 }

    expect(response.status).to eq(200)
    expect(response.parsed_body).to include(
      "visible_reply_count" => 202,
      "has_more" => false,
    )
    expect(response.parsed_body.fetch("comments").map { |comment| comment.fetch("id") }).to eq(
      [*comments, nested].sort_by { |post| [post.created_at, post.id] }.last(2).map(&:id),
    )
  end

  it "returns idempotent edit and delete changes for early and 201st comments with an absolute count" do
    sign_in(user)
    source = Fabricate(:post, user: user, raw: "Video source")
    comments = bulk_replies_to(source, 201)

    get "/videos/posts/#{source.id}/comments.json"
    since = response.parsed_body.fetch("change_cursor")
    newest_comment = reply_to(source, 202)
    record_change(newest_comment, :create, source)

    comments.first.update!(raw: "Edited first", cooked: "<p>Edited first</p>")
    record_change(comments.first, :edit, source)
    comments.last.update!(raw: "Edited last", cooked: "<p>Edited last</p>")
    record_change(comments.last, :edit, source)
    get "/videos/posts/#{source.id}/comments/delta.json", params: { since: since }

    expect(response.status).to eq(200)
    edit_body = response.parsed_body
    expect(edit_body.fetch("visible_reply_count")).to eq(202)
    expect(edit_body.fetch("has_more")).to eq(false)
    edit_changes = edit_body.fetch("changes")
    expect(edit_changes.map { |change| change.fetch("sequence") }).to eq(edit_changes.map { |change| change.fetch("sequence") }.sort)
    expect(edit_changes.select { |change| change.fetch("operation") == "edit" }.map { |change| change.dig("comment", "id") }).to contain_exactly(
      comments.first.id,
      comments.last.id,
    )
    expect(edit_changes.select { |change| change.fetch("operation") == "create" }.map { |change| change.dig("comment", "id") }).to eq(
      [newest_comment.id],
    )

    comments.first.update_columns(deleted_at: Time.zone.now)
    record_change(comments.first, :delete, source)
    comments.last.update_columns(deleted_at: Time.zone.now)
    record_change(comments.last, :delete, source)

    get "/videos/posts/#{source.id}/comments/delta.json", params: { since: edit_body.fetch("next_change_cursor") }

    expect(response.status).to eq(200)
    delete_body = response.parsed_body
    expect(delete_body.fetch("visible_reply_count")).to eq(200)
    expect(delete_body.fetch("has_more")).to eq(false)
    delete_changes = delete_body.fetch("changes")
    expect(delete_changes.map { |change| change.fetch("operation") }).to all(eq("delete"))
    expect(delete_changes.map { |change| change.key?("comment") }).to all(be(false))
    expect(delete_changes.map { |change| change.fetch("tombstone", {}).fetch("id") }).to contain_exactly(
      comments.first.id,
      comments.last.id,
    )

    get "/videos/posts/#{source.id}/comments/delta.json", params: { since: edit_body.fetch("next_change_cursor") }
    expect(response.status).to eq(200)
    expect(response.parsed_body.fetch("changes")).to eq(delete_body.fetch("changes"))
  end

  it "captures the snapshot watermark before reading comments" do
    sign_in(user)
    source = Fabricate(:post, user: user, raw: "Video source")
    recorder = DiscourseVideoShorts::Comments::ChangeRecorder

    calls = []
    allow(recorder).to receive(:current_sequence).with(source.id) do
      calls << :current_sequence
      7
    end
    allow(recorder).to receive(:visible_comments) do |source_post_id, request_guardian|
      calls << [:visible_comments, source_post_id, request_guardian.class]
      []
    end

    get "/videos/posts/#{source.id}/comments.json"
    expect(response.status).to eq(200), response.body
    expect(calls).to eq([:current_sequence, [:visible_comments, source.id, Guardian]])

    sequence =
      recorder.decode_change_cursor(
        response.parsed_body.fetch("change_cursor"),
        user_id: user.id,
        source_post_id: source.id,
      )
    expect(sequence).to eq(7)
  end

  it "does not advance an empty delta page beyond its since watermark" do
    sign_in(user)
    source = Fabricate(:post, user: user, raw: "Video source")
    recorder = DiscourseVideoShorts::Comments::ChangeRecorder
    since = recorder.encode_change_cursor(user_id: user.id, source_post_id: source.id, sequence: 11)

    allow(recorder).to receive(:changes_after).with(source.id, 11, limit: 101).and_return([])
    allow(recorder).to receive(:current_sequence).and_raise("must not sample a second watermark")

    get "/videos/posts/#{source.id}/comments/delta.json", params: { since: since }

    sequence =
      recorder.decode_change_cursor(
        response.parsed_body.fetch("next_change_cursor"),
        user_id: user.id,
        source_post_id: source.id,
      )
    expect(sequence).to eq(11)
  end

  it "privacy-revokes hidden and deleted comment sources" do
    sign_in(user)
    source = Fabricate(:post, user: user, raw: "Video source")
    since =
      DiscourseVideoShorts::Comments::ChangeRecorder.encode_change_cursor(
        user_id: user.id,
        source_post_id: source.id,
        sequence: 0,
      )

    source.update_columns(hidden: true)
    get "/videos/posts/#{source.id}/comments.json"
    expect(response.status).to eq(404)
    get "/videos/posts/#{source.id}/comments/delta.json", params: { since: since }
    expect(response.status).to eq(404)

    source.update_columns(hidden: false, deleted_at: Time.zone.now)
    get "/videos/posts/#{source.id}/comments.json"
    expect(response.status).to eq(404)
    get "/videos/posts/#{source.id}/comments/delta.json", params: { since: since }
    expect(response.status).to eq(404)
  end

  it "records only configured video-source ancestors" do
    source = Fabricate(:post, user: user, raw: "Video source")
    source.update_columns(
      raw: "https://youtu.be/dQw4w9WgXcQ",
      cooked: '<p><a href="https://youtu.be/dQw4w9WgXcQ">video</a></p>',
    )
    comment = reply_to(source, 1)

    expect(DiscourseVideoShorts::Comments::ChangeRecorder.source_post_ids_for(comment)).to eq([])

    SiteSetting.video_shorts_source_category_ids = source.topic.category_id.to_s
    expect(DiscourseVideoShorts::Comments::ChangeRecorder.source_post_ids_for(comment)).to eq([source.id])

    ordinary_root = Fabricate(:post, user: user, raw: "Ordinary discussion")
    ordinary_reply = reply_to(ordinary_root, 2)
    expect(DiscourseVideoShorts::Comments::ChangeRecorder.source_post_ids_for(ordinary_reply)).to eq([])
  end
  it "rejects a cursor bound to a different user and reports expired deltas" do
    sign_in(user)
    source = Fabricate(:post, user: user, raw: "Video source")
    reply_to(source, 1)

    get "/videos/posts/#{source.id}/comments.json"
    since = response.parsed_body.fetch("change_cursor")

    sign_in(Fabricate(:user))
    get "/videos/posts/#{source.id}/comments/delta.json", params: { since: since }
    expect(response.status).to eq(400)
    expect(response.parsed_body).to eq("error" => "invalid_cursor")

    sign_in(user)
    freeze_time 25.hours.from_now do
      get "/videos/posts/#{source.id}/comments/delta.json", params: { since: since }
      expect(response.status).to eq(409)
      expect(response.parsed_body).to eq("error" => "delta_expired")
    end
  end
  it "publishes a content-free invalidation to the source topic's secure audience" do
    source = Fabricate(:post, user: user, raw: "Video source")
    comment = reply_to(source, 1)
    audience = { user_ids: [user.id], group_ids: [] }

    topic = source.topic
    allow(Post).to receive(:find).with(source.id).and_return(source)
    allow(topic).to receive(:secure_audience_publish_messages).and_return(audience)
    allow(MessageBus).to receive(:publish)

    record_change(comment, :create, source)

    expect(topic).to have_received(:secure_audience_publish_messages)
    expect(MessageBus).to have_received(:publish) do |channel, payload, **options|
      expect(channel).to eq("/video-shorts/comments/#{source.id}")
      expect(payload).to eq(
        source_post_id: source.id,
        change_sequence: 1,
      )
      expect(payload.keys).to contain_exactly(:source_post_id, :change_sequence)
      expect(options).to eq(audience)
    end
  end
end
