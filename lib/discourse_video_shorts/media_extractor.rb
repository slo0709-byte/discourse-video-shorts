# frozen_string_literal: true

require "cgi"
require "digest"
require "nokogiri"
require "uri"

module DiscourseVideoShorts
  class MediaExtractor
    VIDEO_EXTENSIONS = %w[mp4 webm mov m4v].freeze
    HLS_EXTENSION = "m3u8"
    BILIBILI_HOSTS = %w[www.bilibili.com bilibili.com].freeze
    BILIBILI_PLAYER_HOST = "player.bilibili.com"
    YOUTUBE_EMBED_HOSTS = %w[www.youtube.com www.youtube-nocookie.com].freeze
    VIMEO_EMBED_HOST = "player.vimeo.com"
    BVID_PATTERN = /\ABV[0-9A-Za-z]{10}\z/

    class << self
      def extract_media_for_visible_post(post, guardian)
        new(post, guardian).extract
      end
    end

    def initialize(post, guardian)
      @post = post
      @guardian = guardian
    end

    def extract
      native_upload_descriptor || hls_descriptor || bilibili_canonical_descriptor ||
        bilibili_iframe_descriptor || youtube_vimeo_iframe_descriptor || raw_known_provider_descriptor ||
        TikTokDouyinExtractor.extract(post) || unsupported_intended_video_descriptor
    end

    private

    attr_reader :post, :guardian

    def native_upload_descriptor
      upload = post.uploads.find { |candidate| playable_upload_extension?(candidate.extension) }
      return nil if upload.blank?

      {
        provider: "native",
        renderability: "native",
        dedupe_key: "native:upload:#{upload.id}",
        upload: {
          id: upload.id,
          sha1: upload.sha1,
          extension: upload.extension,
          original_filename: upload.original_filename,
          filesize: upload.filesize,
          secure: upload.secure?,
        },
      }
    end

    def hls_descriptor
      unsupported_candidate_urls.each do |url|
        uri = parse_http_url(url)
        next if uri.blank?
        next if !hls_path?(uri.path)

        normalized_url = normalized_scheme_host_path(uri)
        return hls_invalid_descriptor(normalized_url) if uri.scheme != "https"

        return {
          provider: "hls",
          renderability: "hls",
          hls_url: url_without_fragment(uri),
          dedupe_key: "hls:#{sha256(normalized_url)}",
        }
      end

      nil
    end

    def hls_invalid_descriptor(normalized_url, reason = "hls_requires_https")
      {
        provider: "hls",
        renderability: "fallback",
        fallback: "post",
        fallback_reason: reason,
        dedupe_key: "hls:invalid:#{sha256(normalized_url)}",
      }
    end

    def bilibili_canonical_descriptor
      raw_urls.each do |url|
        uri = parse_http_url(url)
        next if uri.blank?
        next if BILIBILI_HOSTS.exclude?(uri.host)

        bvid = bilibili_bvid_from_canonical_path(uri.path)
        return bilibili_invalid_descriptor(uri) if bvid.blank?

        return bilibili_iframe_candidate_descriptor(bvid: bvid, page: 1)
      end

      nil
    end

    def bilibili_iframe_descriptor
      iframe_urls.each do |url|
        uri = parse_http_url(url)
        next if uri.blank?
        next if uri.host != BILIBILI_PLAYER_HOST

        return bilibili_player_descriptor(uri)
      end

      nil
    end

    def youtube_vimeo_iframe_descriptor
      iframe_urls.each do |url|
        uri = parse_http_url(url)
        next if uri.blank?

        descriptor = youtube_iframe_descriptor(uri) || vimeo_iframe_descriptor(uri)
        return descriptor if descriptor.present?
      end

      nil
    end

    def raw_known_provider_descriptor
      raw_urls.each do |url|
        uri = parse_http_url(url)
        next if uri.blank?

        youtube_descriptor = raw_youtube_descriptor(uri)
        return youtube_descriptor if youtube_descriptor.present?
        return raw_provider_fallback("vimeo", uri) if raw_vimeo_url?(uri)
      end

      nil
    end

    def unsupported_intended_video_descriptor
      unsupported_candidate_urls.each do |url|
        uri = parse_http_url(url)
        next if uri.blank?
        next if supported_provider_host?(uri.host)
        next if !video_path?(uri.path)

        normalized_url = normalized_scheme_host_path(uri)
        return {
          provider: "unsupported",
          renderability: "fallback",
          fallback: "post",
          fallback_reason: "unsupported_intended_video",
          normalized_url: normalized_url,
          dedupe_key: "unsupported:#{sha256(normalized_url)}",
        }
      end

      nil
    end

    def bilibili_player_descriptor(uri)
      return bilibili_invalid_descriptor(uri) if uri.scheme != "https"
      return bilibili_invalid_descriptor(uri) if uri.path != "/player.html"

      params = Rack::Utils.parse_nested_query(uri.query)
      bvid = params["bvid"].to_s
      return bilibili_invalid_descriptor(uri) if bvid !~ BVID_PATTERN

      page = positive_integer_string?(params["page"]) ? params["page"].to_i : 1
      bilibili_iframe_candidate_descriptor(bvid: bvid, page: page)
    end

    def bilibili_iframe_candidate_descriptor(bvid:, page:)
      {
        provider: "bilibili",
        renderability: "iframe_candidate",
        embed_url: "https://player.bilibili.com/player.html?bvid=#{bvid}&page=#{page}",
        dedupe_key: "bilibili:#{bvid}:page:#{page}",
      }
    end

    def bilibili_invalid_descriptor(uri)
      normalized_url = normalized_scheme_host_path(uri)
      {
        provider: "bilibili",
        renderability: "fallback",
        fallback: "post",
        fallback_reason: "invalid_bilibili_url",
        dedupe_key: "bilibili:invalid:#{sha256(normalized_url)}",
      }
    end

    def youtube_iframe_descriptor(uri)
      return raw_provider_fallback("youtube", uri) if raw_youtube_iframe_host?(uri.host)
      return nil if YOUTUBE_EMBED_HOSTS.exclude?(uri.host)
      return raw_provider_fallback("youtube", uri) if uri.scheme != "https"

      match = uri.path.match(%r{\A/embed/([^/?#]+)\z})
      return raw_provider_fallback("youtube", uri) if match.blank?

      video_id = match[1]
      return raw_provider_fallback("youtube", uri) if video_id.blank?

      {
        provider: "youtube",
        renderability: "iframe_candidate",
        embed_url: "https://#{uri.host}/embed/#{video_id}",
        dedupe_key: "youtube:#{video_id}",
      }
    end

    def vimeo_iframe_descriptor(uri)
      return nil if uri.host != VIMEO_EMBED_HOST
      return raw_provider_fallback("vimeo", uri) if uri.scheme != "https"

      match = uri.path.match(%r{\A/video/([0-9]+)\z})
      return raw_provider_fallback("vimeo", uri) if match.blank?

      video_id = match[1]
      {
        provider: "vimeo",
        renderability: "iframe_candidate",
        embed_url: "https://player.vimeo.com/video/#{video_id}",
        dedupe_key: "vimeo:#{video_id}",
      }
    end

    def raw_provider_fallback(provider, uri)
      normalized_url = normalized_scheme_host_path(uri)
      {
        provider: provider,
        renderability: "fallback",
        fallback: "post",
        fallback_reason: "#{provider}_raw_url_unrenderable_v1",
        dedupe_key: "#{provider}:raw:#{sha256(normalized_url)}",
      }
    end

    def raw_youtube_descriptor(uri)
      return nil if !raw_youtube_url?(uri)

      video_id = raw_youtube_video_id(uri)
      return raw_provider_fallback("youtube", uri) if video_id.blank?

      {
        provider: "youtube",
        renderability: "iframe_candidate",
        embed_url: "https://www.youtube.com/embed/#{video_id}",
        dedupe_key: "youtube:#{video_id}",
      }
    end

    def raw_youtube_video_id(uri)
      if uri.host == "youtu.be"
        return uri.path.delete_prefix("/").split("/").first.presence
      end

      if uri.path.start_with?("/shorts/")
        return uri.path.delete_prefix("/shorts/").split("/").first.presence
      end

      Rack::Utils.parse_nested_query(uri.query)["v"].presence if uri.path.start_with?("/watch")
    end

    def bilibili_bvid_from_canonical_path(path)
      match = path.to_s.match(%r{\A/video/([^/]+)/?\z})
      return nil if match.blank?

      bvid = match[1]
      bvid if bvid.match?(BVID_PATTERN)
    end

    def raw_urls
      @raw_urls ||= extract_urls(post.raw.to_s)
    end

    def unsupported_candidate_urls
      @unsupported_candidate_urls ||= (raw_urls + anchor_urls).uniq
    end

    def iframe_urls
      @iframe_urls ||=
        [post.cooked.to_s, decoded_html(post.cooked.to_s), post.raw.to_s, decoded_html(post.raw.to_s)]
          .flat_map { |html| html_fragment(html).css("iframe[src]").map { |iframe| iframe["src"] } }
          .compact
          .uniq
    end

    def anchor_urls
      @anchor_urls ||=
        html_fragment(post.cooked.to_s).css("a[href]").map { |anchor| anchor["href"] }.compact.uniq
    end

    def extract_urls(text)
      text.scan(%r{https?://[^\s<>"')]+}).map { |url| url.delete_suffix(".") }.uniq
    end

    def html_fragment(html)
      Nokogiri::HTML5.fragment(html)
    end

    def decoded_html(html)
      CGI.unescapeHTML(html)
    end

    def parse_http_url(url)
      uri = URI.parse(url.to_s)
      return nil if %w[http https].exclude?(uri.scheme)
      return nil if uri.host.blank?

      uri
    rescue URI::InvalidURIError
      nil
    end

    def raw_youtube_url?(uri)
      %w[www.youtube.com youtube.com m.youtube.com youtu.be].include?(uri.host) &&
        (uri.path.start_with?("/watch") || uri.path.start_with?("/shorts/") || uri.host == "youtu.be")
    end

    def raw_youtube_iframe_host?(host)
      %w[youtube.com m.youtube.com youtu.be].include?(host)
    end

    def raw_vimeo_url?(uri)
      uri.host == "vimeo.com" && uri.path.match?(%r{\A/[0-9]+/?\z})
    end

    def supported_provider_host?(host)
      BILIBILI_HOSTS.include?(host) || host == BILIBILI_PLAYER_HOST ||
        YOUTUBE_EMBED_HOSTS.include?(host) || host == "youtube.com" || host == "m.youtube.com" ||
        host == "youtu.be" || host == VIMEO_EMBED_HOST || host == "vimeo.com"
    end

    def normalized_scheme_host_path(uri)
      "#{uri.scheme.downcase}://#{uri.host.downcase}#{uri.path}"
    end

    def video_path?(path)
      extension = File.extname(path.to_s).delete_prefix(".").downcase
      VIDEO_EXTENSIONS.include?(extension)
    end

    def hls_path?(path)
      File.extname(path.to_s).delete_prefix(".").downcase == HLS_EXTENSION
    end

    def playable_upload_extension?(extension)
      normalized_extension = extension.to_s.delete_prefix(".").downcase
      VIDEO_EXTENSIONS.include?(normalized_extension) &&
        authorized_upload_extensions.include?(normalized_extension)
    end

    def authorized_upload_extensions
      extensions = setting_extensions(SiteSetting.authorized_extensions)

      if guardian.user&.staff?
        return VIDEO_EXTENSIONS.to_set if SiteSetting.authorized_extensions_for_staff.include?("*")

        extensions |= setting_extensions(SiteSetting.authorized_extensions_for_staff)
      end

      extensions
    end

    def setting_extensions(value)
      value.to_s.gsub(/[\s.]+/, "").downcase.split("|").reject { |extension| extension.include?("*") }.to_set
    end

    def url_without_fragment(uri)
      uri = uri.dup
      uri.fragment = nil
      uri.to_s
    end

    def positive_integer_string?(value)
      value.to_s.match?(/\A[1-9][0-9]*\z/)
    end

    def sha256(value)
      Digest::SHA256.hexdigest(value)
    end
  end
end
