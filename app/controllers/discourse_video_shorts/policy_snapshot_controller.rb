# frozen_string_literal: true

class DiscourseVideoShorts::PolicySnapshotController < ApplicationController
  requires_plugin DiscourseVideoShorts::PLUGIN_NAME

  def show
    unless SiteSetting.video_shorts_enabled
      render_json_error(I18n.t("not_found"), status: 404)
      return
    end
    unless DiscourseVideoShorts::Canary.allowed?(guardian)
      render_json_dump(
        { error: guardian.anonymous? ? "not_found" : "forbidden" },
        status: guardian.anonymous? ? 404 : 403,
      )
      return
    end

    snapshot = DiscourseVideoShorts::Policy::Snapshot.current
    etag = %Q("#{snapshot.etag}")

    if if_none_match?(etag)
      head :not_modified
    else
      render_json_dump(snapshot.to_h)
    end

    response.set_header("ETag", etag)
    response.cache_control[:no_cache] = true
    response.cache_control[:extras] = %w[private must-revalidate]
  end

  private

  def if_none_match?(etag)
    request.headers["If-None-Match"].to_s.split(",").map(&:strip).any? { |value| value == "*" || value == etag }
  end
end
