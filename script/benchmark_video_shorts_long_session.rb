# frozen_string_literal: true

require "json"
require "open3"
require "shellwords"

module DiscourseVideoShorts
  class LongSessionBenchmark
    SWITCHES = 1000
    WARMUP_SWITCHES = 100
    THRESHOLDS = {
      heap_growth_bytes: 30 * 1024 * 1024,
      feed_dom_items: 60,
      mounted_media: 3,
      extra_listeners_or_subscriptions: 5,
      audible_media: 1,
      final_to_first_p95_ratio: 1.25,
      long_task_fraction: 0.05,
      late_mounts: 0,
    }.freeze

    CONTRACT = {
      switches: SWITCHES,
      warmup_switches: WARMUP_SWITCHES,
      required_evidence: {
        browser: true,
        baseline: %w[heap_bytes feed_dom_items listeners subscriptions],
        final: %w[heap_bytes feed_dom_items listeners subscriptions mounted_media audible_media],
        timings: %w[first_quarter_switch_ms final_quarter_switch_ms observed_ms long_task_over_50_ms],
        late_mounts: "non-negative integer",
      },
      thresholds: THRESHOLDS,
    }.freeze

    class << self
      def fail_with(reason, evidence: nil, violations: [])
        report = {
          benchmark: "video_shorts_long_session",
          status: "failed",
          reason: reason,
          switches: SWITCHES,
          warmup_switches: WARMUP_SWITCHES,
          thresholds: THRESHOLDS,
          violations: violations,
        }
        report[:evidence] = evidence if evidence
        puts JSON.generate(report)
        exit 1
      end

      def number!(value, path)
        raise "missing or invalid #{path}" unless value.is_a?(Numeric) && value.finite?

        value
      end

      def non_negative!(value, path)
        value = number!(value, path)
        raise "negative #{path}" if value.negative?

        value
      end

      def non_negative_integer!(value, path)
        raise "missing or invalid #{path}" unless value.is_a?(Integer) && value >= 0

        value
      end

      def percentile_95(samples, path)
        raise "missing #{path}" unless samples.is_a?(Array) && !samples.empty?

        sorted = samples.map.with_index { |sample, index| non_negative!(sample, "#{path}[#{index}]") }.sort
        sorted[(sorted.length * 0.95).ceil - 1]
      end

      def compact_evidence(raw)
        baseline = raw.fetch("baseline")
        final = raw.fetch("final")
        timings = raw.fetch("timings")

        {
          browser: raw.fetch("browser"),
          switches: raw.fetch("switches"),
          warmup_switches: raw.fetch("warmup_switches"),
          baseline: {
            heap_bytes: baseline.fetch("heap_bytes"),
            feed_dom_items: baseline.fetch("feed_dom_items"),
            listeners: baseline.fetch("listeners"),
            subscriptions: baseline.fetch("subscriptions"),
          },
          final: {
            heap_bytes: final.fetch("heap_bytes"),
            feed_dom_items: final.fetch("feed_dom_items"),
            listeners: final.fetch("listeners"),
            subscriptions: final.fetch("subscriptions"),
            mounted_media: final.fetch("mounted_media"),
            audible_media: final.fetch("audible_media"),
          },
          timings: {
            first_quarter_switch_ms: timings.fetch("first_quarter_switch_ms"),
            final_quarter_switch_ms: timings.fetch("final_quarter_switch_ms"),
            observed_ms: timings.fetch("observed_ms"),
            long_task_over_50_ms: timings.fetch("long_task_over_50_ms"),
          },
          late_mounts: raw.fetch("late_mounts"),
        }
      end

      def validate_evidence!(evidence)
        raise "browser evidence was not captured" unless evidence[:browser] == true
        raise "expected #{SWITCHES} switches" unless evidence[:switches] == SWITCHES
        raise "expected at least #{WARMUP_SWITCHES} warm-up switches" unless evidence[:warmup_switches].is_a?(Integer) && evidence[:warmup_switches] >= WARMUP_SWITCHES

        %i[heap_bytes feed_dom_items listeners subscriptions].each do |key|
          non_negative!(evidence[:baseline][key], "baseline.#{key}")
        end
        %i[heap_bytes feed_dom_items listeners subscriptions mounted_media audible_media].each do |key|
          non_negative!(evidence[:final][key], "final.#{key}")
        end
        non_negative_integer!(evidence[:late_mounts], "late_mounts")
        non_negative!(evidence[:timings][:observed_ms], "timings.observed_ms")
        raise "timings.observed_ms must be positive" unless evidence[:timings][:observed_ms].positive?

        non_negative!(evidence[:timings][:long_task_over_50_ms], "timings.long_task_over_50_ms")
      end

      def violations_for(evidence)
        first_p95 = percentile_95(evidence[:timings][:first_quarter_switch_ms], "timings.first_quarter_switch_ms")
        final_p95 = percentile_95(evidence[:timings][:final_quarter_switch_ms], "timings.final_quarter_switch_ms")
        heap_growth = evidence[:final][:heap_bytes] - evidence[:baseline][:heap_bytes]
        long_task_fraction = evidence[:timings][:long_task_over_50_ms] / evidence[:timings][:observed_ms]
        latency_limit = first_p95.zero? ? 0 : first_p95 * THRESHOLDS[:final_to_first_p95_ratio]

        checks = {
          heap_growth_bytes: [heap_growth, THRESHOLDS[:heap_growth_bytes]],
          feed_dom_items: [evidence[:final][:feed_dom_items], THRESHOLDS[:feed_dom_items]],
          mounted_media: [evidence[:final][:mounted_media], THRESHOLDS[:mounted_media]],
          listeners: [evidence[:final][:listeners] - evidence[:baseline][:listeners], THRESHOLDS[:extra_listeners_or_subscriptions]],
          subscriptions: [evidence[:final][:subscriptions] - evidence[:baseline][:subscriptions], THRESHOLDS[:extra_listeners_or_subscriptions]],
          audible_media: [evidence[:final][:audible_media], THRESHOLDS[:audible_media]],
          final_switch_p95_ms: [final_p95, latency_limit],
          long_task_fraction: [long_task_fraction, THRESHOLDS[:long_task_fraction]],
          late_mounts: [evidence[:late_mounts], THRESHOLDS[:late_mounts]],
        }

        checks.filter_map do |name, (actual, limit)|
          { metric: name, actual: actual, limit: limit } if actual > limit
        end
      end

      def run
        if ARGV == ["--contract"]
          puts JSON.pretty_generate(CONTRACT)
          exit 0
        end

        command = ENV["VIDEO_SHORTS_BENCHMARK_BROWSER_COMMAND"]
        fail_with("VIDEO_SHORTS_BENCHMARK_BROWSER_COMMAND is required") if command.nil? || command.empty?

        begin
          stdout, stderr, status = Open3.capture3(
            { "VIDEO_SHORTS_BENCHMARK_CONFIG" => JSON.generate(CONTRACT) },
            *Shellwords.split(command),
          )
        rescue StandardError => error
          fail_with("browser benchmark command could not start: #{error.message}")
        end
        fail_with("browser benchmark command failed: #{stderr.strip}") unless status.success?

        begin
          raw_evidence = JSON.parse(stdout)
          evidence = compact_evidence(raw_evidence)
          validate_evidence!(evidence)
          violations = violations_for(evidence)
        rescue JSON::ParserError => error
          fail_with("browser benchmark did not emit JSON evidence: #{error.message}")
        rescue StandardError => error
          fail_with("required browser evidence is absent: #{error.message}")
        end

        if violations.any?
          fail_with("one or more long-session thresholds were exceeded", evidence: evidence, violations: violations)
        end

        puts JSON.generate(
          benchmark: "video_shorts_long_session",
          status: "passed",
          switches: SWITCHES,
          warmup_switches: WARMUP_SWITCHES,
          thresholds: THRESHOLDS,
          evidence: evidence,
        )
      end
    end
  end
end

DiscourseVideoShorts::LongSessionBenchmark.run
