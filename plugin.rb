# frozen_string_literal: true

# name: discourse-video-shorts
# about: Adds a Shorts-style video feed page backed by Discourse posts.
# version: 0.2.0
# authors: GPTaku
# url: https://github.com/slo0709-byte/discourse-video-shorts

enabled_site_setting :video_shorts_enabled

register_asset "stylesheets/common/video-shorts.scss"
register_asset "stylesheets/common/video-shorts-route-shell.scss"
register_svg_icon "arrows-rotate"
register_svg_icon "triangle-exclamation"
register_svg_icon "up-right-from-square"
register_svg_icon "video"
register_svg_icon "volume-high"
register_svg_icon "volume-xmark"

add_admin_route "video_shorts.admin.title", "discourse-video-shorts", use_new_show_route: true

module ::DiscourseVideoShorts
  PLUGIN_NAME = "discourse-video-shorts"

  module ContentSecurityPolicySourceExtension
    private

    def extendable?(directive)
      %i[frame_src media_src].include?(directive) || super
    end
  end
end

require_relative "lib/discourse_video_shorts/hls_origin_policy"

extend_content_security_policy(::DiscourseVideoShorts::ContentSecurityPolicyExtension.new)

require_relative "lib/discourse_video_shorts/engine"

after_initialize do
  require "content_security_policy/builder"
  require_relative "lib/discourse_video_shorts/admin/diagnostics"
  require_relative "lib/discourse_video_shorts/comment_branch_replies"
  require_relative "lib/discourse_video_shorts/comment_count"
  require_relative "lib/discourse_video_shorts/direct_comments"
  require_relative "lib/discourse_video_shorts/feed"
  require_relative "lib/discourse_video_shorts/media_extractor"
  require_relative "lib/discourse_video_shorts/media_extractor_cache"
  require_relative "lib/discourse_video_shorts/source_selection"
  require_relative "app/controllers/discourse_video_shorts/admin/diagnostics_controller"
  require_relative "app/controllers/discourse_video_shorts/comments_controller"
  require_relative "app/controllers/discourse_video_shorts/videos_controller"

  if defined?(::ContentSecurityPolicy::Builder) &&
       !::ContentSecurityPolicy::Builder.ancestors.include?(
         ::DiscourseVideoShorts::ContentSecurityPolicySourceExtension
       )
    ::ContentSecurityPolicy::Builder.prepend(
      ::DiscourseVideoShorts::ContentSecurityPolicySourceExtension
    )
  end

  Discourse::Application.routes.append do
    scope "/admin/plugins/discourse-video-shorts", constraints: AdminConstraint.new do
      get "/diagnostics" => "discourse_video_shorts/admin/diagnostics#show",
          constraints: {
            format: :json,
          }
      get "/diagnostics" => "admin/plugins#index", :format => false
    end

    mount ::DiscourseVideoShorts::Engine, at: "/"
  end

  on(:post_edited) do |post|
    ::DiscourseVideoShorts::MediaExtractorCache.invalidate(post)
  end
end
