# frozen_string_literal: true

require "rspec/autorun"
require "json"
require "json_schemer"
require "open3"
require "tmpdir"

module QaEvidenceValidators
end

RSpec.describe QaEvidenceValidators do
  let(:validator) { File.expand_path("../../script/qa/validate_evidence.rb", __dir__) }
  let(:privacy_validator) { File.expand_path("../../script/qa/verify_observability_privacy.rb", __dir__) }
  let(:schema) { JSONSchemer.schema(JSON.parse(File.read(File.expand_path("../../docs/qa/evidence-schema.json", __dir__)))) }
  let(:artifact) { "artifact.txt" }
  let(:samples) { Array.new(30, 100) }

  def manifest
    browsers = %w[desktop-chrome desktop-edge iphone-safari android-chrome]
    media = %w[bilibili youtube upload_mp4 external_mp4_or_hls]
    long_session_combinations = [
      ["desktop-chrome", 1], ["desktop-chrome", 2], ["desktop-chrome", 3],
      ["desktop-edge", 1], ["desktop-edge", 2], ["desktop-edge", 3],
      ["iphone-safari", 1], ["android-chrome", 1]
    ]
    visual_combinations = [
      ["desktop-chrome", "desktop-1440x900", "light"], ["desktop-chrome", "desktop-1440x900", "dark"],
      ["desktop-chrome", "desktop-narrow", "light"], ["desktop-chrome", "desktop-narrow", "dark"],
      ["desktop-edge", "desktop-1440x900", "light"], ["desktop-edge", "desktop-1440x900", "dark"],
      ["desktop-edge", "desktop-narrow", "light"], ["desktop-edge", "desktop-narrow", "dark"],
      ["iphone-safari", "iphone-portrait", "light"], ["iphone-safari", "iphone-portrait", "dark"],
      ["iphone-safari", "iphone-landscape", "light"], ["iphone-safari", "iphone-landscape", "dark"],
      ["android-chrome", "android-portrait", "light"], ["android-chrome", "android-portrait", "dark"]
    ]
    scenarios = [
      [1, "create", "new"], [1, "edit", "first"], [1, "delete", "first"],
      [201, "create", "new"], [201, "edit", "first"], [201, "edit", "201st"],
      [201, "delete", "first"], [201, "delete", "201st"]
    ]
    metric = {
      "heap_delta_mib" => 10, "media_instances_max" => 1, "feed_dom_items_max" => 20,
      "listener_delta" => 1, "subscription_delta" => 1, "audible_players_max" => 1,
      "late_mounts" => 0, "passed" => true
    }

    {
      "schema_version" => 1,
      "run" => {
        "id" => "focused-validator-test", "started_at" => "2026-07-10T00:00:00Z",
        "discourse_tag" => "v2026.7.0-latest", "discourse_commit" => "ded677e00beb0e9bae6e70b69582aecfb72b5477",
        "environment" => {
          "browsers" => browsers.map { |browser| { "browser" => browser, "version" => "1.2.3", "device" => "test device", "os" => "test os", "real_device" => true, "provenance_artifact" => artifact } },
          "app_cpu_cores" => 4, "app_ram_mib" => 8192, "app_config_artifact" => artifact,
          "db_cpu_cores" => 4, "db_ram_mib" => 8192, "db_config_artifact" => artifact,
          "plugin_manifest_artifact" => artifact, "cache_mode" => "production", "cache_config_artifact" => artifact, "background_load_artifact" => artifact
        }
      },
      "matrix" => browsers.product(media).map { |browser, medium| { "browser" => browser, "media" => medium, "passed" => true, "screenshot" => artifact, "trace" => artifact } },
      "responsiveness" => {
        "cold_start" => %w[4g wifi].map { |network| { "network" => network, "samples_ms" => Array.new(10, 100) } },
        "thirty_switch_ms" => samples, "artifact" => artifact
      },
      "comment_sync" => {
        "scenarios" => scenarios.map do |descendants, operation, target|
          { "descendant_count" => descendants, "operation" => operation, "target" => target, "samples_ms" => samples, "duplicates" => 0, "incorrect_counts" => 0, "artifact" => artifact }
        end
      },
      "authorization_revocation" => { "samples_ms" => samples, "clear_sensitive_cache" => true, "disable_writes" => true, "close_comments" => true, "artifact" => artifact },
      "policy_revocation" => { "detection_ms" => samples, "post_observation_deleted_origin_requests" => 0, "artifact" => artifact },
      "data_gate" => {
        "stage" => "ui_pre_data_layer", "candidate_count" => 10_000, "seed" => 20_260_710,
        "warmup_traversals" => 5, "warmup_seconds" => 300, "concurrency" => 20,
        "duration_seconds_per_round" => 1800, "background_load_percent" => 70,
        "completed_full_sequences" => 30,
        "rounds" => (1..3).map { |round| { "round" => round, "duration_seconds" => 1800, "users" => 20, "background_load_percent" => 70, "completed_full_sequences" => 10, "raw_samples_artifact" => artifact } },
        "metrics" => {
          "unauthorized_leaks" => 0, "duplicates" => 0, "omissions" => 0, "cursor_loops" => 0,
          "page_p95_ms" => 350, "page_p99_ms" => 750, "max_request_ms" => 2000,
          "sql_p95" => 20, "scans_per_request_max" => 500, "rss_delta_mib" => 150,
          "http_responses_p95_per_20" => 5, "scan_per_item_p95" => 20, "end_response_count" => 22
        },
        "raw_artifacts" => { "benchmark_output" => artifact, "identity_manifest" => artifact, "environment_load" => artifact, "round_samples" => [artifact, artifact, artifact] },
        "passed" => true
      },
      "long_session" => long_session_combinations.map do |browser, round|
        {
          "round" => round, "surface" => browser.start_with?("desktop-") ? "desktop" : "mobile", "browser" => browser,
          "switches" => 1000, "warmup_switches" => 100,
          "first_quarter_samples_ms" => Array.new(250, 100), "final_quarter_samples_ms" => Array.new(250, 120),
          "observation_duration_ms" => 100_000, "cumulative_long_task_duration_ms" => 5_000,
          "metrics" => metric, "trace" => artifact, "passed" => true
        }
      end,
      "visual" => visual_combinations.map { |browser, viewport, theme| { "browser" => browser, "viewport" => viewport, "theme" => theme, "baseline" => artifact, "actual" => artifact, "diff_ratio" => 0.005, "manual_passed" => true } },
      "critical_flows" => %w[offline-recovery lifecycle-a-b-a admin-diagnostics native-actions].map { |id| { "id" => id, "passed" => true, "artifact" => artifact } },
      "rollback" => {
        "sequence" => "old-new-old", "discourse_commit" => "ded677e00beb0e9bae6e70b69582aecfb72b5477",
        "old_plugin_revision" => "old", "new_plugin_revision" => "new", "executed_at" => "2026-07-10T01:00:00Z",
        "operator" => "qa-runner", "core_writes_preserved" => true, "new_jobs_running" => 0, "artifact" => artifact, "passed" => true
      },
      "defects" => { "p0" => 0, "p1" => 0, "p2" => [], "p3" => [] }
    }
  end

  def run_validator(document)
    Dir.mktmpdir do |directory|
      File.write(File.join(directory, artifact), "evidence\n")
      File.write(File.join(directory, "manifest.json"), JSON.generate(document))
      return Open3.capture3(RbConfig.ruby, validator, directory)
    end
  end

  it "accepts a complete evidence manifest" do
    _stdout, stderr, status = run_validator(manifest)
    expect(status).to be_success, stderr
  end
  it "keeps the JSON schema aligned with the complete validator contract" do
    expect(schema.validate(manifest).to_a).to be_empty
  end

  it "fails closed when environment provenance is missing" do
    document = manifest
    document.fetch("run").delete("environment")
    _stdout, stderr, status = run_validator(document)
    expect(status).not_to be_success
    expect(stderr).to include("run missing keys: environment")
  end

  it "computes timing percentiles instead of trusting pass booleans" do
    document = manifest
    document.fetch("responsiveness").fetch("cold_start").first["samples_ms"] = Array.new(8, 100) + Array.new(2, 2_001)
    _stdout, stderr, status = run_validator(document)
    expect(status).not_to be_success
    expect(stderr).to include("p90")
  end
  it "enforces comment p95 and post-observation policy request gates" do
    comment_document = manifest
    comment_document.fetch("comment_sync").fetch("scenarios").first["samples_ms"] = Array.new(28, 100) + Array.new(2, 2_001)
    _stdout, comment_stderr, comment_status = run_validator(comment_document)
    expect(comment_status).not_to be_success
    expect(comment_stderr).to include("p95")

    policy_document = manifest
    policy_document.fetch("policy_revocation")["post_observation_deleted_origin_requests"] = 1
    _stdout, policy_stderr, policy_status = run_validator(policy_document)
    expect(policy_status).not_to be_success
    expect(policy_stderr).to include("deleted-origin request")
  end

  it "rejects incomplete data rounds and long-session degradation" do
    data_document = manifest
    data_document.fetch("data_gate")["completed_full_sequences"] = 29
    _stdout, data_stderr, data_status = run_validator(data_document)
    expect(data_status).not_to be_success
    expect(data_stderr).to include("at least 30")

    session_document = manifest
    session_document.fetch("long_session").first["final_quarter_samples_ms"] = Array.new(250, 126)
    _stdout, session_stderr, session_status = run_validator(session_document)
    expect(session_status).not_to be_success
    expect(session_stderr).to include("ratio exceeds 1.25")
  end

  it "rejects missing or wrong long-session browser rounds" do
    missing_document = manifest
    missing_document.fetch("long_session").pop
    _stdout, missing_stderr, missing_status = run_validator(missing_document)
    expect(missing_status).not_to be_success
    expect(missing_stderr).to include("exactly eight browser rounds")
    expect(schema.validate(missing_document).to_a).not_to be_empty

    wrong_document = manifest
    wrong_document.fetch("long_session").last["browser"] = "iphone-safari"
    _stdout, wrong_stderr, wrong_status = run_validator(wrong_document)
    expect(wrong_status).not_to be_success
    expect(wrong_stderr).to include("every required browser round exactly once")
    expect(schema.validate(wrong_document).to_a).not_to be_empty
  end

  it "rejects missing or wrong visual combinations" do
    document = manifest
    document.fetch("visual").last["viewport"] = "iphone-portrait"
    _stdout, stderr, status = run_validator(document)
    expect(status).not_to be_success
    expect(stderr).to include("every required browser/viewport/theme combination exactly once")
    expect(schema.validate(document).to_a).not_to be_empty
  end

  it "rejects a missing critical flow" do
    document = manifest
    document.fetch("critical_flows").pop
    _stdout, stderr, status = run_validator(document)
    expect(status).not_to be_success
    expect(stderr).to include("exactly four entries")
    expect(schema.validate(document).to_a).not_to be_empty
  end

  it "requires artifact paths to resolve to nonempty files" do
    document = manifest
    document.fetch("rollback")["artifact"] = "missing.txt"
    _stdout, stderr, status = run_validator(document)
    expect(status).not_to be_success
    expect(stderr).to include("missing or empty")
  end

  it "allows provenance but rejects bodies, credentials, full URLs, and full HMACs" do
    Dir.mktmpdir do |directory|
      safe = { "browser_version" => "Chrome 126", "device" => "Pixel 8", "plugin_commit" => "ded677e00beb0e9bae6e70b69582aecfb72b5477", "hmac" => "redacted" }
      File.write(File.join(directory, "safe.json"), JSON.generate(safe))
      _stdout, stderr, status = Open3.capture3(RbConfig.ruby, privacy_validator, directory)
      expect(status).to be_success, stderr

      [
        { "body" => "private post" },
        { "authorization" => "redacted" },
        { "origin" => "https://media.example.test/video" },
        { "media_identity_hmac" => "a" * 64 }
      ].each do |unsafe|
        File.write(File.join(directory, "unsafe.json"), JSON.generate(unsafe))
        _stdout, unsafe_stderr, unsafe_status = Open3.capture3(RbConfig.ruby, privacy_validator, directory)
        expect(unsafe_status).not_to be_success
        expect(unsafe_stderr).to include("Privacy validation failed")
        File.delete(File.join(directory, "unsafe.json"))
      end
    end
  end
end
