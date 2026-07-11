# frozen_string_literal: true

require_relative "comments_snapshot_controller"

class DiscourseVideoShorts::CommentsDeltaController < ApplicationController
  requires_plugin DiscourseVideoShorts::PLUGIN_NAME

  include DiscourseVideoShorts::CommentsControllerSupport

  def show
    source_post = comments_source_post
    return unless source_post

    raise DiscourseVideoShorts::Comments::ChangeRecorder::InvalidCursor if params[:since].blank?

    recorder = DiscourseVideoShorts::Comments::ChangeRecorder
    since =
      recorder.decode_change_cursor(
        params[:since],
        user_id: comments_user_id,
        source_post_id: source_post.id,
      )
    raise recorder::DeltaExpired if recorder.delta_expired?(source_post.id, since)

    visible_comments = recorder.visible_comments(source_post.id, guardian)
    visible_comments_by_id = visible_comments.index_by(&:id)
    rows = recorder.changes_after(source_post.id, since, limit: delta_limit + 1)
    page = rows.first(delta_limit)
    has_more = rows.length > page.length
    next_sequence = page.last&.fetch("sequence")&.to_i || since

    render_json_dump(
      changes: page.map { |change| serialize_change(change, visible_comments_by_id) },
      next_change_cursor: recorder.encode_change_cursor(
        user_id: comments_user_id,
        source_post_id: source_post.id,
        sequence: next_sequence,
      ),
      has_more: has_more,
      visible_reply_count: visible_comments.length,
    )
  rescue DiscourseVideoShorts::Comments::ChangeRecorder::DeltaExpired
    render_json_dump({ error: "delta_expired" }, status: 409)
  rescue DiscourseVideoShorts::Comments::ChangeRecorder::InvalidCursor
    render_invalid_cursor
  end

  private

  def delta_limit
    return 100 if params[:limit].blank?

    limit = Integer(params[:limit])
    raise DiscourseVideoShorts::Comments::ChangeRecorder::InvalidCursor unless (1..100).cover?(limit)

    limit
  rescue ArgumentError, TypeError
    raise DiscourseVideoShorts::Comments::ChangeRecorder::InvalidCursor
  end

  def serialize_change(change, visible_comments_by_id)
    post = visible_comments_by_id[change.fetch("changed_post_id").to_i]
    metadata = {
      "sequence" => change.fetch("sequence").to_i,
      "changed_post_id" => change.fetch("changed_post_id").to_i,
      "operation" => change.fetch("operation"),
      "changed_at" => Time.zone.parse(change.fetch("changed_at").to_s).iso8601(6),
    }

    if post
      metadata.merge("comment" => serialized_comment(post))
    else
      metadata.merge("tombstone" => { "id" => change.fetch("changed_post_id").to_i })
    end
  end
end
