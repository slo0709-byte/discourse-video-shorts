# frozen_string_literal: true

class DiscourseVideoShorts::VideosController < ApplicationController
  requires_plugin DiscourseVideoShorts::PLUGIN_NAME
  skip_before_action :check_xhr, only: :show

  def show
    respond_to do |format|
      format.html do
        if !SiteSetting.video_shorts_enabled
          render plain: "", status: :not_found, layout: false
        elsif !DiscourseVideoShorts::Canary.allowed?(guardian)
          render plain: "", status: guardian.anonymous? ? :not_found : :forbidden, layout: false
        else
          render html: "", layout: true
        end
      end
      format.json { render_feed }
    end
  end

  private

  def render_feed
    return render_error("not_found", 404) unless SiteSetting.video_shorts_enabled
    return render_error(guardian.anonymous? ? "not_found" : "forbidden", guardian.anonymous? ? 404 : 403) unless DiscourseVideoShorts::Canary.allowed?(guardian)

    feed =
      DiscourseVideoShorts::Feed.new(
        guardian: guardian,
        page_size: params[:page_size],
        scan_limit: params[:scan_limit],
        cursor: params[:cursor],
      ).call
    render_json_dump(feed)
  rescue DiscourseVideoShorts::Feed::INVALID_CURSOR
    render_error("invalid_cursor", 400)
  rescue RateLimiter::LimitExceeded
    render_error("rate_limited", 429, retry_after: 60)
  rescue ActiveRecord::ConnectionTimeoutError, ActiveRecord::QueryCanceled
    render_error("temporarily_unavailable", 503)
  rescue Discourse::InvalidAccess
    render_error("forbidden", 403)
  rescue ActiveRecord::RecordNotFound
    render_error("not_found", 404)
  end

  def render_error(error, status, retry_after: nil)
    payload = { error: error }
    payload[:retry_after] = retry_after if retry_after
    response.set_header("Retry-After", retry_after.to_s) if retry_after
    render_json_dump(payload, status: status)
  end
end
