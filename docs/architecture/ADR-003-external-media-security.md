# ADR-003: External media security

## Status

Accepted for implementation. This decision does not assert that staging or device security gates have passed.

## Decision

External MP4 and HLS are disabled by default. Their authority is the singleton `video_shorts_origin_policies` row, not a site setting. Administrators update `external_media_enabled` and `origins` only through `PATCH` or `PUT /admin/plugins/discourse-video-shorts/origins.json`; each effective change increments `revision` and appends an immutable `video_shorts_origin_policy_revisions` row.

An allowed origin is an exact normalized HTTPS origin: lowercase host, no credentials, path, query, fragment, or wildcard, with port omitted only for 443. Approval never extends to subdomains or another port. `GET /videos/policy.json` returns the current user's `{revision, external_media_enabled, origins, generated_at}` snapshot with `ETag: "policy-N"` and `Cache-Control: no-cache, private, must-revalidate`.

A feed item and every external request must use the same policy revision. Missing, disabled, stale, or unparsable policy and an origin not in that snapshot fail before a request. `VideoShortsMediaLoader` uses `credentials: "omit"`, `redirect: "error"`, rejects redirected responses, rechecks authorization after fetch, and aborts owned requests on destruction. Redirects therefore fail closed; an opaque or otherwise unobservable redirect is not accepted.

The custom Hls.js loader is used for every playlist and discovered HLS resource. Hls.js routes master and variant manifests, segments, initialization data, subtitles, and keys through the revision-bound loader, so each URL is checked before fetch. Policy revision changes destroy playback and abort requests. The route policy service keeps the heartbeat active while an external resource or request is retained and revalidates before new work.

Provider embeds do not use the administrator origin list. They use the static client allowlist: Bilibili only `https://player.bilibili.com/player.html`; YouTube only HTTPS, no explicit port, on `www.youtube.com` or `www.youtube-nocookie.com` under `/embed/`. The iframe sandbox and allow attributes remain restrictive.

CSP is defense in depth only. The plugin's `frame-src` lists the provider hosts while `media-src` and `connect-src` admit HTTPS transport; neither CSP nor a permissive shared site policy grants application authorization.

Safari native HLS is deliberately not used because native playlist subresource requests cannot be proven to pass through this loader. HLS requires the vendored Hls.js/MSE path. Where that path is unavailable or unsupported, playback fails closed and the UI offers the topic link; this limitation still requires formal iPhone Safari evidence.

## Emergency control

Set the policy's `external_media_enabled` to false to stop external MP4/HLS without disabling provider embeds or uploads. Set `video_shorts_enabled` to false for the full kill switch: `/videos` and `/videos.json` stop serving the feature. A policy change must produce a new revision; clients observing it may not issue a new request to a removed origin.

## Release evidence still required

Implementation and request specs are not formal-browser proof. Before release retain evidence for each supported browser that policy-save-to-last-old-request p95 is at most 2 seconds over 30 runs and that requests to a removed origin after the client first observes the new revision are exactly zero. Include adjacent preloads, lost notification/revalidation, every HLS resource class, redirect denial, and the iPhone Safari fail-closed behavior. Any missing evidence or one post-observation request blocks external-media release.
