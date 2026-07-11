# ADR-001: Feed data access remains evidence-driven

- Status: Proposed; no A1/A2 selection has been recorded.
- Scope: `/videos.json` candidate discovery before UI implementation.
- Decision owner: data-layer maintainer after production-equivalent benchmark evidence is reviewed.

## Candidate approaches

**A1 — bounded on-demand scan** is the initial experiment, not an accepted production choice. It uses `(posts.created_at, posts.id)` descending keyset pagination, source filtering with category/tag OR semantics, eager loading, real-time Guardian checks, one item per identity, and no more than 500 candidates scanned by one response. A cursor advances after every scanned window, including an empty item window; only exhaustion of candidates produces `next_cursor: null` and `end_reached: true`.

**A2 — lightweight media-candidate index** is prohibited until A1 evidence fails a hard gate. It would store only `post_id`, `media_type`, `media_identity_hmac`, `parser_version`, `source_digest`, and `invalidated_at`; Guardian, title, counts, and policy remain live core reads. Selecting A2 additionally requires demonstrated interrupt/resume backfill, rebuild difference `0`, repair difference `0`, and reversible parser-shadow activation. This ADR does not create or authorize A2 migrations, jobs, or indexes.

A3/full feed indexing is outside this decision. If both A1 and A2 fail, return to architecture review rather than expanding this ADR.

## Fixed benchmark contract

The benchmark seed is **20260710** and contains exactly 10,000 mutually exclusive candidates:

| Candidate class | Count |
| --- | ---: |
| Visible, no media | 5,000 |
| Visible, unique valid media | 1,500 (300 each: Bilibili, YouTube, upload MP4, approved external MP4, approved external HLS) |
| Visible duplicate identity | 1,000 |
| Visible malformed, HTTP, or unapproved media | 1,000 |
| Private and not visible to the benchmark user | 1,000 |
| Deleted or hidden | 500 |

Each class is exactly 60% first posts and 40% replies. The provisioner assigns exactly 5,000 records a category primary source and 5,000 a tag primary source; every fifth record is also assigned the other source, yielding 2,000 deterministic double hits. Body sizes are exactly 7,000 at 2 KiB, 2,500 at 20 KiB, and 500 at 100 KiB. Preserve the generated expected-identity hash manifest with the raw benchmark artifact; do not place post bodies, media URLs, raw identities, HMAC inputs, cookies, Authorization values, or credentials in evidence.

Run at Discourse commit `ded677e00beb0e9bae6e70b69582aecfb72b5477`. Before measurement, supply a separately reviewed JSON environment record declaring `production_equivalent: true` and recording the Discourse commit, database version and parameters, database specification, plugin list, cache mode, worker CPU/RAM limits, and analyzed-statistics timestamp. Missing or empty fields fail closed. A live background driver must produce both SQL and HTTP load and continuously write its sampled proof record; a static statement that the target is 70% is not evidence.

Warm up with five complete traversals and five minutes of concurrent load. Then run 20 independent users/cursors for 30 minutes, completing at least 30 full cursor sequences, in three reported rounds. Use a monotonic clock per response; count SQL using ActiveRecord/database instrumentation; sample process RSS every 100 ms and report delta from baseline. Do not force GC during a measured interval.

## Hard gates

All are required for A1 selection:

- Unauthorized leakage, duplicate items, missing expected items, and cursor loops: `0`.
- Page p95 <= 350 ms, p99 <= 750 ms, and every request <= 2 s.
- SQL p95 <= 20 per response; candidates scanned <= 500 per response; RSS delta <= 150 MiB.
- HTTP responses needed to deliver 20 new authorized, deduplicated items p95 <= 5.
- Candidates scanned per delivered new item p95 <= 20.
- Complete traversal response count <= `ceil(10000 / 500) + 2 = 22`.
- At least 30 complete cursor sequences must be recorded across exactly three reported rounds.

A missing metric, unavailable RSS/SQL instrumentation, incomplete round, unproven visibility mix, or non-advancing cursor is a failure, not a zero or an estimate. Any failure disqualifies A1 and is the only trigger to perform the isolated A2 experiment.

## Provisioning, recording evidence, and making the decision

Provision only in an isolated benchmark environment. The seed is idempotent under the `video-shorts-data-gate-20260710` namespace and `Video Shorts Data Gate 20260710` category prefix. It refuses production by default; the exceptional production path requires both `--allow-production` and a traceable `--audit-ticket`.

```bash
RAILS_ENV=test LOAD_PLUGINS=1 bundle exec rails runner \
  plugins/discourse-video-shorts/script/seed_video_shorts_data_gate.rb \
  --manifest /controlled/video-shorts-data-gate-20260710-manifest.json
```

The provisioner emits the benchmark user ID and a manifest checksum. The manifest contains stable database post IDs, structural attributes, per-media identity hashes, and a canonical record checksum. The benchmark re-reads all 10,000 posts, checks marker/body/count distributions, runs the production `MediaExtractor` for all 1,500 valid-media records, and rejects any identity drift before timing `Feed`.

The background command is started by the benchmark with `VIDEO_SHORTS_BACKGROUND_TARGET_PERCENT=70` and `VIDEO_SHORTS_BACKGROUND_PROOF_PATH=<path>`. It must remain alive through measurement and atomically refresh JSON containing its own process ID, target, observed SQL and HTTP percentages, positive SQL/HTTP sample counts, and start timestamp. The runner verifies that the proof process ID is the child it started and that both observed loads are at least 70%.

Invoke the runner with all fail-closed inputs:

```bash
RAILS_ENV=test LOAD_PLUGINS=1 VIDEO_SHORTS_BENCHMARK_USER_ID=<manifest-user-id> \
  bundle exec rails runner plugins/discourse-video-shorts/script/benchmark_video_shorts_data_layer.rb \
  --manifest /controlled/video-shorts-data-gate-20260710-manifest.json \
  --environment /controlled/video-shorts-environment.json \
  --background-command '/controlled/run-video-shorts-background-load' \
  --background-proof /controlled/video-shorts-background-proof.json \
  --candidates 10000 --seed 20260710 --concurrency 20 --duration 30m \
  --background-load 70 --assert-thresholds
```

`--self-test` is the only short mode. It exercises the wrong-seed, missing-environment, and missing-background-proof rejection contracts, emits `performance_measured: false`, and does not run warmup or measurements. It must never be presented as performance evidence.

The full runner preserves five complete warmup traversals plus five minutes of concurrent warmup, then measures 20 concurrent users for 30 minutes in each of exactly three rounds. It emits one machine-readable JSON evidence record and exits nonzero for unavailable instrumentation or, with `--assert-thresholds`, any hard-gate violation. Archive the unmodified JSON output, seed manifest, environment record, live background proof, and raw per-round samples in the controlled evidence store. Redacted telemetry is intentional: records contain counts, durations, SQL counts, RSS, hashes, and outcome codes only.

After review, append a dated evidence entry containing the artifact locations, exact Discourse commit, all three round results, worst-round values, violations, and an explicit `A1 accepted` or `A1 rejected; A2 authorized` conclusion. No benchmark result has been run or claimed by this ADR.
