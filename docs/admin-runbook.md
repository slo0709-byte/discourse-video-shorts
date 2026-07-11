# Video Shorts admin runbook

## Configuration

Configure these Discourse site settings under the plugin:

- `video_shorts_enabled`: full feature switch; default `false`.
- `video_shorts_source_category_ids`: category list; default empty.
- `video_shorts_source_tag_names`: tag list; default empty. Category and tag matching is OR.
- `video_shorts_excerpt_character_limit`: integer, default `120`, minimum `1`.
- `video_shorts_page_size`: integer, default `20`, minimum `1`.
- `video_shorts_candidate_scan_limit`: integer, default `500`, minimum `1`.
- `video_shorts_debug_mode`: server-only boolean, default `false`.
- `video_shorts_canary_group_ids`: group list, default empty; a nonempty value limits access to those groups.

Keep `video_shorts_enabled=false` during installation and migration. Set source category/tag lists explicitly. An empty effective source selection returns an empty feed. Do not increase page or scan limits to work around a failed data-layer gate.

## External origins

At **Admin > Plugins > Video Shorts**, update the external policy through the origin control. Enter only exact HTTPS origins such as `https://media.example` or `https://media.example:8443`: no path, wildcard, credentials, query, fragment, or HTTP. The write updates `external_media_enabled` and the complete origin list together, increments the revision, and creates an append-only audit row. Origin entries are configuration, not a place for tokens, signed URLs, credentials, cookies, or secrets.

Policy removal is immediate for new work after revision observation. Adding an origin can require a page reload for the site's effective CSP. Provider embeds are not configured here; Bilibili and YouTube hosts are a static code allowlist.

## Diagnostics

Use **Admin > Plugins > Video Shorts** or `GET /admin/plugins/discourse-video-shorts/diagnostics.json`. Verify:

- `enabled`, `kill_switch`, and canary audience;
- policy revision, `external_media_enabled`, normalized origins, and update time;
- configured and effective categories/tags plus warnings;
- bounded scan sample, candidates scanned, scan-limit/end flags, media-kind counts, fallback reasons, and topic fallback links;
- upload object-storage/CDN and HTTPS HLS delivery recommendations.

Diagnostics deliberately report heartbeat, delta, lease, and client resources as `observable: false`; collect those from formal client evidence. `measured_query_count: null` is not proof of the SQL gate. Do not paste diagnostic output containing private post data into public tickets.

## Canary procedure

1. Record immutable plugin artifact SHA, Discourse commit `ded677e00beb0e9bae6e70b69582aecfb72b5477`, Hls.js lock/SBOM, current settings, policy revision, and database backup metadata.
2. Install with `video_shorts_enabled=false`; run admin, homepage, topic, login, and disabled-route smoke checks.
3. Set `video_shorts_canary_group_ids` to the approved group IDs, then enable `video_shorts_enabled`. Confirm a member can access the page/API and nonmembers receive the contracted 403/404 without feed, policy, or diagnostics data.
4. Start with external media disabled. Enable only after the external-security evidence is present. Observe at least one production peak period before expanding the audience.
5. Remove the canary restriction only after all evidence validators pass and P0/P1 is zero. An empty canary list means all eligible members, not nobody.

## Monitoring and release gates

Monitor aggregate feed latency/error rate, candidates scanned, responses per 20 delivered items, SQL count, RSS, policy revision/heartbeat age, external references and aborts, comment delta lag, lease age, route/window/item generations, mounted/audible media, and client error/fallback counts. Never log post bodies, cookies, authorization headers, complete query URLs, signed media URLs, full HMACs, credentials, or secrets.

Required hard signals include: feed p95 at most 350 ms and p99 at most 750 ms, no request over 2 s, SQL p95 at most 20/page, scan at most 500/request, RSS increase at most 150 MiB, responses per 20 new items p95 at most 5, scan amplification p95 at most 20, and at most 22 responses to exhaustion. Long-session limits are heap increase at most 30 MiB, at most 60 feed DOM items, at most 3 media, at most 1 audible media, listeners/subscriptions at most baseline plus 5, late mounts zero, p95 trend at most 1.25x, and long tasks at most 5%. Comment sync p95 is at most 2 seconds, lease revocation p95 at most 6 seconds, policy detection p95 at most 2 seconds, and post-observation removed-origin requests exactly zero.

These are thresholds to evaluate, not results. Do not promote when formal staging/browser/device evidence is missing.

## Emergency disable

- External-media incident: set policy `external_media_enabled=false`; confirm the revision increments, tracked requests abort, and no new external requests start. Provider/upload playback and the feed remain available.
- Realtime/comment incident: there is no separate realtime site setting. Disable `video_shorts_enabled` to fail closed; do not invent a client-only override or leave stale comments visible.
- Feed, authorization, privacy, or broad incident: set `video_shorts_enabled=false`. Confirm `/videos` and `/videos.json` return 404, stop plugin jobs if rollback is underway, and follow `migration-and-rollback.md`.
