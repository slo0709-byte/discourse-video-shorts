# frozen_string_literal: true

require "uri"
require "ipaddr"

module DiscourseVideoShorts
  class HlsOriginPolicy
    HOST_PATTERN =
      /\A(?=.{1,253}\z)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\z/i

    class << self
      def configured_origins
        SiteSetting.video_shorts_hls_allowed_origins
          .to_s
          .split("|")
          .filter_map { |value| normalize_origin(value) }
          .uniq
      end

      def media_csp_sources
        ["'self'", "blob:", "https:", *configured_origins, *native_media_origins].uniq
      end

      def normalize_origin(value)
        uri = value.is_a?(URI::Generic) ? value : URI.parse(value.to_s.strip)
        return nil if uri.scheme&.downcase != "https"
        return nil if uri.host.blank? || uri.userinfo.present?
        return nil if !valid_host?(uri.hostname)

        host = uri.hostname.downcase
        host = "[#{host}]" if host.include?(":")
        port = uri.port == 443 ? "" : ":#{uri.port}"
        "https://#{host}#{port}"
      rescue URI::Error
        nil
      end

      private

      def native_media_origins
        [
          GlobalSetting.try(:cdn_url),
          GlobalSetting.try(:s3_cdn_url),
          SiteSetting::Upload.try(:s3_cdn_url),
        ].filter_map { |value| normalize_origin(value) }
      end

      def valid_host?(host)
        return false if host.blank? || host.include?("*")
        return true if host.include?(":") && IPAddr.new(host).ipv6?

        host.match?(HOST_PATTERN)
      rescue IPAddr::InvalidAddressError
        false
      end
    end
  end

  class ContentSecurityPolicyExtension < Hash
    FRAME_SOURCES = %w[
      'self'
      https://www.youtube.com
      https://www.youtube-nocookie.com
      https://player.bilibili.com
      https://www.bilibili.com
      https://player.vimeo.com
      https://www.tiktok.com
      https://open.douyin.com
    ].freeze

    def each
      return enum_for(:each) if !block_given?

      yield :frame_src, FRAME_SOURCES
      yield :media_src, HlsOriginPolicy.media_csp_sources
    end
  end
end
