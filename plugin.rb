# frozen_string_literal: true

# name: discourse-video-shorts
# about: Adds a Shorts-style video feed page backed by Discourse posts.
# version: 0.2.0
# authors: GPTaku
# url: https://github.com/slo0709-byte/discourse-video-shorts


register_asset "stylesheets/common/video-shorts.scss"
register_asset "stylesheets/common/video-shorts-route-shell.scss"
register_svg_icon "arrows-rotate"
register_svg_icon "triangle-exclamation"
register_svg_icon "up-right-from-square"
register_svg_icon "video"

add_admin_route "video_shorts.admin.title", "discourse-video-shorts", use_new_show_route: true

extend_content_security_policy(
  frame_src: %w[
    'self'
    https://www.youtube.com
    https://www.youtube-nocookie.com
    https://player.bilibili.com
  ],
  media_src: %w['self' https:],
  connect_src: %w['self' https:],
)

module ::DiscourseVideoShorts
  PLUGIN_NAME = "discourse-video-shorts"

  module ContentSecurityPolicyFrameSrcExtension
    private

    def extendable?(directive)
      %i[frame_src media_src connect_src].include?(directive) || super
    end
  end

  module AnonymousCacheBypass
    def cacheable?
      path = @request.path
      return false if path == "/videos" || path.start_with?("/videos.", "/videos/")

      super
    end
  end
end

require_relative "lib/discourse_video_shorts/engine"

after_initialize do
  require "content_security_policy/builder"
  require_relative "app/models/discourse_video_shorts/origin_policy"
  require_relative "lib/discourse_video_shorts/policy/snapshot"
  require_relative "lib/discourse_video_shorts/media/origin_policy"
  require_relative "lib/discourse_video_shorts/media/redirect_policy"
  require_relative "lib/discourse_video_shorts/media/hls_policy"
  require_relative "lib/discourse_video_shorts/media_extractor"
  require_relative "lib/discourse_video_shorts/media_extractor_cache"
  require_relative "lib/discourse_video_shorts/source_selection"
  require_relative "lib/discourse_video_shorts/feed"
  require_relative "lib/discourse_video_shorts/comments/change_recorder"
  require_relative "lib/discourse_video_shorts/admin/diagnostics"
  require_relative "app/controllers/discourse_video_shorts/videos_controller"
  require_relative "app/controllers/discourse_video_shorts/policy_snapshot_controller"
  require_relative "app/controllers/discourse_video_shorts/comments_snapshot_controller"
  require_relative "app/controllers/discourse_video_shorts/comments_delta_controller"
  require_relative "app/controllers/discourse_video_shorts/authorization_leases_controller"
  require_relative "app/controllers/discourse_video_shorts/admin/origins_controller"
  require_relative "app/controllers/discourse_video_shorts/admin/diagnostics_controller"

  if defined?(::ContentSecurityPolicy::Builder) &&
       !::ContentSecurityPolicy::Builder.ancestors.include?(
         ::DiscourseVideoShorts::ContentSecurityPolicyFrameSrcExtension
       )
    ::ContentSecurityPolicy::Builder.prepend(
      ::DiscourseVideoShorts::ContentSecurityPolicyFrameSrcExtension
    )
  end

  if defined?(::Middleware::AnonymousCache::Helper) &&
       !::Middleware::AnonymousCache::Helper.ancestors.include?(
         ::DiscourseVideoShorts::AnonymousCacheBypass
       )
    ::Middleware::AnonymousCache::Helper.prepend(
      ::DiscourseVideoShorts::AnonymousCacheBypass
    )
  end

  Discourse::Application.routes.prepend do
    get "/videos" => "discourse_video_shorts/videos#show", format: false
    scope "/admin/plugins/discourse-video-shorts", constraints: AdminConstraint.new do
      get "/origins" => "discourse_video_shorts/admin/origins#show", constraints: { format: :json }
      patch "/origins" => "discourse_video_shorts/admin/origins#update", constraints: { format: :json }
      put "/origins" => "discourse_video_shorts/admin/origins#update", constraints: { format: :json }
      get "/diagnostics" => "discourse_video_shorts/admin/diagnostics#show", constraints: { format: :json }
      get "/diagnostics" => "admin/plugins#index", format: false
    end

    mount ::DiscourseVideoShorts::Engine, at: "/"
  end

  on(:post_created) do |post|
    ::DiscourseVideoShorts::Comments::ChangeRecorder.record(post: post, operation: :create)
  end

  on(:post_edited) do |post|
    ::DiscourseVideoShorts::Comments::ChangeRecorder.record(post: post, operation: :edit)
  end

  on(:post_destroyed) do |post|
    ::DiscourseVideoShorts::Comments::ChangeRecorder.record(post: post, operation: :delete)
  end

  on(:post_recovered) do |post|
    ::DiscourseVideoShorts::Comments::ChangeRecorder.record(post: post, operation: :recover)
  end

  on(:post_process_cooked) do |_document, post|
    ::DiscourseVideoShorts::Comments::ChangeRecorder.record(post: post, operation: :edit)
  end
end
