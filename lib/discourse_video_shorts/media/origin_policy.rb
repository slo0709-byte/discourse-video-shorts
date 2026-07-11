# frozen_string_literal: true

require "ipaddr"
require "uri"

module DiscourseVideoShorts
  module Media
    class OriginPolicy
      class Denied < StandardError; end

      attr_reader :snapshot

      def initialize(snapshot:)
        raise Denied, "missing_policy_snapshot" unless valid_snapshot?(snapshot)

        @snapshot = snapshot
        @revision = snapshot.revision
      end

      def revision
        @revision
      end

      def allowed_url?(url, revision: @revision)
        return false unless revision == @revision && snapshot.external_media_enabled

        origin = self.class.origin_for_url(url)
        origin && snapshot.allowed_origin?(origin)
      rescue URI::InvalidURIError
        false
      end

      def authorize!(url, revision: @revision)
        raise Denied, "policy_revision_mismatch" unless revision == @revision
        raise Denied, "external_media_disabled" unless snapshot.external_media_enabled

        origin = self.class.origin_for_url(url)
        raise Denied, "invalid_external_url" if origin.nil?
        raise Denied, "unapproved_origin" unless snapshot.allowed_origin?(origin)

        origin
      end

      def self.normalize_origin(value)
        uri = URI.parse(value.to_s)
        return nil unless uri.path.empty? || uri.path == "/"
        return nil unless uri.query.nil? && uri.fragment.nil?

        origin_for_uri(uri)
      rescue URI::InvalidURIError
        nil
      end

      def self.origin_for_url(value)
        origin_for_uri(URI.parse(value.to_s))
      rescue URI::InvalidURIError
        nil
      end

      def self.origin_for_uri(uri)
        return nil unless uri.is_a?(URI::HTTP) && uri.scheme&.downcase == "https"
        return nil if uri.host.nil? || uri.host.empty? || uri.userinfo.present?

        host = uri.host.downcase.delete_suffix(".")
        return nil unless valid_host?(host)

        port = uri.port
        return nil unless port == 443 || (1..65_535).cover?(port)

        normalized_host = host.include?(":") ? "[#{host}]" : host
        port == 443 ? "https://#{normalized_host}" : "https://#{normalized_host}:#{port}"
      end

      def self.valid_host?(host)
        IPAddr.new(host)
        true
      rescue IPAddr::InvalidAddressError
        host.match?(/\A(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\z/)
      end

      private

      def valid_snapshot?(candidate)
        candidate.frozen? && candidate.respond_to?(:revision) &&
          candidate.respond_to?(:external_media_enabled) && candidate.respond_to?(:origins) &&
          candidate.origins.frozen? && candidate.respond_to?(:allowed_origin?)
      end
    end
  end
end
