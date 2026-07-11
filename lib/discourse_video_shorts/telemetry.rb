# frozen_string_literal: true

require "json"
require "digest"
require "uri"
require "time"

module DiscourseVideoShorts
  module Telemetry
    SENSITIVE_KEY = /(?:authorization|cookie|credential|password|secret|token|raw|cooked|content|excerpt|url|uri|identity|hmac)/i
    SAFE_SCALAR = [Numeric, TrueClass, FalseClass, NilClass].freeze

    module_function

    # Benchmark evidence is deliberately metric-only: it must never become a second
    # storage location for posts, session credentials, or media URLs.
    def safe_event(event)
      sanitize(event).merge("schema_version" => 1)
    end

    def json_line(event)
      JSON.generate(safe_event(event))
    end

    def sanitize(value, key = nil)
      return "[redacted]" if key.to_s.match?(SENSITIVE_KEY)

      case value
      when Hash
        value.each_with_object({}) do |(child_key, child_value), result|
          result[child_key.to_s] = sanitize(child_value, child_key)
        end
      when Array
        value.map { |child| sanitize(child) }
      when String
        value.match?(%r{\Ahttps?://}i) ? "[redacted-url]" : value
      when *SAFE_SCALAR
        value
      else
        value.to_s
      end
    end

    class DataLayerContract
      SEED = 20_260_710
      CANDIDATES = 10_000
      ROUND_COUNT = 3
      WARMUP_TRAVERSALS = 5
      WARMUP_SECONDS = 300
      MAX_SCAN_PER_REQUEST = 500
      THRESHOLDS = {
        page_p95_ms: 350,
        page_p99_ms: 750,
        request_max_ms: 2_000,
        sql_p95: 20,
        rss_delta_mib: 150,
        responses_per_twenty_p95: 5,
        scan_per_item_p95: 20,
        responses_to_end_max: 22,
      }.freeze
      MIX = {
        visible_without_media: 5_000,
        visible_unique_valid_media: 1_500,
        visible_duplicate_identity: 1_000,
        visible_malformed_or_unapproved: 1_000,
        private_not_visible: 1_000,
        deleted_or_hidden: 500,
      }.freeze
      VALID_MEDIA_KINDS = %w[bilibili youtube upload_mp4 external_mp4 external_hls].freeze
      MANIFEST_SCHEMA_VERSION = 1
      NAMESPACE = "video-shorts-data-gate-20260710"
      DISCOURSE_COMMIT = "ded677e00beb0e9bae6e70b69582aecfb72b5477"
      ENVIRONMENT_FIELDS = %w[
        production_equivalent
        discourse_commit
        database_version
        database_parameters
        database_specification
        plugin_list
        cache_mode
        worker_cpu_limit
        worker_ram_mib
        analyzed_statistics_at
      ].freeze
      BACKGROUND_PROOF_FIELDS = %w[
        driver_pid
        target_percent
        sql_observed_percent
        http_observed_percent
        sql_samples
        http_samples
        started_at
        sampled_at
      ].freeze

      def self.dataset_manifest(seed: SEED, candidates: CANDIDATES)
        raise ArgumentError, "only the approved 10,000-candidate contract is supported" unless seed == SEED && candidates == CANDIDATES

        {
          seed:,
          candidates:,
          namespace: NAMESPACE,
          schema_version: MANIFEST_SCHEMA_VERSION,
          mix: MIX,
          placement: { first_posts_percent: 60, replies_percent: 40 },
          source_matching: { category_or_tag_each_percent: 50, double_match_included: true },
          body_sizes: { kib_2_percent: 70, kib_20_percent: 25, kib_100_percent: 5 },
          valid_media_kinds: VALID_MEDIA_KINDS,
          expected_unique_visible_identities: 1_500,
        }
      end

      def self.canonical_json(value)
        normalized =
          case value
          when Hash
            value.keys.map(&:to_s).sort.to_h do |key|
              source_key = value.key?(key) ? key : key.to_sym
              [key, canonical_json_value(value.fetch(source_key))]
            end
          else
            canonical_json_value(value)
          end
        JSON.generate(normalized)
      end

      def self.canonical_json_value(value)
        case value
        when Hash
          JSON.parse(canonical_json(value))
        when Array
          value.map { |item| canonical_json_value(item) }
        else
          value
        end
      end
      private_class_method :canonical_json_value

      def self.manifest_checksum(records)
        Digest::SHA256.hexdigest(canonical_json(records))
      end

      def self.verify_manifest!(manifest)
        manifest = manifest.transform_keys(&:to_s)
        expected = dataset_manifest
        raise ArgumentError, "manifest schema version mismatch" unless manifest["schema_version"] == MANIFEST_SCHEMA_VERSION
        raise ArgumentError, "manifest namespace mismatch" unless manifest["namespace"] == NAMESPACE
        raise ArgumentError, "manifest seed mismatch" unless manifest["seed"] == SEED
        raise ArgumentError, "manifest candidate count mismatch" unless manifest["candidates"] == CANDIDATES

        records = manifest["records"]
        raise ArgumentError, "manifest must contain exactly #{CANDIDATES} records" unless records.is_a?(Array) && records.length == CANDIDATES
        raise ArgumentError, "manifest record checksum mismatch" unless manifest["records_sha256"] == manifest_checksum(records)

        ids = records.map { |record| record.fetch("post_id") }
        raise ArgumentError, "manifest post IDs are not unique" unless ids.uniq.length == CANDIDATES
        mix = records.group_by { |record| record.fetch("candidate_class") }.transform_values(&:length)
        expected_mix = expected.fetch(:mix).transform_keys(&:to_s)
        raise ArgumentError, "manifest candidate mix mismatch" unless mix == expected_mix

        records
      end

      def self.verify_dataset_summary!(summary)
        summary = summary.transform_keys(&:to_s)
        expected_mix = MIX.transform_keys(&:to_s)
        raise ArgumentError, "database candidate count mismatch" unless summary["candidates"] == CANDIDATES
        raise ArgumentError, "database candidate mix mismatch" unless summary["mix"] == expected_mix
        raise ArgumentError, "database first/reply placement mismatch" unless summary["placement"] == { "first" => 6_000, "reply" => 4_000 }
        expected_class_placement =
          MIX.to_h do |candidate_class, count|
            [
              candidate_class.to_s,
              { "first" => (count * 0.6).to_i, "reply" => (count * 0.4).to_i },
            ]
          end
        raise ArgumentError, "database per-class placement mismatch" unless summary["class_placement"] == expected_class_placement
        raise ArgumentError, "database primary source split mismatch" unless summary["source_primary"] == { "category" => 5_000, "tag" => 5_000 }
        raise ArgumentError, "database double-hit coverage mismatch" unless summary["double_match"] == 2_000
        raise ArgumentError, "database body-size mix mismatch" unless summary["body_sizes_kib"] == { "2" => 7_000, "20" => 2_500, "100" => 500 }
        raise ArgumentError, "database deleted/hidden split mismatch" unless summary["deleted_hidden"] == { "deleted" => 250, "hidden" => 250 }
        expected_kinds = VALID_MEDIA_KINDS.to_h { |kind| [kind, 300] }
        raise ArgumentError, "database valid-media mix mismatch" unless summary["valid_media_kinds"] == expected_kinds
        actual_identity_checksum = summary["identity_manifest_sha256"]
        expected_identity_checksum = summary["expected_identity_manifest_sha256"]
        raise ArgumentError, "database identity manifest missing" if actual_identity_checksum.blank? || expected_identity_checksum.blank?
        raise ArgumentError, "database identity manifest drift" unless actual_identity_checksum == expected_identity_checksum

        true
      end

      def self.verify_environment!(metadata)
        metadata = metadata.transform_keys(&:to_s)
        missing = ENVIRONMENT_FIELDS.reject do |field|
          metadata.key?(field) && !metadata[field].nil? && metadata[field] != ""
        end
        raise ArgumentError, "environment metadata missing: #{missing.join(", ")}" if missing.present?
        raise ArgumentError, "environment is not declared production-equivalent" unless metadata["production_equivalent"] == true
        raise ArgumentError, "unexpected Discourse commit" unless metadata["discourse_commit"] == DISCOURSE_COMMIT
        raise ArgumentError, "database parameters must be recorded" unless metadata["database_parameters"].is_a?(Hash) && metadata["database_parameters"].present?
        raise ArgumentError, "database specification must be recorded" unless metadata["database_specification"].is_a?(Hash) && metadata["database_specification"].present?
        raise ArgumentError, "plugin list must be recorded" unless metadata["plugin_list"].is_a?(Array) && metadata["plugin_list"].present?
        raise ArgumentError, "worker CPU limit must be positive" unless metadata["worker_cpu_limit"].to_f.positive?
        raise ArgumentError, "worker RAM limit must be positive" unless metadata["worker_ram_mib"].to_f.positive?
        Time.iso8601(metadata["analyzed_statistics_at"].to_s)

        true
      end

      def self.verify_background_proof!(proof, driver_pid:)
        proof = proof.transform_keys(&:to_s)
        missing = BACKGROUND_PROOF_FIELDS.reject { |field| proof.key?(field) && proof[field].present? }
        raise ArgumentError, "background proof missing: #{missing.join(", ")}" if missing.present?
        raise ArgumentError, "background proof is not from the active driver" unless proof["driver_pid"].to_i == driver_pid.to_i
        raise ArgumentError, "background target must be 70%" unless proof["target_percent"].to_i == 70
        raise ArgumentError, "background SQL load below 70%" if proof["sql_observed_percent"].to_f < 70
        raise ArgumentError, "background HTTP load below 70%" if proof["http_observed_percent"].to_f < 70
        raise ArgumentError, "background proof requires sampled SQL and HTTP load" unless proof["sql_samples"].to_i.positive? && proof["http_samples"].to_i.positive?
        started_at = Time.iso8601(proof["started_at"].to_s)
        sampled_at = Time.iso8601(proof["sampled_at"].to_s)
        raise ArgumentError, "background proof timestamps are inconsistent" if sampled_at < started_at
        raise ArgumentError, "background proof is stale" if sampled_at < Time.now.utc - 15

        true
      end

      def self.percentile(values, percentile)
        sorted = values.compact.map(&:to_f).sort
        return nil if sorted.empty?

        sorted[((sorted.length - 1) * percentile).ceil]
      end

      def self.violations(report)
        violations = []
        checks = {
          unauthorized_leaks: 0,
          duplicate_items: 0,
          missing_items: 0,
          cursor_loops: 0,
        }
        checks.each do |key, expected|
          value = report[key]
          violations << "#{key}=missing" if value.nil?
          violations << "#{key}=#{value} (expected #{expected})" if value && value.to_i != expected
        end

        metric_limits = THRESHOLDS
        metric_limits.each do |key, limit|
          value = report[key]
          violations << "#{key}=missing" if value.nil?
          violations << "#{key}=#{value} exceeds #{limit}" if value && value.to_f > limit
        end
        completed_sequences = report[:completed_cursor_sequences]
        violations << "completed_cursor_sequences=missing" if completed_sequences.nil?
        violations << "completed_cursor_sequences=#{completed_sequences} (minimum 30)" if completed_sequences && completed_sequences.to_i < 30
        violations << "rounds=#{report[:rounds]} (expected #{ROUND_COUNT})" unless report[:rounds].to_i == ROUND_COUNT
        violations << "max_scanned=missing" if report[:max_scanned].nil?
        violations << "max_scanned=#{report[:max_scanned]} exceeds #{MAX_SCAN_PER_REQUEST}" if report[:max_scanned] && report[:max_scanned].to_i > MAX_SCAN_PER_REQUEST
        violations
      end
    end
  end
end
