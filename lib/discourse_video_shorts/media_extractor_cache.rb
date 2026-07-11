# frozen_string_literal: true

require "digest"
require "json"

module DiscourseVideoShorts
  class MediaExtractorCache
    VERSION = 2
    CACHE_TTL = 1.day
    CACHE_KEY_PREFIX = "discourse-video-shorts:media:"

    class << self
      def extract_media_for_visible_post(post, guardian, policy_snapshot:)
        new(post, guardian, policy_snapshot:).extract
      end
    end

    def initialize(post, guardian, policy_snapshot:)
      @post = post
      @guardian = guardian
      @policy_snapshot = policy_snapshot
    end

    def extract
      cached = cached_descriptor
      return cached if cached.present?

      descriptor =
        MediaExtractor.extract_media_for_visible_post(
          post,
          guardian,
          policy_snapshot: policy_snapshot,
        )
      write_cache(descriptor) if descriptor.present?
      descriptor
    end

    private

    attr_reader :post, :guardian, :policy_snapshot

    def cached_descriptor
      raw_payload = Discourse.cache.read(cache_key)
      return nil if raw_payload.blank?

      payload = JSON.parse(raw_payload)
      return nil if payload["version"] != VERSION
      return nil if payload["signature"] != signature

      symbolize(payload["descriptor"])
    rescue JSON::ParserError, TypeError
      nil
    end

    def write_cache(descriptor)
      Discourse.cache.write(cache_key, JSON.generate(cache_payload(descriptor)), expires_in: CACHE_TTL)
    end

    def signature
      @signature ||= Digest::SHA256.hexdigest(JSON.generate(signature_payload))
    end
    def cache_key
      "#{CACHE_KEY_PREFIX}#{signature}"
    end

    def cache_payload(descriptor)
      { version: VERSION, signature: signature, descriptor: stringify(descriptor) }
    end

    def signature_payload
      {
        version: VERSION,
        raw: Digest::SHA256.hexdigest(post.raw.to_s),
        cooked: Digest::SHA256.hexdigest(post.cooked.to_s),
        uploads: upload_signature,
        settings: settings_signature,
        staff: guardian.user&.staff? ? true : false,
        policy_revision: policy_snapshot.revision,
      }
    end

    def upload_signature
      post.uploads.map { |upload| upload_payload(upload) }.sort_by { |upload| upload[:id].to_i }
    end

    def upload_payload(upload)
      {
        id: upload.id,
        sha1: upload.sha1,
        extension: upload.extension,
        original_filename: upload.original_filename,
        filesize: upload.filesize,
        secure: upload.secure?
      }
    end

    def settings_signature
      {
        authorized_extensions: SiteSetting.authorized_extensions.to_s,
        authorized_extensions_for_staff: SiteSetting.authorized_extensions_for_staff.to_s,
      }
    end

    def stringify(value)
      case value
      when Hash
        value.to_h { |key, nested_value| [key.to_s, stringify(nested_value)] }
      when Array
        value.map { |nested_value| stringify(nested_value) }
      else
        value
      end
    end

    def symbolize(value)
      case value
      when Hash
        value.to_h { |key, nested_value| [key.to_sym, symbolize(nested_value)] }
      when Array
        value.map { |nested_value| symbolize(nested_value) }
      else
        value
      end
    end
  end
end
