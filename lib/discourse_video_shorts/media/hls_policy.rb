# frozen_string_literal: true

require "uri"
require_relative "origin_policy"
require_relative "redirect_policy"

module DiscourseVideoShorts
  module Media
    class HlsPolicy
      class Denied < StandardError; end

      attr_reader :revision

      def initialize(snapshot:)
        @origin_policy = OriginPolicy.new(snapshot:)
        @redirect_policy = RedirectPolicy.new(origin_policy: @origin_policy)
        @revision = @origin_policy.revision
      end

      def authorize_manifest!(url, observed_redirects: [url])
        authorize!(url, observed_redirects:)
      end

      # Use this for every master/variant/segment/init/subtitle/key request after
      # parsing it from a manifest. `base_url` is the fetched manifest URL.
      def authorize_resource!(resource_url, base_url:, observed_redirects: nil)
        resolved_url = resolve_url(resource_url, base_url)
        redirects = observed_redirects || [resolved_url]
        authorize!(resolved_url, observed_redirects: redirects)
      end

      private

      def authorize!(url, observed_redirects:)
        @origin_policy.authorize!(url, revision:)
        @redirect_policy.authorize_chain!(observed_redirects, revision:)
        url
      rescue OriginPolicy::Denied, RedirectPolicy::Denied => error
        raise Denied, error.message
      end

      def resolve_url(resource_url, base_url)
        candidate = resource_url.to_s.strip
        raise Denied, "invalid_hls_resource_url" if candidate.empty? || candidate.start_with?("#")

        base = URI.parse(base_url.to_s)
        raise Denied, "invalid_hls_base_url" unless OriginPolicy.origin_for_url(base)

        resolved = URI.join(base.to_s, candidate)
        resolved.fragment = nil
        raise Denied, "invalid_hls_resource_url" unless OriginPolicy.origin_for_url(resolved)

        resolved.to_s
      rescue URI::InvalidURIError
        raise Denied, "invalid_hls_resource_url"
      end
    end
  end
end
