# Compatibility spike: Discourse v2026.7.0-latest

## Version pin

Compatibility work is bound to Discourse tag `v2026.7.0-latest`, commit `ded677e00beb0e9bae6e70b69582aecfb72b5477`. Re-run this spike before changing either value. The bundled player is Hls.js `1.6.16`; its runtime is `public/javascripts/hls.min.js`, with checksum, license, and SBOM material under `vendor/`.

## Implemented compatibility facts

These are concrete integration points in the plugin; they are not claims that the formal release matrix passed.

- Public plugin events `on(:post_created)`, `on(:post_edited)`, `on(:post_destroyed)`, and `on(:post_recovered)` call `Comments::ChangeRecorder` with `create`, `edit`, `delete`, and `recover`. The public `on(:post_process_cooked)` hook emits an idempotent `edit` invalidation so rebakes are covered. Media extraction uses a cooked-content signature in its transient cache key, so rebakes read a new key without explicit invalidation; duplicate comment invalidations are safe because the client applies sequence-ordered post-ID upserts.
- After the database transaction commits, `MessageBus.publish` sends only `{source_post_id, change_sequence}` to `/video-shorts/comments/:source_post_id` with `Topic#secure_audience_publish_messages`. MessageBus is invalidation only; comment bodies are re-read through Guardian-filtered endpoints.
- The client `@service messageBus` calls `subscribe(channel, handler)` once per active source and calls `unsubscribe(channel, the_same_handler)` after the last callback and during service destruction. Browser `online` is the reconnect signal; every active callback is told to fetch delta before trusting local state.
- Admin origin and diagnostics routes are scoped by `AdminConstraint.new`; their controllers inherit `Admin::AdminController`. The origin controller is the only policy writer.
- Feed, comment snapshot/delta, policy snapshot, leases, and diagnostics use the request `guardian`; private visibility remains a server decision. `Topic#secure_audience_publish_messages` limits realtime delivery but does not replace Guardian checks.
- State-changing plugin admin requests use Discourse's normal authenticated controller and `discourse/lib/ajax` path. No action skips forgery protection; CSRF validation is inherited from Discourse. Comment writes reuse core `POST /posts.json`, `PUT /posts/:id.json`, and `DELETE /posts/:id.json`, which enforce core Guardian and CSRF behavior.
- Hls.js `1.6.16` is loaded from the plugin-owned static path and receives `VideoShortsMediaLoader` as its loader. Native Safari HLS is not a fallback because it cannot expose every subresource to the origin policy.

## Formal evidence still required

The pin and code inspection establish the intended API surface only. Release remains blocked until retained, machine-checkable evidence on the pinned Discourse checkout proves:

1. create/edit/destroy/recover/post-process hook timing and coverage, including commit ordering, rebakes, idempotent duplicate invalidations, and secure audience behavior;
2. subscribe, exact-handler unsubscribe, reconnect delta recovery, route teardown, and no duplicate subscriptions;
3. `AdminConstraint`, admin authentication, Guardian denial, anonymous 404/member 403 behavior, and failed-CSRF requests;
4. Hls.js checksum/version loading, every HLS resource through the custom loader, redirect denial, and unsupported-MSE fallback;
5. desktop Chrome, desktop Edge, iPhone Safari, and Android Chrome across Bilibili, YouTube, upload MP4, and approved external MP4/HLS;
6. the approved performance, long-session, comment-sync, policy-revocation, visual, rollback, privacy, and P0/P1-zero gates.

No staging, formal-browser, or physical-device gate is recorded as passed by this document. Missing raw evidence is a failed release gate, not an assumed compatibility result.
