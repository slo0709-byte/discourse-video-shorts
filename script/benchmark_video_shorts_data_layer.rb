# frozen_string_literal: true

# Run with Rails runner. This measures the A1 feed query directly so cursor and
# scan accounting are identical to /videos.json without serializing credentials.
require "json"
require "optparse"
require "shellwords"
require Rails.root.join("plugins/discourse-video-shorts/lib/discourse_video_shorts/telemetry")

module DiscourseVideoShorts
  class DataLayerBenchmark
    Options = Data.define(
      :candidates,
      :seed,
      :concurrency,
      :duration_seconds,
      :background_load,
      :user_id,
      :assert_thresholds,
      :manifest_path,
      :environment_path,
      :background_command,
      :background_proof_path,
      :self_test,
    )

    def self.parse_duration(value)
      match = value.match(/\A(\d+)([smh]?)\z/)
      raise OptionParser::InvalidArgument, value unless match

      match[1].to_i * { "" => 1, "s" => 1, "m" => 60, "h" => 3600 }.fetch(match[2])
    end

    def initialize(options)
      @options = options
      @samples = []
      @mutex = Mutex.new
      @rss_samples_kib = []
      @background_pid = nil
    end

    def run
      if options.self_test
        run_contract_self_test
        return
      end

      verify_options!
      manifest = load_and_verify_manifest!
      environment = load_json!(options.environment_path, "environment metadata")
      Telemetry::DataLayerContract.verify_environment!(environment)
      verify_database!(manifest)
      start_background_driver!
      warm_up
      verify_background_proof!
      baseline_rss = rss_kib!
      rounds =
        Array.new(Telemetry::DataLayerContract::ROUND_COUNT) do |index|
          round = run_round(index + 1)
          verify_background_proof!
          round
        end
      report = summarize(rounds, baseline_rss)
      violations = Telemetry::DataLayerContract.violations(report)
      evidence = Telemetry.safe_event(
        event: "video_shorts_data_layer_benchmark",
        manifest_sha256: Digest::SHA256.file(options.manifest_path).hexdigest,
        configuration: {
          concurrency: options.concurrency,
          duration_seconds: options.duration_seconds,
          background_load_target_percent: options.background_load,
          warmup_traversals: Telemetry::DataLayerContract::WARMUP_TRAVERSALS,
          warmup_seconds: Telemetry::DataLayerContract::WARMUP_SECONDS,
          environment_sha256: Digest::SHA256.file(options.environment_path).hexdigest,
          background_proof_sha256: Digest::SHA256.file(options.background_proof_path).hexdigest,
        },
        report:,
        violations:,
        round_samples: rounds,
      )
      puts JSON.generate(evidence)
      exit 1 if options.assert_thresholds && violations.present?
    rescue StandardError => error
      puts JSON.generate(Telemetry.safe_event(event: "video_shorts_data_layer_benchmark", status: "unavailable", error_class: error.class.name, error: "[redacted]"))
      exit 1
    ensure
      stop_background_driver!
    end

    private

    attr_reader :options

    def verify_options!
      raise ArgumentError, "--candidates must be 10000" unless options.candidates == Telemetry::DataLayerContract::CANDIDATES
      raise ArgumentError, "--seed must be 20260710" unless options.seed == Telemetry::DataLayerContract::SEED
      raise ArgumentError, "--concurrency must be 20" unless options.concurrency == 20
      raise ArgumentError, "--duration must be 30m" unless options.duration_seconds == 1800
      raise ArgumentError, "--background-load must be 70" unless options.background_load == 70
      raise ArgumentError, "--user-id is required to measure Guardian visibility" unless options.user_id
      raise ArgumentError, "--manifest is required" if options.manifest_path.blank?
      raise ArgumentError, "--environment is required" if options.environment_path.blank?
      raise ArgumentError, "--background-command is required" if options.background_command.blank?
      raise ArgumentError, "--background-proof is required" if options.background_proof_path.blank?
      raise ArgumentError, "--assert-thresholds is required for the release gate" unless options.assert_thresholds
      raise ArgumentError, "benchmark user not found" unless User.exists?(options.user_id)
    end

    def load_json!(path, label)
      raise ArgumentError, "#{label} file does not exist" unless path.present? && File.file?(path)

      JSON.parse(File.read(path))
    rescue JSON::ParserError
      raise ArgumentError, "#{label} is not valid JSON"
    end

    def load_and_verify_manifest!
      manifest = load_json!(options.manifest_path, "manifest")
      Telemetry::DataLayerContract.verify_manifest!(manifest)
      manifest
    end

    def verify_database!(manifest)
      records = manifest.fetch("records")
      namespace_post_ids =
        PostCustomField.where(
          name: "video_shorts_benchmark_namespace",
          value: Telemetry::DataLayerContract::NAMESPACE,
        ).pluck(:post_id)
      raise "database benchmark namespace count mismatch" unless namespace_post_ids.length == Telemetry::DataLayerContract::CANDIDATES
      raise "database benchmark namespace IDs drift" unless namespace_post_ids.sort == records.map { |record| record.fetch("post_id") }.sort
      posts = Post.unscoped.where(id: records.map { |record| record.fetch("post_id") }).includes(:uploads, topic: :tags).index_by(&:id)
      raise "manifest posts are missing from the database" unless posts.length == records.length

      guardian = Guardian.new(User.find(options.user_id))
      category_ids = SiteSetting.video_shorts_source_category_ids.to_s.split("|").map(&:to_i)
      tag_names = SiteSetting.video_shorts_source_tag_names.to_s.split("|")
      records.each do |record|
        post = posts.fetch(record.fetch("post_id"))
        fields = post.custom_fields
        expected_fields = {
          "namespace" => Telemetry::DataLayerContract::NAMESPACE,
          "seed" => Telemetry::DataLayerContract::SEED.to_s,
          "ordinal" => record.fetch("ordinal").to_s,
          "class" => record.fetch("candidate_class"),
          "placement" => record.fetch("placement"),
          "source_primary" => record.fetch("source_primary"),
          "double_match" => record.fetch("double_match").to_s,
          "body_kib" => record.fetch("body_kib").to_s,
        }
        expected_fields.each do |name, value|
          raise "post #{post.id} #{name} drift" unless fields["video_shorts_benchmark_#{name}"] == value
        end
        raise "post #{post.id} body-size drift" unless post.raw.to_s.bytesize == record.fetch("body_bytes")
        actual_placement = post.post_number == 1 ? "first" : "reply"
        raise "post #{post.id} placement drift" unless actual_placement == record.fetch("placement")

        category_match = category_ids.include?(post.topic.category_id)
        tag_match = (post.topic.tags.map(&:name) & tag_names).present?
        primary_match = record.fetch("source_primary") == "category" ? category_match : tag_match
        raise "post #{post.id} primary source drift" unless primary_match
        raise "post #{post.id} double-source drift" unless record.fetch("double_match") == (category_match && tag_match)

        visible = guardian.can_see?(post.topic) && guardian.can_see?(post)
        case record.fetch("candidate_class")
        when "private_not_visible"
          raise "post #{post.id} private visibility drift" if visible
        when "deleted_or_hidden"
          raise "post #{post.id} deleted/hidden drift" unless post.deleted_at || post.hidden?
          actual_state = post.deleted_at ? "deleted" : "hidden"
          raise "post #{post.id} deleted/hidden state drift" unless actual_state == record.fetch("state")
        else
          raise "post #{post.id} visible-candidate drift" unless visible && !post.deleted_at && !post.hidden?
        end
      end

      valid_records = records.select { |record| record["media_kind"].present? }
      identity_hashes =
        valid_records.map do |record|
          media = MediaExtractor.extract_media_for_visible_post(posts.fetch(record.fetch("post_id")), guardian)
          raise "post #{record.fetch("post_id")} media extraction failed" unless media&.fetch(:kind) == record.fetch("media_kind")
          digest = Digest::SHA256.hexdigest(media.fetch(:identity))
          raise "post #{record.fetch("post_id")} identity drift" unless digest == record.fetch("identity_sha256")
          digest
        end.sort

      summary = {
        "candidates" => records.length,
        "mix" => records.group_by { |record| record.fetch("candidate_class") }.transform_values(&:length),
        "placement" => records.group_by { |record| record.fetch("placement") }.transform_values(&:length),
        "class_placement" =>
          records.group_by { |record| record.fetch("candidate_class") }.transform_values do |class_records|
            class_records.group_by { |record| record.fetch("placement") }.transform_values(&:length)
          end,
        "source_primary" => records.group_by { |record| record.fetch("source_primary") }.transform_values(&:length),
        "double_match" => records.count { |record| record.fetch("double_match") },
        "body_sizes_kib" => records.group_by { |record| record.fetch("body_kib").to_s }.transform_values(&:length),
        "deleted_hidden" =>
          records.filter_map { |record| record["state"] }.group_by(&:itself).transform_values(&:length),
        "valid_media_kinds" => valid_records.group_by { |record| record.fetch("media_kind") }.transform_values(&:length),
        "identity_manifest_sha256" => Digest::SHA256.hexdigest(identity_hashes.join("\n")),
        "expected_identity_manifest_sha256" => manifest.fetch("expected_identity_manifest_sha256"),
      }
      Telemetry::DataLayerContract.verify_dataset_summary!(summary)
    end

    def start_background_driver!
      proof_path = File.expand_path(options.background_proof_path)
      File.delete(proof_path) if File.exist?(proof_path)
      @background_pid =
        Process.spawn(
          {
            "VIDEO_SHORTS_BACKGROUND_TARGET_PERCENT" => options.background_load.to_s,
            "VIDEO_SHORTS_BACKGROUND_PROOF_PATH" => proof_path,
          },
          *Shellwords.split(options.background_command),
        )
      sleep 0.1
      Process.kill(0, @background_pid)
    rescue Errno::ESRCH
      raise "background-load driver exited before measurement"
    end

    def verify_background_proof!
      Process.kill(0, @background_pid)
      proof = load_json!(options.background_proof_path, "background proof")
      Telemetry::DataLayerContract.verify_background_proof!(proof, driver_pid: @background_pid)
    rescue Errno::ESRCH
      raise "background-load driver is not running"
    end

    def stop_background_driver!
      return unless @background_pid

      Process.kill("TERM", @background_pid)
      Process.wait(@background_pid)
    rescue Errno::ESRCH, Errno::ECHILD
      nil
    ensure
      @background_pid = nil
    end

    def run_contract_self_test
      failures = []
      begin
        Telemetry::DataLayerContract.dataset_manifest(seed: 1)
        failures << "wrong seed accepted"
      rescue ArgumentError
        nil
      end
      begin
        Telemetry::DataLayerContract.verify_environment!({})
        failures << "missing environment accepted"
      rescue ArgumentError
        nil
      end
      begin
        Telemetry::DataLayerContract.verify_background_proof!({}, driver_pid: Process.pid)
        failures << "missing background proof accepted"
      rescue ArgumentError
        nil
      end
      raise failures.join(", ") if failures.present?

      puts JSON.generate(event: "video_shorts_data_layer_contract_self_test", status: "passed", performance_measured: false)
    end

    def warm_up
      Telemetry::DataLayerContract::WARMUP_TRAVERSALS.times { traverse(round: 0) }
      run_workers(deadline: monotonic + Telemetry::DataLayerContract::WARMUP_SECONDS, round: 0)
    end

    def run_round(number)
      @mutex.synchronize { @samples = []; @rss_samples_kib = [] }
      baseline = rss_kib!
      sampler = Thread.new do
        loop do
          @mutex.synchronize { @rss_samples_kib << rss_kib! }
          sleep 0.1
        end
      rescue StandardError
        # The final report rejects missing RSS evidence; never substitute a value.
      end
      run_workers(deadline: monotonic + options.duration_seconds, round: number)
      sampler.kill
      sampler.join
      samples = @mutex.synchronize { @samples.dup }
      raise "round #{number} completed no full cursor traversals" if samples.empty?

      { number:, baseline_rss_kib: baseline, samples:, peak_rss_kib: @rss_samples_kib.max }
    end

    def run_workers(deadline:, round:)
      errors = Queue.new
      workers = Array.new(options.concurrency) do
        Thread.new do
          ActiveRecord::Base.connection_pool.with_connection do
            traverse(round:) while monotonic < deadline
          end
        rescue StandardError => error
          errors << error
        end
      end
      workers.each(&:join)
      raise errors.pop unless errors.empty?
    end

    def traverse(round:)
      guardian = Guardian.new(User.find(options.user_id))
      cursor = nil
      prior_cursors = {}
      identities = {}
      requests = []
      loop do
        raise "cursor loop detected" if cursor && prior_cursors[cursor]
        prior_cursors[cursor] = true if cursor
        result, elapsed_ms, sql_count = measure_query(guardian, cursor)
        scan = result.fetch(:scan)
        items = result.fetch(:items)
        duplicate_count = items.count { |item| identities.key?(item.dig(:media, :identity)) }
        items.each { |item| identities[item.dig(:media, :identity)] = true }
        unauthorized_count = Post.where(id: items.map { |item| item.fetch(:post_id) }).includes(:topic).count { |post| !guardian.can_see?(post) || !guardian.can_see?(post.topic) }
        requests << { elapsed_ms:, sql_count:, scanned: scan.fetch(:candidates_scanned), delivered: items.length, duplicate_count:, unauthorized_count: }
        cursor = result[:next_cursor]
        if cursor.nil?
          raise "cursor ended before candidate exhaustion" unless scan.fetch(:end_reached)
          break
        end
      end
      @mutex.synchronize { @samples << { round:, requests:, delivered: identities.length, cursor_terminated: true } } if round.positive?
    end

    def measure_query(guardian, cursor)
      sql_count = 0
      measuring_thread = Thread.current
      subscription = ActiveSupport::Notifications.subscribe("sql.active_record") do |_name, _start, _finish, _id, payload|
        next unless Thread.current == measuring_thread

        sql_count += 1 unless payload[:cached] || payload[:name] == "SCHEMA"
      end
      started = monotonic
      result = Feed.new(guardian:, page_size: 20, scan_limit: Telemetry::DataLayerContract::MAX_SCAN_PER_REQUEST, cursor:).call
      [result, (monotonic - started) * 1000, sql_count]
    ensure
      ActiveSupport::Notifications.unsubscribe(subscription) if subscription
    end

    def summarize(rounds, baseline_rss)
      samples = rounds.flat_map { |round| round.fetch(:samples) }
      requests = samples.flat_map { |sample| sample.fetch(:requests) }
      delivered = samples.sum { |sample| sample.fetch(:delivered) }
      response_windows = samples.flat_map { |sample| responses_per_twenty(sample.fetch(:requests)) }
      {
        rounds: rounds.length,
        completed_cursor_sequences: samples.length,
        unauthorized_leaks: requests.sum { |request| request[:unauthorized_count] },
        duplicate_items: requests.sum { |request| request[:duplicate_count] },
        missing_items: [Telemetry::DataLayerContract.dataset_manifest[:expected_unique_visible_identities] * samples.length - delivered, 0].max,
        cursor_loops: 0,
        page_p95_ms: Telemetry::DataLayerContract.percentile(requests.map { |request| request[:elapsed_ms] }, 0.95),
        page_p99_ms: Telemetry::DataLayerContract.percentile(requests.map { |request| request[:elapsed_ms] }, 0.99),
        request_max_ms: requests.map { |request| request[:elapsed_ms] }.max,
        sql_p95: Telemetry::DataLayerContract.percentile(requests.map { |request| request[:sql_count] }, 0.95),
        max_scanned: requests.map { |request| request[:scanned] }.max,
        rss_delta_mib: rss_delta_mib(rounds, baseline_rss),
        responses_per_twenty_p95: Telemetry::DataLayerContract.percentile(response_windows, 0.95),
        scan_per_item_p95: Telemetry::DataLayerContract.percentile(requests.filter_map { |request| request[:scanned].to_f / request[:delivered] if request[:delivered].positive? }, 0.95),
        responses_to_end_max: samples.map { |sample| sample[:requests].length }.max,
      }
    end
    def responses_per_twenty(requests)
      delivered_since_window = 0
      responses_since_window = 0
      requests.each_with_object([]) do |request, windows|
        responses_since_window += 1
        delivered_since_window += request[:delivered]
        next if delivered_since_window < 20

        windows << responses_since_window
        delivered_since_window -= 20
        responses_since_window = 0
      end
    end

    def rss_delta_mib(rounds, baseline_rss)
      peak = rounds.map { |round| round[:peak_rss_kib] }.compact.max
      return nil unless peak

      (peak - baseline_rss) / 1024.0
    end

    def rss_kib!
      status = File.read("/proc/self/status")
      match = status.match(/^VmRSS:\s+(\d+)\s+kB$/)
      raise "RSS instrumentation unavailable" unless match

      match[1].to_i
    end

    def monotonic
      Process.clock_gettime(Process::CLOCK_MONOTONIC)
    end
  end
end

parsed = {
  candidates: 10_000,
  seed: 20_260_710,
  concurrency: 20,
  duration_seconds: 1800,
  background_load: 70,
  user_id: ENV["VIDEO_SHORTS_BENCHMARK_USER_ID"]&.to_i || User.find_by(username: "video_member")&.id,
  assert_thresholds: false,
  manifest_path: nil,
  environment_path: nil,
  background_command: nil,
  background_proof_path: nil,
  self_test: false,
}
OptionParser.new do |parser|
  parser.on("--candidates COUNT", Integer) { |value| parsed[:candidates] = value }
  parser.on("--seed SEED", Integer) { |value| parsed[:seed] = value }
  parser.on("--concurrency COUNT", Integer) { |value| parsed[:concurrency] = value }
  parser.on("--duration DURATION") do |value|
    parsed[:duration_seconds] = DiscourseVideoShorts::DataLayerBenchmark.parse_duration(value)
  end
  parser.on("--background-load PERCENT", Integer) { |value| parsed[:background_load] = value }
  parser.on("--user-id ID", Integer) { |value| parsed[:user_id] = value }
  parser.on("--manifest PATH") { |value| parsed[:manifest_path] = value }
  parser.on("--environment PATH") { |value| parsed[:environment_path] = value }
  parser.on("--background-command COMMAND") { |value| parsed[:background_command] = value }
  parser.on("--background-proof PATH") { |value| parsed[:background_proof_path] = value }
  parser.on("--self-test") { parsed[:self_test] = true }
  parser.on("--assert-thresholds") { parsed[:assert_thresholds] = true }
end.parse!

DiscourseVideoShorts::DataLayerBenchmark.new(DiscourseVideoShorts::DataLayerBenchmark::Options.new(**parsed)).run
