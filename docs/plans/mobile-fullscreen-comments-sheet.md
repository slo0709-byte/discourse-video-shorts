# Mobile Fullscreen Shorts And Comments Sheet

## TL;DR
> **Summary**: Make `/videos` feel like a real mobile short-video player by using route-local fullscreen on mobile and replacing comment-topic navigation with a Discourse-compatible comments bottom sheet.
> **Deliverables**:
> - Mobile `/videos` fullscreen/immersive layout.
> - Comments sheet opened from the action rail, with loading/error/empty states.
> - Native Discourse reply composer entry from inside the sheet.
> - RED->GREEN tests and remote browser QA evidence.
> **Effort**: Medium
> **Parallel**: YES - 4 waves
> **Critical Path**: Task 1 -> Task 3 -> Task 5 -> Task 7 -> Final Verification

## Context
### Original Request
用户要求移动端应该全屏，目前不是全屏；评论不应该跳转过去，应该像 YouTube Shorts 一样弹出，并询问如何设计比较好。

### Interview Summary
- No further user decision is blocking.
- Default design: mobile-first immersive fullscreen, not a rigid YouTube clone.
- Comments should stay in the `/videos` context and open as a sheet.
- Replies still use Discourse native composer and permission/login behavior.

### Research Findings
- `discourse-video-shorts/assets/stylesheets/common/video-shorts.scss` currently subtracts `--header-offset` from feed height, so mobile is not true fullscreen.
- `discourse-video-shorts/assets/javascripts/discourse/components/video-shorts/action-rail.gjs` currently opens the composer directly from the reply button.
- `feed.gjs` already ignores keyboard shortcuts inside `[role='dialog']`, `.modal`, composer, and related surfaces.
- Discourse plugin modal examples use `DModal` with `modal.show(Component, { model })`.
- Full Discourse `PostStream` is too heavy for this sheet; use a lightweight comments contract.

### Metis Review (gaps addressed)
- Replace rail reply action with comments sheet opening; only sheet “Reply” opens native composer.
- Use core direct replies endpoint first; do not embed full `PostStream`.
- Sheet must use `role="dialog"` or equivalent ignored surface so feed keyboard shortcuts do not fire inside comments.
- Mobile fullscreen must be explicitly breakpoint/route scoped because it conflicts with normal Discourse shell.
- v1 comments scope is direct replies to the source video post, not full nested topic timeline.

## Work Objectives
### Core Objective
Mobile users should get a fullscreen short-video experience, and tapping comments should open an in-context comments sheet instead of navigating away from `/videos`.

### Deliverables
- Mobile fullscreen CSS behavior scoped to `/videos`.
- A comments sheet component using Discourse modal patterns.
- A comments data loader that consumes Discourse core direct-replies JSON first.
- Action rail wiring so comment count opens the sheet.
- Native composer reply entry inside the sheet.
- Tests and remote browser QA scripts proving behavior.

### Definition of Done
- Remote mobile browser QA at `http://23.165.248.117/videos` proves `.video-shorts-feed` fills the visible viewport and no Discourse header/outlet gap remains on mobile.
- Browser QA proves tapping `[data-action="reply"]` opens a comments sheet without changing `location.pathname`.
- Browser QA proves the sheet lists comments, supports empty/error states, and closes back to the same active video.
- Browser QA proves a sheet reply action opens the native Discourse composer/login behavior, not a custom reply system.
- Regression QA proves provider iframe active-only lifecycle, native playback bounds, and unsafe provider fallback still pass.
- Regression QA proves no unexpected `pageerror` or `console.error` during fullscreen load, vertical swipes, comments open/close, native MP4, YouTube, Bilibili, and unsupported-provider fallback.

### Must Have
- Mobile fullscreen only on the `/videos` route.
- Desktop remains a centered 9:16 player inside Discourse shell.
- Comments are readable in a bottom sheet on mobile.
- Sheet scroll is independent from the video feed scroll.
- Reply uses Discourse native composer/login.
- Security/visibility uses Discourse core direct replies endpoint first; plugin proxy is allowed only if core shape or pagination cannot satisfy the UI contract.

### Must NOT Have
- Do not globally hide Discourse header/sidebar outside `/videos`.
- Do not clone YouTube visual details rigidly.
- Do not implement a custom comment/reply storage system.
- Do not embed full topic route/PostStream in the sheet.
- Do not navigate away from `/videos` when opening comments.
- Do not break provider active-only iframe unmounting.

## Verification Strategy
> ZERO HUMAN INTERVENTION - all verification is agent-executed.
- Test decision: TDD, using existing QUnit acceptance tests and RSpec request specs for behavior/data contracts. Pixel/viewport assertions must live in Playwright browser scripts with explicit viewport sizes; do not rely on QUnit for mobile media-query geometry. Local QUnit may be blocked by Ruby mismatch; RED/GREEN browser scripts against remote are mandatory fallback evidence, but tests still must be written first.
- QA policy: Every task has agent-executed browser or HTTP scenarios.
- Evidence directory: `.omo/ulw-loop/g006/evidence/`

## Execution Strategy
### Parallel Execution Waves
Wave 1: RED tests and core replies characterization.
Wave 2: Implement server comments data and mobile fullscreen CSS.
Wave 3: Implement comments sheet UI and action-rail wiring.
Wave 4: Remote deployment, browser QA, docs, final review.

### Dependency Matrix
| Task | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |
| 1. Add RED Mobile Fullscreen Tests | none | 3, 7 | 2 |
| 2. Add RED Comments Sheet Tests And Core Replies Characterization | none | 4, 5, 6 | 1 |
| 3. Implement Mobile Fullscreen Route Layout | 1 | 7 | 4 |
| 4. Implement Comments Data Contract | 2 | 5, 7 | 3 |
| 5. Implement Comments Sheet UI | 2, 4 | 6, 7 | none |
| 6. Wire Action Rail Comments And Native Reply | 5 | 7 | none |
| 7. Remote QA And Regression Suite | 3, 4, 5, 6 | 8 | none |
| 8. Update Docs And Operational Notes | 7 | Final | none |

## TODOs

- [x] 1. Add RED Mobile Fullscreen Layout Tests

  **What to do**: Add Playwright browser contract tests that fail on the current mobile layout because `/videos` does not occupy the full mobile viewport. Keep QUnit for non-geometry behavior only; pin desktop geometry through Playwright.
  **Must NOT do**: Do not change source CSS in this task. Do not hide global Discourse header outside `/videos`.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 3, 7 | Blocked By: none

  **References**:
  - Current mobile height: `discourse-video-shorts/assets/stylesheets/common/video-shorts.scss:1-17`, `:200-228`.
  - Current layout QA pattern: `.omo/ulw-loop/g004/tiktok_layout_browser_test.mjs`.
  - Existing acceptance layout test: `discourse-video-shorts/test/javascripts/acceptance/videos-dedicated-player-test.js`.

  **Acceptance Criteria**:
  - [ ] New Playwright test explicitly sets viewport 390x844 and asserts mobile `.video-shorts-feed`/viewport height covers `window.innerHeight` within 2px after route settling.
  - [ ] New test asserts `document.scrollingElement.scrollHeight <= window.innerHeight + 2` on mobile `/videos` after route settling.
  - [ ] New test asserts mobile stage/control rail remain visible inside the viewport.
  - [ ] New test asserts desktop layout still keeps a centered 9:16 stage and does not globally black out `html`/`body`.
  - [ ] New test asserts header/sidebar/outlet spacing returns after navigating away from `/videos`.

  **QA Scenarios**:
  ```text
  Scenario: RED mobile fullscreen contract
    Tool: Playwright
    Steps: run `node .omo/ulw-loop/g006/mobile_fullscreen_browser_test.mjs --expect-red` against http://23.165.248.117/videos at 390x844.
    Expected: exits non-zero before implementation with assertion mentioning mobile feed not fullscreen.
    Evidence: .omo/ulw-loop/g006/evidence/task-1-mobile-fullscreen-red.txt

  Scenario: Desktop unchanged characterization
    Tool: Playwright
    Steps: run same script at 1280x900 and inspect stage/body state.
    Expected: desktop still has centered 9:16 stage and no global black body/html.
    Evidence: .omo/ulw-loop/g006/evidence/task-1-desktop-characterization.txt
  ```

  **Commit**: YES | Message: `test(video-shorts): cover mobile fullscreen contract` | Files: QA script, acceptance test

- [x] 2. Add RED Comments Sheet Tests And Core Replies Characterization

  **What to do**: Add RED tests for a comments sheet opened from the action rail instead of route navigation or immediate composer opening. Characterize the existing core direct-replies endpoint and define the frontend adapter contract against that real JSON shape.
  **Must NOT do**: Do not implement the sheet or server endpoint yet. Do not plan a full topic stream.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 4, 5, 6 | Blocked By: none

  **References**:
  - Current reply action: `discourse-video-shorts/assets/javascripts/discourse/components/video-shorts/action-rail.gjs:176-194`.
  - Core direct replies endpoint: `discourse/app/controllers/posts_controller.rb` `replies` action; executor must inspect exact route before coding.
  - Current action tests: `discourse-video-shorts/test/javascripts/acceptance/videos-route-test.js:337-385`.
  - Modal pattern: `discourse/plugins/discourse-math/assets/javascripts/discourse/components/modal/math-insert.gjs`.

  **Acceptance Criteria**:
  - [ ] Clicking `[data-action="reply"]` opens `.video-shorts-comments-sheet` and does not change `currentURL()`.
  - [ ] Opening comments does not immediately call `composer.open`.
  - [ ] Sheet test stubs direct replies JSON and renders at least username, cooked body, and reply count.
  - [ ] Edge test covers no replies and fetch error states.

  **QA Scenarios**:
  ```text
  Scenario: RED comments sheet open
    Tool: QUnit/Playwright
    Steps: click `.video-shorts-action-rail__button[data-action="reply"]` on a feed item.
    Expected: before implementation, `.video-shorts-comments-sheet` is missing or composer opens immediately; test fails for the right reason.
    Evidence: .omo/ulw-loop/g006/evidence/task-2-comments-sheet-red.txt

  Scenario: Core direct replies characterization and adapter contract
    Tool: RSpec request or HTTP browser fixture
    Steps: create video post with two visible direct replies and one hidden/private reply, request `/posts/:post_id/replies.json`, and define adapter expectations for the returned array.
    Expected: core endpoint behavior is captured; hidden/private reply excluded; only the unimplemented adapter/sheet behavior remains RED.
    Evidence: .omo/ulw-loop/g006/evidence/task-2-comments-api-red.txt
  ```

  **Commit**: YES | Message: `test(video-shorts): cover comments sheet contract` | Files: acceptance tests, request specs or QA scripts

- [x] 3. Implement Mobile Fullscreen Route Layout

  **What to do**: Make mobile `/videos` route immersive fullscreen. Add or verify a stable route scoping mechanism that can affect Discourse chrome outside the route subtree: prefer adding/removing a body/app route class while on `/videos`; use `body:has(.video-shorts-page)` only if browser support is verified on the remote target and documented in evidence. Feed viewport uses `100dvh`, page chrome/header spacing is neutralized only under that route scope on mobile, and stage/action rail fit visible viewport. Keep desktop behavior from Task 1 characterization.
  **Must NOT do**: Do not set global `html`/`body` black. Do not hide Discourse chrome globally. Do not alter desktop layout except necessary regressions.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 7 | Blocked By: 1

  **References**:
  - Stylesheet: `discourse-video-shorts/assets/stylesheets/common/video-shorts.scss`.
  - Route template class root: `discourse-video-shorts/assets/javascripts/discourse/templates/videos.gjs`.
  - Prior viewport-fit evidence: `.omo/ulw-loop/g004/evidence/final-review-fix3-overlay.json`.

  **Acceptance Criteria**:
  - [ ] A stable route-scoping hook exists at body/app level, or `body:has(.video-shorts-page)` support is verified on the remote target before use.
  - [ ] All fullscreen/chrome CSS selectors include that executable route scope and can affect the needed Discourse chrome/header/outlet nodes.
  - [ ] At 390x844, active `.video-shorts-feed__item` and `.video-shorts-item__stage` fit inside viewport without requiring page scroll after route settle.
  - [ ] At 390x844, `document.scrollingElement.scrollHeight <= window.innerHeight + 2` on `/videos`.
  - [ ] Discourse header/outlet gap does not consume mobile video viewport on `/videos`.
  - [ ] After navigating from `/videos` to `/`, Discourse header/sidebar/outlet spacing is restored.
  - [ ] Desktop 1280x900 remains centered 9:16, route-local, non-global.

  **QA Scenarios**:
  ```text
  Scenario: Mobile fullscreen GREEN
    Tool: Playwright
    Steps: run `node .omo/ulw-loop/g006/mobile_fullscreen_browser_test.mjs` after deploy.
    Expected: ok=true; viewport/stage/control rail all inside 390x844 viewport.
    Evidence: .omo/ulw-loop/g006/evidence/task-3-mobile-fullscreen-green.json

  Scenario: Adjacent desktop route regression
    Tool: Playwright
    Steps: open `/videos` at 1280x900 and `/` at 1280x900; also navigate mobile `/videos` -> `/`.
    Expected: desktop video route centered; root Discourse header/layout unaffected; mobile global route chrome restored after leaving `/videos`.
    Evidence: .omo/ulw-loop/g006/evidence/task-3-desktop-root-regression.json
  ```

  **Commit**: YES | Message: `fix(video-shorts): make mobile feed fullscreen` | Files: SCSS, template only if route class is needed

- [x] 4. Implement Core Direct Replies Comments Data Contract

  **What to do**: Consume Discourse core direct replies first. Verify the exact route and JSON shape for `GET /posts/:post_id/replies.json`; build a frontend adapter that normalizes the core bare array of serialized posts into `{ comments, hasMore, nextAfter }` for the sheet. `hasMore` is derived by the adapter from `response.length === 20`; `nextAfter` is the last rendered comment `post_number`. Add a plugin proxy only if the core response cannot be consumed or paginated safely after inspection, and document the reason in evidence before adding it.
  **Must NOT do**: Do not add a plugin comments endpoint by default. Do not return all topic posts. Do not bypass Guardian. Do not include raw hidden/deleted/private replies.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 5, 7 | Blocked By: 2

  **References**:
  - Core replies action: `discourse/app/controllers/posts_controller.rb` `replies`; inspect route before coding.
  - Plugin routes: `discourse-video-shorts/config/routes.rb`.
  - Plugin controller: `discourse-video-shorts/app/controllers/discourse_video_shorts/videos_controller.rb`.
  - Feed visibility patterns: `discourse-video-shorts/lib/discourse_video_shorts/feed.rb`.
  - Request specs: `discourse-video-shorts/spec/requests/videos_feed_spec.rb`.

  **Acceptance Criteria**:
  - [ ] Uses core direct replies JSON unless evidence proves a proxy is required.
  - [ ] Normalizes direct replies for the source video post with cooked body, username/avatar, created_at, post_url, post_id, post_number.
  - [ ] Anonymous/public visibility matches Discourse core permissions.
  - [ ] Private/hidden/deleted replies are excluded or return controlled 403/404.
  - [ ] More than 20 direct replies produces a core array of 20; the frontend adapter derives `hasMore=true` and `nextAfter=<last post_number>`; no silent truncation in the sheet UI.
  - [ ] Malformed/missing post_id behavior is characterized for the core endpoint or controlled in the proxy only if a proxy is introduced.

  **QA Scenarios**:
  ```text
  Scenario: HTTP comments happy path
    Tool: curl
    Steps: `curl -i 'http://23.165.248.117/posts/<seed-video-post-id>/replies.json'` unless Task 4 evidence requires a proxy.
    Expected: HTTP 200 JSON array with direct replies only; frontend adapter evidence shows normalized comments array.
    Evidence: .omo/ulw-loop/g006/evidence/task-4-comments-http.txt

  Scenario: HTTP comments pagination and malformed/private
    Tool: curl
    Steps: seed/request more than 20 direct replies, then request with the planned `after`/next cursor; also request missing/invalid/private post id as anonymous.
    Expected: core first page returns capped array length 20; adapter output derives `hasMore`/`nextAfter`; next page advances without duplicates; private/malformed cases are controlled, never 500.
    Evidence: .omo/ulw-loop/g006/evidence/task-4-comments-http-errors.txt
  ```

  **Commit**: YES | Message: `feat(video-shorts): load direct reply comments` | Files: frontend loader/specs; controller/routes only if proxy evidence requires them

- [x] 5. Implement Comments Sheet UI

  **What to do**: Add `VideoShortsCommentsSheet` using `DModal`, styled as mobile bottom sheet and desktop Discourse-compatible modal/panel. Because `DModal` renders in the modal outlet outside the route subtree, pass/use a stable modal class or root class in the modal outlet and style `.video-shorts-comments-sheet` independently of the route subtree. It fetches direct replies through the Task 4 adapter, renders loading/empty/error/comment rows, uses `@item.counts.reply_count` for the displayed count, supports the Task 4 adapter-derived `hasMore` contract, and keeps internal scrolling separate from the feed. Expose public args/actions needed by Task 6, but do not change the action rail reply button in this task.
  **Must NOT do**: Do not render full topic route or `PostStream`. Do not create nested cards inside cards. Do not use visible instructional text beyond normal state labels.

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: 6, 7 | Blocked By: 2, 4

  **References**:
  - Modal pattern: `discourse/plugins/discourse-math/assets/javascripts/discourse/components/modal/math-insert.gjs`.
  - Modal service usage: `discourse-video-shorts/assets/javascripts/discourse/components/video-shorts/action-rail.gjs:200-224`.
  - Feed ignored surfaces: `discourse-video-shorts/assets/javascripts/discourse/components/video-shorts/feed.gjs:49-54`.
  - Stylesheet: `discourse-video-shorts/assets/stylesheets/common/video-shorts.scss`.

  **Acceptance Criteria**:
  - [ ] Sheet root/modal outlet has a stable `.video-shorts-comments-sheet` class, `role="dialog"` via `DModal`, close button, and accessible title.
  - [ ] Sheet SCSS targets the modal outlet/root class directly and does not rely on being nested inside `.video-shorts-page`.
  - [ ] Mobile sheet covers roughly 60-75% viewport height and overlays current video without route navigation.
  - [ ] Sheet title/count comes from `@item.counts.reply_count`; rendered rows come from direct replies JSON.
  - [ ] If `hasMore` is true, sheet shows and verifies a load-more control that appends without duplicates.
  - [ ] Comment list scrolls inside the sheet; feed active index does not change while scrolling sheet.
  - [ ] Loading, empty, and error states are represented.
  - [ ] Escape/backdrop/close can return focus to a passed opener element; Task 6 verifies the actual action rail opener.

  **QA Scenarios**:
  ```text
  Scenario: Browser comments sheet happy path
    Tool: Playwright
    Steps: open `/videos` mobile, click `[data-action="reply"]`, wait for `.video-shorts-comments-sheet`, inspect rows.
    Expected: sheet visible, URL remains `/videos`, active video unchanged, at least one seeded comment row rendered.
    Evidence: .omo/ulw-loop/g006/evidence/task-5-comments-sheet-browser.json

  Scenario: Browser sheet scroll isolation
    Tool: Playwright
    Steps: open sheet, scroll `.video-shorts-comments-sheet__body`, press ArrowDown/Space while focus is inside sheet, then close with Escape.
    Expected: feed active item index and playback state do not change.
    Evidence: .omo/ulw-loop/g006/evidence/task-5-comments-sheet-scroll-isolation.json

  Scenario: Browser sheet focus and pagination
    Tool: Playwright
    Steps: open sheet from `[data-action="reply"]`, click load-more when present, close with Escape.
    Expected: comments append without duplicate post ids; focus returns to the same reply button after close.
    Evidence: .omo/ulw-loop/g006/evidence/task-5-comments-sheet-focus-pagination.json
  ```

  **Commit**: YES | Message: `feat(video-shorts): add comments sheet UI` | Files: comments component, feed state/API, SCSS, tests; no action rail reply behavior change

- [x] 6. Wire Action Rail Comments And Native Reply Composer

  **What to do**: Change action rail reply/comment button to open the comments sheet. Move existing `composer.open` logic into a sheet “Reply” action. Anonymous users still trigger login when attempting to write.
  **Must NOT do**: Do not open composer immediately from the rail. Do not navigate to topic for ordinary comment viewing. Do not replace Discourse composer.

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: 7 | Blocked By: 5

  **References**:
  - Current composer logic: `discourse-video-shorts/assets/javascripts/discourse/components/video-shorts/action-rail.gjs:176-194`.
  - Existing login helper: `action-rail.gjs` `showLogin()`.
  - Native action tests: `discourse-video-shorts/test/javascripts/acceptance/videos-route-test.js`.

  **Acceptance Criteria**:
  - [ ] Clicking comment/reply action opens comments sheet, not composer.
  - [ ] Closing a sheet opened from `[data-action="reply"]` returns focus to the same action rail button.
  - [ ] Clicking sheet reply opens composer with `Composer.REPLY`, correct topic/post context, and `skipJumpOnSave: true`.
  - [ ] Anonymous sheet reply prompts login.
  - [ ] Existing like/bookmark/share/flag/open-topic actions still work.

  **QA Scenarios**:
  ```text
  Scenario: Composer opens only from sheet
    Tool: QUnit/Playwright
    Steps: spy/stub composer, click action rail reply, then click sheet reply.
    Expected: composer not called on rail click; called once on sheet reply with topic/post model.
    Evidence: .omo/ulw-loop/g006/evidence/task-6-composer-from-sheet.txt

  Scenario: Native action regression
    Tool: Playwright
    Steps: click like/bookmark/share/flag/open-topic controls on `/videos`.
    Expected: existing native endpoints/modals/links still behave as before.
    Evidence: .omo/ulw-loop/g006/evidence/task-6-native-actions-regression.json
  ```

  **Commit**: YES | Message: `fix(video-shorts): open comments before composer` | Files: action rail, comments sheet, tests

- [x] 7. Remote Deployment And Full Browser QA

  **What to do**: Deploy to remote test site, precompile assets, restart, then run mobile fullscreen, comments sheet, provider lifecycle, native playback, and HTTP comments/provider regression scripts. Seed or identify QA rows for native MP4, YouTube iframe, Bilibili iframe, and unsupported-provider fallback.
  **Must NOT do**: Do not print secrets into evidence. Do not count local-only tests as completion.

  **Parallelization**: Can Parallel: NO | Wave 4 | Blocks: 8, Final | Blocked By: 3, 4, 5, 6

  **References**:
  - Prior deploy evidence pattern: `.omo/ulw-loop/g005/evidence/remote-precompile.txt`.
  - Existing browser QA scripts: `.omo/ulw-loop/g004/*.mjs`, `.omo/ulw-loop/g005/console_and_lifecycle_browser_test.mjs`.

  **Acceptance Criteria**:
  - [ ] `/srv/status` and `/videos` return 200 after deploy.
  - [ ] Mobile fullscreen browser QA passes at 390x844.
  - [ ] Comments sheet browser QA passes at mobile and desktop.
  - [ ] Provider iframe active-only lifecycle passes for seeded YouTube and Bilibili items after vertical swipes.
  - [ ] Native MP4 active behavior still passes.
  - [ ] Unsupported-provider fallback still renders safely.
  - [ ] Only the current screen's native video/provider iframe is mounted or playing after each vertical swipe.
  - [ ] Playwright fails on any unexpected `pageerror` or `console.error`.
  - [ ] HTTP provider and comments contracts pass.

  **QA Scenarios**:
  ```text
  Scenario: Full remote browser suite
    Tool: Playwright
    Steps: run all g006 browser scripts sequentially against seeded native MP4, YouTube iframe, Bilibili iframe, and unsupported-provider rows at http://23.165.248.117/videos.
    Expected: each script writes ok=true and screenshot/action log where applicable; after swipes only the active screen's provider/native media is mounted or playing.
    Evidence: .omo/ulw-loop/g006/evidence/task-7-remote-browser-summary.json

  Scenario: Console and pageerror regression
    Tool: Playwright
    Steps: capture `pageerror` and `console.error` during fullscreen load, vertical swipes, comments open/close, native MP4, YouTube, Bilibili, and unsupported-provider fallback.
    Expected: no unexpected page errors or console errors.
    Evidence: .omo/ulw-loop/g006/evidence/task-7-console-errors.json

  Scenario: Full remote HTTP suite
    Tool: curl
    Steps: curl `/srv/status`, `/videos.json`, and comments endpoint/core replies endpoint.
    Expected: status 200 for healthy paths; controlled JSON errors for malformed paths.
    Evidence: .omo/ulw-loop/g006/evidence/task-7-remote-http-summary.txt
  ```

  **Commit**: NO | Message: n/a | Files: deployment evidence only

- [x] 8. Update UX Contract Documentation

  **What to do**: Update README/docs to describe mobile fullscreen behavior, comments sheet scope, direct replies v1 limitation, native composer reply behavior, and exclusions.
  **Must NOT do**: Do not claim full topic timeline/nested replies if v1 only direct replies. Do not claim custom comments.

  **Parallelization**: Can Parallel: YES | Wave 4 | Blocks: Final | Blocked By: 5, 6, 7

  **References**:
  - `discourse-video-shorts/README.md`.
  - `discourse-video-shorts/docs/video-feed-contract.md`.

  **Acceptance Criteria**:
  - [ ] Docs say mobile `/videos` is fullscreen/immersive and route-scoped.
  - [ ] Docs say comments open in a sheet and ordinary comment viewing does not navigate to topic.
  - [ ] Docs say v1 comments are direct replies and writing uses Discourse composer.
  - [ ] Docs preserve provider active-only and unsupported fallback constraints.

  **QA Scenarios**:
  ```text
  Scenario: Docs contract grep
    Tool: bash
    Steps: `rg -n "fullscreen|comments sheet|direct replies|composer|active-only|fallback" README/docs`.
    Expected: required contract terms present.
    Evidence: .omo/ulw-loop/g006/evidence/task-8-docs-contract.txt

  Scenario: Docs formatting
    Tool: bash
    Steps: run Prettier check on README and video-feed-contract.
    Expected: exits 0.
    Evidence: .omo/ulw-loop/g006/evidence/task-8-docs-prettier.txt
  ```

  **Commit**: YES | Message: `docs(video-shorts): document fullscreen comments flow` | Files: README, docs

## Final Verification Wave
> ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
- [ ] F1. Plan Compliance Audit
- [ ] F2. Code Quality Review
- [ ] F3. Real Manual QA
- [ ] F4. Scope Fidelity Check

## Commit Strategy
- Commit 1: `test(video-shorts): cover mobile fullscreen and comments sheet contracts`
- Commit 2: `fix(video-shorts): make mobile feed fullscreen`
- Commit 3: `feat(video-shorts): add comments sheet`
- Commit 4: `docs(video-shorts): document mobile fullscreen comments flow`

## Success Criteria
- Mobile `/videos` is fullscreen and route-scoped.
- Comments open in a sheet without route navigation.
- Native Discourse reply behavior is preserved.
- Provider/native playback lifecycle regressions remain green.
