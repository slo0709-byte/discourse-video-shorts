# frozen_string_literal: true

require "rails_helper"
require_relative "../../lib/discourse_video_shorts/telemetry"

RSpec.describe DiscourseVideoShorts::Telemetry::DataLayerContract do
  def passing_report
    {
      rounds: 3,
      completed_cursor_sequences: 30,
      unauthorized_leaks: 0,
      duplicate_items: 0,
      missing_items: 0,
      cursor_loops: 0,
      page_p95_ms: 350,
      page_p99_ms: 750,
      request_max_ms: 2_000,
      sql_p95: 20,
      max_scanned: 500,
      rss_delta_mib: 150,
      responses_per_twenty_p95: 5,
      scan_per_item_p95: 20,
      responses_to_end_max: 22,
    }
  end
  def valid_environment
    described_class::ENVIRONMENT_FIELDS.to_h { |field| [field, "recorded"] }.merge(
      "production_equivalent" => true,
      "discourse_commit" => described_class::DISCOURSE_COMMIT,
      "database_parameters" => { "shared_buffers" => "1GB" },
      "database_specification" => { "cpu" => "4" },
      "plugin_list" => ["discourse-video-shorts"],
      "worker_cpu_limit" => 4,
      "worker_ram_mib" => 8_192,
      "analyzed_statistics_at" => Time.now.utc.iso8601,
    )
  end

  def valid_background_proof(pid = 123)
    now = Time.now.utc.iso8601
    described_class::BACKGROUND_PROOF_FIELDS.to_h { |field| [field, 1] }.merge(
      "driver_pid" => pid,
      "target_percent" => 70,
      "sql_observed_percent" => 70,
      "http_observed_percent" => 70,
      "started_at" => now,
      "sampled_at" => now,
    )
  end

  def valid_manifest
    records =
      described_class::MIX.flat_map do |candidate_class, count|
        count.times.map do |index|
          {
            "post_id" => records_id(candidate_class, index),
            "candidate_class" => candidate_class.to_s,
          }
        end
      end
    described_class.dataset_manifest.transform_keys(&:to_s).merge(
      "records" => records,
      "records_sha256" => described_class.manifest_checksum(records),
    )
  end

  def records_id(candidate_class, index)
    described_class::MIX.keys.index(candidate_class) * 10_000 + index + 1
  end

  it "defines the approved deterministic candidate mix" do
    manifest = described_class.dataset_manifest

    expect(manifest).to include(seed: 20_260_710, candidates: 10_000, expected_unique_visible_identities: 1_500)
    expect(manifest.fetch(:mix).values.sum).to eq(10_000)
    expect(manifest.fetch(:valid_media_kinds)).to contain_exactly("bilibili", "youtube", "upload_mp4", "external_mp4", "external_hls")
  end

  it "rejects wrong seeds and candidate counts" do
    expect { described_class.dataset_manifest(seed: 1) }.to raise_error(ArgumentError, /approved/)
    expect { described_class.dataset_manifest(candidates: 9_999) }.to raise_error(ArgumentError, /approved/)

    manifest = valid_manifest.merge("candidates" => 9_999)
    expect { described_class.verify_manifest!(manifest) }.to raise_error(ArgumentError, /candidate count/)
  end

  it "fails closed for missing production-equivalent environment facts" do
    expect { described_class.verify_environment!({}) }.to raise_error(ArgumentError, /metadata missing/)
    expect { described_class.verify_environment!(valid_environment.merge("production_equivalent" => false)) }.to raise_error(ArgumentError, /not declared/)
    expect { described_class.verify_environment!(valid_environment.merge("discourse_commit" => "wrong")) }.to raise_error(ArgumentError, /commit/)
  end

  it "requires proof from the active background SQL and HTTP load driver" do
    expect { described_class.verify_background_proof!({}, driver_pid: 123) }.to raise_error(ArgumentError, /proof missing/)
    expect { described_class.verify_background_proof!(valid_background_proof(999), driver_pid: 123) }.to raise_error(ArgumentError, /active driver/)
    expect { described_class.verify_background_proof!(valid_background_proof.merge("http_observed_percent" => 69), driver_pid: 123) }.to raise_error(ArgumentError, /HTTP load/)
  end

  it "detects manifest drift" do
    manifest = valid_manifest
    expect(described_class.verify_manifest!(manifest).length).to eq(10_000)

    manifest.fetch("records").first["post_id"] = -1
    expect { described_class.verify_manifest!(manifest) }.to raise_error(ArgumentError, /checksum/)
  end

  it "detects database summary drift" do
    summary = {
      "candidates" => 10_000,
      "mix" => described_class::MIX.transform_keys(&:to_s),
      "placement" => { "first" => 6_000, "reply" => 4_000 },
      "class_placement" =>
        described_class::MIX.to_h do |candidate_class, count|
          [candidate_class.to_s, { "first" => (count * 0.6).to_i, "reply" => (count * 0.4).to_i }]
        end,
      "source_primary" => { "category" => 5_000, "tag" => 5_000 },
      "double_match" => 2_000,
      "body_sizes_kib" => { "2" => 7_000, "20" => 2_500, "100" => 500 },
      "deleted_hidden" => { "deleted" => 250, "hidden" => 250 },
      "valid_media_kinds" => described_class::VALID_MEDIA_KINDS.to_h { |kind| [kind, 300] },
      "identity_manifest_sha256" => "same",
      "expected_identity_manifest_sha256" => "same",
    }
    expect(described_class.verify_dataset_summary!(summary)).to eq(true)
    expect { described_class.verify_dataset_summary!(summary.merge("candidates" => 9_999)) }.to raise_error(ArgumentError, /candidate count/)
    expect { described_class.verify_dataset_summary!(summary.merge("identity_manifest_sha256" => "drift")) }.to raise_error(ArgumentError, /identity manifest/)
  end

  it "rejects each hard gate without a database fixture" do
    expect(described_class.violations(passing_report)).to be_empty

    failures = {
      unauthorized_leaks: 1,
      duplicate_items: 1,
      missing_items: 1,
      cursor_loops: 1,
      page_p95_ms: 351,
      page_p99_ms: 751,
      request_max_ms: 2_001,
      sql_p95: 21,
      max_scanned: 501,
      rss_delta_mib: 151,
      responses_per_twenty_p95: 6,
      scan_per_item_p95: 21,
      responses_to_end_max: 23,
    }
    failures.each do |metric, value|
      report = passing_report.merge(metric => value)
      expect(described_class.violations(report)).to include(a_string_starting_with(metric.to_s))
    end
  end

  it "fails closed when benchmark evidence omits a required metric" do
    expect(described_class.violations(passing_report.except(:sql_p95))).to include("sql_p95=missing")
  end

  it "uses nearest-rank percentile selection for small metric samples" do
    expect(described_class.percentile([10, 20, 30], 0.95)).to eq(30.0)
  end
end
