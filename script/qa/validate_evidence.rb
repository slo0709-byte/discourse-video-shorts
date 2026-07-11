#!/usr/bin/env ruby
# frozen_string_literal: true

require "json"
require "pathname"
require "time"

module DiscourseVideoShorts
  class EvidenceValidator
    BROWSERS = %w[desktop-chrome desktop-edge iphone-safari android-chrome].freeze
    DESKTOP_BROWSERS = %w[desktop-chrome desktop-edge].freeze
    MOBILE_BROWSERS = %w[iphone-safari android-chrome].freeze
    MEDIA = %w[bilibili youtube upload_mp4 external_mp4_or_hls].freeze
    COMMIT = "ded677e00beb0e9bae6e70b69582aecfb72b5477"
    LONG_SESSION_COMBINATIONS = (DESKTOP_BROWSERS.product([1, 2, 3]) + MOBILE_BROWSERS.product([1])).freeze
    VISUAL_COMBINATIONS = (
      DESKTOP_BROWSERS.product(%w[desktop-1440x900 desktop-narrow], %w[light dark]) +
      %w[iphone-portrait iphone-landscape].product(%w[light dark]).map { |viewport, theme| ["iphone-safari", viewport, theme] } +
      %w[light dark].map { |theme| ["android-chrome", "android-portrait", theme] }
    ).freeze
    CRITICAL_FLOWS = %w[offline-recovery lifecycle-a-b-a admin-diagnostics native-actions].freeze

    class EvidenceError < StandardError; end

    class << self
      def fail!(message)
        raise EvidenceError, message
      end

      def object!(value, path)
        fail!("#{path} must be an object") unless value.is_a?(Hash)
        value
      end

      def array!(value, path)
        fail!("#{path} must be an array") unless value.is_a?(Array)
        value
      end

      def exact_keys!(value, required, path)
        object!(value, path)
        missing = required - value.keys
        extra = value.keys - required
        fail!("#{path} missing keys: #{missing.join(', ')}") unless missing.empty?
        fail!("#{path} unexpected keys: #{extra.join(', ')}") unless extra.empty?
      end

      def integer!(value, path)
        fail!("#{path} must be an integer") unless value.is_a?(Integer)
      end

      def number!(value, path, minimum: nil, maximum: nil)
        fail!("#{path} must be a finite number") unless value.is_a?(Numeric) && value.finite?
        fail!("#{path} must be at least #{minimum}") if minimum && value < minimum
        fail!("#{path} must be at most #{maximum}") if maximum && value > maximum
        value
      end

      def present_string!(value, path)
        fail!("#{path} must be a nonempty string") unless value.is_a?(String) && !value.strip.empty?
      end

      def timestamp!(value, path)
        present_string!(value, path)
        Time.iso8601(value)
      rescue ArgumentError
        fail!("#{path} must be an ISO-8601 timestamp")
      end

      def artifact!(root, value, path)
        fail!("#{path} must be a safe relative artifact path") unless value.is_a?(String) && value.match?(%r{\A[A-Za-z0-9][A-Za-z0-9._/-]*\z}) && !value.include?("..")
        artifact = root.join(value).cleanpath
        fail!("#{path} artifact is missing or empty: #{value}") unless artifact.file? && artifact.size.positive?
        real_root = root.realpath
        real_artifact = artifact.realpath
        fail!("#{path} escapes evidence directory") unless real_artifact.to_s.start_with?("#{real_root}/")
        value
      end

      def samples!(value, path, minimum: 30)
        array!(value, path)
        fail!("#{path} needs at least #{minimum} samples") if value.length < minimum
        value.each_with_index { |sample, index| number!(sample, "#{path}[#{index}]", minimum: 0) }
        value
      end

      def percentile(value, quantile)
        sorted = value.sort
        sorted[[(sorted.length * quantile).ceil - 1, 0].max]
      end

      def percentile_at_most!(value, quantile, limit, path)
        measured = percentile(value, quantile)
        fail!("#{path} p#{(quantile * 100).to_i} #{measured}ms exceeds #{limit}ms") if measured > limit
      end

      def required_browser_set!(entries, key, path)
        values = entries.map { |entry| object!(entry, path).fetch(key) { fail!("#{path} entry is missing #{key}") } }
        missing = BROWSERS - values
        fail!("#{path} missing browsers: #{missing.join(', ')}") unless missing.empty?
      end

      def run
        
          evidence_dir = ARGV.fetch(0) { fail!("usage: #{$PROGRAM_NAME} EVIDENCE_DIR") }
          fail!("unexpected arguments") unless ARGV.length == 1
          root = Pathname.new(evidence_dir).expand_path
          manifest_path = root.join("manifest.json")
          fail!("evidence directory does not exist: #{root}") unless root.directory?
          fail!("manifest is missing: #{manifest_path}") unless manifest_path.file?
          manifest = JSON.parse(manifest_path.read)

          top_keys = %w[schema_version run matrix responsiveness comment_sync authorization_revocation policy_revocation data_gate long_session visual critical_flows rollback defects]
          exact_keys!(manifest, top_keys, "manifest")
          fail!("unsupported schema_version") unless manifest["schema_version"] == 1

          run = manifest["run"]
          exact_keys!(run, %w[id started_at discourse_tag discourse_commit environment], "run")
          present_string!(run["id"], "run.id")
          fail!("run.id must be at most 128 characters") if run["id"].length > 128
          timestamp!(run["started_at"], "run.started_at")
          fail!("wrong Discourse tag") unless run["discourse_tag"] == "v2026.7.0-latest"
          fail!("wrong Discourse commit") unless run["discourse_commit"] == COMMIT

          environment = run["environment"]
          environment_keys = %w[browsers app_cpu_cores app_ram_mib app_config_artifact db_cpu_cores db_ram_mib db_config_artifact plugin_manifest_artifact cache_mode cache_config_artifact background_load_artifact]
          exact_keys!(environment, environment_keys, "run.environment")
          browser_provenance = array!(environment["browsers"], "run.environment.browsers")
          fail!("run.environment.browsers must contain exactly four entries") unless browser_provenance.length == 4
          provenance_browsers = browser_provenance.each_with_index.map do |entry, index|
            path = "run.environment.browsers[#{index}]"
            exact_keys!(entry, %w[browser version device os real_device provenance_artifact], path)
            fail!("#{path}.browser is unsupported") if BROWSERS.none?(entry["browser"])
            %w[version device os].each { |key| present_string!(entry[key], "#{path}.#{key}") }
            fail!("#{path}.version must contain a version number") unless entry["version"].match?(/\d/)
            fail!("#{path} is not real-device evidence") unless entry["real_device"] == true
            artifact!(root, entry["provenance_artifact"], "#{path}.provenance_artifact")
            entry["browser"]
          end
          fail!("run.environment.browsers must contain each required browser exactly once") unless provenance_browsers.sort == BROWSERS.sort
          %w[app_cpu_cores app_ram_mib db_cpu_cores db_ram_mib].each { |key| number!(environment[key], "run.environment.#{key}", minimum: Float::MIN) }
          present_string!(environment["cache_mode"], "run.environment.cache_mode")
          %w[app_config_artifact db_config_artifact plugin_manifest_artifact cache_config_artifact background_load_artifact].each do |key|
            artifact!(root, environment[key], "run.environment.#{key}")
          end

          matrix = array!(manifest["matrix"], "matrix")
          fail!("matrix needs exactly all 16 browser/media combinations") unless matrix.length == 16
          combinations = matrix.each_with_index.map do |entry, index|
            path = "matrix[#{index}]"
            exact_keys!(entry, %w[browser media passed screenshot trace], path)
            fail!("#{path} has an unsupported browser") if BROWSERS.none?(entry["browser"])
            fail!("#{path} has an unsupported media type") if MEDIA.none?(entry["media"])
            fail!("#{path} did not pass") unless entry["passed"] == true
            artifact!(root, entry["screenshot"], "#{path}.screenshot")
            artifact!(root, entry["trace"], "#{path}.trace")
            [entry["browser"], entry["media"]]
          end
          fail!("matrix must contain every browser/media combination exactly once") unless combinations.sort == BROWSERS.product(MEDIA).sort

          responsiveness = manifest["responsiveness"]
          exact_keys!(responsiveness, %w[cold_start thirty_switch_ms artifact], "responsiveness")
          cold_start = array!(responsiveness["cold_start"], "responsiveness.cold_start")
          fail!("responsiveness.cold_start must contain 4g and wifi exactly once") unless cold_start.length == 2
          networks = cold_start.each_with_index.map do |scenario, index|
            path = "responsiveness.cold_start[#{index}]"
            exact_keys!(scenario, %w[network samples_ms], path)
            fail!("#{path}.network must be 4g or wifi") if %w[4g wifi].none?(scenario["network"])
            scenario_samples = samples!(scenario["samples_ms"], "#{path}.samples_ms", minimum: 10)
            percentile_at_most!(scenario_samples, 0.90, 2_000, "#{path}.samples_ms")
            scenario["network"]
          end
          fail!("responsiveness.cold_start must contain 4g and wifi exactly once") unless networks.sort == %w[4g wifi]
          thirty_switch = samples!(responsiveness["thirty_switch_ms"], "responsiveness.thirty_switch_ms")
          percentile_at_most!(thirty_switch, 0.90, 500, "responsiveness.thirty_switch_ms")
          artifact!(root, responsiveness["artifact"], "responsiveness.artifact")

          sync = manifest["comment_sync"]
          exact_keys!(sync, ["scenarios"], "comment_sync")
          scenarios = array!(sync["scenarios"], "comment_sync.scenarios")
          required_scenarios = [
            [1, "create", "new"], [1, "edit", "first"], [1, "delete", "first"],
            [201, "create", "new"], [201, "edit", "first"], [201, "edit", "201st"],
            [201, "delete", "first"], [201, "delete", "201st"]
          ]
          found_scenarios = scenarios.each_with_index.map do |scenario, index|
            path = "comment_sync.scenarios[#{index}]"
            exact_keys!(scenario, %w[descendant_count operation target samples_ms duplicates incorrect_counts artifact], path)
            integer!(scenario["descendant_count"], "#{path}.descendant_count")
            fail!("#{path}.descendant_count must be positive") unless scenario["descendant_count"].positive?
            fail!("#{path}.operation is unknown") if %w[create edit delete].none?(scenario["operation"])
            fail!("#{path}.target is unknown") if %w[new first 201st].none?(scenario["target"])
            samples = samples!(scenario["samples_ms"], "#{path}.samples_ms")
            percentile_at_most!(samples, 0.95, 2_000, "#{path}.samples_ms")
            %w[duplicates incorrect_counts].each { |metric| fail!("#{path}.#{metric} must be zero") unless scenario[metric] == 0 }
            artifact!(root, scenario["artifact"], "#{path}.artifact")
            [scenario["descendant_count"] >= 201 ? 201 : 1, scenario["operation"], scenario["target"]]
          end
          fail!("comment sync contains duplicate normalized scenarios") unless found_scenarios.uniq.length == found_scenarios.length
          fail!("comment sync lacks normal and 201+ targeted create/edit/delete evidence") unless (required_scenarios - found_scenarios).empty?

          authorization = manifest["authorization_revocation"]
          exact_keys!(authorization, %w[samples_ms clear_sensitive_cache disable_writes close_comments artifact], "authorization_revocation")
          authorization_samples = samples!(authorization["samples_ms"], "authorization_revocation.samples_ms")
          percentile_at_most!(authorization_samples, 0.95, 6_000, "authorization_revocation.samples_ms")
          %w[clear_sensitive_cache disable_writes close_comments].each do |key|
            fail!("authorization_revocation.#{key} was not proven") unless authorization[key] == true
          end
          artifact!(root, authorization["artifact"], "authorization_revocation.artifact")

          policy = manifest["policy_revocation"]
          exact_keys!(policy, %w[detection_ms post_observation_deleted_origin_requests artifact], "policy_revocation")
          detection_samples = samples!(policy["detection_ms"], "policy_revocation.detection_ms")
          percentile_at_most!(detection_samples, 0.95, 2_000, "policy_revocation.detection_ms")
          fail!("policy revocation allowed a deleted-origin request after observation") unless policy["post_observation_deleted_origin_requests"] == 0
          artifact!(root, policy["artifact"], "policy_revocation.artifact")

          data_gate = manifest["data_gate"]
          data_gate_keys = %w[stage candidate_count seed warmup_traversals warmup_seconds concurrency duration_seconds_per_round background_load_percent completed_full_sequences rounds metrics raw_artifacts passed]
          exact_keys!(data_gate, data_gate_keys, "data_gate")
          fail!("data gate is not the fixed pre-UI 10k gate") unless data_gate["stage"] == "ui_pre_data_layer" && data_gate["candidate_count"] == 10_000 && data_gate["seed"] == 20_260_710
          integer!(data_gate["warmup_traversals"], "data_gate.warmup_traversals")
          fail!("data_gate.warmup_traversals must be at least 5") if data_gate["warmup_traversals"] < 5
          number!(data_gate["warmup_seconds"], "data_gate.warmup_seconds", minimum: 300)
          fail!("data_gate.concurrency must be 20") unless data_gate["concurrency"] == 20
          number!(data_gate["duration_seconds_per_round"], "data_gate.duration_seconds_per_round", minimum: 1_800)
          number!(data_gate["background_load_percent"], "data_gate.background_load_percent", minimum: 70)
          integer!(data_gate["completed_full_sequences"], "data_gate.completed_full_sequences")
          fail!("data_gate.completed_full_sequences must be at least 30") if data_gate["completed_full_sequences"] < 30
          fail!("data gate did not pass") unless data_gate["passed"] == true

          rounds = array!(data_gate["rounds"], "data_gate.rounds")
          fail!("data_gate.rounds must contain exactly three rounds") unless rounds.length == 3
          completed_sequences = 0
          round_artifacts = rounds.each_with_index.map do |round, index|
            path = "data_gate.rounds[#{index}]"
            exact_keys!(round, %w[round duration_seconds users background_load_percent completed_full_sequences raw_samples_artifact], path)
            integer!(round["round"], "#{path}.round")
            number!(round["duration_seconds"], "#{path}.duration_seconds", minimum: 1_800)
            fail!("#{path}.users must be 20") unless round["users"] == 20
            number!(round["background_load_percent"], "#{path}.background_load_percent", minimum: 70)
            integer!(round["completed_full_sequences"], "#{path}.completed_full_sequences")
            fail!("#{path}.completed_full_sequences cannot be negative") if round["completed_full_sequences"].negative?
            completed_sequences += round["completed_full_sequences"]
            artifact!(root, round["raw_samples_artifact"], "#{path}.raw_samples_artifact")
          end
          fail!("data_gate.rounds must be numbered 1, 2, 3 exactly once") unless rounds.map { |round| round["round"] }.sort == [1, 2, 3]
          fail!("data_gate.completed_full_sequences does not equal the round total") unless completed_sequences == data_gate["completed_full_sequences"]

          metrics = data_gate["metrics"]
          data_metric_keys = %w[unauthorized_leaks duplicates omissions cursor_loops page_p95_ms page_p99_ms max_request_ms sql_p95 scans_per_request_max rss_delta_mib http_responses_p95_per_20 scan_per_item_p95 end_response_count]
          exact_keys!(metrics, data_metric_keys, "data_gate.metrics")
          %w[unauthorized_leaks duplicates omissions cursor_loops].each { |key| fail!("data_gate.metrics.#{key} must be zero") unless metrics[key] == 0 }
          { "page_p95_ms" => 350, "page_p99_ms" => 750, "max_request_ms" => 2_000, "sql_p95" => 20, "scans_per_request_max" => 500, "rss_delta_mib" => 150, "http_responses_p95_per_20" => 5, "scan_per_item_p95" => 20, "end_response_count" => 22 }.each do |key, limit|
            number!(metrics[key], "data_gate.metrics.#{key}", minimum: 0, maximum: limit)
          end

          raw_artifacts = data_gate["raw_artifacts"]
          exact_keys!(raw_artifacts, %w[benchmark_output identity_manifest environment_load round_samples], "data_gate.raw_artifacts")
          %w[benchmark_output identity_manifest environment_load].each { |key| artifact!(root, raw_artifacts[key], "data_gate.raw_artifacts.#{key}") }
          raw_round_samples = array!(raw_artifacts["round_samples"], "data_gate.raw_artifacts.round_samples")
          fail!("data_gate.raw_artifacts.round_samples must contain exactly three artifacts") unless raw_round_samples.length == 3
          raw_round_samples.each_with_index { |value, index| artifact!(root, value, "data_gate.raw_artifacts.round_samples[#{index}]") }
          fail!("data gate round sample artifact lists disagree") unless raw_round_samples.sort == round_artifacts.sort

          long_session = array!(manifest["long_session"], "long_session")
          fail!("long_session must contain exactly eight browser rounds") unless long_session.length == 8
          combinations = []
          long_session.each_with_index do |entry, index|
            path = "long_session[#{index}]"
            keys = %w[round surface browser switches warmup_switches first_quarter_samples_ms final_quarter_samples_ms observation_duration_ms cumulative_long_task_duration_ms metrics trace passed]
            exact_keys!(entry, keys, path)
            integer!(entry["round"], "#{path}.round")
            combinations << [entry["browser"], entry["round"]]
            fail!("#{path}.surface is invalid") if %w[desktop mobile].none?(entry["surface"])
            fail!("#{path}.browser is invalid") if BROWSERS.none?(entry["browser"])
            expected_surface = DESKTOP_BROWSERS.include?(entry["browser"]) ? "desktop" : "mobile"
            fail!("#{path}.surface does not match its browser") unless entry["surface"] == expected_surface
            integer!(entry["switches"], "#{path}.switches")
            fail!("#{path} did not perform 1000 switches") if entry["switches"] < 1_000
            integer!(entry["warmup_switches"], "#{path}.warmup_switches")
            fail!("#{path} did not perform 100 warm-up switches") if entry["warmup_switches"] < 100
            first_samples = samples!(entry["first_quarter_samples_ms"], "#{path}.first_quarter_samples_ms", minimum: 250)
            final_samples = samples!(entry["final_quarter_samples_ms"], "#{path}.final_quarter_samples_ms", minimum: 250)
            first_p95 = percentile(first_samples, 0.95)
            final_p95 = percentile(final_samples, 0.95)
            fail!("#{path} first-quarter p95 must be greater than zero") unless first_p95.positive?
            fail!("#{path} final/first p95 ratio exceeds 1.25") if final_p95 / first_p95.to_f > 1.25
            duration = number!(entry["observation_duration_ms"], "#{path}.observation_duration_ms", minimum: Float::MIN)
            long_tasks = number!(entry["cumulative_long_task_duration_ms"], "#{path}.cumulative_long_task_duration_ms", minimum: 0)
            fail!("#{path} long-task fraction exceeds 5%") if long_tasks / duration.to_f > 0.05
            artifact!(root, entry["trace"], "#{path}.trace")
            session_metrics = entry["metrics"]
            metric_keys = %w[heap_delta_mib media_instances_max feed_dom_items_max listener_delta subscription_delta audible_players_max late_mounts passed]
            exact_keys!(session_metrics, metric_keys, "#{path}.metrics")
            { "heap_delta_mib" => 30, "media_instances_max" => 3, "feed_dom_items_max" => 60, "listener_delta" => 5, "subscription_delta" => 5, "audible_players_max" => 1 }.each do |key, limit|
              number!(session_metrics[key], "#{path}.metrics.#{key}", minimum: 0, maximum: limit)
            end
            fail!("#{path}.metrics.late_mounts must be zero") unless session_metrics["late_mounts"] == 0
            fail!("#{path}.metrics did not pass") unless session_metrics["passed"] == true
            fail!("#{path} did not pass") unless entry["passed"] == true
          end
          fail!("long_session must contain every required browser round exactly once") unless combinations.sort == LONG_SESSION_COMBINATIONS.sort

          visual = array!(manifest["visual"], "visual")
          fail!("visual must contain exactly fourteen browser/viewport/theme combinations") unless visual.length == 14
          visual_combinations = visual.each_with_index.map do |entry, index|
            path = "visual[#{index}]"
            exact_keys!(entry, %w[browser viewport theme baseline actual diff_ratio manual_passed], path)
            fail!("#{path}.browser is invalid") if BROWSERS.none?(entry["browser"])
            present_string!(entry["viewport"], "#{path}.viewport")
            fail!("#{path}.theme is invalid") if %w[light dark].none?(entry["theme"])
            artifact!(root, entry["baseline"], "#{path}.baseline")
            artifact!(root, entry["actual"], "#{path}.actual")
            number!(entry["diff_ratio"], "#{path}.diff_ratio", minimum: 0, maximum: 0.005)
            fail!("#{path} manual inspection failed") unless entry["manual_passed"] == true
            [entry["browser"], entry["viewport"], entry["theme"]]
          end
          fail!("visual must contain every required browser/viewport/theme combination exactly once") unless visual_combinations.sort == VISUAL_COMBINATIONS.sort

          critical_flows = array!(manifest["critical_flows"], "critical_flows")
          fail!("critical_flows must contain exactly four entries") unless critical_flows.length == 4
          flow_ids = critical_flows.each_with_index.map do |entry, index|
            path = "critical_flows[#{index}]"
            exact_keys!(entry, %w[id passed artifact], path)
            fail!("#{path}.id is invalid") if CRITICAL_FLOWS.none?(entry["id"])
            fail!("#{path} did not pass") unless entry["passed"] == true
            artifact!(root, entry["artifact"], "#{path}.artifact")
            entry["id"]
          end
          fail!("critical_flows must contain every required flow exactly once") unless flow_ids.sort == CRITICAL_FLOWS.sort

          rollback = manifest["rollback"]
          rollback_keys = %w[sequence discourse_commit old_plugin_revision new_plugin_revision executed_at operator core_writes_preserved new_jobs_running artifact passed]
          exact_keys!(rollback, rollback_keys, "rollback")
          fail!("rollback is not old-new-old") unless rollback["sequence"] == "old-new-old"
          fail!("rollback used the wrong Discourse commit") unless rollback["discourse_commit"] == COMMIT
          %w[old_plugin_revision new_plugin_revision operator].each { |key| present_string!(rollback[key], "rollback.#{key}") }
          fail!("rollback old and new plugin revisions must differ") if rollback["old_plugin_revision"] == rollback["new_plugin_revision"]
          timestamp!(rollback["executed_at"], "rollback.executed_at")
          fail!("rollback did not preserve core writes") unless rollback["core_writes_preserved"] == true
          fail!("rollback left new jobs running") unless rollback["new_jobs_running"] == 0
          artifact!(root, rollback["artifact"], "rollback.artifact")
          fail!("rollback failed") unless rollback["passed"] == true

          defects = manifest["defects"]
          exact_keys!(defects, %w[p0 p1 p2 p3], "defects")
          fail!("P0/P1 must both be zero") unless defects["p0"] == 0 && defects["p1"] == 0
          %w[p2 p3].each do |severity|
            records = array!(defects[severity], "defects.#{severity}")
            records.each_with_index do |record, index|
              path = "defects.#{severity}[#{index}]"
              exact_keys!(record, %w[id status artifact], path)
              present_string!(record["id"], "#{path}.id")
              fail!("#{path}.status is invalid") if %w[open accepted fixed verified].none?(record["status"])
              artifact!(root, record["artifact"], "#{path}.artifact")
            end
          end

          puts "Evidence is complete and passes required gates."
        rescue EvidenceError, JSON::ParserError => e
          warn "Evidence validation failed: #{e.message}"
          exit 1
        
      end
    end
  end
end

DiscourseVideoShorts::EvidenceValidator.run
