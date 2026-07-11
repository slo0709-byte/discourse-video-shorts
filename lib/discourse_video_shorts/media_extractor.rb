# frozen_string_literal: true

require "cgi"
require "nokogiri"
require "openssl"
require "uri"
require_relative "media/origin_policy"

module DiscourseVideoShorts
  class MediaExtractor
    BILIBILI_HOSTS = %w[bilibili.com www.bilibili.com player.bilibili.com].freeze
    BVID_PATTERN = /\ABV[0-9A-Za-z]{10}\z/
    YOUTUBE_HOSTS = %w[m.youtube.com www.youtube.com youtube.com].freeze
    YOUTUBE_ID_PATTERN = /\A[A-Za-z0-9_-]{11}\z/

    class << self
      def extract_media_for_visible_post(post, guardian, policy_snapshot: nil)
        new(post, guardian, policy_snapshot:).extract
      end
    end

    def initialize(post, guardian, policy_snapshot: nil)
      @post = post
      @guardian = guardian
      @policy_snapshot = policy_snapshot
    end

    def extract
      uploaded_mp4_descriptor || provider_descriptor || external_media_descriptor || invalid_media_descriptor
    end

    private

    attr_reader :post, :guardian, :policy_snapshot

    def uploaded_mp4_descriptor
      upload = post.uploads.find { |candidate| playable_upload?(candidate) }
      return nil unless upload

      {
        kind: "upload_mp4",
        identity: "v1:upload:#{upload.id}:#{upload.sha1}",
        url: authorized_upload_url(upload),
        required_origins: [],
        policy_revision: nil,
        fallback_reason: nil,
      }
    end

    def provider_descriptor
      candidate_urls.each do |url|
        uri = parse_url(url)
        next unless uri

        descriptor = bilibili_descriptor(uri) || youtube_descriptor(uri)
        return descriptor if descriptor
      end
      nil
    end

    def bilibili_descriptor(uri)
      return nil if BILIBILI_HOSTS.exclude?(uri.host)
      return fallback("bilibili", "invalid_bilibili_url", uri.to_s) unless uri.scheme == "https"

      bvid =
        if uri.host == "player.bilibili.com" && uri.path == "/player.html"
          Rack::Utils.parse_nested_query(uri.query.to_s)["bvid"]
        else
          uri.path.match(%r{\A/video/([^/]+)/?\z})&.captures&.first
        end
      return fallback("bilibili", "invalid_bilibili_url", uri.to_s) unless bvid&.match?(BVID_PATTERN)

      {
        kind: "bilibili",
        identity: "v1:bilibili:#{bvid}",
        url: "https://player.bilibili.com/player.html?bvid=#{bvid}&page=1",
        required_origins: [],
        policy_revision: nil,
        fallback_reason: nil,
      }
    end

    def youtube_descriptor(uri)
      video_id = youtube_video_id(uri)
      return nil unless video_id || youtube_host?(uri.host)
      return fallback("youtube", "invalid_youtube_url", uri.to_s) unless uri.scheme == "https" && video_id

      {
        kind: "youtube",
        identity: "v1:youtube:#{video_id}",
        url: "https://www.youtube.com/embed/#{video_id}",
        required_origins: [],
        policy_revision: nil,
        fallback_reason: nil,
      }
    end

    def external_media_descriptor
      candidate_urls.each do |url|
        uri = parse_url(url)
        next unless uri

        kind = external_kind(uri)
        next unless kind
        return fallback(kind, "https_required", uri.to_s) unless uri.scheme == "https"

        playback_url = url_without_fragment(uri)
        origin_policy = Media::OriginPolicy.new(snapshot: current_policy_snapshot)
        origin = origin_policy.authorize!(playback_url)

        return {
          kind:,
          identity: external_identity(kind, playback_url),
          url: playback_url,
          required_origins: [origin],
          policy_revision: origin_policy.revision,
          fallback_reason: nil,
        }
      rescue Media::OriginPolicy::Denied => error
        return fallback(kind || "external", error.message, url)
      end
      nil
    end

    def invalid_media_descriptor
      raw_urls.each do |url|
        uri = parse_url(url)
        return fallback("external", "invalid_media_url", url) if uri.nil? && url.start_with?("http")
      end
      nil
    end

    def current_policy_snapshot
      return policy_snapshot if policy_snapshot
      return DiscourseVideoShorts::Policy::Snapshot.current if defined?(DiscourseVideoShorts::Policy::Snapshot)

      raise Media::OriginPolicy::Denied, "missing_policy_snapshot"
    end

    def youtube_video_id(uri)
      candidate =
        if uri.host == "youtu.be"
          uri.path.delete_prefix("/").split("/").first if uri.path.match?(%r{\A/[^/]+/?\z})
        elsif YOUTUBE_HOSTS.include?(uri.host) && uri.path == "/watch"
          Rack::Utils.parse_nested_query(uri.query.to_s)["v"]
        elsif YOUTUBE_HOSTS.include?(uri.host) && uri.path.match?(%r{\A/(?:shorts|embed)/[^/]+/?\z})
          uri.path.split("/").last
        end
      candidate if candidate&.match?(YOUTUBE_ID_PATTERN)
    end

    def youtube_host?(host)
      YOUTUBE_HOSTS.include?(host) || host == "youtu.be"
    end


    def external_kind(uri)
      extension = File.extname(uri.path.to_s).delete_prefix(".").downcase
      return "external_mp4" if extension == "mp4"
      return "external_hls" if extension == "m3u8"

      nil
    end

    def authorized_upload_url(upload)
      UrlHelper.cook_url(upload.url, secure: upload.secure?, local: true)
    end


    def playable_upload?(upload)
      upload.extension.to_s.delete_prefix(".").downcase == "mp4" && authorized_upload_extensions.include?("mp4")
    end

    def authorized_upload_extensions
      extensions = setting_extensions(SiteSetting.authorized_extensions)
      if guardian.user&.staff?
        staff_extensions = SiteSetting.authorized_extensions_for_staff.to_s
        return Set["mp4"] if staff_extensions.split("|").include?("*")

        extensions |= setting_extensions(staff_extensions)
      end
      extensions
    end

    def setting_extensions(value)
      value.to_s.gsub(/[\s.]+/, "").downcase.split("|").to_set
    end

    def candidate_urls
      @candidate_urls ||= (raw_urls + cooked_urls).uniq
    end

    def raw_urls
      @raw_urls ||= extract_urls(post.raw.to_s)
    end

    def cooked_urls
      @cooked_urls ||=
        html_fragment(post.cooked.to_s).css("a[href], iframe[src]").filter_map do |element|
          element["href"] || element["src"]
        end.uniq
    end

    def extract_urls(text)
      text.scan(%r{https?://[^\s<>"')]+}).map { |url| url.delete_suffix(".") }.uniq
    end

    def parse_url(url)
      uri = URI.parse(url.to_s)
      return nil unless uri.is_a?(URI::HTTP) && uri.host.present?
      return nil if uri.userinfo.present?

      uri.host = uri.host.downcase
      uri
    rescue URI::InvalidURIError
      nil
    end

    def html_fragment(html)
      Nokogiri::HTML5.fragment(CGI.unescapeHTML(html))
    end

    def url_without_fragment(uri)
      normalized = uri.dup
      normalized.fragment = nil
      normalized.to_s
    end

    def fallback(kind, reason, value)
      {
        kind: "fallback",
        identity: external_identity("#{kind}:#{reason}", value),
        url: nil,
        required_origins: [],
        policy_revision: nil,
        fallback_reason: reason,
      }
    end

    def external_identity(kind, value)
      secret = Rails.application.secret_key_base
      digest = OpenSSL::HMAC.hexdigest("SHA256", secret, "discourse-video-shorts:v1:#{kind}:#{value}")
      "v1:external:#{digest}"
    end
  end
end
