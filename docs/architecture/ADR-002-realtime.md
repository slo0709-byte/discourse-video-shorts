# ADR-002: Realtime rollout evidence gates

## Status

Accepted for implementation; no rollout or benchmark result is asserted by this ADR.

## Context

Video Shorts maintains a route-scoped feed, playback resources, authorization leases, and realtime policy updates. Realtime rollout must be evidence-led: a healthy-looking UI is not proof that route teardown, media cleanup, subscription ownership, or backend capacity are safe.

Lifecycle evidence is aggregate-only. It contains no post IDs, user IDs, URLs, titles, payloads, or media identifiers. The stable counter surface records route/window/item generations; active listeners and subscriptions; mounted and audible media; aborts; policy heartbeats; latest and maximum delta lag; and active lease age.

## Decision

Roll out through the following ordered gates. A gate may not be represented as passed without its required evidence. Missing browser, load-test, or telemetry evidence fails the gate rather than being treated as a pass.

### B1: deterministic lifecycle contract

Before integration, exercise the lifecycle counter API with a deterministic clock. The contract verifies generation increments, active-resource increments and decrements, abort and heartbeat totals, delta-lag aggregation, lease age, and rejection of invalid negative transitions. This gate establishes counter semantics only; it is not production performance evidence.

### B2: browser long-session evidence

Run `script/benchmark_video_shorts_long_session.rb` with a browser harness that emits the required machine-readable evidence. The driver requires 1,000 route/item switches after at least 100 warm-up switches and exits nonzero when browser evidence is absent or any threshold is exceeded.

The fixed B2 budget is:

- stable heap growth: at most 30 MiB;
- feed DOM items: at most 60;
- mounted media: at most 3;
- listeners and subscriptions: each may increase by at most 5 over baseline;
- audible media: at most 1;
- final-quarter switch p95: at most 1.25 times first-quarter switch p95;
- cumulative duration of tasks over 50 ms: at most 5% of observed time;
- late media mounts: 0.

The benchmark evidence is intentionally aggregate-only. Its command contract must provide browser confirmation, switch and warm-up counts, baseline and final heap/DOM/listener/subscription values, final media/audio values, first- and final-quarter switch samples, observation duration, cumulative long-task duration, and late-mount count.

### B3: realtime load and mobile evidence

B3 is a fixed capacity budget, not a claim of measured performance. It requires reproducible load, server, database, network, and mobile evidence at all of the following limits:

- 500 users with open comments, 20% using two tabs;
- polling streams at most 500, peak steady RPS at most 667, and duplicate-tab extra requests at most 5%;
- endpoint p95 at most 250 ms, p99 at most 500 ms, errors below 0.1%, and SQL p95 at most 8 per request;
- application CPU p95 at most 70%, database CPU p95 at most 60%, database connections at most 70% of pool, and lock-wait p95 at most 20 ms;
- unchanged mobile downlink at most 60 KiB/min, 30-minute battery increase at most 3%, and 4G comment-sync p95 at most 2 seconds.

## Consequences

Lifecycle instrumentation remains a narrow, privacy-safe observability contract rather than analytics. The browser harness must report actual measurements; it cannot synthesize a passing report when a browser session, heap sample, long-task observation, or lifecycle snapshot is unavailable. B3 promotion remains blocked until all budget measurements are captured and independently retained as evidence.
