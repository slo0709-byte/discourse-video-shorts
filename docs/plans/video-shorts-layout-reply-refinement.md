# Video Shorts Layout And Reply Refinement

## TL;DR
> **Summary**: Refine `/videos` from a working vertical feed into a YouTube Shorts-style Discourse experience: desktop uses a centered short player with an adjacent action rail and expandable right comments panel, mobile keeps fullscreen bottom-sheet comments, and replying/publishing stays in the shorts context instead of jumping to the topic.
> **Deliverables**:
> - Desktop YouTube Shorts-style structure: centered 9:16 player, adjacent action rail, expandable right comments panel.
> - Mobile YouTube Shorts-style structure: fullscreen player, right-side overlaid action rail, bottom-sheet comments.
> - Reply composer/publish flow that stays on `/videos` and refreshes comments.
> - RED->GREEN acceptance/Playwright tests and remote browser QA.
> **Effort**: Medium
> **Parallel**: YES - 4 waves
> **Critical Path**: Task 1 -> Task 3 -> Task 5 -> Task 6 -> Task 8 -> Final Verification

## Context
### Original Request
用户要求重新仔细检查 YouTube 短视频 PC 端和移动端布局/样式；指出当前仍差一点；点击回复和发布回复不到位；发布后会跳到该视频主题；希望判断更好的设计。

### Interview Summary
- No user decision is blocking.
- Default design: prefer YouTube Shorts interaction structure, not TikTok-first and not a visual clone.
- Desktop should feel like a dedicated shorts viewer, not only a player centered inside a generic Discourse page.
- Mobile should remain fullscreen and keep comments as an in-context bottom sheet.
- Reply publishing must preserve `/videos` and the active video context.

### Research Findings
- Existing mobile route scoping is in `discourse-video-shorts/assets/javascripts/discourse/routes/videos.js`; CSS uses `body.video-shorts-route` in `discourse-video-shorts/assets/stylesheets/common/video-shorts.scss`.
- Existing desktop layout is a centered 9:16 stage inside the Discourse shell; it lacks the YouTube Shorts desktop structure where actions sit beside the short and comments expand in a right panel.
- Existing action rail comment/reply button opens `VideoShortsCommentsSheet` from `discourse-video-shorts/assets/javascripts/discourse/components/video-shorts/action-rail.gjs`.
- Existing sheet Reply calls `composer.open({ skipJumpOnSave: true })`, but Discourse core composer still renders a saved permalink and can route to `createdPost.url`.
- Discourse core composer save logic is in `discourse/frontend/discourse/app/services/composer.js`; `saveAction` passes `jump: !skipJumpOnSave`, but saved UI in `composer-container.gjs` still links to the new post.
- YouTube Shorts interaction reference: comments are opened from a collapsed comments control; desktop keeps the short centered with actions next to it and comments expanding as a right panel; mobile uses a bottom-sheet-like comments surface. This plan borrows those structural ideas while preserving Discourse shell and native permissions.

### Metis Review (gaps addressed)
- `skipJumpOnSave` is not sufficient proof: plan requires real post-save browser QA that asserts final URL stays `/videos`.
- This is a v2 UX contract change, not cosmetic polish: docs must update the YouTube Shorts-style desktop structure and in-context reply behavior.
- “Reply” is split into three distinct actions: rail comment button opens comments, comments Reply opens write UI, Publish creates the reply.
- Desktop comments state must be owned above individual items so it can follow the active video safely.
- Inline reply form backed by Discourse core post creation is the preferred architecture because it avoids the docked composer’s saved-post navigation path while preserving core storage/permissions.
- Desktop and mobile acceptance criteria are separate; the desktop right comments panel must not inherit mobile fullscreen chrome hiding.

## Work Objectives
### Core Objective
Make `/videos` feel like a polished Discourse-native short-video viewer on both desktop and mobile, and make reading/replying to comments stay inside the `/videos` experience after publish.

### Deliverables
- Desktop YouTube Shorts-style viewer: active 9:16 stage centered in the viewing lane, adjacent action rail outside the video content, and expandable right comments/context panel that does not overlap the player.
- Mobile fullscreen viewer remains route-scoped with right-side overlaid action rail and bottom-sheet comments.
- Comments UI has clear distinction between “open comments” and “write reply”.
- Publishing a reply from the shorts UI creates a Discourse core reply but leaves the browser on `/videos`.
- Newly posted reply appears in the comments surface, highlighted or positioned visibly.
- Regression coverage for YouTube/Bilibili/native active-only playback, CSP, unsupported fallback, and native actions.

### Definition of Done
- Remote desktop browser QA at `1280x900` proves `/videos` shows a YouTube Shorts-style viewer with player, adjacent action rail, and expandable right comments panel, no generic topic navigation, and no overlap.
- Remote mobile browser QA at `390x844` proves `/videos` stays fullscreen with right-side action rail, comments are bottom-sheet style, and feed scroll is isolated from comments scroll.
- Logged-in browser QA proves Reply opens a write surface from `/videos`, publishes a real Discourse reply, stays on `/videos`, preserves active video, and refreshes direct replies.
- Anonymous browser QA proves reading public comments works and write actions prompt login without route jump.
- Regression QA proves active-only YouTube/Bilibili iframe lifecycle, native MP4 lifecycle, unsupported fallback, CSP frame-src, and native actions still pass.
- No unexpected plugin `console.error` or `pageerror` during layout, comments open/close, reply publish, and provider swipes.

### Must Have
- Desktop YouTube Shorts-style structure: centered player lane, action rail beside the player, expandable right comments/context panel; not a modal-only desktop experience.
- Mobile YouTube Shorts-style structure: fullscreen player, right-side overlaid action rail, bottom-sheet comments; no desktop right comments panel forced onto mobile.
- Comments surface state is owned at the route/controller/feed-shell level and receives the active item; it is not item-local state that can desynchronize when the feed scrolls.
- Reply publishing must not navigate to `/t/...`.
- Discourse permissions, login behavior, CSRF/session behavior, and post visibility must remain core-governed.
- Direct replies remain the v1 comments scope unless the plan explicitly adds a later full-topic timeline task.

### Must NOT Have
- Do not clone YouTube visual branding, icons, colors, or exact controls rigidly; borrow structure only.
- Do not implement custom comment storage.
- Do not embed the full topic route or full `PostStream` inside the shorts viewer.
- Do not globally hide Discourse chrome outside mobile `/videos`.
- Do not keep offscreen YouTube/Bilibili/native players mounted.
- Do not rely only on `skipJumpOnSave` as proof that publish stays on `/videos`.
- Do not leave the comments panel bound to a stale post after the active video changes.

## Verification Strategy
> ZERO HUMAN INTERVENTION - all verification is agent-executed.
- Test decision: TDD RED-GREEN-REFACTOR. Add acceptance/Playwright RED tests before production edits.
- QA policy: Every task has agent-executed browser or HTTP scenarios against the remote test site.
- Evidence directory: `.omo/ulw-loop/g007/evidence/`

## Execution Strategy
### Parallel Execution Waves
Wave 1: RED layout/reply tests and publish-flow characterization.
Wave 2: Desktop/mobile layout implementation and comments panel factoring.
Wave 3: Reply publish flow implementation and comments refresh.
Wave 4: Remote deployment, regression QA, docs, final review.

### Dependency Matrix
| Task | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |
| 1. Add RED Desktop/Mobile Layout Refinement Tests | none | 3, 8 | 2 |
| 2. Add RED Reply Publish Stay-On-Videos Tests | none | 5, 6, 8 | 1 |
| 3. Implement Feed Shell State For Active Item And Comments Surface | 1 | 4, 8 | none |
| 4. Implement YouTube Shorts-Style Desktop Layout And Mobile Surface Routing | 1, 3 | 5, 8 | none |
| 5. Implement In-Context Reply Write Surface | 2, 4 | 6, 8 | none |
| 6. Implement Publish-And-Refresh Without Topic Jump | 2, 5 | 8 | none |
| 7. Polish Counts, Long Text, Focus, And Responsive Details | 3, 4, 5 | 8 | none |
| 8. Remote Deployment And Full Browser Regression QA | 3, 4, 5, 6, 7 | 9, Final | none |
| 9. Update UX Contract Documentation | 8 | Final | none |

## TODOs

- [x] 1. Add RED Desktop/Mobile Layout Refinement Tests

  **What to do**: Add Playwright browser contracts that fail against the current desktop/modal-only comments experience and pin the already-good mobile fullscreen behavior. The tests must define the desired YouTube Shorts-style desktop structure: centered vertical player, action rail immediately outside the player on desktop, and expandable right comments panel.
  **Must NOT do**: Do not change production layout in this task. Do not weaken existing active-only media assertions.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 3, 8 | Blocked By: none

  **References**:
  - Current feed markup: `discourse-video-shorts/assets/javascripts/discourse/components/video-shorts/feed.gjs`.
  - Current item/stage/action rail markup: `discourse-video-shorts/assets/javascripts/discourse/components/video-shorts/item.gjs`.
  - Current CSS: `discourse-video-shorts/assets/stylesheets/common/video-shorts.scss`.
  - Existing mobile fullscreen script: `.omo/ulw-loop/g006/mobile_fullscreen_browser_test.mjs`.
  - Existing comments script: `.omo/ulw-loop/g006/comments_sheet_browser_test.mjs`.

  **Acceptance Criteria**:
  - [x] New script `.omo/ulw-loop/g007/layout_refinement_browser_test.mjs` runs against `http://23.165.248.117/videos`.
  - [x] At `1280x900`, initial desktop state expects centered 9:16 player with action rail outside the stage, adjacent to the player’s right edge.
  - [x] Rename/standardize the rail comments opener to `[data-action="open-comments"]`; reserve “reply” wording for the in-panel/in-sheet write action.
  - [x] At `1280x900`, clicking `[data-action="open-comments"]` expects an expandable right comments/context panel, not a centered modal-only sheet.
  - [x] Desktop assertion requires stage visible, rail visible outside stage bounds, panel visible after comments click, no overlap between stage/rail/panel, and URL remains `/videos`.
  - [x] At `390x844`, player remains fullscreen with right-side overlaid action rail and comments still open as bottom sheet, not desktop right comments panel.
  - [x] Mobile assertion requires feed viewport height equals `window.innerHeight` within 2px and no horizontal overflow.
  - [x] Script captures unexpected `console.error` and `pageerror`; expected current-failure assertions are allowlisted in RED mode.
  - [x] In `--expect-red` mode, the script exits `0` only when the current implementation fails for the expected reason; it exits non-zero if it unexpectedly passes or fails for an unrelated reason.

  **QA Scenarios**:
  ```text
  Scenario: RED YouTube Shorts desktop structure contract
    Tool: Browser use / Playwright
    Steps: `node .omo/ulw-loop/g007/layout_refinement_browser_test.mjs --expect-red --viewport=1280x900`
    Expected: exits 0 in expect-red mode only after observing the expected current failure: action rail inside stage, missing desktop comments panel, or panel/stage overlap.
    Evidence: .omo/ulw-loop/g007/evidence/task-1-desktop-layout-red.txt

  Scenario: Mobile bottom sheet baseline
    Tool: Browser use / Playwright
    Steps: same script at viewport `390x844`, click `[data-action="open-comments"]`, inspect `.video-shorts-comments-sheet`.
    Expected: mobile remains fullscreen and bottom sheet; this may pass before implementation and must stay green.
    Evidence: .omo/ulw-loop/g007/evidence/task-1-mobile-layout-baseline.json
  ```

  **Commit**: YES | Message: `test(video-shorts): cover refined layout contract` | Files: `.omo/ulw-loop/g007/layout_refinement_browser_test.mjs`, acceptance tests

- [x] 2. Add RED Reply Publish Stay-On-Videos Tests

  **What to do**: Add failing tests and browser scripts for the real problem: opening reply from comments and publishing must create a Discourse reply while staying on `/videos`. Characterize current composer behavior, including `skipJumpOnSave`, saved permalink, and any route jump.
  **Must NOT do**: Do not implement a new publish flow yet. Do not count `skipJumpOnSave` alone as success.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 5, 6, 8 | Blocked By: none

  **References**:
  - Current reply open: `discourse-video-shorts/assets/javascripts/discourse/components/video-shorts/action-rail.gjs`.
  - Current comments sheet Reply action: `discourse-video-shorts/assets/javascripts/discourse/components/modal/video-shorts-comments-sheet.gjs`.
  - Core composer save jump logic: `discourse/frontend/discourse/app/services/composer.js` `saveAction`, `save`, `viewNewReply`.
  - Composer saved permalink UI: `discourse/frontend/discourse/app/components/composer-container.gjs`.
  - Current logged-in evidence: `.omo/ulw-loop/g006/evidence/task-6-logged-in-sheet-reply-composer.json`.

  **Acceptance Criteria**:
  - [x] New acceptance test stubs post creation and asserts reply publish leaves `currentURL()` at `/videos`.
  - [x] New Playwright script logs in as admin, opens `/videos`, opens comments, writes reply, clicks composer save or inline publish, and asserts final path is `/videos`.
  - [x] Publish script uses a controlled seed video/topic and unique test marker text, then deletes/cleans up the created reply or records it in a cleanup manifest for idempotent reruns.
  - [x] Test asserts original active feed item `data-post-id` remains active after publish.
  - [x] Test asserts new reply appears in comments surface without clicking a topic link.
  - [x] RED evidence captures current route jump or missing in-context publish behavior.
  - [x] Script captures unexpected `console.error` and `pageerror`; expected current-failure assertions are allowlisted in RED mode.

  **QA Scenarios**:
  ```text
  Scenario: RED publish reply stays in shorts
    Tool: Browser use / Playwright
    Steps: `ADMIN_PASS=... node .omo/ulw-loop/g007/reply_publish_browser_test.mjs --expect-red`
    Expected: exits 0 in expect-red mode only after observing expected current behavior: route becomes `/t/...` or new reply does not appear in comments surface.
    Evidence: .omo/ulw-loop/g007/evidence/task-2-reply-publish-red.json

  Scenario: Anonymous write gate baseline
    Tool: Browser use / Playwright
    Steps: open `/videos` anonymous, click `[data-action="open-comments"]`, then click the in-panel/in-sheet `[data-action="reply"]` write action.
    Expected: login prompt/route appears without navigating to topic.
    Evidence: .omo/ulw-loop/g007/evidence/task-2-anonymous-reply-gate.json
  ```

  **Commit**: YES | Message: `test(video-shorts): cover in-context reply publishing` | Files: `.omo/ulw-loop/g007/reply_publish_browser_test.mjs`, acceptance tests

- [x] 3. Implement Feed Shell State For Active Item And Comments Surface

  **What to do**: Add a feed-shell state boundary that owns `activeIndex`, active item, comments-open state, and selected comments item. The active item must be observable by a sibling desktop right comments panel and by Playwright tests. When the active video changes, the desktop comments panel follows the new active item if open; mobile sheet remains bound to the item it was opened for until closed.
  **Must NOT do**: Do not keep comments-open state inside each `VideoShortsItem`. Do not use global mutable state. Do not change visual layout yet except minimal data attributes/hooks required for testing.

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: 4, 8 | Blocked By: 1

  **References**:
  - Current feed component: `discourse-video-shorts/assets/javascripts/discourse/components/video-shorts/feed.gjs`.
  - Current stage component: `discourse-video-shorts/assets/javascripts/discourse/components/video-shorts/item.gjs`.
  - Current controller model items: `discourse-video-shorts/assets/javascripts/discourse/controllers/videos.js`.
  - Current comments opener: `discourse-video-shorts/assets/javascripts/discourse/components/video-shorts/action-rail.gjs`.

  **Acceptance Criteria**:
  - [x] Feed shell exposes `data-active-post-id` for the current active item.
  - [x] Clicking the rail comments button opens comments for the active item without navigating.
  - [x] Desktop comments-open state follows active item after ArrowDown/scroll to the next video.
  - [x] Mobile sheet remains bound to its original opened item until closed; mobile action rail remains overlaid on the right side of the video.
  - [x] Existing mobile fullscreen geometry remains unchanged.
  - [x] Existing active-only provider/native media lifecycle remains unchanged.

  **QA Scenarios**:
  ```text
  Scenario: Active comments state follows desktop active video
    Tool: Browser use / Playwright
    Steps: open `/videos` at `1280x900`, click `[data-action="open-comments"]`, press ArrowDown, inspect `data-active-post-id` and comments surface post id.
    Expected: comments surface switches to the new active item and URL remains `/videos`.
    Evidence: .omo/ulw-loop/g007/evidence/task-3-active-comments-state.json

  Scenario: Mobile sheet binding regression
    Tool: Browser use / Playwright
    Steps: open `/videos` at `390x844`, click `[data-action="open-comments"]`, attempt feed key/scroll while sheet focused.
    Expected: sheet stays bound to opened post; feed active item unchanged while sheet focused.
    Evidence: .omo/ulw-loop/g007/evidence/task-3-mobile-sheet-binding.json
  ```

  **Commit**: YES | Message: `refactor(video-shorts): lift active comments state` | Files: feed/controller/action rail/comments tests

- [x] 4. Implement YouTube Shorts-Style Desktop Layout And Mobile Surface Routing

  **What to do**: Convert desktop `/videos` into a YouTube Shorts-style viewer with a centered 9:16 player lane, an action rail outside the video content on the player’s right side, and an expandable right comments/context panel. Factor comments content into a reusable component rendered inside the desktop panel and inside the existing mobile `DModal` bottom sheet. Desktop comment button opens/selects the side panel; mobile keeps bottom sheet routing.
  **Must NOT do**: Do not duplicate comments fetching logic. Do not render full topic route/PostStream. Do not make desktop use bottom-sheet-only behavior. Do not apply mobile fullscreen chrome hiding to desktop.

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: 5, 8 | Blocked By: 1, 3

  **References**:
  - Current comments sheet: `discourse-video-shorts/assets/javascripts/discourse/components/modal/video-shorts-comments-sheet.gjs`.
  - Current comments adapter: `discourse-video-shorts/assets/javascripts/discourse/lib/video-shorts-comments.js`.
  - Current template root: `discourse-video-shorts/assets/javascripts/discourse/templates/videos.gjs`.
  - Current SCSS route styles: `discourse-video-shorts/assets/stylesheets/common/video-shorts.scss`.
  - Existing load-more/desktop evidence script: `.omo/ulw-loop/g006/comments_sheet_pagination_desktop_browser_test.mjs`.

  **Acceptance Criteria**:
  - [x] Shared comments content component handles loading, empty, error, rows, load-more, and dedupe.
  - [x] Desktop `.video-shorts-feed` exposes a layout wrapper with player lane, desktop action-rail lane, and expandable right panel region.
  - [x] Desktop breakpoint and sizing are explicit: at >=1024px use the YouTube Shorts-style player + rail + right panel structure; below that use mobile/tablet fullscreen sheet behavior rather than crushing the 9:16 player.
  - [x] Right panel has min/max width rules; if viewport width cannot fit player, rail, gap, and panel without overlap, the panel collapses or switches to sheet behavior.
  - [x] At `1280x900`, the stage remains 9:16 and fully visible without requiring page scroll to see controls.
  - [x] Desktop action rail sits outside `.video-shorts-item__stage` bounds and does not cover metadata or video content.
  - [x] Desktop comments panel sits to the right of the player/action lane with no bounding-box overlap.
  - [x] Desktop comments panel can be closed/collapsed, returning to centered player + adjacent rail.
  - [x] Desktop header/sidebar remain visible and usable.
  - [x] Mobile keeps right-side overlaid action rail and `DModal` with `.video-shorts-comments-sheet` bottom alignment.
  - [x] Desktop uses `.video-shorts-comments-panel` side panel inside `/videos` layout, not modal-only.
  - [x] Panel/sheet displays count from `@item.counts.reply_count` and rows from direct replies JSON.
  - [x] Panel/sheet scroll is independent from feed scroll.
  - [x] Closing or switching panel focus returns to the invoking comments control.

  **QA Scenarios**:
  ```text
  Scenario: Desktop comments panel behavior
    Tool: Browser use / Playwright
    Steps: open `/videos` at `1280x900`, click `[data-action="open-comments"]`, intercept replies JSON with 20+2 comments, click Load more.
    Expected: right panel visible; row count appends to 21 unique rows; feed active item follows expected active post.
    Evidence: .omo/ulw-loop/g007/evidence/task-4-desktop-comments-panel.json

  Scenario: Desktop YouTube Shorts layout GREEN
    Tool: Browser use / Playwright
    Steps: `node .omo/ulw-loop/g007/layout_refinement_browser_test.mjs --viewport=1280x900`
    Expected: ok=true; player, action rail, and right panel boxes do not overlap; URL remains `/videos`.
    Evidence: .omo/ulw-loop/g007/evidence/task-4-desktop-layout-green.json

  Scenario: Mobile comments sheet behavior
    Tool: Browser use / Playwright
    Steps: open `/videos` at `390x844`, click `[data-action="open-comments"]`, intercept replies JSON happy/empty/error.
    Expected: bottom sheet states render; feed keyboard shortcuts ignored while focus inside sheet.
    Evidence: .omo/ulw-loop/g007/evidence/task-4-mobile-comments-sheet.json
  ```

  **Commit**: YES | Message: `feat(video-shorts): add YouTube-style desktop layout` | Files: comments components, SCSS, tests

- [x] 5. Implement In-Context Reply Write Surface

  **What to do**: Replace the sheet/panel Reply action that opens the docked Discourse composer with an in-context reply write surface inside the comments panel/sheet. Use Discourse core post creation endpoint/session/CSRF and core validation responses; do not store comments in plugin-owned storage. Keep anonymous users routed through native login. This is a v2 contract change from “native docked composer” to “native Discourse post endpoint through a lightweight shorts reply form.”
  **Must NOT do**: Do not use full topic route composer as the primary write UI for shorts comments. Do not bypass Guardian, CSRF, rate limits, trust level, or post validation. Do not support uploads/complex composer features in v1 unless explicitly already supported by the chosen core endpoint.

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: 6, 8 | Blocked By: 2, 4

  **References**:
  - Core post creation endpoint used by composer model: `discourse/frontend/discourse/app/models/composer.js`.
  - Current `Composer.REPLY` usage to replace: `discourse-video-shorts/assets/javascripts/discourse/components/video-shorts/action-rail.gjs`.
  - Comments adapter: `discourse-video-shorts/assets/javascripts/discourse/lib/video-shorts-comments.js`.
  - Discourse ajax/error pattern: `discourse/lib/ajax`, `discourse/lib/ajax-error`.

  **Acceptance Criteria**:
  - [x] Logged-in users see a compact reply field inside desktop panel/mobile sheet.
  - [x] Reply API helper has an explicit contract for endpoint, required payload fields (`topic_id`, `raw`, `reply_to_post_number` or equivalent), response shape, pending/enqueued response shape, CSRF/session handling, and `ajax-error` validation mapping.
  - [x] Reply field has publish/cancel states and disables publish while submitting.
  - [x] Empty reply is blocked client-side and does not call network.
  - [x] Server validation/rate-limit errors show inline in the comments surface without route navigation.
  - [x] Failed publish preserves typed text for correction.
  - [x] Anonymous users see/read comments and clicking write prompts native login without topic navigation.
  - [x] Existing native Discourse composer remains untouched for other site surfaces.

  **QA Scenarios**:
  ```text
  Scenario: In-context reply field opens
    Tool: Browser use / Playwright
    Steps: logged-in `/videos`, open comments, click reply field, type text.
    Expected: publish button enabled, URL still `/videos`, no `#reply-control.open`.
    Evidence: .omo/ulw-loop/g007/evidence/task-5-reply-field.json

  Scenario: Empty/server-error reply
    Tool: Browser use / Playwright
    Steps: click publish with empty text, then intercept post creation with 422.
    Expected: no network for empty; 422 renders inline error; URL remains `/videos`.
    Evidence: .omo/ulw-loop/g007/evidence/task-5-reply-errors.json
  ```

  **Commit**: YES | Message: `feat(video-shorts): add in-context reply field` | Files: comments components, reply API helper, tests

- [x] 6. Implement Publish-And-Refresh Without Topic Jump

  **What to do**: Submit replies through the chosen Discourse core endpoint from the in-context reply surface, then refresh/append direct replies for the active video and highlight the new row. Preserve active feed item and scroll position. Prevent navigation to `/t/...`; a defensive route-jump guard may log and restore `/videos`, but success must not depend on recovery.
  **Must NOT do**: Do not depend on user avoiding the saved permalink. Do not leave stale counts/rows after publish. Do not navigate to topic for success.

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: 8 | Blocked By: 2, 5

  **References**:
  - Current direct replies fetch: `discourse-video-shorts/assets/javascripts/discourse/lib/video-shorts-comments.js`.
  - Core replies endpoint shape evidence: `.omo/ulw-loop/g006/evidence/task-4-pagination-adapter-contract.json`.
  - Current controller model items: `discourse-video-shorts/assets/javascripts/discourse/controllers/videos.js`.
  - Current active item data attributes: `feed.gjs` `data-video-shorts-index` and `data-post-id`.

  **Acceptance Criteria**:
  - [x] Successful publish sends a real Discourse reply tied to `topic_id` and source `post_id` context.
  - [x] Request includes correct `reply_to_post_number` or equivalent source-post context when replying to a non-OP video post.
  - [x] Request payload and response handling are verified against Discourse core semantics for `topic_id`, `raw`, CSRF/session, validation errors, rate limits, and pending/enqueued posts.
  - [x] Publish browser script uses a seeded topic/video and unique reply text; it cleans up the created reply or writes the reply id to `.omo/ulw-loop/g007/evidence/reply-cleanup-manifest.json`.
  - [x] After success, browser path remains `/videos`.
  - [x] Active item post id remains the original video post id.
  - [x] Comments surface refreshes or appends the created reply without duplicates.
  - [x] Reply count updates in the action rail and panel/sheet title.
  - [x] New reply is visibly highlighted or scrolled into view in the comments surface.
  - [x] Pending/enqueued responses are handled without topic navigation.
  - [x] Failed publish preserves typed text and shows Discourse/server validation feedback in context.

  **QA Scenarios**:
  ```text
  Scenario: Publish real reply stays in videos
    Tool: Browser use / Playwright
    Steps: `ADMIN_PASS=... node .omo/ulw-loop/g007/reply_publish_browser_test.mjs`
    Expected: ok=true; final path `/videos`; original active post id unchanged; new reply text visible in comments surface.
    Evidence: .omo/ulw-loop/g007/evidence/task-6-reply-publish-green.json

  Scenario: Pending/enqueued or validation response
    Tool: Browser use / Playwright
    Steps: intercept post creation as pending/enqueued or 422 validation response.
    Expected: inline status/error shown; URL remains `/videos`; feed active item unchanged.
    Evidence: .omo/ulw-loop/g007/evidence/task-6-reply-publish-edge.json
  ```

  **Commit**: YES | Message: `fix(video-shorts): keep published replies in videos` | Files: comments reply helper, components, tests

- [x] 7. Polish Counts, Long Text, Focus, And Responsive Details

  **What to do**: Polish visual/interaction details exposed by the refined layout: compact action counts, long title/comment wrapping, focus management, keyboard isolation, safe-area spacing, and mobile/desktop breakpoints.
  **Must NOT do**: Do not introduce decorative one-note palettes or YouTube branding. Do not hide important Discourse controls globally.

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: 8 | Blocked By: 3, 4, 5

  **References**:
  - Action rail count display: `discourse-video-shorts/assets/javascripts/discourse/components/video-shorts/action-rail.gjs`.
  - Metadata wrapping: `discourse-video-shorts/assets/javascripts/discourse/components/video-shorts/metadata.gjs`.
  - Current SCSS button/count rules: `discourse-video-shorts/assets/stylesheets/common/video-shorts.scss`.

  **Acceptance Criteria**:
  - [x] Large counts format compactly (`1.2k`, `12k`) without overflowing action buttons.
  - [x] Long titles/excerpts do not overlap desktop action rail, desktop right panel, or mobile right-side action rail.
  - [x] Comment rows wrap long unbroken text safely.
  - [x] Escape/backdrop/close restores focus to the triggering control on mobile and desktop.
  - [x] Arrow/Space keyboard shortcuts do not advance or play the feed while focus is in comments/reply input.
  - [x] Reduced-motion preference keeps scroll behavior non-animated.

  **QA Scenarios**:
  ```text
  Scenario: Long content visual bounds
    Tool: Browser use / Playwright
    Steps: load fixture/intercepted feed with long title, long excerpt, high counts, and long comment text at mobile and desktop viewports.
    Expected: no horizontal overflow; metadata, action rail, and panel boxes do not overlap; text remains readable.
    Evidence: .omo/ulw-loop/g007/evidence/task-7-long-content-bounds.json

  Scenario: Focus and keyboard isolation
    Tool: Browser use / Playwright
    Steps: focus reply input, press ArrowDown and Space, close comments, inspect active index and focus target.
    Expected: active index unchanged while input focused; focus returns to comments control after close.
    Evidence: .omo/ulw-loop/g007/evidence/task-7-focus-keyboard.json
  ```

  **Commit**: YES | Message: `fix(video-shorts): polish responsive comments UI` | Files: components, SCSS, tests

- [x] 8. Remote Deployment And Full Browser Regression QA

  **What to do**: Deploy to the remote test site, precompile assets, restart, then run the full g007 QA suite plus existing g004/g006 provider/layout/action regressions.
  **Must NOT do**: Do not print secrets into evidence. Do not count local-only tests as completion.

  **Parallelization**: Can Parallel: NO | Wave 4 | Blocks: 9, Final | Blocked By: 3, 4, 5, 6, 7

  **References**:
  - Deployment evidence pattern: `.omo/ulw-loop/g006/evidence/final-csp-preserve-remote-precompile.txt`.
  - Existing provider lifecycle: `.omo/ulw-loop/g005/console_and_lifecycle_browser_test.mjs`.
  - Existing fullscreen: `.omo/ulw-loop/g006/mobile_fullscreen_browser_test.mjs`.
  - Existing comments scripts: `.omo/ulw-loop/g006/comments_sheet_browser_test.mjs`, `.omo/ulw-loop/g006/comments_sheet_pagination_desktop_browser_test.mjs`.

  **Acceptance Criteria**:
  - [x] `/srv/status`, `/videos`, and `/videos.json` return healthy responses after deploy.
  - [x] Desktop refined layout browser QA passes.
  - [x] Mobile fullscreen + right rail + bottom sheet browser QA passes.
  - [x] Logged-in reply publish browser QA passes with real post creation or controlled seeded test category.
  - [x] Anonymous read/login gate browser QA passes.
  - [x] YouTube iframe provider check passes: active item iframe is mounted with an embed URL, offscreen YouTube iframe is unmounted or stopped, swipe does not leave the previous iframe active, and no provider-related `console.error`/`pageerror` occurs.
  - [x] Bilibili iframe provider check passes: active item iframe is mounted with a valid player URL, offscreen Bilibili iframe is unmounted or stopped, swipe does not leave the previous iframe active, and no provider-related `console.error`/`pageerror` occurs.
  - [x] Native MP4 active-only lifecycle passes: active `<video>` can play, offscreen videos are paused and not audible, and switching active item pauses the previous native video.
  - [x] Unsupported fallback passes.
  - [x] CSP frame-src still includes self/http/https and provider origins.
  - [x] Native Discourse actions still pass: like, share/open topic fallback, bookmark if available, login gate for anonymous restricted actions.
  - [x] No unexpected plugin `console.error` or `pageerror`.

  **QA Scenarios**:
  ```text
  Scenario: Full remote browser suite
    Tool: Browser use / Playwright
    Steps: run `node .omo/ulw-loop/g007/final_browser_suite.mjs` after deploy.
    Expected: ok=true for desktop layout, mobile layout, comments, reply publish with cleanup/idempotency, anonymous login gate, YouTube iframe lifecycle, Bilibili iframe lifecycle, native MP4 lifecycle, unsupported fallback, native actions, and console/pageerror checks.
    Evidence: .omo/ulw-loop/g007/evidence/task-8-final-browser-suite.json

  Scenario: Full remote HTTP suite
    Tool: HTTP call / curl
    Steps: curl `http://23.165.248.117/srv/status`, `/videos.json?page_size=20`, `/posts/<seed>/replies.json`, malformed replies, and `/videos` headers.
    Expected: healthy status, provider/comment JSON contracts, controlled malformed error, CSP header contains required frame-src.
    Evidence: .omo/ulw-loop/g007/evidence/task-8-final-http-suite.txt
  ```

  **Commit**: NO | Message: n/a | Files: deployment/QA evidence only

- [x] 9. Update UX Contract Documentation

  **What to do**: Update README and contract docs to describe the v2 UX contract change: YouTube Shorts-style desktop structure, mobile fullscreen/right-rail/bottom-sheet structure, in-context reply publish behavior, direct replies limitation, active-only media, and CSP constraints.
  **Must NOT do**: Do not claim full nested topic timeline. Do not claim exact YouTube clone.

  **Parallelization**: Can Parallel: YES | Wave 4 | Blocks: Final | Blocked By: 8

  **References**:
  - `discourse-video-shorts/README.md`.
  - `discourse-video-shorts/docs/video-feed-contract.md`.

  **Acceptance Criteria**:
  - [x] Docs say desktop uses centered player, adjacent action rail, and expandable right comments/context panel.
  - [x] Docs say mobile uses fullscreen player, right-side overlaid action rail, and bottom-sheet comments.
  - [x] Docs say publishing a reply stays on `/videos` and refreshes direct replies.
  - [x] Docs say comments are v1 direct replies, not full topic timeline.
  - [x] Docs preserve active-only provider/native and unsupported fallback constraints.
  - [x] Docs mention CSP frame-src provider requirements.

  **QA Scenarios**:
  ```text
  Scenario: Docs contract grep
    Tool: bash
    Steps: `rg -n "YouTube Shorts-style|adjacent action rail|right comments|bottom sheet|publish.*videos|direct replies|active-only|frame-src" discourse-video-shorts/README.md discourse-video-shorts/docs/video-feed-contract.md`
    Expected: required terms present.
    Evidence: .omo/ulw-loop/g007/evidence/task-9-docs-contract.txt

  Scenario: Docs formatting
    Tool: bash
    Steps: `cd discourse && pnpm prettier --check ../discourse-video-shorts/README.md ../discourse-video-shorts/docs/video-feed-contract.md`
    Expected: exits 0.
    Evidence: .omo/ulw-loop/g007/evidence/task-9-docs-prettier.txt
  ```

  **Commit**: YES | Message: `docs(video-shorts): document refined shorts comments flow` | Files: README, docs

## Final Verification Wave
> ALL automated checks must pass. Present consolidated results to the user with evidence paths; whether to wait for explicit user approval is controlled by the outer workflow, not by this plan.
- [x] F1. Plan Compliance Audit
- [x] F2. Code Quality Review
- [x] F3. Real Manual QA
- [x] F4. Scope Fidelity Check

## Commit Strategy
- Commit 1: `test(video-shorts): cover refined shorts layout and reply flow`
- Commit 2: `feat(video-shorts): add YouTube-style desktop layout`
- Commit 3: `fix(video-shorts): keep reply publishing in videos`
- Commit 4: `fix(video-shorts): polish responsive comments interactions`
- Commit 5: `docs(video-shorts): document refined comments flow`

## Success Criteria
- Desktop `/videos` has a YouTube Shorts-style centered player, adjacent action rail, and expandable right comments panel.
- Mobile `/videos` remains fullscreen with right-side action rail and bottom-sheet comments.
- Reply publish creates a real Discourse reply and remains on `/videos`.
- Newly created reply appears in the comments surface without topic navigation.
- Provider/native playback and Discourse-native actions remain green.
