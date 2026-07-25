# frozen_string_literal: true

require 'digest'
require 'json'

module DiscourseVideoShorts
  class MediaExtractorCache
    CUSTOM_FIELD = 'discourse_video_shorts_media_cache_v1'
    VERSION = 2

    class << self
      def extract_media_for_visible_post(post, guardian)
        new(post, guardian).extract
      end

      def invalidate(post)
        return if post.blank?

        post.custom_fields.delete(CUSTOM_FIELD)
        post.save_custom_fields(true)
      end
    end

    def initialize(post, guardian)
      @post = post
      @guardian = guardian
    end

    def extract
      cached = cached_descriptor
      return cached if cached.present?

      descriptor = MediaExtractor.extract_media_for_visible_post(post, guardian)
      write_cache(descriptor) if descriptor.present?
      descriptor
    end

    private

    attr_reader :post, :guardian

    def cached_descriptor
      raw_payload = post.custom_fields[CUSTOM_FIELD]
      return nil if raw_payload.blank?

      payload = JSON.parse(raw_payload)
      return nil if payload['version'] != VERSION
      return nil if payload['signature'] != signature

      symbolize(payload['descriptor'])
    rescue JSON::ParserError, TypeError
      self.class.invalidate(post)
      nil
    end

    def write_cache(descriptor)
      post.custom_fields[CUSTOM_FIELD] = JSON.generate(cache_payload(descriptor))
      post.save_custom_fields(true)
    end

    def signature
      @signature ||= Digest::SHA256.hexdigest(JSON.generate(signature_payload))
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
        staff: guardian.user&.staff? ? true : false
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
        hls_allowed_origins: SiteSetting.video_shorts_hls_allowed_origins.to_s
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
