# frozen_string_literal: true

require "uri"

module DiscourseVideoShorts
  class OriginPolicy < ActiveRecord::Base
    self.table_name = "video_shorts_origin_policies"

    belongs_to :updated_by, class_name: "User", optional: true
    has_many :policy_revisions,
             class_name: "DiscourseVideoShorts::OriginPolicyRevision",
             dependent: :restrict_with_exception

    validates :revision, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
    validate :origins_are_normalized_https
    after_commit :publish_revision_change, on: :update, if: :saved_change_to_revision?

    def self.current
      first!
    end

    def self.normalize_origins(origins)
      unless origins.is_a?(Array)
        raise ArgumentError, "origins must be an array"
      end

      origins.map { |origin| normalize_origin(origin) }.uniq.sort
    end

    def self.normalize_origin(origin)
      unless origin.is_a?(String) && origin == origin.strip
        raise ArgumentError, "origin must be a normalized HTTPS origin"
      end

      uri = URI.parse(origin)
      unless uri.is_a?(URI::HTTPS) && uri.host.present? && uri.userinfo.nil? &&
               uri.path.to_s.empty? && uri.query.nil? && uri.fragment.nil?
        raise ArgumentError, "origin must be a normalized HTTPS origin"
      end

      host = uri.host.downcase
      raise ArgumentError, "origin must be a normalized HTTPS origin" if host.include?("*")

      port = uri.port == 443 ? nil : uri.port
      normalized = "https://#{host}#{":#{port}" if port}"

      normalized
    rescue URI::InvalidURIError
      raise ArgumentError, "origin must be a normalized HTTPS origin"
    end

    def update!(origins:, external_media_enabled:, actor:)
      normalized_origins = self.class.normalize_origins(origins)
      if [true, false].exclude?(external_media_enabled)
        raise ArgumentError, "external_media_enabled must be true or false"
      end

      self.class.transaction do
        lock!
        return self if self.origins == normalized_origins && self.external_media_enabled == external_media_enabled

        self.origins = normalized_origins
        self.external_media_enabled = external_media_enabled
        self.updated_by = actor
        self.revision += 1
        save!

        policy_revisions.create!(
          revision: revision,
          external_media_enabled: external_media_enabled,
          origins: normalized_origins,
          changed_by: actor,
        )

        self
      end
    end

    private

    def origins_are_normalized_https
      normalized = self.class.normalize_origins(origins)
      errors.add(:origins, "must contain unique normalized HTTPS origins") unless origins == normalized
    rescue ArgumentError
      errors.add(:origins, "must contain unique normalized HTTPS origins")
    end
    def publish_revision_change
      DiscourseEvent.trigger(:discourse_video_shorts_policy_changed, revision)
    end
  end

  class OriginPolicyRevision < ActiveRecord::Base
    self.table_name = "video_shorts_origin_policy_revisions"

    belongs_to :origin_policy, class_name: "DiscourseVideoShorts::OriginPolicy"
    belongs_to :changed_by, class_name: "User", optional: true

    attr_readonly :origin_policy_id, :revision, :external_media_enabled, :origins, :changed_by_id, :created_at

    before_update { raise ActiveRecord::ReadOnlyRecord, "video shorts policy revisions are append-only" }
    before_destroy { raise ActiveRecord::ReadOnlyRecord, "video shorts policy revisions are append-only" }
  end
end
