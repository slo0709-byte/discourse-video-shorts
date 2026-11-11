# frozen_string_literal: true

module DiscourseVideoShorts
  module ProviderPolicy
    SITE_SETTING_BY_PROVIDER = {
      "youtube" => :video_shorts_youtube_enabled,
      "bilibili" => :video_shorts_bilibili_enabled,
      "tiktok" => :video_shorts_tiktok_enabled,
      "douyin" => :video_shorts_douyin_enabled,
    }.freeze

    module_function

    def enabled?(provider)
      setting = SITE_SETTING_BY_PROVIDER[provider.to_s]
      setting.nil? || SiteSetting.public_send(setting)
    end

    def settings_snapshot
      SITE_SETTING_BY_PROVIDER.transform_values do |setting|
        SiteSetting.public_send(setting)
      end
    end
  end
end
