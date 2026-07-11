# frozen_string_literal: true

module DiscourseVideoShorts
  module CommentsControllerSupport
    private

    def comments_source_post
      return render_not_found unless SiteSetting.video_shorts_enabled
      unless DiscourseVideoShorts::Canary.allowed?(guardian)
        return guardian.anonymous? ? render_not_found : render_forbidden
      end

      source_post = Post.find_by(id: params[:post_id])
      return render_not_found unless source_post
      return render_not_found if source_post.deleted_at.present? || source_post.hidden?
      return render_not_found if source_post.topic.nil? || source_post.topic.deleted_at.present?
      return render_not_found unless guardian.can_see_post?(source_post)

      source_post
    end

    def comments_limit
      return 50 if params[:limit].blank?

      limit = Integer(params[:limit])
      raise DiscourseVideoShorts::Comments::ChangeRecorder::InvalidCursor unless (1..100).cover?(limit)

      limit
    rescue ArgumentError, TypeError
      raise DiscourseVideoShorts::Comments::ChangeRecorder::InvalidCursor
    end

    def comments_user_id
      current_user&.id || 0
    end

    def serialized_comment(post)
      {
        "id" => post.id,
        "post_number" => post.post_number,
        "reply_to_post_number" => post.reply_to_post_number,
        "username" => post.user.username,
        "avatar_template" => post.user.avatar_template,
        "cooked" => post.cooked,
        "created_at" => post.created_at.iso8601(6),
        "updated_at" => post.updated_at.iso8601(6),
        "reply_count" => post.reply_count || 0,
      }
    end

    def render_not_found
      render_json_dump({ error: "not_found" }, status: 404)
      nil
    end

    def render_forbidden
      render_json_dump({ error: "forbidden" }, status: 403)
      nil
    end

    def render_invalid_cursor
      render_json_dump({ error: "invalid_cursor" }, status: 400)
    end
  end
end

class DiscourseVideoShorts::CommentsSnapshotController < ApplicationController
  requires_plugin DiscourseVideoShorts::PLUGIN_NAME

  include DiscourseVideoShorts::CommentsControllerSupport

  def show
    source_post = comments_source_post
    return unless source_post

    recorder = DiscourseVideoShorts::Comments::ChangeRecorder
    snapshot_sequence = recorder.current_sequence(source_post.id)
    visible_comments = DiscourseVideoShorts::Comments::ChangeRecorder.visible_comments(source_post.id, guardian)
    comments = visible_comments
    limit = comments_limit
    cursor = params[:cursor]
    if cursor.present?
      created_at, post_id =
        DiscourseVideoShorts::Comments::ChangeRecorder.decode_snapshot_cursor(
          cursor,
          user_id: comments_user_id,
          source_post_id: source_post.id,
        )
      comments = comments.select { |post| (post.created_at > created_at) || (post.created_at == created_at && post.id > post_id) }
    end

    page = comments.first(limit)
    has_more = comments.length > page.length
    next_cursor =
      if has_more
        last_post = page.last
        DiscourseVideoShorts::Comments::ChangeRecorder.encode_snapshot_cursor(
          user_id: comments_user_id,
          source_post_id: source_post.id,
          created_at: last_post.created_at,
          post_id: last_post.id,
        )
      end

    render_json_dump(
      schema_version: recorder::SCHEMA_VERSION,
      snapshot_at: Time.zone.now.iso8601(6),
      source_post_id: source_post.id,
      comments: page.map { |post| serialized_comment(post) },
      next_cursor: next_cursor,
      has_more: has_more,
      visible_reply_count: visible_comments.length,
      change_cursor: recorder.encode_change_cursor(
        user_id: comments_user_id,
        source_post_id: source_post.id,
        sequence: snapshot_sequence,
      ),
      authorization_lease: recorder.authorization_lease(user_id: comments_user_id, source_post_id: source_post.id),
    )
  rescue DiscourseVideoShorts::Comments::ChangeRecorder::InvalidCursor
    render_invalid_cursor
  end
end
