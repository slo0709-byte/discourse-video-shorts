# frozen_string_literal: true

module DiscourseVideoShorts
  class DirectComments
    PAGE_SIZE = 20

    def initialize(source:, guardian:, current_user:, after:)
      @source = source
      @guardian = guardian
      @current_user = current_user
      @after = after
    end

    def call
      post_ids = direct_posts.limit(PAGE_SIZE + 1).pluck(:id)
      has_more = post_ids.length > PAGE_SIZE
      page_ids = post_ids.first(PAGE_SIZE)
      posts = serialize(page_ids)

      {
        posts: posts,
        has_more: has_more,
        next_after: posts.last&.fetch(:post_number, nil),
      }
    end

    private

    attr_reader :source, :guardian, :current_user, :after

    def direct_posts
      relation =
        if source.post_number == 1
          source
            .topic
            .posts
            .where(reply_to_post_number: [nil, source.post_number])
        else
          source.topic.posts.where(reply_to_post_number: source.post_number)
        end

      relation
        .secured(guardian)
        .where(post_type: Post.types[:regular], deleted_at: nil, hidden: false)
        .where.not(id: source.id)
        .where(post_number: (after + 1)..)
        .order(:post_number)
    end

    def serialize(post_ids)
      return [] if post_ids.blank?

      topic_view =
        TopicView.new(
          source.topic,
          current_user,
          post_ids: post_ids,
          include_related: false,
          include_suggested: false,
        )

      posts = TopicViewPostsSerializer.new(topic_view, scope: guardian).post_stream[:posts]
      posts_by_id = posts.index_by { |post| post[:id] || post["id"] }
      fresh_reply_counts = Post.where(id: post_ids).pluck(:id, :reply_count).to_h

      post_ids.filter_map do |post_id|
        serialized = posts_by_id[post_id]
        next if serialized.blank?

        serialized[:reply_count] = fresh_reply_counts.fetch(post_id, 0)
        serialized
      end
    end
  end
end
