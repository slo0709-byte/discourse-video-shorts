# frozen_string_literal: true
require "time"


module DiscourseVideoShorts
  module Policy
    class Snapshot
      attr_reader :revision, :external_media_enabled, :origins, :generated_at

      def self.current(generated_at: Time.current)
        policy = OriginPolicy.current
        new(
          revision: policy.revision,
          external_media_enabled: policy.external_media_enabled,
          origins: policy.origins,
          generated_at: generated_at,
        )
      end

      def initialize(revision:, external_media_enabled:, origins:, generated_at:)
        @revision = Integer(revision)
        @external_media_enabled = !!external_media_enabled
        @origins = origins.map { |origin| origin.dup.freeze }.freeze
        @generated_at = generated_at.utc.iso8601.freeze
        freeze
      end

      def etag
        "policy-#{revision}"
      end

      def allowed_origin?(origin)
        origins.include?(origin)
      end

      def to_h
        {
          revision: revision,
          external_media_enabled: external_media_enabled,
          origins: origins,
          generated_at: generated_at,
        }.freeze
      end
    end
  end
end
