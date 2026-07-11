# frozen_string_literal: true

require_relative "origin_policy"

module DiscourseVideoShorts
  module Media
    class RedirectPolicy
      class Denied < StandardError; end

      def initialize(origin_policy:)
        @origin_policy = origin_policy
      end

      # The caller must provide the actual, ordered response URLs. A redirect API
      # that cannot expose every hop is not safe for external media.
      def authorize_chain!(observed_urls, revision: @origin_policy.revision)
        urls = Array(observed_urls)
        raise Denied, "unobservable_redirect" if urls.empty? || urls.any?(&:blank?)

        urls.map { |url| @origin_policy.authorize!(url, revision:) }
      rescue OriginPolicy::Denied => error
        raise Denied, error.message
      end
    end
  end
end
