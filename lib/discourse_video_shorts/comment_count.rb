# frozen_string_literal: true
module DiscourseVideoShorts
  class CommentCount
    def self.call(posts:, guardian:)
      posts = Array(posts).compact
      counts = posts.index_with { 0 }
      return counts if posts.blank?

      direct_reply_ids_by_post = direct_reply_ids_by_post(posts)
      descendant_post_ids_by_post = descendant_post_ids_by_post(direct_reply_ids_by_post)
      visible_post_ids =
        Post
          .where(id: descendant_post_ids_by_post.values.flat_map(&:to_a).uniq)
          .secured(guardian)
          .where(post_type: Post.types[:regular], deleted_at: nil, hidden: false)
          .pluck(:id)
          .to_set

      posts.each do |post|
        counts[post] = (descendant_post_ids_by_post[post.id] & visible_post_ids).length
      end

      counts
    end

    def initialize(post:, guardian:)
      @post = post
      @guardian = guardian
    end

    def call
      self.class.call(posts: [post], guardian: guardian).fetch(post)
    end

    private

    attr_reader :post, :guardian

    class << self
      private

      def direct_reply_ids_by_post(posts)
        root_ids = posts.map(&:id)
        explicit_edges =
          PostReply.where(post_id: root_ids).pluck(:post_id, :reply_post_id).group_by(&:first)
        topic_ids = posts.map(&:topic_id).uniq
        reply_to_post_numbers = posts.map(&:post_number).uniq
        candidates =
          Post
            .where(topic_id: topic_ids, reply_to_post_number: [nil, *reply_to_post_numbers])
            .where.not(id: root_ids)
            .pluck(:id, :topic_id, :reply_to_post_number)

        op_candidate_ids =
          posts
            .select { |post| post.post_number == 1 }
            .flat_map do |post|
              candidates.filter_map do |id, topic_id, reply_to_post_number|
                id if topic_id == post.topic_id && [nil, post.post_number].include?(reply_to_post_number)
              end
            end
            .uniq
        candidate_parent_ids =
          PostReply.where(reply_post_id: op_candidate_ids).pluck(:post_id, :reply_post_id)

        posts.index_with do |post|
          explicit_reply_ids = Array(explicit_edges[post.id]).map(&:second)
          relation_reply_ids =
            candidates.filter_map do |id, topic_id, reply_to_post_number|
              next if topic_id != post.topic_id

              if post.post_number == 1
                next if ![nil, post.post_number].include?(reply_to_post_number)

                parents = candidate_parent_ids.filter_map { |parent_id, reply_id| parent_id if reply_id == id }
                next if parents.any? { |parent_id| parent_id != post.id } && !parents.include?(post.id)

                id
              elsif reply_to_post_number == post.post_number
                id
              end
            end

          Set.new(explicit_reply_ids | relation_reply_ids)
        end
      end

      def descendant_post_ids_by_post(direct_reply_ids_by_post)
        descendants_by_root_id =
          direct_reply_ids_by_post.to_h { |root_post, reply_ids| [root_post.id, reply_ids.dup] }
        owners_by_post_id = Hash.new { |hash, post_id| hash[post_id] = Set.new }
        frontier = Hash.new { |hash, post_id| hash[post_id] = Set.new }

        direct_reply_ids_by_post.each do |root_post, reply_ids|
          reply_ids.each do |reply_id|
            owners_by_post_id[reply_id] << root_post.id
            frontier[reply_id] << root_post.id
          end
        end

        while frontier.present?
          next_frontier = Hash.new { |hash, post_id| hash[post_id] = Set.new }
          PostReply.where(post_id: frontier.keys).pluck(:post_id, :reply_post_id).each do |parent_id, reply_id|
            new_root_ids = frontier[parent_id] - owners_by_post_id[reply_id]
            next if new_root_ids.blank?

            owners_by_post_id[reply_id].merge(new_root_ids)
            next_frontier[reply_id].merge(new_root_ids)
            new_root_ids.each { |root_id| descendants_by_root_id[root_id] << reply_id }
          end
          frontier = next_frontier
        end

        descendants_by_root_id
      end
    end
  end
end
