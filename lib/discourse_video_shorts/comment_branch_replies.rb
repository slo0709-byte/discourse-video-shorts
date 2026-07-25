# frozen_string_literal: true

module DiscourseVideoShorts
  class CommentBranchReplies
    PAGE_SIZE = 20

    def initialize(parent:, guardian:, current_user:, after:)
      @parent = parent
      @guardian = guardian
      @current_user = current_user
      @after = after
    end

    def call
      rows = descendant_rows
      has_more = rows.length > PAGE_SIZE
      page_rows = rows.first(PAGE_SIZE)

      {
        posts: serialize(page_rows.map(&:post_id)),
        has_more: has_more,
        next_after: page_rows.last&.post_number,
      }
    end

    private

    attr_reader :parent, :guardian, :current_user, :after

    def descendant_rows
      DB.query(
        <<~SQL,
          WITH RECURSIVE descendants(reply_post_id) AS (
            SELECT post_replies.reply_post_id
            FROM post_replies
            INNER JOIN posts replies ON replies.id = post_replies.reply_post_id
            WHERE post_replies.post_id = :parent_id
              AND replies.topic_id = :topic_id

            UNION

            SELECT post_replies.reply_post_id
            FROM post_replies
            INNER JOIN descendants ON descendants.reply_post_id = post_replies.post_id
            INNER JOIN posts replies ON replies.id = post_replies.reply_post_id
            WHERE replies.topic_id = :topic_id
          )
          SELECT posts.id AS post_id, posts.post_number
          FROM descendants
          INNER JOIN posts ON posts.id = descendants.reply_post_id
          WHERE posts.topic_id = :topic_id
            AND posts.post_type = :regular_post_type
            AND posts.deleted_at IS NULL
            AND posts.hidden = FALSE
            AND posts.post_number > :after
          ORDER BY posts.post_number ASC
          LIMIT :limit
        SQL
        parent_id: parent.id,
        topic_id: parent.topic_id,
        regular_post_type: Post.types[:regular],
        after: after,
        limit: PAGE_SIZE + 1,
      )
    end

    def serialize(post_ids)
      return [] if post_ids.blank?

      topic_view =
        TopicView.new(
          parent.topic,
          current_user,
          post_ids: post_ids,
          include_related: false,
          include_suggested: false,
        )

      posts = TopicViewPostsSerializer.new(topic_view, scope: guardian).post_stream[:posts]
      posts_by_id = posts.index_by { |post| post[:id] || post["id"] }
      post_ids.filter_map { |post_id| posts_by_id[post_id] }
    end
  end
end
