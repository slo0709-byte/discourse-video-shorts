# frozen_string_literal: true

class DiscourseVideoShorts::Admin::DiagnosticsController < Admin::AdminController
  requires_plugin DiscourseVideoShorts::PLUGIN_NAME

  def show
    render_json_dump(
      DiscourseVideoShorts::Admin::Diagnostics.new(
        guardian: guardian,
        sample_size: params[:sample_size],
        scan_limit: params[:scan_limit],
      ).call,
    )
  end
end
