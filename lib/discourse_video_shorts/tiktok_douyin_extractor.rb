# frozen_string_literal: true

require "cgi"
require "digest"
require "nokogiri"
require "uri"

module DiscourseVideoShorts
  class TikTokDouyinExtractor
    TIKTOK_PAGE_HOSTS = %w[tiktok.com www.tiktok.com m.tiktok.com].freeze
    TIKTOK_SHORT_HOSTS = %w[vm.tiktok.com vt.tiktok.com].freeze
    DOUYIN_PAGE_HOSTS = %w[douyin.com www.douyin.com].freeze
    DOUYIN_SHARE_HOSTS = %w[iesdouyin.com www.iesdouyin.com].freeze
    DOUYIN_SHORT_HOST = "v.douyin.com"
    DOUYIN_PLAYER_HOST = "open.douyin.com"
    VIDEO_ID_PATTERN = /\A[0-9]{6,30}\z/

    class << self
      def extract(post)
        new(post).extract
      end
    end

    def initialize(post)
      @post = post
    end

    def extract
      tiktok_lazy_video_descriptor || iframe_descriptor || page_descriptor ||
        short_link_fallback_descriptor
    end

    private

    attr_reader :post

    def tiktok_lazy_video_descriptor
      html_fragments.each do |fragment|
        node =
          fragment.at_css(
            '[data-provider-name="tiktok"][data-video-id], blockquote.tiktok-embed[data-video-id]',
          )
        video_id = valid_video_id(node&.[]("data-video-id"))
        return tiktok_descriptor(video_id) if video_id
      end

      nil
    end

    def iframe_descriptor
      iframe_urls.each do |url|
        uri = parse_http_url(url)
        next if uri.blank?

        descriptor = tiktok_url_descriptor(uri) || douyin_url_descriptor(uri)
        return descriptor if descriptor
      end

      nil
    end

    def page_descriptor
      source_urls.each do |url|
        uri = parse_http_url(url)
        next if uri.blank?

        descriptor = tiktok_url_descriptor(uri) || douyin_url_descriptor(uri)
        return descriptor if descriptor
      end

      nil
    end

    def short_link_fallback_descriptor
      source_urls.each do |url|
        uri = parse_http_url(url)
        next if uri.blank?

        if tiktok_short_link?(uri)
          return fallback_descriptor("tiktok", uri, "tiktok_short_link_requires_canonical_url")
        end

        if normalized_host(uri) == DOUYIN_SHORT_HOST
          return fallback_descriptor("douyin", uri, "douyin_short_link_requires_canonical_url")
        end
      end

      nil
    end

    def tiktok_url_descriptor(uri)
      video_id = tiktok_video_id(uri)
      return nil if video_id.blank?
      return fallback_descriptor("tiktok", uri, "tiktok_requires_https") if uri.scheme != "https"

      tiktok_descriptor(video_id)
    end

    def douyin_url_descriptor(uri)
      video_id = douyin_video_id(uri)
      return nil if video_id.blank?
      return fallback_descriptor("douyin", uri, "douyin_requires_https") if uri.scheme != "https"

      {
        provider: "douyin",
        renderability: "iframe_candidate",
        embed_url: "https://open.douyin.com/player/video?vid=#{video_id}&autoplay=0",
        source_url: "https://www.douyin.com/video/#{video_id}",
        dedupe_key: "douyin:#{video_id}",
      }
    end

    def tiktok_descriptor(video_id)
      {
        provider: "tiktok",
        renderability: "iframe_candidate",
        embed_url:
          "https://www.tiktok.com/player/v1/#{video_id}?autoplay=0&loop=1&rel=0",
        source_url: "https://www.tiktok.com/v/#{video_id}",
        dedupe_key: "tiktok:#{video_id}",
      }
    end

    def fallback_descriptor(provider, uri, reason)
      normalized_url = normalized_scheme_host_path(uri)
      {
        provider: provider,
        renderability: "fallback",
        fallback: "post",
        fallback_reason: reason,
        source_url: normalized_url,
        dedupe_key: "#{provider}:fallback:#{Digest::SHA256.hexdigest(normalized_url)}",
      }
    end

    def tiktok_video_id(uri)
      return nil if TIKTOK_PAGE_HOSTS.exclude?(normalized_host(uri))

      patterns = [
        %r{\A/@[^/]+/video/([0-9]{6,30})/?\z},
        %r{\A/v/([0-9]{6,30})(?:\.html)?/?\z},
        %r{\A/player/v1/([0-9]{6,30})/?\z},
        %r{\A/embed/v2/([0-9]{6,30})/?\z},
      ]
      patterns.filter_map { |pattern| uri.path.match(pattern)&.[](1) }.first
    end

    def douyin_video_id(uri)
      if DOUYIN_PAGE_HOSTS.include?(normalized_host(uri))
        return uri.path.match(%r{\A/video/([0-9]{6,30})/?\z})&.[](1)
      end

      if DOUYIN_SHARE_HOSTS.include?(normalized_host(uri))
        return uri.path.match(%r{\A/share/video/([0-9]{6,30})/?\z})&.[](1)
      end

      return nil if normalized_host(uri) != DOUYIN_PLAYER_HOST || uri.path != "/player/video"

      valid_video_id(douyin_player_video_id(uri))
    end

    def tiktok_short_link?(uri)
      TIKTOK_SHORT_HOSTS.include?(normalized_host(uri)) ||
        (TIKTOK_PAGE_HOSTS.include?(normalized_host(uri)) && uri.path.start_with?("/t/"))
    end

    def valid_video_id(value)
      value = value.to_s
      value if value.match?(VIDEO_ID_PATTERN)
    end

    def douyin_player_video_id(uri)
      pairs = URI.decode_www_form(uri.query.to_s)
      return nil if pairs.any? { |key, _value| key.start_with?("vid[") }

      values = pairs.filter_map { |key, value| value if key == "vid" }
      values.one? ? values.first : nil
    rescue ArgumentError
      nil
    end

    def source_urls
      @source_urls ||= (extract_urls(post.raw.to_s) + anchor_urls).uniq
    end

    def iframe_urls
      @iframe_urls ||=
        [post.cooked.to_s, CGI.unescapeHTML(post.cooked.to_s), post.raw.to_s, CGI.unescapeHTML(post.raw.to_s)]
          .flat_map { |html| html_fragment(html).css("iframe[src]").map { |iframe| iframe["src"] } }
          .compact
          .uniq
    end

    def anchor_urls
      html_fragments.flat_map { |fragment| fragment.css("a[href]").map { |anchor| anchor["href"] } }.uniq
    end

    def html_fragments
      @html_fragments ||=
        [post.cooked.to_s, CGI.unescapeHTML(post.cooked.to_s)].map { |html| html_fragment(html) }
    end

    def extract_urls(text)
      text.scan(%r{https?://[^\s<>"')]+}).map { |url| url.delete_suffix(".") }.uniq
    end

    def html_fragment(html)
      Nokogiri::HTML5.fragment(html)
    end

    def parse_http_url(url)
      uri = URI.parse(url.to_s)
      return nil if %w[http https].exclude?(uri.scheme)
      return nil if uri.host.blank?
      return nil if uri.userinfo.present?
      return nil if uri.port != uri.default_port

      uri
    rescue URI::InvalidURIError
      nil
    end

    def normalized_scheme_host_path(uri)
      "#{uri.scheme.downcase}://#{normalized_host(uri)}#{uri.path}"
    end

    def normalized_host(uri)
      uri.host.to_s.downcase
    end
  end
end
