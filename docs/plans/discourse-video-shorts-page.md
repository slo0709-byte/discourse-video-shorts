# Discourse Video Shorts Page

## TL;DR
> **Summary**: Build a greenfield Discourse plugin that adds a `/videos` page with a Shorts-style vertical feed sourced from Discourse topics/posts containing uploaded or embedded videos, including Bilibili. The plugin keeps Discourse topics/posts as the source of truth, exposes a permission-safe JSON feed endpoint, and reuses native Discourse actions.
> **Deliverables**:
> - Discourse plugin scaffold
> - Local Discourse dev/test checkout under `/root/shipinye/discourse`
> - Plugin source at `/root/shipinye/discourse-video-shorts`, symlinked into the checkout for dev/test
> - `/videos` frontend route and `/videos.json` backend endpoint
> - Normalized video-feed data contract
> - Glimmer Shorts-style feed UI
> - Native Discourse action integration: like, reply, share, bookmark, flag/report, open topic, login prompts
> - Settings for source category/tag and page size
> - Automated backend/frontend tests and browser QA scenarios
> **Effort**: Large
> **Parallel**: LIMITED - 11 ordered waves
> **Critical Path**: Task 1A -> Task 1B -> Task 1C -> Task 2 -> Task 4 -> Task 3 -> Task 5 -> Task 6 -> Task 7 -> Task 8 -> Task 9 -> Final Verification, with Task 1D browser runtime gating browser QA rather than backend/service work

## Context

### Original Request
The user wants to develop a Discourse video page, similar to YouTube Shorts.

Confirmed follow-up decisions:
- Include both Discourse-hosted topic/post videos and embedded videos.
- Embedded videos include Bilibili.
- Use the recommended default architecture: Discourse plugin with route/API.
- Use default/native Discourse interactions only.

### Research Summary
- Workspace `/root/shipinye` is empty, so this is greenfield.
- Discourse official/community guidance supports plugin-backed custom routes for a real `/videos` page.
- Discourse can support uploaded videos, but admins must allow video extensions and adequate upload size through core settings such as `authorized_extensions`, `authorized_extensions_for_staff`, `theme_authorized_extensions`, and `max_attachment_size_kb`.
- Discourse already oneboxes supported video links, including common providers. External iframe providers cannot guarantee the same pause/mute/keyboard control as native `<video>`.
- Current Discourse plugin frontend work should follow installed Discourse source conventions for route maps, `.gjs` Glimmer components, plugin assets, SCSS, and acceptance tests.

Useful references:
- Discourse JS API tutorial: https://meta.discourse.org/t/theme-developer-tutorial-6-using-the-js-api/357801
- Custom route/plugin pattern research thread: https://meta.discourse.org/t/topic/391441
- Video upload settings: https://meta.discourse.org/t/does-discourse-support-uploading-videos/200789
- Insert Video official component context: https://meta.discourse.org/t/insert-video/147651

### Metis Review (gaps addressed)
- Keep `/videos` fixed for v1; do not make route path configurable.
- Define exact ordering concepts: global candidate scan order is `post.created_at DESC, post.id DESC`; media precedence within one post is native upload, Bilibili, YouTube/Vimeo, unsupported intended-video fallback; max one feed item per post; dedupe by server-produced `media.dedupe_key` only within one response page.
- Distinguish native `<video>` guarantees from best-effort iframe behavior.
- Support canonical `bilibili.com/video/BV...` and already-cooked Bilibili iframe/player embeds in v1; defer `b23.tv` short-link expansion.
- Use post-level permission checks with `Guardian`, not topic visibility alone.
- Target native actions to `post_id`; share/open uses topic URL plus post anchor.
- Implement only latest ordering in v1.
- Avoid new persistent video records in v1 unless a cache becomes necessary.

## Work Objectives

### Core Objective
Create a Discourse plugin that exposes a permission-safe Shorts-style video feed at `/videos`, using existing Discourse topics/posts as the content source and native Discourse interactions as the action model.

### Deliverables
- Plugin scaffold under one repository.
- Discourse dev/test checkout at `/root/shipinye/discourse`, with plugin source owned at `/root/shipinye/discourse-video-shorts` and symlinked into `/root/shipinye/discourse/plugins/discourse-video-shorts`.
- Backend endpoint `GET /videos.json`.
- Server-side media extraction service.
- Frontend `/videos` route and route model.
- Glimmer feed/player components.
- SCSS for responsive mobile/desktop layout.
- Settings and admin-safe empty states.
- Tests and agent-executed QA evidence.
- Evidence and QA artifacts stored outside the Discourse checkout at `/root/shipinye/evidence/`.

### Definition of Done
- `GET /videos.json` returns only videos visible to the current requester.
- `/videos` renders a vertical video feed with one active item.
- Native uploaded MP4/webm videos support muted autoplay, pause/play, and offscreen pause.
- Bilibili embedded videos render only when the extracted embed URL passes strict provider allowlisting; otherwise they show safe fallback behavior and labeled topic fallback links.
- Bilibili canonical posts count as supported when they either render as iframe candidates after Task 3 freezes an iframe-capable contract or show a verified labeled topic fallback under the conservative fallback-only contract.
- A fallback-only provider media contract is a valid v1 media outcome when plugin CSP/provider sandbox proof is unavailable or fails; if browser runtime itself is unavailable, backend/API work may complete but full browser-facing final verification remains blocked.
- Like, reply, share, bookmark, flag/report, and open-topic actions use Discourse-native flows.
- Anonymous users see only public videos and native login prompts for restricted actions.
- Empty/loading/error/unsupported states are visible and tested.
- Backend RSpec, frontend QUnit/acceptance tests, lint/build, and agent-run browser QA pass.

### Must Have
- Fixed v1 route: `/videos`.
- Fixed v1 API endpoint: `/videos.json`.
- Configurable source category/tag through plugin settings.
- Latest-first feed ordering.
- Page size default: 20, max: 50.
- Candidate scan limit per API request default: 500, hard max: 1000.
- Partial pages are acceptable when `scan_limit_reached=true`; the client should continue pagination using `next_cursor`.
- Preload active item plus one previous and one next item only.
- No more than one native video playing at a time.
- `prefers-reduced-motion` respected.
- Controls respect `safe-area-inset-*`.

### Must NOT Have
- No Discourse core modifications.
- No new recommendation algorithm or ML.
- No custom non-native like/save/comment/report system.
- No custom transcoding pipeline.
- No creator studio or upload flow inside `/videos` v1.
- No persistent video table unless task evidence proves extraction cannot meet performance/security requirements without it.
- No `b23.tv` expansion in v1 unless explicitly added later.
- No arbitrary generic iframe support in v1.

## Verification Strategy
> Agent-executed where infrastructure is available. Missing infrastructure is recorded as a blocker and surfaced with exact evidence.

- Test decision: TDD. Each implementation task starts by writing failing tests, captures RED, implements, then captures GREEN.
- Backend framework: from `/root/shipinye/discourse`, Discourse plugin RSpec via `bundle exec rspec plugins/discourse-video-shorts/spec`.
- Frontend framework: from `/root/shipinye/discourse`, Discourse plugin QUnit/acceptance tests.
- Browser QA: Playwright or real browser against a running Discourse dev/test instance.
- Browser fallback: if local browser tooling cannot install or launch, run the backend/API verification and record `/root/shipinye/evidence/task-1-browser-blocker.txt`; this documents the gap but does not count as full completion for browser-facing criteria.
- Browser-block rule for Tasks 5-9: if `/root/shipinye/evidence/task-1-browser-blocker.txt` exists, implementation and non-browser tests may proceed, but browser-only QA scenarios are marked `blocked` in `/root/shipinye/evidence/manifest.md`, not passed. Final Verification is blocked without required desktop/mobile/browser artifacts.
- Evidence directory: `/root/shipinye/evidence/`, outside the Discourse checkout and plugin.
- QA URLs: Task 1 records `DISCOURSE_WEB_URL` and `DISCOURSE_API_URL` in `/root/shipinye/evidence/task-1-base-url.txt`. They may be the same only when the selected Discourse dev server/proxy proves it serves both HTML and JSON surfaces.
- Required channels:
  - HTTP: `curl -i "$DISCOURSE_API_URL/videos.json"`
  - Browser: Playwright opens `$DISCOURSE_WEB_URL/videos`
  - Browser mobile viewport: Playwright iPhone/Android viewport

## Execution Strategy

### Parallel Execution Waves
Wave 1: Task 1A checkout/runtime
Wave 2: Task 1B plugin scaffold
Wave 3: Task 1C QA seed foundation and Task 1D browser runtime
Wave 4: Task 2
Wave 5: Task 4
Wave 6: Task 3
Wave 7: Task 5
Wave 8: Task 6
Wave 9: Task 7
Wave 10: Task 8
Wave 11: Task 9

### Dependency Matrix
- Task 1A and 1B block all implementation tasks and establish the Discourse checkout path and plugin source path.
- Task 1C QA seed foundation blocks Task 4 and all later media/feed/browser validation.
- Task 1D browser runtime blocks browser QA portions of Task 5, Task 6, Task 7, Task 8, Task 9, and Final Verification. It also blocks promotion of provider iframes to `renderability: "iframe_candidate"`; when browser runtime is unavailable, backend/service Tasks 2-4 and Task 3 may proceed only with a conservative provider-iframe fallback contract.
- Task 2 depends on Task 1A and Task 1B only, and blocks Task 4, Task 3, Task 5, Task 6.
- Task 3 blocks Task 5, Task 7, Task 8.
- Task 4 blocks Task 3 validation and Task 8 security QA.
- Task 5 blocks Task 6, Task 7, Task 8.
- Task 6 blocks Task 8.
- Task 7 depends on Task 5 and Task 6.
- Task 8 depends on all user-facing behavior.
- Task 9 depends on all code tasks.

## TODOs

- [x] 1. Prepare Discourse Dev Environment, Plugin Scaffold, and QA Seed Foundation

  **What to do**: Starting from the current `/root/shipinye` workspace, split this milestone into four explicit, separately assignable substeps with separate evidence and separate gates. Treat 1A-1D as independent tracked subtasks in the work board even though they share this planning section. **1A checkout/backend runtime**: clone or otherwise place a supported Discourse checkout at `/root/shipinye/discourse`. Default checkout policy: use official `discourse/discourse` branch `tests-passed` unless the user provides a production target version; immediately record `git rev-parse HEAD`, branch name, and `git remote -v` to `/root/shipinye/evidence/task-1-discourse-version.txt`. The resolved commit SHA becomes the pinned implementation target; all later source-contract discovery and tests must use that exact checkout SHA unless the plan is deliberately updated. Bootstrap Discourse backend/test runtime using the checked-out repository's supported development path, defaulting to Docker helper commands if available: install Ruby gems, install JS dependencies needed by tests/build, prepare Postgres/Redis, run database create/migrate/seed for development and test, create deterministic QA admin/member credentials, and start the Rails/API or combined dev server on recorded web/API URLs when available. Capture exact commands and outputs to the evidence files listed below. Record `DISCOURSE_WEB_URL=...` and `DISCOURSE_API_URL=...` in `/root/shipinye/evidence/task-1-base-url.txt`; they may be the same only when a proxy/combined dev server proves it serves both HTML and JSON. If Docker/Postgres/Redis/Ruby/JS backend dependencies cannot be made available after two setup attempts, stop implementation, record `/root/shipinye/evidence/task-1-backend-blocker.txt`, and ask the user for the missing infrastructure decision. **1B plugin scaffold and route coexistence spike**: create the deliverable plugin source at `/root/shipinye/discourse-video-shorts` using Discourse plugin conventions, then symlink it into `/root/shipinye/discourse/plugins/discourse-video-shorts` for dev/test. Include `plugin.rb`, `config/routes.rb`, frontend asset directories, test directories, package/lint config expected by current Discourse plugin tooling, README with install/dev commands, and a minimal enabled setting. Before Task 3 API work, prove a no-op plugin HTML route `/videos` and no-op JSON route `/videos.json` can coexist without shadowing each other in the pinned checkout. **1C QA seed foundation**: before Task 4 starts, add a tiny valid MP4 fixture or generator and automated factories/scripts for native MP4, Bilibili canonical URL, cooked Bilibili iframe, cooked YouTube iframe, cooked Vimeo iframe, private category video, unsupported intended-video URL, and non-video posts. **1D browser runtime**: install/verify Playwright or the checked-out Discourse browser-test path and record browser launch evidence. If browser dependencies cannot be made available after two setup attempts, record `/root/shipinye/evidence/task-1-browser-blocker.txt`; backend/service Tasks 2-4 may proceed, but browser-facing completion criteria in Tasks 5-9 and Final Verification remain blocked until browser runtime is available.

  **Must NOT do**: Do not scaffold a theme component instead of a plugin. Do not make the plugin source live only inside the Discourse clone. Do not add application logic in this task.

  **Parallelization**: Can Parallel: LIMITED | Waves 1-3 | Blocks: 2,3,4,5,6,7,8,9 by substep gate | Blocked By: none

  **References**:
  - External: https://github.com/discourse/discourse-plugin-skeleton - plugin skeleton pattern.
  - External: https://meta.discourse.org/t/topic/391441 - route/API/plugin split pattern.

  **Acceptance Criteria**:
  - [ ] `/root/shipinye/discourse` exists and is a runnable Discourse checkout.
  - [ ] Discourse checkout branch and pinned implementation commit SHA are recorded in `/root/shipinye/evidence/task-1-discourse-version.txt`.
  - [ ] Ruby/Bundler setup command and output are recorded in `/root/shipinye/evidence/task-1-bundle.txt`.
  - [ ] JS dependency setup command and output are recorded in `/root/shipinye/evidence/task-1-js-deps.txt`.
  - [ ] Postgres/Redis readiness, DB create/migrate/seed, and test DB setup are recorded in `/root/shipinye/evidence/task-1-db.txt`.
  - [ ] Deterministic admin/member browser-QA credentials are created and recorded outside git in `/root/shipinye/evidence/task-1-qa-env.txt`; this file must not be committed.
  - [ ] Evidence secrets are outside `/root/shipinye/discourse-video-shorts`; all git staging/commit commands run from `/root/shipinye/discourse-video-shorts`.
  - [ ] If `/root/shipinye` is or becomes a git repo, root `.gitignore` includes `/evidence/`; otherwise commit checks explicitly confirm `/root/shipinye/evidence/` is outside the plugin repo and cannot be staged from plugin commits.
  - [ ] Admin/test user creation or documented factory-only test strategy is recorded in `/root/shipinye/evidence/task-1-users.txt`.
  - [ ] QA server commands and `DISCOURSE_WEB_URL` / `DISCOURSE_API_URL` are recorded in `/root/shipinye/evidence/task-1-base-url.txt`.
  - [ ] Chosen URLs are proven before feature work: `curl -i "$DISCOURSE_WEB_URL"` returns HTML from Discourse and `curl -i "$DISCOURSE_API_URL/session/current.json"` or equivalent pinned-checkout JSON endpoint returns JSON.
  - [ ] Tiny MP4 fixture/generator and seed script/factories exist before Task 4 and are recorded in `/root/shipinye/evidence/task-1-seed-fixtures.txt`.
  - [ ] Backend/runtime blockers after two attempts are recorded in `/root/shipinye/evidence/task-1-backend-blocker.txt`; no plugin implementation tasks proceed until backend runtime is available.
  - [ ] Browser/runtime blockers after two attempts are recorded in `/root/shipinye/evidence/task-1-browser-blocker.txt`; backend/service Tasks 2-4 may proceed, but browser-facing completion criteria remain blocked.
  - [ ] `/root/shipinye/discourse-video-shorts` exists as the deliverable plugin source.
  - [ ] `/root/shipinye/discourse/plugins/discourse-video-shorts` is a symlink to `/root/shipinye/discourse-video-shorts` and is loaded by Discourse.
  - [ ] Plugin boots in a Discourse dev/test instance with no initializer errors.
  - [ ] No-op `/videos` HTML route and `/videos.json` JSON route coexist in the scaffold without shadowing; `/videos?format=json` behavior is recorded for the pinned checkout.
  - [ ] From `/root/shipinye/discourse`, `bundle exec rspec plugins/discourse-video-shorts/spec` exits 0 after scaffold tests.
  - [ ] Frontend lint/test command for plugin assets exits 0.

  **QA Scenarios**:
  ```text
  Scenario: Plugin boot
    Tool: tmux
    Steps: cd /root/shipinye/discourse; start Discourse dev server with plugin installed using recorded DISCOURSE_WEB_URL and DISCOURSE_API_URL; visit root page and a known JSON endpoint.
    Expected: server boots and root page returns 200.
    Evidence: /root/shipinye/evidence/task-1-plugin-boot.txt

  Scenario: Plugin scaffold loaded
    Tool: tmux
    Steps: cd /root/shipinye/discourse; run the scaffold plugin's minimal RSpec/lint checks.
    Expected: plugin loads with no route/API behavior required yet.
    Evidence: /root/shipinye/evidence/task-1-scaffold-checks.txt

  Scenario: Route coexistence scaffold spike
    Tool: HTTP call
    Steps: with scaffold/no-op handlers only, curl -i "$DISCOURSE_WEB_URL/videos", curl -i "$DISCOURSE_API_URL/videos.json", and curl -i "$DISCOURSE_API_URL/videos?format=json".
    Expected: HTML and JSON routes are distinguishable in the pinned checkout; query-param format behavior is recorded before Task 3 API work.
    Evidence: /root/shipinye/evidence/task-1-route-coexistence.txt

  Scenario: Browser runtime gate
    Tool: Browser use
    Steps: launch the selected browser QA tool against DISCOURSE_WEB_URL and capture a smoke screenshot.
    Expected: browser tooling can open a Discourse page, or task-1-browser-blocker.txt records the exact missing dependency without blocking backend/service Tasks 2-4.
    Evidence: /root/shipinye/evidence/task-1-browser-runtime.txt
  ```

  **Suggested Commit**: only if the user requests commits | Message: `feat(plugin): scaffold video shorts plugin` | Files: plugin scaffold

- [x] 2. Add Settings and Source Selection

  **What to do**: Add plugin settings for enabling the feed, source category IDs, source tag names, page size default 20, page size max 50, candidate scan limit default 500/hard max 1000, and optional staff-only debug mode. Source semantics are topic-level: a post is eligible if its topic matches any configured category source OR any configured tag source. Replies inherit their topic's category and tags for source matching. Category matching is exact category only in v1; subcategories are excluded unless a future setting is added. Consider only regular posts for media extraction; exclude small actions and system posts. Closed and archived topics are eligible when visible. Unlisted/private topics are eligible only when the current `Guardian` can see them. If Discourse Tags are disabled, tag filters are ignored and staff empty/debug state explains that tags are unavailable. Invalid, deleted, or inaccessible configured sources are ignored for requester-visible feed selection while valid accessible sources still participate with OR semantics; if no configured source remains usable, responses are empty. Invalid, deleted, or private source settings never leak to anonymous users; staff see a configuration warning naming omitted sources. Define a deterministic cursor source-scope digest input for Task 3: `video_shorts_enabled`, normalized effective category IDs, normalized effective tag names, tag availability, category exact-match semantics, topic-level OR semantics, regular-post-only filter version, and the plugin setting schema/version. Exclude per-request `page_size` and user identity from this source-scope digest; those are validated separately. Task 2 verifies settings and source-selection services directly; endpoint-facing HTTP behavior is tested in Task 3 after `/videos.json` exists.

  **Must NOT do**: Do not duplicate Discourse upload-extension policy. Read core upload settings where needed instead.

  **Parallelization**: Can Parallel: NO | Wave 4 | Blocks: 3,4,5 | Blocked By: 1A,1B

  **References**:
  - External: https://meta.discourse.org/t/does-discourse-support-uploading-videos/200789 - core upload settings.
  - External: https://github.com/discourse/discourse-plugin-skeleton - plugin settings and locale structure.
  - Installed Discourse source: confirm current plugin setting access patterns before implementation.

  **Acceptance Criteria**:
  - [ ] Settings can be read by backend services and later by the Task 3 endpoint.
  - [ ] `video_shorts_enabled` is exposed to the client through the pinned checkout's supported plugin setting/client API mechanism, or the frontend explicitly delegates disabled behavior to backend/not-found routing without reading the setting.
  - [ ] Page size always clamps to max 50; oversized values do not return validation errors.
  - [ ] Candidate scan limit clamps to hard max 1000.
  - [ ] Source-scope digest inputs are documented and deterministic; changing source settings or source semantics changes the digest, while changing request `page_size` does not.
  - [ ] Multiple category/tag sources use OR semantics across configured category IDs and tag names.
  - [ ] Source matching is topic-level; replies inherit topic category/tags.
  - [ ] Category sources do not include subcategories in v1.
  - [ ] Only regular posts are considered for extraction; small actions and system posts are excluded.
  - [ ] Closed/archived visible topics are eligible; unlisted/private topics require current `Guardian` visibility.
  - [ ] Disabled Tags plugin or invalid source settings produce staff-only configuration warnings; invalid/inaccessible sources are ignored while valid accessible sources still return visible items.
  - [ ] If all configured sources are invalid, inaccessible, or unavailable, anonymous-safe empty responses do not reveal private source names.
  - [ ] Anonymous empty state does not reveal private category/tag configuration.
  - [ ] Staff empty state identifies missing/empty source settings.

  **QA Scenarios**:
  ```text
  Scenario: Empty configured source service behavior
    Tool: tmux
    Steps: run settings/source-selection specs as anonymous and staff contexts with no source settings.
    Expected: anonymous-facing service result contains no private config names; staff-facing result includes a configuration warning.
    Evidence: /root/shipinye/evidence/task-2-empty-source-service.txt

  Scenario: Oversized page size
    Tool: tmux
    Steps: run settings/source-selection specs with configured/default/requested page size over 50.
    Expected: resolved page size clamps to 50 for Task 3 endpoint use.
    Evidence: /root/shipinye/evidence/task-2-page-size.txt
  ```

  **Suggested Commit**: only if the user requests commits | Message: `feat(settings): configure video feed sources` | Files: settings, tests

- [x] 3. Implement Permission-Safe Feed Endpoint

  **What to do**: Start with native action contract discovery before freezing `/videos.json`: inspect the pinned Discourse checkout SHA for current like, unlike, bookmark, flag, reply/composer, share/open-topic flows and record exact models/services/API payloads in `/root/shipinye/evidence/task-3-action-contract.txt`. Run a native-action custom-route spike before freezing the contract: when browser/frontend runtime is available, create a temporary minimal `/videos` route/component or promote the Task 1B no-op route into a spike component using a static serialized fixture with the minimum fields expected in the feed contract. Spike files live under `/root/shipinye/discourse-video-shorts/tmp/spikes/native-actions/` or an equivalently ignored test-only spike path recorded in evidence; they must be deleted before Task 3 completion or explicitly promoted into Task 5 production files with the promotion noted in `/root/shipinye/evidence/task-3-native-action-route-spike.txt`. Prove like/unlike, bookmark, flag/report, and reply/composer can be invoked without the full topic-page model context. When browser/frontend runtime is unavailable, perform source-level/service-level discovery and document the extra Discourse store/model/service state the feed contract must provide or preload, while Task 7 browser proof remains blocked. Also consume Task 4B's provider iframe/CSP spike evidence before freezing the contract. If browser runtime and plugin CSP proof are available, the API may distinguish a playable/renderable iframe candidate from a post fallback. If browser runtime is unavailable, freeze a conservative contract where provider iframe media is returned only as `fallback: "post"` with no `embed_url`, and document `/root/shipinye/evidence/task-3-conservative-iframe-contract.txt`; frontend work must not render provider iframes until a later browser/CSP proof updates the contract. Hard gate: write the finalized API contract to `/root/shipinye/discourse-video-shorts/docs/video-feed-contract.md` and update any plan placeholder references before Task 5 starts; no frontend route/model work may begin while the contract is still a placeholder. Then implement `GET /videos.json` returning normalized feed items from configured category/tag sources. Apply `Guardian` checks to topics and posts. Exclude posts only when current Discourse `Guardian` and post-state checks disallow access, including deleted posts, hidden posts where the user lacks permission, whispers where the user lacks permission, private category/group access, and secure upload access. Staff may see any content `Guardian` permits. Native upload URLs must be serialized only through the checked-out Discourse version's current upload URL/security helpers after post visibility is confirmed; extraction descriptors from Task 4A are not serialized directly as final URLs unless they already used those helpers after authorization. Task 3 owns query construction and preloading for everything Task 4A needs: posts, cooked/raw fields, `PostUpload`/`Upload`, topic/category/tag visibility fields, users/avatar data, counts, and current-user action state. Media descriptors include trusted server-side `provider`, `renderability`, and `dedupe_key` fields; the frontend must not infer provider or sandbox policy by reparsing URLs. Provider fallback contract: `provider` always remains the detected source provider for known Bilibili/YouTube/Vimeo/native media, even when `renderability: "fallback"` and no playable URL is emitted; `provider: "unsupported"` is reserved for unknown intended-video URLs that do not match a supported provider. Candidate scan order is `post.created_at DESC, post.id DESC`. Cursor pagination encodes the last scanned candidate `(created_at, post_id)`, not merely the last emitted item, plus the Task 2 source-scope digest. For each page, keep scanning candidates until `page_size` emitted feed items are returned, there are no more candidates, or the candidate scan limit is reached. Emitted feed items include playable videos, known-provider fallback descriptors, and unknown intended-video fallbacks with `provider: "unsupported"`; non-video and inaccessible posts are skipped. Dedupe duplicate `media.dedupe_key` values within the response page after extraction. If the limit is reached before EOF, return `scan_limit_reached: true` and `next_cursor` after the last scanned candidate. Cursor pagination only; no offset pagination for long feeds. Query validation contract: non-integer, missing, or `page_size <= 0` falls back to default 20; oversized `page_size` clamps to 50; non-integer, missing, or `scan_limit <= 0` falls back to the configured default; oversized `scan_limit` clamps to 1000. Malformed, expired, tampered, user-identity-mismatched, or source-setting-version-mismatched cursors return a documented 400 JSON error without running a feed scan. Cursor identity is `current_user.id` for logged-in users and an anonymous-safe public scope for anonymous users, unless the pinned checkout exposes a stable anonymous identity suitable for signed cursors. Cursors are not bound to a snapshot of item authorization results; if a user loses access between pages, pagination continues from the cursor and newly inaccessible items are omitted.

  **Conceptual response-level data contract placeholder to replace during Task 3 before Task 5 starts**:
  ```json
  {
    "items": [
      {
        "topic_id": 123,
        "post_id": 456,
        "post_number": 2,
        "topic_url": "/t/title/123/1",
        "post_url": "/t/title/123/2",
        "display": "title, excerpt, username, avatar, timestamps",
        "counts": "like and reply counts using exact Discourse field names",
        "native_action_state": "exact like/bookmark/flag/reply/share fields discovered from checked-out Discourse source",
        "media": "provider, renderability, dedupe_key, safe video_url or embed_url when available, fallback fields, thumbnail/duration when available"
      }
    ],
    "next_cursor": "opaque string or null",
    "scan_limit_reached": false
  }
  ```

  **Must NOT do**: Do not expose raw upload/provider URLs from posts the user cannot access. Do not serialize cooked HTML wholesale as the primary data contract.

  **Parallelization**: Can Parallel: NO | Wave 6 | Blocks: 5,7,8 | Blocked By: 1A,1B,1C,2,4

  **References**:
  - External: https://docs.discourse.org/ - Discourse JSON/API conventions.
  - External: https://meta.discourse.org/t/topic/391441 - controller/route pattern.

  **Acceptance Criteria**:
  - [ ] Anonymous request returns only public visible videos.
  - [ ] Logged-in request returns only videos visible to that user.
  - [ ] Staff request can include staff-visible content where current Discourse `Guardian` permits.
  - [ ] Private category videos are absent for anonymous/non-member users.
  - [ ] Deleted posts, hidden posts, whispers, private category/group posts, and secure uploads are absent for users not authorized by current Discourse `Guardian` and post-state checks.
  - [ ] Endpoint avoids N+1 queries for topic/post/user/category/tag stats.
  - [ ] Endpoint preloads all associations/media fields required by extraction and serialization; Task 4A remains a pure per-post service and does not issue candidate queries.
  - [ ] Query-count specs cover mixed native upload, cooked iframe, unsupported fallback, and sparse-feed pages.
  - [ ] Items are sorted by `post.created_at DESC, post.id DESC`, and pagination preserves that order without duplicates.
  - [ ] Pagination scans past non-video and inaccessible candidates until `page_size` emitted items or EOF.
  - [ ] Known-provider fallbacks keep their detected `provider` with `renderability: "fallback"`; only unknown intended-video URLs use `provider: "unsupported"`. Both count toward `page_size`.
  - [ ] Duplicate `media.dedupe_key` values within one response page appear only once.
  - [ ] Cross-page duplicate media in different posts is allowed in v1 and documented as a non-goal unless persistent indexing is added later.
  - [ ] Pagination stops at the candidate scan limit and returns `scan_limit_reached: true` when more candidates may exist.
  - [ ] Partial pages are accepted when `scan_limit_reached=true`; frontend pagination can request `next_cursor` to continue filling the experience.
  - [ ] `next_cursor` resumes after the last scanned candidate and cannot repeat or skip valid emitted items.
  - [ ] Invalid query inputs follow the contract: `page_size` and `scan_limit` lower-bound/non-integer cases default safely, upper-bound cases clamp, and invalid cursors return documented 400 JSON instead of 500 or empty-loop pagination.
  - [ ] Cursor token includes enough signed/opaque context to reject tampered cursors and cursors from incompatible source-setting versions or logged-in requester identity context, without binding to a stale authorization snapshot.
  - [ ] Cursor source-scope digest uses Task 2's deterministic digest inputs; source setting changes invalidate old cursors, but page size changes do not.
  - [ ] Anonymous cursors use an anonymous-safe public scope, not an unstable browser session, unless the pinned checkout provides a stable anonymous identifier.
  - [ ] If access changes between pages, a previously valid cursor still advances from the last scanned candidate and newly inaccessible items are omitted rather than causing a cursor-context 400.
  - [ ] Data contract includes current-user action state needed by native Discourse APIs, with exact field names mapped in `/root/shipinye/evidence/task-3-action-contract.txt`.
  - [ ] Native-action custom-route spike proves like/unlike, bookmark, flag/report, and reply/composer can work from `/videos` using feed contract data, or the contract includes the additional initialized Discourse model/service state required.
  - [ ] Native-action spike files are either deleted from the ignored spike path before Task 3 completion or explicitly promoted into Task 5 production files with evidence.
  - [ ] Data contract includes exact media renderability/fallback shape. With browser/CSP proof, the frontend can tell `renderability: "iframe_candidate"` from `fallback: "post"`; without browser/CSP proof, all provider iframe media is fallback-only and no `embed_url` is serialized.
  - [ ] Data contract includes trusted media `provider`, `renderability`, and `dedupe_key` fields; frontend iframe sandbox selection uses provider/renderability enums, never URL parsing.
  - [ ] `/root/shipinye/discourse-video-shorts/docs/video-feed-contract.md` contains the finalized exact API contract before Task 5 starts.
  - [ ] Conceptual JSON placeholder references are either updated or superseded by `docs/video-feed-contract.md` before Task 5 starts.
  - [ ] Data contract includes `post_number`; `post_url` is generated as the canonical Discourse URL for the exact post, not merely the topic OP.
  - [ ] Secure uploads/private category attachments are serialized only through current Discourse upload URL/security helpers, and unauthorized requests never receive usable upload URLs.
  - [ ] Backend route guard for `video_shorts_enabled=false` records the pinned checkout's exact disabled JSON status/body in `/root/shipinye/evidence/task-3-disabled-contract.txt` and tests that exact behavior for `/videos.json`.
  - [ ] Disabled HTML behavior is explicit for `/videos`: the plugin shows Discourse's native not-found/unknown route result with no redirect and no `.video-shorts-*` feed DOM; Task 5 tests this exact outcome.
  - [ ] Routing strategy is explicit: declare JSON route before HTML route, constrain JSON to extension/request format where the pinned checkout supports it, constrain HTML/Ember route to HTML, and ensure `/videos` and `/videos.json` do not shadow each other.
  - [ ] Request specs document actual pinned-checkout behavior for `/videos?format=json`; if Rails treats it as a normal query param, native HTML behavior is acceptable as long as `/videos.json` remains the JSON endpoint.
  - [ ] Sparse feeds do not require a v1 cache/index; document partial-page behavior when `scan_limit_reached=true` and reserve indexing as a future optimization.

  **QA Scenarios**:
  ```text
  Scenario: Public feed happy path
    Tool: HTTP call
    Steps: seed one public topic with uploaded MP4 and run curl -i "$DISCOURSE_API_URL/videos.json"
    Expected: HTTP 200 with one item containing topic_id, post_id, provider native, and video_url.
    Evidence: /root/shipinye/evidence/task-3-public-feed.txt

  Scenario: Empty configured source over endpoint
    Tool: HTTP call
    Steps: curl -i "$DISCOURSE_API_URL/videos.json" as anonymous with no source settings after Task 3 endpoint exists.
    Expected: 200 JSON with empty items and no private config names.
    Evidence: /root/shipinye/evidence/task-3-empty-anonymous.txt

  Scenario: Private feed exclusion
    Tool: HTTP call
    Steps: seed one private category topic with video; curl anonymously.
    Expected: HTTP 200 and private topic/post absent.
    Evidence: /root/shipinye/evidence/task-3-private-exclusion.txt

  Scenario: Secure upload URL exclusion
    Tool: HTTP call
    Steps: enable secure upload behavior if available, seed private category post with uploaded MP4, curl anonymously and as unauthorized user.
    Expected: item is absent and no usable upload URL is serialized.
    Evidence: /root/shipinye/evidence/task-3-secure-upload.txt

  Scenario: Route format separation
    Tool: HTTP call
    Steps: verify Task 1 route coexistence evidence, then curl -i "$DISCOURSE_WEB_URL/videos"; curl -i "$DISCOURSE_API_URL/videos.json"; curl -i "$DISCOURSE_API_URL/videos?format=json"
    Expected: /videos returns HTML route, /videos.json returns JSON endpoint, and /videos?format=json follows documented pinned-checkout request.format behavior without shadowing /videos.json.
    Evidence: /root/shipinye/evidence/task-3-route-format.txt

  Scenario: Backend setting disabled
    Tool: HTTP call
    Steps: set video_shorts_enabled=false and curl -i "$DISCOURSE_API_URL/videos.json"
    Expected: record the exact pinned-checkout disabled JSON status/body/headers, then make the request spec assert that same contract and no feed JSON.
    Evidence: /root/shipinye/evidence/task-3-disabled-contract.txt

  Scenario: Sparse feed benchmark
    Tool: HTTP call
    Steps: seed exactly 1000 matching visible posts ordered by `post.created_at DESC, post.id DESC`, with exactly one valid video at candidate positions 1, 51, 101, 151, 201, 251, 301, 351, 401, and 451 in the first 500 scanned candidates, then another deterministic set in the next 500; curl first and second pages with page_size=20 and default scan limit 500.
    Expected: first page returns exactly 10 items with scan_limit_reached=true and next_cursor after candidate 500; second page resumes after candidate 500 and returns the next deterministic set without duplicates; endpoint avoids N+1 queries.
    Evidence: /root/shipinye/evidence/task-3-sparse-benchmark.txt

  Scenario: Invalid query and cursor handling
    Tool: HTTP call
    Steps: curl /videos.json with page_size=0, page_size=abc, page_size=500, scan_limit=0, scan_limit=abc, scan_limit=5000, malformed cursor, tampered cursor, logged-in cursor from another user, anonymous cursor under the public anonymous scope, cursor from incompatible source settings, and a valid cursor after access revocation.
    Expected: page_size/scan_limit cases default or clamp as documented; malformed/tampered/identity-or-source-mismatched cursor cases return documented 400 JSON; valid cursor after access revocation continues pagination while omitting newly inaccessible items; no request returns 500 or repeats the same cursor indefinitely.
    Evidence: /root/shipinye/evidence/task-3-query-validation.txt

  Scenario: Source-scope cursor digest
    Tool: HTTP call
    Steps: create a cursor, change configured category/tag source settings, retry the cursor, then separately retry after only changing page_size.
    Expected: source-setting changes return documented cursor 400; page_size-only changes do not invalidate an otherwise valid cursor.
    Evidence: /root/shipinye/evidence/task-3-cursor-scope-digest.txt

  Scenario: Native actions from custom route spike
    Tool: Browser use when available; otherwise source/service-level discovery
    Steps: before freezing docs/video-feed-contract.md, create a temporary route/component or promote the no-op scaffold route with one static serialized fixture item, then invoke like/unlike, bookmark, flag/report, and reply/composer using only feed-provided data plus documented Discourse services. If browser/frontend runtime is unavailable, inspect source/service contracts and run non-browser tests where possible.
    Expected: actions work without full topic-page model context, or evidence names the extra model/service fields that the feed contract must include; spike files under the ignored spike path are either discarded or explicitly promoted into Task 5; browser-facing proof remains a Task 7 blocker when browser runtime is unavailable.
    Evidence: /root/shipinye/evidence/task-3-native-action-route-spike.txt

  Scenario: Mixed media query-count guard
    Tool: tmux
    Steps: seed native upload, Bilibili cooked iframe, YouTube embed iframe, Vimeo embed iframe, unsupported intended-video post, and sparse non-video candidates; run request specs with query counting enabled.
    Expected: endpoint preloads extraction/serialization associations and avoids N+1 growth across mixed media and sparse-feed pages.
    Evidence: /root/shipinye/evidence/task-3-query-count.txt

  Scenario: Disabled JSON contract
    Tool: HTTP call
    Steps: set video_shorts_enabled=false and curl -i "$DISCOURSE_API_URL/videos.json"; record status, headers, and body.
    Expected: behavior matches the exact pinned-checkout disabled JSON contract recorded in /root/shipinye/evidence/task-3-disabled-contract.txt.
    Evidence: /root/shipinye/evidence/task-3-disabled-json.txt

  Scenario: Contract freezes provider renderability
    Tool: tmux
    Steps: if browser runtime exists, verify /root/shipinye/evidence/task-4-provider-iframe-spike.txt and /root/shipinye/evidence/task-4-plugin-csp-spike.txt exist, then write docs/video-feed-contract.md and run request specs for iframe candidate and fallback media descriptors. If browser runtime is unavailable, write the conservative fallback-only provider iframe contract and run request specs proving no provider embed_url is serialized.
    Expected: contract either explicitly represents renderable iframe candidates separately from post fallbacks after plugin-level CSP proof, or explicitly marks provider iframes fallback-only until browser/CSP proof is added.
    Evidence: /root/shipinye/evidence/task-3-renderability-contract.txt
  ```

  **Suggested Commit**: only if the user requests commits | Message: `feat(api): expose permission-safe video feed` | Files: backend endpoint/service/tests

- [x] 4. Implement Media Extraction

  **What to do**: Split this milestone into two separately tracked subtasks. **4A Media extraction**: build a pure per-post server-side extraction service, e.g. `extract_media_for_visible_post(post, guardian)`, that receives one already-visible candidate post and returns zero or one normalized media descriptor. Start with a discovery note for the pinned checkout covering where media data lives and which associations Task 3 must preload before calling extraction. Preference order: native uploads through Discourse `PostUpload`/`Upload` associations and upload helpers first; provider URLs from raw/cooked content parsed with structured URL/HTML parsers second; already-cooked iframes parsed and revalidated third. Media precedence within a single visible post is: native uploaded video descriptor first, canonical Bilibili descriptor second, YouTube/Vimeo descriptor third, unsupported intended-video marker last. Every non-nil descriptor must include a server-produced `dedupe_key`: native upload `native:upload:{upload_id}`, Bilibili `bilibili:{bvid}:page:{page}`, YouTube/Vimeo `provider:{provider_id_or_normalized_embed_path}`, and unsupported intended video `unsupported:{normalized_url_or_content_hash}`. Known providers always keep their provider enum even when unsafe/unrenderable; unknown intended-video URLs use `provider: "unsupported"`. Do not query candidate posts, paginate, apply response-page dedupe, own cursor behavior, generate canonical post URLs, or serialize final secure upload URLs in 4A; Task 3 owns those responsibilities and preloads the post/upload/topic/user fields extraction requires. Native upload extraction returns upload identifiers/descriptors sufficient for Task 3 to serialize through Discourse security helpers after authorization. Non-video posts return no media descriptor. Posts that clearly contain known-provider video media but cannot be safely rendered return the detected provider with `renderability: "fallback"`, `fallback: "post"`, and `fallback_reason`; unknown intended-video media returns `provider: "unsupported"` with the same fallback shape. Neither shape includes serialized `post_url`. **4B Provider/CSP renderability spike**: when browser runtime is available before Task 3, run a disposable spike proving the exact allowlisted iframe hosts can be added through the pinned checkout's plugin CSP hook/API and accepted by a browser without modifying Discourse core. 4B may leave behind only documented evidence, or it may promote minimal CSP hook code into plugin source if that code is production-ready and covered by Task 6 tests; the choice must be recorded in `/root/shipinye/evidence/task-4-plugin-csp-spike.txt`. Task 6 owns the permanent UI/CSP integration and must re-prove provider iframe behavior after real UI code lands. When browser runtime is unavailable, skip iframe promotion and require Task 3 to freeze the conservative fallback-only provider iframe contract. Task 3 is blocked by 4A for all media contracts and by 4B only when freezing an iframe-capable contract.

  **Bilibili v1 support**:
  - `https://www.bilibili.com/video/BV...`
  - `https://bilibili.com/video/BV...`
  - already-cooked iframe/player embeds from allowed Discourse rendering
  - Defer `b23.tv` short links.

  **Bilibili transform contract**:
  - Accept URL host `www.bilibili.com` or `bilibili.com`.
  - Strip inbound query parameters and fragments before path validation.
  - Accept path shape `/video/{bvid}` with optional trailing slash only.
  - Validate `{bvid}` against `^BV[0-9A-Za-z]{10}$`.
  - Generate embed URL exactly as `https://player.bilibili.com/player.html?bvid={bvid}&page=1`.
  - If host validation fails, this is not a Bilibili match and extraction continues to other providers or returns nil/unsupported according to the post content.
  - If host is valid but path or BVID validation fails, return provider `bilibili` with `fallback: "post"`, `fallback_reason`, and no `embed_url`.

  **Cooked Bilibili iframe contract**:
  - Accept only HTTPS `player.bilibili.com/player.html`.
  - Accept query param `bvid` only when it matches `^BV[0-9A-Za-z]{10}$`.
  - Accept optional `page` only when it is a positive integer; default missing or invalid `page` to `1`.
  - Strip every other inbound query parameter and all fragments.
  - Normalize emitted embed URL exactly as `https://player.bilibili.com/player.html?bvid={bvid}&page={page_or_1}`.
  - `aid`/`cid`-only cooked iframes are not playable Bilibili embeds in v1 unless the same iframe URL also contains a valid `bvid`; otherwise return provider `bilibili` with `fallback: "post"`, `fallback_reason`, and no `embed_url`.

  **YouTube/Vimeo v1 contract**:
  - YouTube and Vimeo are v1-supported only as already-cooked allowlisted iframe embeds. Do not transform raw YouTube watch URLs, YouTube Shorts URLs, youtu.be URLs, Vimeo page URLs, or arbitrary provider page URLs in v1.
  - Accept only HTTPS already-cooked iframe URLs with host/path shape `www.youtube.com/embed/{id}`, `www.youtube-nocookie.com/embed/{id}`, or `player.vimeo.com/video/{id}`.
  - Revalidate every cooked iframe with a structured URL parser; non-allowlisted host/path, non-HTTPS URL, missing ID, or arbitrary iframe source returns provider-specific `fallback: "post"` with no `embed_url`.
  - Preserve only the normalized HTTPS iframe URL needed for rendering. Provider tracking/query data is stripped unless the pinned checkout's provider iframe compatibility spike proves a specific parameter is required and documents it in `/root/shipinye/evidence/task-4-provider-iframe-spike.txt`.

  **Unsupported intended-video v1 contract**:
  - Unknown intended-video fallback is emitted only for raw/cooked text or anchor URLs parsed with structured URL/HTML parsers, where the URL scheme is `http` or `https`, the host is not one of the supported provider hosts above, and the path basename ends with `.mp4`, `.webm`, `.mov`, or `.m4v` case-insensitively.
  - Strip query parameters and fragments before extension matching and dedupe-key generation. The `dedupe_key` is `unsupported:{sha256(normalized_scheme_host_path)}` so it never exposes private content or signed URL data.
  - The deterministic QA fixture for this rule is `https://example.invalid/videos/unsupported-sample.mp4`.
  - Do not classify arbitrary links, generic `/video/` paths, images, audio, documents, data/javascript/blob URLs, or arbitrary iframes as unsupported intended-video in v1.
  - Raw YouTube/Vimeo page URLs are known-provider but unrenderable in v1 and use provider-specific fallback semantics, not `provider: "unsupported"`.

  **Iframe safety rule**: Only emit an HTTPS `embed_url` when the provider is matched by this exact host allowlist and the resulting URL is generated by trusted extraction rules for that provider: `player.bilibili.com`, `www.youtube.com`, `www.youtube-nocookie.com`, `player.vimeo.com`. Do not allow apex `youtube.com` as an emitted embed host. Already-cooked iframes must still be revalidated against the same allowlist. Do not serialize arbitrary iframe sources. If a provider URL cannot be transformed safely, return its provider with `fallback: "post"`, `fallback_reason`, and no iframe `embed_url`; Task 3 serializes any final `post_url`.

  **Must NOT do**: Do not perform arbitrary remote expansion of short links in v1. Do not trust client-side parsing for security.

  **Parallelization**: Can Parallel: NO | Wave 5 | Blocks: 3,5,8 | Blocked By: 1A,1B,1C,2

  **References**:
  - External: https://meta.discourse.org/t/insert-video/147651 - source/poster/subtitle video markup patterns.
  - External: https://meta.discourse.org/t/control-user-s-ability-to-use-access-to-iframe-how/277327/8 - onebox/iframe distinction.

  **Acceptance Criteria**:
  - [ ] Native uploaded MP4/webm in post becomes provider `native` with upload descriptor/identifier, not an unauthorized raw final URL.
  - [ ] Every extracted descriptor includes stable server-produced `dedupe_key` according to the v1 provider rules.
  - [ ] Extraction discovery records the pinned checkout's media sources and helper APIs before implementation.
  - [ ] Canonical Bilibili link becomes provider `bilibili`.
  - [ ] Already-rendered Bilibili iframe becomes provider `bilibili`.
  - [ ] YouTube/Vimeo onebox/embed becomes provider `youtube` or `vimeo` only when its embed host is allowlisted.
  - [ ] Non-video posts are absent from the feed.
  - [ ] Intended but unsafe/unrenderable known-provider media keeps its detected provider with fallback descriptor only; unknown intended-video media uses provider `unsupported`; Task 3 serializes final `post_url`.
  - [ ] Duplicate embeds from the same post do not create multiple feed items.
  - [ ] Duplicate media in one response page is deduped by Task 3 using `media.dedupe_key`, not signed URLs or client URL parsing.
  - [ ] Extraction discovery names the exact preloaded associations/fields Task 3 must provide, including upload associations, cooked/raw post fields, topic/category/tag fields, and any provider iframe data source.
  - [ ] Extraction service does not query posts or implement cursor/page behavior.
  - [ ] Bilibili canonical URLs follow the exact transform contract and strip inbound query/fragment data.
  - [ ] Bilibili negative tests cover bad host, bad BVID, query/fragment stripping, and non-HTTPS iframe rejection.
  - [ ] Cooked Bilibili iframe tests cover valid `bvid`/`page`, missing page defaulting to `1`, invalid extra params stripped, `aid`/`cid`-only fallback, and invalid BVID fallback.
  - [ ] Bad Bilibili host is not classified as provider `bilibili`.
  - [ ] Canonical Bilibili links never produce arbitrary iframe URLs; unsafe or unknown transforms return fallback descriptor only.
  - [ ] YouTube/Vimeo raw page URLs are not transformed in v1 and return provider-specific fallback or nil according to post intent; they do not use `provider: "unsupported"`.
  - [ ] YouTube/Vimeo already-cooked iframe tests cover accepted embed host/path shapes and rejection of page URLs, short URLs, apex `youtube.com`, non-HTTPS URLs, and arbitrary iframe sources.
  - [ ] Unsupported intended-video tests cover the exact extension-based rule, the `example.invalid` fixture, query/fragment stripping, and rejection of arbitrary links, generic `/video/` paths, images, audio, documents, data/javascript/blob URLs, and arbitrary iframes.
  - [ ] Minimal provider iframe compatibility spike runs before Task 3 freezes `docs/video-feed-contract.md` when browser runtime is available; otherwise Task 3 uses the conservative fallback-only provider iframe contract.
  - [ ] Minimal plugin CSP spike proves exact provider iframe hosts can be permitted from plugin code before Task 3 freezes `docs/video-feed-contract.md` when browser runtime is available; evidence records whether spike code was discarded or promoted. If plugin CSP extension fails, Task 3 uses fallback-only provider iframe media and records the limitation instead of modifying core.
  - [ ] Provider iframe hosts are exactly allowlisted and revalidated before serialization.
  - [ ] Non-HTTPS embed URLs are rejected and return fallback descriptor only; Task 3 serializes any final `post_url`.

  **QA Scenarios**:
  ```text
  Scenario: Bilibili canonical link extraction
    Tool: tmux
    Steps: run service-level RSpec for extract_media_for_visible_post with https://www.bilibili.com/video/BV1Q541167Qg; assert the BVID matches ^BV[0-9A-Za-z]{10}$.
    Expected: descriptor has provider bilibili and either an allowlisted player.bilibili.com embed_url or fallback descriptor only.
    Evidence: /root/shipinye/evidence/task-4-bilibili-link.txt

  Scenario: Bilibili negative transforms
    Tool: tmux
    Steps: run service-level RSpec for bad host, bad BVID, query/fragment canonical URL, and non-HTTPS cooked iframe cases.
    Expected: only valid canonical/query-fragment-stripped BVID transforms to allowlisted HTTPS player URL; bad host is not provider bilibili; invalid BVID on valid host returns fallback descriptor without embed_url.
    Evidence: /root/shipinye/evidence/task-4-bilibili-negative.txt

  Scenario: Cooked Bilibili iframe contract
    Tool: tmux
    Steps: run service-level RSpec for HTTPS player iframe with valid bvid/page, missing page, extra params, aid/cid-only, and invalid bvid.
    Expected: valid bvid normalizes to exact player URL with page; extra params/fragments are stripped; aid/cid-only and invalid bvid return Bilibili fallback descriptors without embed_url.
    Evidence: /root/shipinye/evidence/task-4-bilibili-cooked-iframe.txt

  Scenario: YouTube and Vimeo v1 iframe-only support
    Tool: tmux
    Steps: run service-level RSpec for already-cooked YouTube/Vimeo embed iframes and raw provider page URLs.
    Expected: only HTTPS allowlisted embed iframe host/path shapes become provider youtube/vimeo descriptors; raw watch/short/page URLs and arbitrary iframes are not transformed into playable embeds.
    Evidence: /root/shipinye/evidence/task-4-youtube-vimeo-contract.txt

  Scenario: Provider iframe compatibility spike before contract freeze
    Tool: tmux
    Steps: run service-level and minimal browser/component checks for Bilibili cooked iframe, YouTube embed iframe, Vimeo embed iframe, and unsupported fallback before Task 3 writes docs/video-feed-contract.md.
    Expected: descriptor shape records renderability as iframe_candidate or fallback post; evidence exists before Task 3 contract freeze.
    Evidence: /root/shipinye/evidence/task-4-provider-iframe-spike.txt

  Scenario: Plugin CSP feasibility spike before contract freeze
    Tool: Browser use
    Steps: from the plugin only, add the exact allowed provider frame hosts through the pinned checkout's plugin CSP hook/API; open a minimal plugin-rendered page or test fixture with Bilibili, YouTube, and Vimeo iframe candidates.
    Expected: browser accepts the plugin-provided frame-src/equivalent policy for exact allowlisted hosts; no Discourse core file changes are required. Evidence states whether CSP spike code is discarded or promoted. If browser runtime or plugin CSP extension is unavailable, record the limitation and require Task 3 to freeze fallback-only provider iframe media.
    Evidence: /root/shipinye/evidence/task-4-plugin-csp-spike.txt

  Scenario: Unsupported media fallback
    Tool: tmux
    Steps: run service-level RSpec with non-video post, unsafe known-provider post, `https://example.invalid/videos/unsupported-sample.mp4`, and rejected non-video URL shapes.
    Expected: non-video post returns nil descriptor; unsafe known-provider video keeps its detected provider with fallback descriptor and no playable URL; the `example.invalid` fixture returns provider unsupported with extension-based dedupe key and no playable URL; arbitrary links/iframes/images/audio/documents are rejected.
    Evidence: /root/shipinye/evidence/task-4-unsupported.txt
  ```

  **Suggested Commit**: only if the user requests commits | Message: `feat(extraction): normalize post videos for feed` | Files: extraction service/tests

- [x] 5. Add Frontend Route and Feed Model

  **What to do**: Register `/videos` frontend route. Route model fetches `/videos.json`, handles loading/error/empty states, cursor pagination, partial-page continuation, and login-aware action availability from the data contract. When the API returns fewer than the requested page size with `scan_limit_reached=true` and `next_cursor`, continue fetching additional pages until the initial viewport/preload window has enough items or no cursor remains, capped at 3 automatic continuation requests or 1500 ms of continuation time, whichever comes first; after the cap, render available items plus a continuation/loading affordance. For `video_shorts_enabled=false`, implement explicit disabled HTML behavior: `/videos` shows Discourse's native not-found/unknown route result with no redirect and no `.video-shorts-*` feed DOM. Do not invent a custom disabled screen.

  **Browser-block rule**: If `task-1-browser-blocker.txt` exists, complete route/model implementation with QUnit/source-level tests where possible, mark browser QA scenarios in this task as `blocked` in `evidence/manifest.md`, and do not count them as passed.

  **Must NOT do**: Do not fetch arbitrary topic HTML and parse it in the browser.

  **Parallelization**: Can Parallel: NO | Wave 7 | Blocks: 6,7,8 | Blocked By: 1A,1B,1C,3,4

  **References**:
  - External: https://meta.discourse.org/t/topic/391441 - frontend route map and route model pattern.
  - External: https://github.com/discourse/discourse-plugin-skeleton - plugin frontend asset structure.
  - Installed Discourse source: confirm current plugin route-map, route, and `.gjs` route template conventions before implementation.

  **Acceptance Criteria**:
  - [ ] `/videos` loads feed items from `/videos.json`.
  - [ ] Network error shows retry without losing current visible item.
  - [ ] Empty anonymous state does not expose private config.
  - [ ] Empty staff state gives configuration hint.
  - [ ] Cursor pagination appends items without duplicating existing posts.
  - [ ] Partial API pages continue automatically when `scan_limit_reached=true` and `next_cursor` exists, until the initial viewport/preload window is filled, pagination reaches EOF, or the auto-continuation cap is reached.
  - [ ] Initial automatic partial-page continuation is capped at 3 requests or 1500 ms; if still underfilled, UI renders available items and a continuation affordance instead of blocking first render indefinitely.
  - [ ] Frontend route guard for `video_shorts_enabled=false` shows native not-found/unknown route behavior, with no redirect and no `.video-shorts-*` feed DOM mounted.

  **QA Scenarios**:
  ```text
  Scenario: Route happy path
    Tool: Browser use
    Steps: Playwright opens $DISCOURSE_WEB_URL/videos with seeded public video.
    Expected: feed renders first video title and player.
    Evidence: /root/shipinye/evidence/task-5-route-happy.png

  Scenario: API failure retry
    Tool: Browser use
    Steps: mock /videos.json 500, open /videos, click Retry after restoring endpoint.
    Expected: error state appears, retry loads feed.
    Evidence: /root/shipinye/evidence/task-5-retry.png

  Scenario: Partial page continuation
    Tool: Browser use
    Steps: mock or seed /videos.json so the first response returns fewer than page_size items with scan_limit_reached=true and next_cursor, then open /videos.
    Expected: route/model requests the next cursor automatically up to the 3-request/1500 ms cap; the feed fills the initial viewport/preload window when possible, otherwise renders available items with a continuation affordance.
    Evidence: /root/shipinye/evidence/task-5-partial-page-continuation.txt

  Scenario: Frontend setting disabled
    Tool: Browser use
    Steps: set video_shorts_enabled=false and open "$DISCOURSE_WEB_URL/videos".
    Expected: Discourse native not-found/unknown route result appears, there is no redirect, and no `.video-shorts-*` feed DOM mounts.
    Evidence: /root/shipinye/evidence/task-5-disabled-html.png
  ```

  **Suggested Commit**: only if the user requests commits | Message: `feat(route): add videos feed route` | Files: frontend route/model/tests

- [x] 6. Build Shorts-Style Player UI

  **What to do**: Create Glimmer components for feed, feed item, native player, allowlisted iframe embed player, action rail, metadata, and state overlays. Mobile uses full viewport scroll snap. Desktop centers 9:16 player and places metadata/actions beside it. Use BEM SCSS. Respect safe-area insets. Use muted autoplay for native video. Pause offscreen native videos. For iframe providers, fallback-only topic rendering is the default unless Task 3's finalized contract includes trusted server-side `provider` and `renderability: "iframe_candidate"` enums and the item has an allowlisted `embed_url` backed by provider-specific sandbox/CSP evidence. When Task 3 froze the conservative fallback-only contract or an item lacks `embed_url`, render the labeled topic fallback only. Iframe default attributes are HTTPS `src`, descriptive `title`, `loading="lazy"`, `allowfullscreen`, `referrerpolicy="strict-origin-when-cross-origin"`, sandbox baseline `allow-scripts allow-presentation` without `allow-same-origin` unless required, and `allow="autoplay; fullscreen; picture-in-picture; encrypted-media"`. Treat `allow-same-origin` as an expected provider-specific decision point for Bilibili, YouTube, and Vimeo: each provider must either keep the stricter baseline and prove safe rendering/fallback, or add `allow-same-origin` only for that provider after a compatibility failure proves it is required and the risk/justification is recorded. Provider-specific deviations from defaults are allowed only when documented and tested. Run provider compatibility tests for Bilibili, YouTube, and Vimeo when iframe_candidate support is in the finalized contract; these verify iframe element rendering, safe attributes, Discourse CSP allowance, and fallback behavior, not guaranteed remote provider playback. If a provider fails only because of sandbox restrictions, adjust that provider's sandbox attributes to the narrowest documented working set and record the justification in `/root/shipinye/evidence/task-6-iframe-compat.txt`; if the provider remains incompatible, render the post fallback for that provider instead of weakening sandbox globally. Extend Discourse CSP through the pinned checkout's plugin CSP hook/API only, for exact allowlisted iframe hosts only, including `frame-src` or the current checked-out Discourse equivalent directive. If CSP cannot be extended from the plugin without core edits, use the fallback-only provider iframe contract; do not modify Discourse core.

  **Browser-block rule**: If `task-1-browser-blocker.txt` exists, complete component/source/QUnit checks where possible, mark browser screenshots/DOM media scenarios as `blocked` in `evidence/manifest.md`, and do not count them as passed.

  **Must NOT do**: Do not claim full playback control for provider iframes. Do not put explanatory marketing text in the app surface.

  **Parallelization**: Can Parallel: NO | Wave 8 | Blocks: 7,8 | Blocked By: 5

  **References**:
  - External: https://github.com/discourse/discourse-plugin-skeleton - plugin asset and stylesheet placement.
  - Installed Discourse source: follow existing plugin `.gjs` component, stylesheet, icon, and acceptance-test conventions.
  - Local: `/root/.codex/plugins/cache/sisyphuslabs/omo/0.1.0/skills/frontend-ui-ux/SKILL.md` - UI polish/accessibility guidance.

  **Acceptance Criteria**:
  - [ ] Mobile viewport displays one active 9:16 video item without controls overlapping safe areas.
  - [ ] Desktop preserves vertical video format and keeps actions visible.
  - [ ] Native videos autoplay muted when allowed and show play overlay if blocked.
  - [ ] Scrolling to next item pauses previous native video.
  - [ ] `prefers-reduced-motion` disables non-essential motion.
  - [ ] Long titles wrap without covering action controls.
  - [ ] Mounted iframes have descriptive `title` and visible "open topic" fallback.
  - [ ] If the finalized feed contract is fallback-only for provider iframes, provider items render only the topic fallback and no iframe element is mounted.
  - [ ] Iframes include default safe attributes or documented provider-specific deviations, and never render non-allowlisted or non-HTTPS `src` values.
  - [ ] For each iframe provider, tests document one of two outcomes: strict sandbox works/falls back safely, or provider-specific `allow-same-origin` is required and narrowly applied with evidence.
  - [ ] Fallback-only provider rendering remains the default until each provider has exact sandbox/CSP evidence for iframe rendering.
  - [ ] Frontend sandbox policy uses trusted `media.provider` and `media.renderability` enums from the API contract; it never chooses iframe sandbox attributes by parsing `embed_url`.
  - [ ] Provider iframe compatibility for Bilibili, YouTube, and Vimeo is tested and documented for DOM attributes, CSP allowance, and fallback behavior; remote provider playback failures are recorded separately and do not fail plugin correctness unless caused by plugin CSP/attributes.
  - [ ] Discourse CSP permits only the exact allowlisted provider iframe hosts needed for rendered embeds.
  - [ ] CSP extension uses plugin APIs only; no Discourse core file is modified for CSP.
  - [ ] UI shows a continuation/loading state instead of an underfilled empty-looking feed when `next_cursor` exists after a partial page.
  - [ ] Media preload window contains active item plus at most one previous and one next item; DOM/network assertions verify no additional videos/iframes are eagerly loaded.

  **QA Scenarios**:
  ```text
  Scenario: Mobile active item
    Tool: Browser use
    Steps: Playwright iPhone viewport opens /videos, screenshots first item.
    Expected: one video visible, action rail and caption do not overlap notch/home indicator areas.
    Evidence: /root/shipinye/evidence/task-6-mobile.png

  Scenario: Native offscreen pause
    Tool: Browser use
    Steps: open /videos with two native videos, scroll to second, inspect first video paused state.
    Expected: first native video paused, second active video is current.
    Evidence: /root/shipinye/evidence/task-6-offscreen-pause.txt

  Scenario: Provider iframe compatibility
    Tool: Browser use
    Steps: seed one Bilibili, one YouTube, and one Vimeo embed; open /videos and verify each iframe loads or falls back safely.
    Expected: allowlisted provider iframe elements render with safe attributes or documented fallback; CSP permits required frame hosts; no arbitrary iframe src renders; remote playback availability is recorded but not required.
    Evidence: /root/shipinye/evidence/task-6-iframe-compat.txt

  Scenario: Preload window
    Tool: Browser use
    Steps: seed at least five feed items, open /videos, inspect DOM/network requests before scrolling.
    Expected: active item plus at most one previous and one next item are preloaded; no other video/iframe media is eagerly loaded.
    Evidence: /root/shipinye/evidence/task-6-preload-window.txt
  ```

  **Suggested Commit**: only if the user requests commits | Message: `feat(ui): build shorts video feed interface` | Files: Glimmer components/SCSS/tests

- [x] 7. Wire Native Discourse Actions

  **What to do**: Implement action buttons against native Discourse post/topic flows. Canonical target: `post_id` for like, bookmark, flag/report, and reply. Share/open use `post_url` or `topic_url` with post anchor. Logged-out restricted actions invoke the normal Discourse login prompt. Reply opens the standard Discourse composer for the target post/topic; no custom comments panel in v1.

  **Browser-block rule**: If `task-1-browser-blocker.txt` exists, complete source/service tests where possible, mark native-action browser scenarios as `blocked` in `evidence/manifest.md`, and do not count them as passed.

  **Must NOT do**: Do not implement custom counters, custom save lists, custom report dialogs, or a separate comment system.

  **Parallelization**: Can Parallel: NO | Wave 9 | Blocks: 8 | Blocked By: 3,5,6

  **References**:
  - External: https://meta.discourse.org/t/theme-developer-tutorial-6-using-the-js-api/357801 - JS API and current-user/login-aware patterns.
  - Discourse core conventions: native post menu actions and composer/flag/bookmark APIs in installed Discourse source.
  - Installed Discourse source: verify current native action payload/state field names before freezing frontend usage.

  **Acceptance Criteria**:
  - [ ] Like toggles through native Discourse API and updates count/state.
  - [ ] Bookmark opens/uses native bookmark flow.
  - [ ] Reply opens standard composer targeting the post/topic.
  - [ ] Share copies or exposes stable post/topic URL.
  - [ ] Flag/report opens native flag flow.
  - [ ] Anonymous action requiring auth opens login prompt.
  - [ ] Action buttons consume verified current-user fields from `/videos.json`, including liked/unlike state, bookmark state, and native post action summary where required by installed Discourse APIs.
  - [ ] Task 3 contract includes enough serialized post/topic shape to instantiate or call the exact native like, unlike, bookmark, flag, reply/composer, and share/open APIs verified in the pinned checkout.

  **QA Scenarios**:
  ```text
  Scenario: Logged-in native actions
    Tool: Browser use
    Steps: sign in test user, open /videos, click like, bookmark, reply, share, flag on first item.
    Expected: native Discourse state/flows appear; no custom modal replaces them.
    Evidence: /root/shipinye/evidence/task-7-native-actions.png

  Scenario: Anonymous login prompt
    Tool: Browser use
    Steps: anonymous opens /videos and clicks like.
    Expected: standard Discourse login prompt appears.
    Evidence: /root/shipinye/evidence/task-7-login-prompt.png
  ```

  **Suggested Commit**: only if the user requests commits | Message: `feat(actions): reuse native discourse post actions` | Files: action components/tests

- [x] 8. Add Accessibility, Browser, and Security Hardening

  **What to do**: Add keyboard shortcuts and accessibility safeguards for feed/playback only: Space play/pause, ArrowDown/J next, ArrowUp/K previous, M mute, Esc closes menus/dialogs. Do not add v1 single-key shortcuts for native Discourse actions like like/reply/share; those remain button/native-flow interactions to avoid conflicts with Discourse's shortcut system. Integrate with the pinned checkout's shortcut/keybinding service where available, or scope handlers to the active feed surface with focus/user-setting checks. Disable shortcuts inside inputs/composer/dialogs/menus and when focus is outside the active feed. Ensure focus order, labels, visible focus states, screen reader active item label, and iframe titles. Add security regression tests for private uploads, hidden/deleted posts, and access changes between pages.

  **Browser-block rule**: If `task-1-browser-blocker.txt` exists, complete backend/security/source checks where possible, mark keyboard/accessibility/browser scenarios as `blocked` in `evidence/manifest.md`, and do not count them as passed.

  **Must NOT do**: Do not trap focus inside the scroll feed. Do not expose private configuration in public states.

  **Parallelization**: Can Parallel: NO | Wave 10 | Blocks: 9 | Blocked By: 3,4,5,6,7

  **References**:
  - External: https://github.com/discourse/discourse - accessibility/browser support notes in Discourse README.
  - Metis guardrails from planning review.

  **Acceptance Criteria**:
  - [ ] Feed/playback keyboard shortcuts work only when focus is inside the active feed surface and not inside input/composer/dialog/menu.
  - [ ] V1 does not bind L/R/S or other native-action shortcuts; like/reply/share remain native button flows.
  - [ ] Shortcut implementation either uses the pinned checkout's keybinding service or documents scoped event handling that avoids global Discourse shortcut conflicts.
  - [ ] Screen reader labels include title, author, and feed position.
  - [ ] Focus order is player, metadata, primary actions, secondary actions.
  - [ ] Private upload URLs are never serialized for unauthorized users.
  - [ ] If a user loses access between pages, pagination omits inaccessible items.
  - [ ] Chrome/Edge desktop, Firefox desktop, and Android Chrome are tested where local Playwright/browser tooling allows.
  - [ ] Safari/iOS Safari are tested only if macOS/iOS hardware is available; otherwise run Playwright WebKit as the automated fallback and document the real Safari gap in `/root/shipinye/evidence/task-8-browser-matrix.txt`.

  **QA Scenarios**:
  ```text
  Scenario: Keyboard operation
    Tool: Browser use
    Steps: Playwright opens /videos, focuses active feed, presses Space, M, ArrowDown, J, ArrowUp, K, then focuses composer/input and repeats.
    Expected: playback/navigation shortcuts work only in active feed; shortcuts do not fire inside composer/input; L/R/S are not bound by the plugin.
    Evidence: /root/shipinye/evidence/task-8-keyboard.txt

  Scenario: Access revocation during pagination
    Tool: HTTP call
    Steps: request first page as user, revoke category access, request next cursor.
    Expected: inaccessible videos are omitted; no private URLs in JSON.
    Evidence: /root/shipinye/evidence/task-8-access-revocation.txt

  Scenario: Browser matrix fallback
    Tool: Browser use
    Steps: run available Chromium/Firefox/WebKit Playwright matrix for /videos; record whether real Safari/iOS Safari hardware is unavailable.
    Expected: automated browser matrix passes; any unavailable real Safari/iOS Safari coverage is explicitly documented.
    Evidence: /root/shipinye/evidence/task-8-browser-matrix.txt
  ```

  **Suggested Commit**: only if the user requests commits | Message: `fix(security): harden video feed permissions and accessibility` | Files: tests/components/services

- [x] 9. Documentation and Operational Notes

  **What to do**: Document installation, supported media, settings, Bilibili limitations, browser autoplay caveats, upload prerequisites, native action behavior, QA commands, and troubleshooting. Include upgrade notes and explicit v1 exclusions. Add a QA seed section with exact fixture strategy: store or generate a tiny valid MP4 fixture for tests, create topics through Discourse factories for automated tests, and provide a script or command sequence for browser QA seeding of native MP4, Bilibili canonical URL, YouTube, Vimeo, private category video, unsupported intended-video URL, and non-video posts.

  **Browser-block rule**: If `task-1-browser-blocker.txt` exists, documentation still lands, but browser QA instructions/artifacts are marked blocked in `evidence/manifest.md` and final verification remains blocked.

  **Must NOT do**: Do not promise adaptive streaming, `b23.tv` support, custom recommendation, or upload UI.

  **Parallelization**: Can Parallel: NO | Wave 11 | Blocks: final verification | Blocked By: all feature behavior including Task 8

  **References**:
  - External: https://meta.discourse.org/t/does-discourse-support-uploading-videos/200789 - upload prerequisites.
  - External: https://meta.discourse.org/t/insert-video/147651 - video insertion component context.

  **Acceptance Criteria**:
  - [ ] README explains how admins configure category/tag sources.
  - [ ] README explains Discourse upload settings required for hosted videos.
  - [ ] README documents Bilibili canonical URL and iframe support, with `b23.tv` deferred.
  - [ ] README documents native Discourse action mapping.
  - [ ] README lists test and QA commands.
  - [ ] README includes deterministic seed commands or scripts for all browser QA media cases.

  **QA Scenarios**:
  ```text
  Scenario: Fresh install docs
    Tool: tmux
    Steps: follow README install/config commands in a clean Discourse dev instance.
    Expected: plugin installs, `/videos` renders configured seed videos.
    Evidence: /root/shipinye/evidence/task-9-docs-install.txt

  Scenario: Unsupported expectation check
    Tool: tmux
    Steps: search README for b23.tv/adaptive streaming/custom upload promises.
    Expected: docs state these are out of scope for v1.
    Evidence: /root/shipinye/evidence/task-9-docs-scope.txt
  ```

  **Suggested Commit**: only if the user requests commits | Message: `docs: document video shorts plugin setup` | Files: README/docs

## Final Verification Wave

- [x] F1. Plan Compliance Audit
  - Verify every task acceptance criterion has a matching automated test or explicit QA artifact.
  - Command: inspect `/root/shipinye/evidence/` and test logs.
  - Fail if `docs/video-feed-contract.md` is missing, if the conceptual placeholder still governs implementation, or if frontend code references API fields absent from `docs/video-feed-contract.md`.
  - Create `/root/shipinye/evidence/manifest.md` with one row per acceptance criterion: task, criterion summary, artifact path, artifact type (`test-log`, `http-output`, `browser-screenshot`, `source-discovery`, `docs-check`, or `blocker`), and pass/block status.

- [ ] F2. Full Automated Test Suite
  - Backend: `cd /root/shipinye/discourse && bundle exec rspec plugins/discourse-video-shorts/spec`
  - Frontend: from `/root/shipinye/discourse`, run Discourse plugin QUnit/acceptance tests for `/videos`.
  - Lint/build: from `/root/shipinye/discourse`, run plugin JS/SCSS lint and production asset build.

- [ ] F3. Agent-Run Browser QA
  - HTTP: `curl -i "$DISCOURSE_API_URL/videos.json"`
  - Browser desktop: open `$DISCOURSE_WEB_URL/videos`, interact with native uploaded video and Bilibili item; Bilibili iframe interaction is required only when Task 3 froze an iframe_candidate contract, otherwise verified fallback link behavior is acceptable.
  - Provider DOM/CSP checks: verify Bilibili, YouTube, and Vimeo iframe/fallback behavior according to the finalized contract and save artifacts in `/root/shipinye/evidence/final-provider-iframes.txt`.
  - Browser mobile: iPhone viewport scroll/action test.
  - Verify artifacts in `/root/shipinye/evidence/final-http.txt`, `/root/shipinye/evidence/final-desktop.png`, `/root/shipinye/evidence/final-mobile.png`.

- [x] F4. Scope Fidelity Check
  - Confirm no Discourse core modifications.
  - Confirm no custom social action system.
  - Confirm no upload/transcoding/recommendation features slipped into v1.
  - Confirm route remains fixed `/videos`.

## Commit Strategy
- Use atomic Conventional Commits.
- Do not commit automatically unless the user requests it.
- Commit only plugin source under `/root/shipinye/discourse-video-shorts`; do not commit the cloned Discourse checkout.
- Recommended final series:
  - `feat(plugin): scaffold video shorts plugin`
  - `feat(settings): configure video feed sources`
  - `feat(api): expose permission-safe video feed`
  - `feat(extraction): normalize post videos for feed`
  - `feat(route): add videos feed route`
  - `feat(ui): build shorts video feed interface`
  - `feat(actions): reuse native discourse post actions`
  - `fix(security): harden video feed permissions and accessibility`
  - `docs: document video shorts plugin setup`

## Success Criteria
- `/videos` works as a browser-facing Shorts-style feed.
- `/videos.json` is permission-safe and normalized.
- Uploaded videos and canonical/embedded Bilibili videos are supported; Bilibili iframe rendering is required only under an iframe_candidate contract, otherwise labeled topic fallback satisfies v1 support.
- Native Discourse actions work through native flows.
- Automated tests capture RED to GREEN for each production task.
- Agent-run QA artifacts prove HTTP, desktop browser, and mobile browser behavior.
- Documentation states exact v1 support and exclusions.
