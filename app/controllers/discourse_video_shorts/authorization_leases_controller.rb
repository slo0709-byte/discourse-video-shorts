# frozen_string_literal: true

class DiscourseVideoShorts::AuthorizationLeasesController < ApplicationController
  requires_plugin DiscourseVideoShorts::PLUGIN_NAME

  MAX_SOURCE_POST_IDS = 3 unless const_defined?(:MAX_SOURCE_POST_IDS, false)

  def create
    return render_not_found unless SiteSetting.video_shorts_enabled
    unless DiscourseVideoShorts::Canary.allowed?(guardian)
      return render_json_dump(
        { error: guardian.anonymous? ? "not_found" : "forbidden" },
        status: guardian.anonymous? ? 404 : 403,
      )
    end

    source_posts = source_post_ids.map { |id| Post.find_by(id: id) }
    return render_not_found if source_posts.any?(&:nil?) || source_posts.any? { |post| revoked?(post) }

    render_json_dump(
      leases: source_posts.map do |post|
        DiscourseVideoShorts::Comments::ChangeRecorder.authorization_lease(
          user_id: current_user&.id || 0,
          source_post_id: post.id,
        ).merge("source_post_id" => post.id)
      end,
    )
  rescue ArgumentError, TypeError
    render_json_dump({ error: "invalid_source_post_ids" }, status: 400)
  end

  private

  def source_post_ids
    ids = params.require(:source_post_ids)
    raise ArgumentError unless ids.is_a?(Array) && (1..MAX_SOURCE_POST_IDS).cover?(ids.length)

    normalized_ids = ids.map { |id| Integer(id) }
    raise ArgumentError unless normalized_ids.all?(&:positive?) && normalized_ids.uniq.length == normalized_ids.length

    normalized_ids
  end

  def revoked?(post)
    post.deleted_at.present? || post.hidden? || !guardian.can_see_post?(post)
  end

  def render_not_found
    render_json_dump({ error: "not_found" }, status: 404)
  end
end
