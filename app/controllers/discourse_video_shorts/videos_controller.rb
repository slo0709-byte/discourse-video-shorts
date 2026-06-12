# frozen_string_literal: true

class DiscourseVideoShorts::VideosController < ApplicationController
  requires_plugin DiscourseVideoShorts::PLUGIN_NAME

  def show
    respond_to do |format|
      format.html do
        raise Discourse::NotFound unless SiteSetting.video_shorts_enabled

        render html: "", layout: true
      end
      format.json do
        if !SiteSetting.video_shorts_enabled
          render_json_error(I18n.t("not_found"), status: 404)
          next
        end

        feed =
          DiscourseVideoShorts::Feed.new(
            guardian: guardian,
            page_size: params[:page_size],
            scan_limit: params[:scan_limit],
            cursor: params[:cursor],
          ).call
        render_json_dump(feed)
      rescue DiscourseVideoShorts::Feed::INVALID_CURSOR
        render_json_dump(DiscourseVideoShorts::Feed.invalid_cursor_json, status: 400)
      end
    end
  end
end
