# Video Shorts Native User And Comments Layout Plan

## TL;DR
> **Summary**: Fix `/videos` so author usernames behave like native Discourse user links, desktop metadata aligns to the bottom like Shorts, horizontal overflow is eliminated, and desktop comments-open mode shifts the player left while moving publisher/text onto the video bottom.
> **Deliverables**:
> - Clickable native Discourse author link with user-card behavior.
> - Desktop default layout with bottom-aligned left metadata.
> - Desktop comments-open layout with player shifted left, comments panel open, and metadata overlaid at the video bottom.
> - No horizontal scrollbar across desktop, phone, tablet, and comments-open states.
> - RED->GREEN acceptance/browser evidence and remote QA artifacts.
> **Effort**: Medium
> **Parallel**: YES - 4 waves
> **Critical Path**: Task 1 -> Task 2 -> Task 3 -> Task 5 -> Final verification

## Context

### Original Request

The user reported that the username is not connected to native Discourse behavior and cannot be clicked; the PC left-side content should be visually closer to YouTube Shorts by aligning to the bottom; there must be no horizontal scrollbar; and when opening replies/comments on PC, the video should move left, the comments panel should open, and publisher/text should move to the video bottom.

### Interview Summary

No additional user decision is needed. The required direction is clear: use YouTube Shorts as an interaction reference, but keep Discourse-native user/profile/comment semantics. Do not clone YouTube branding or abandon Discourse UI conventions.

### Research Findings

- `discourse-video-shorts/assets/javascripts/discourse/components/video-shorts/metadata.gjs` currently renders `@{{@item.username}}` as plain text.
- `discourse-video-shorts/lib/discourse_video_shorts/feed.rb` serializes `username` and `avatar_template`, but not `user_path`.
- Discourse provides native user path/link patterns through `discourse/lib/url` `userPath(...)` and `discourse/ui-kit/d-user-link`.
- `discourse-video-shorts/assets/javascripts/discourse/components/video-shorts/feed.gjs` already exposes `data-comments-open` and `data-comments-layout` on `.video-shorts-feed__viewport`.
- Current g009 QA proves publisher presence and hit targets, but does not prove clickable native username, bottom alignment, comments-open metadata relocation, or horizontal overflow absence.
- Current local QUnit is blocked in this workspace because Ruby is `3.2.3` while Discourse requires `~> 3.4`; browser QA against the real remote site must be the completion gate.
- External Shorts references indicate Shorts comments are opened through a comment button/panel rather than normal page comments; keep this only as an interaction reference, not as a full clone. Sources: YouTube Help on Shorts comment panel behavior and recent Shorts comment UI articles.

### Metis Review

Metis findings incorporated:

- Native Discourse username behavior must be asserted, not inferred from visible text.
- Prefer native `DUserLink`; if not viable, use `userPath(...)` plus `data-user-card`.
- Mobile `.video-shorts-item__info { pointer-events: none; }` will make links unclickable unless `.video-shorts-metadata__publisher-link` explicitly restores `pointer-events: auto`.
- Desktop must be modeled as two states: comments closed and comments open.
- Comments-open metadata relocation needs an explicit CSS/DOM contract; do not rely on accidental position changes.
- `openComments` may need to activate the clicked item or prove only the active item controls are interactable.
- Horizontal overflow must be measured on document and body, not visually guessed.
- Tablet/mobile route wrapper constraints must be retained from g009.
- Local QUnit may be unavailable; every user-facing criterion still needs real browser evidence.

## Work Objectives

### Core Objective

Make `/videos` feel like a Discourse-native Shorts page: native clickable author identity, bottom-aligned desktop metadata, no horizontal overflow, and a comments-open desktop state that moves the player left and places metadata at the video bottom.

### Deliverables

- Updated metadata component rendering a native Discourse user link.
- Updated desktop CSS for bottom-aligned info in default state.
- Updated desktop comments-open CSS for player-left/comments-right composition and metadata-on-video-bottom.
- Updated tests and QA scripts for native username, overflow, and comments-open layout.
- Remote deployment to `http://23.165.248.117/videos` with browser and HTTP evidence.

### Definition of Done

- Browser QA at `1280x900` desktop default: author link is clickable, info is bottom-aligned left of video, no horizontal overflow.
- Browser QA at `1280x900` desktop comments-open: clicking comments keeps `/videos`, opens comments panel, player shifts left, metadata appears on the video bottom, no horizontal overflow.
- Browser QA at `390x844`, `641x900`, `768x1024`, and `1023x768`: no horizontal overflow, username link is available, metadata visible, rail buttons hit-testable.
- HTTP regression: `/srv/status`, `/videos`, `/videos.json?page_size=10` return `200`, YouTube/Bilibili remain `iframe_candidate`.
- Prettier passes on changed files and QA scripts.
- Reviewer returns unconditional `APPROVE`.

### Must Have

- Author username link must route to the native Discourse user profile and expose `data-user-card={{username}}`.
- On mobile/tablet, author link must remain clickable even though the metadata overlay is otherwise pointer-safe.
- Metadata text must not block action rail clicks on mobile/tablet.
- Desktop default metadata must be bottom-aligned, not vertically centered.
- Desktop comments-open metadata must move onto the video bottom, not remain in the left info lane.
- No `document.documentElement.scrollWidth > window.innerWidth` or `document.body.scrollWidth > window.innerWidth` in tested viewports.

### Must NOT Have

- Do not change how comments are stored; replies remain Discourse topic posts/replies.
- Do not make username a custom non-Discourse route.
- Do not reintroduce mobile bottom tabs over the video page.
- Do not use hard-coded YouTube colors or branding.
- Do not hide comments panel behind route navigation.
- Do not rely on human visual inspection as the only proof.

## Verification Strategy

> ZERO HUMAN INTERVENTION - all verification is agent-executed.

- Test decision: TDD. Write/extend failing acceptance/browser tests first. If local QUnit cannot execute because of Ruby/server environment, record the blocker and rely on RED browser tests plus remote GREEN browser QA.
- QA policy: Every task has agent-executed browser or HTTP scenarios.
- Evidence root: `.omo/ulw-loop/g010/evidence/`
- Required scripts:
  - Extend `.omo/ulw-loop/g009/viewport_layout_browser_test.mjs` into `.omo/ulw-loop/g010/viewport_layout_browser_test.mjs`, or create a g010-specific script.
  - Extend `.omo/ulw-loop/g009/action_regression_browser_test.mjs` into `.omo/ulw-loop/g010/comments_open_layout_browser_test.mjs`.

## Execution Strategy

### Parallel Execution Waves

Wave 1: RED tests and QA scripts for native user link, desktop bottom alignment, comments-open relocation, and overflow.

Wave 2: Implement native user link and default desktop bottom alignment.

Wave 3: Implement comments-open desktop layout and overflow constraints.

Wave 4: Deploy, run full browser/HTTP regression, fix reviewer blockers.

### Dependency Matrix

| Task | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |
| 1. Native username RED/GREEN plan and implementation | none | 2, 5 | 2 RED prep only |
| 2. Desktop default bottom alignment | Task 1 tests available | 3, 5 | none |
| 3. Desktop comments-open layout | Task 2 | 5 | 4 QA script refinement |
| 4. Horizontal overflow QA expansion | none | 5 | 1, 2 |
| 5. Remote deployment and full QA | 1, 2, 3, 4 | Final verification | none |
| F1-F4 | 5 | completion | none |

## TODOs

- [x] 1. Make Author Username A Native Discourse Link

  **What to do**:
  - First add failing assertions in `discourse-video-shorts/test/javascripts/acceptance/videos-dedicated-player-test.js`.
  - Assert `.video-shorts-metadata__publisher-link` exists, has `href="/u/video-author"` or equivalent Discourse base-aware user path, has `data-user-card="video-author"`, and contains `@video-author`.
  - Implement in `metadata.gjs`.
  - Preferred implementation: import `DUserLink` from `discourse/ui-kit/d-user-link` and pass `@username={{@item.username}}`; add class/attributes if the component permits.
  - Fallback if `DUserLink` cannot expose required class/attributes in plugin GJS: import `userPath` from `discourse/lib/url` in a backing component, compute `publisherPath`, and render `<a class="video-shorts-metadata__publisher-link" href={{this.publisherPath}} data-user-card={{@item.username}}>`.
  - Keep the visible text as `@username`.
  - Add CSS so `.video-shorts-metadata__publisher-link { pointer-events: auto; }` under mobile/tablet overlays while keeping the rest of `.video-shorts-item__info` pointer-safe.

  **Must NOT do**:
  - Do not use a custom route or plain `href="/users/..."`.
  - Do not remove username from the feed payload.
  - Do not make the whole metadata block clickable.

  **Parallelization**: Can Parallel: NO | Wave 1-2 | Blocks: 2, 5 | Blocked By: none

  **References**:
  - Current plain text: `discourse-video-shorts/assets/javascripts/discourse/components/video-shorts/metadata.gjs`
  - Data source: `discourse-video-shorts/lib/discourse_video_shorts/feed.rb`
  - Native helper: `discourse/frontend/discourse/app/lib/url.js:userPath`
  - Native component: `discourse/frontend/discourse/app/ui-kit/d-user-link.gjs`
  - Existing user-card anchor pattern: `discourse/frontend/discourse/admin/templates/admin-search-logs/term.gjs`

  **Acceptance Criteria**:
  - [ ] RED evidence shows current publisher has no anchor and fails native link assertion.
  - [ ] GREEN evidence shows publisher link `href` points to `/u/video-author` and has `data-user-card`.
  - [ ] Browser QA click on publisher link triggers native Discourse behavior without JavaScript errors: either navigation to `/u/video-author` or a visible native user card.
  - [ ] Mobile/tablet proves the publisher link center is hit-testable and actual click behavior works: either navigation to `/u/video-author` or a visible native user card. If route CSS hides `#user-card`, the implementation must use navigation proof rather than user-card proof.

  **QA Scenarios**:
  ```text
  Scenario: Native author link is present
    Tool: bash + QUnit if available, otherwise Playwright browser script
    Steps: Seed/route `/videos.json` with username `video-author`; open `/videos`; locate `.video-shorts-metadata__publisher-link`.
    Expected: Link text includes `@video-author`, href includes `/u/video-author`, `data-user-card=video-author`.
    Evidence: .omo/ulw-loop/g010/evidence/native-author-link-red.txt and native-author-link-green.json

  Scenario: Clicking metadata whitespace does not navigate
    Tool: Playwright
    Steps: Open `/videos`; click `.video-shorts-metadata__excerpt`; read `location.pathname`.
    Expected: Still `/videos`.
    Evidence: .omo/ulw-loop/g010/evidence/native-author-link-whitespace-green.json

  Scenario: Mobile author link remains clickable inside pointer-safe metadata overlay
    Tool: Playwright
    Steps: Open `/videos` at `390x844`; use `document.elementFromPoint()` at the publisher link center; click the link.
    Expected: Hit target is the publisher link or its descendant; click either navigates to `/u/video-author` or opens a visible native user card; action rail hit targets still pass.
    Evidence: .omo/ulw-loop/g010/evidence/native-author-link-mobile-hit-green.json

  Scenario: Tablet author link uses native Discourse behavior
    Tool: Playwright
    Steps: Open `/videos` at `768x1024`; click `.video-shorts-metadata__publisher-link`.
    Expected: Browser navigates to `/u/video-author` or a visible native user card appears. Hidden `#user-card` does not count as pass.
    Evidence: .omo/ulw-loop/g010/evidence/native-author-link-tablet-click-green.json
  ```

  **Commit**: NO | Message: `fix(video-shorts): use native user links in metadata` | Files: `metadata.gjs`, acceptance test, optional QA script

- [x] 2. Align Desktop Default Metadata To Bottom Left

  **What to do**:
  - Add RED browser assertion for desktop `1280x900`: `.video-shorts-item__info` bottom must be within a small tolerance of `.video-shorts-item__stage` bottom, and `.video-shorts-item__info` must remain left of `.video-shorts-item__player`.
  - Change desktop CSS so `.video-shorts-item` aligns children to the bottom or `.video-shorts-item__info` self-aligns to the player/stage bottom.
  - Keep the video stage, action rail, and comments panel dimensions stable.
  - Use Discourse variables and existing class names; avoid new decorative wrappers.

  **Must NOT do**:
  - Do not put default desktop metadata back inside `.video-shorts-item__stage`.
  - Do not make the left info column vertically centered.
  - Do not use viewport-width font scaling.

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: 3, 5 | Blocked By: 1 test setup

  **References**:
  - Current layout CSS: `discourse-video-shorts/assets/stylesheets/common/video-shorts.scss`
  - Current markup: `discourse-video-shorts/assets/javascripts/discourse/components/video-shorts/item.gjs`
  - Current geometry QA: `.omo/ulw-loop/g009/viewport_layout_browser_test.mjs`

  **Acceptance Criteria**:
  - [ ] Desktop default info bottom is within `16px` of stage bottom.
  - [ ] Info remains left of player and does not overlap stage or rail.
  - [ ] Stage/player still fit first viewport.

  **QA Scenarios**:
  ```text
  Scenario: Desktop info bottom aligns with player
    Tool: Playwright
    Steps: Open `http://23.165.248.117/videos` at `1280x900`; measure infoRect and stageRect.
    Expected: `Math.abs(infoRect.bottom - stageRect.bottom) <= 16`, `infoRect.right <= playerRect.left`, no overlap.
    Evidence: .omo/ulw-loop/g010/evidence/desktop-bottom-align-green.json

  Scenario: Long text stays bounded
    Tool: Playwright route intercept or seeded remote item
    Steps: Render long title/excerpt; measure infoRect and document scroll width.
    Expected: Text wraps/clamps, no horizontal overflow, no overlap.
    Evidence: .omo/ulw-loop/g010/evidence/desktop-bottom-align-long-text-green.json
  ```

  **Commit**: NO | Message: `fix(video-shorts): bottom-align desktop metadata` | Files: `video-shorts.scss`, browser QA script

- [x] 3. Implement Desktop Comments-Open Layout Transition

  **What to do**:
  - Add RED browser test: on desktop `1280x900`, click `[data-action="open-comments"]`.
  - Assert:
    - path remains `/videos`;
    - `.video-shorts-comments-panel` exists;
    - `.video-shorts-feed__viewport[data-comments-open="true"]` exists;
    - player/stage shifts left compared with the closed state;
    - `.video-shorts-item__info` is positioned as a bottom overlay on or within the video stage area;
    - the left info lane no longer occupies separate space.
  - Before opening comments, record the active post id and stage rect.
  - If comments controls are ever rendered for non-active items, update `openComments(item)` or feed logic so opening comments makes that item active before opening/measuring the panel.
  - Implement using existing `data-comments-open="true"` on `.video-shorts-feed__viewport`.
  - CSS approach:
    - default desktop: `.video-shorts-item` has `info + player`.
    - comments-open desktop: `.video-shorts-feed__viewport[data-comments-open="true"] .video-shorts-item` should use one player-focused layout; `.video-shorts-item__info` becomes absolute over the lower-left of `.video-shorts-item__stage` or stage area.
    - Keep `.video-shorts-action-rail` beside player and before comments panel.
    - Ensure comments panel does not overlap rail.

  **Must NOT do**:
  - Do not navigate to topic page.
  - Do not open the mobile comments sheet on desktop.
  - Do not duplicate metadata DOM; reposition the existing `.video-shorts-item__info`.
  - Do not hide the publisher/text when comments open.

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: 5 | Blocked By: 2

  **References**:
  - Open comments action: `discourse-video-shorts/assets/javascripts/discourse/components/video-shorts/action-rail.gjs`
  - State attributes: `discourse-video-shorts/assets/javascripts/discourse/components/video-shorts/feed.gjs`
  - Comments panel CSS: `discourse-video-shorts/assets/stylesheets/common/video-shorts.scss`
  - Existing comments regression QA: `.omo/ulw-loop/g009/action_regression_browser_test.mjs`

  **Acceptance Criteria**:
  - [ ] Clicking comments opens `.video-shorts-comments-panel` and keeps URL `/videos`.
  - [ ] Stage `left` decreases by at least `40px` compared with closed state, or panel layout otherwise proves player shifted left to make room.
  - [ ] Metadata is visually inside the video/stage lower region when comments are open.
  - [ ] Comments panel, rail, stage, and metadata do not overlap incoherently.
  - [ ] The comments panel corresponds to the same post as the active/visible video.

  **QA Scenarios**:
  ```text
  Scenario: Desktop comments-open shifts player and moves metadata
    Tool: Playwright
    Steps: Open `/videos` at `1280x900`; capture closed rects; click `[data-action="open-comments"]`; capture open rects.
    Expected: comments panel exists; URL is `/videos`; stage/player shifts left; metadata rect is within stage/player bounds and near lower-left; no overlap with rail/panel.
    Evidence: .omo/ulw-loop/g010/evidence/desktop-comments-open-layout-green.json

  Scenario: Close comments restores left info lane
    Tool: Playwright
    Steps: After opening comments, click `[data-action="close-comments"]`; capture rects.
    Expected: comments panel gone; metadata returns to left lane; no horizontal overflow.
    Evidence: .omo/ulw-loop/g010/evidence/desktop-comments-close-restore-green.json

  Scenario: Comments open for the active video only
    Tool: Playwright
    Steps: Open `/videos`; record `data-active-post-id`; click the visible active item comments button; read `data-comments-open-post-id`.
    Expected: active post id equals comments-open post id.
    Evidence: .omo/ulw-loop/g010/evidence/desktop-comments-active-item-green.json
  ```

  **Commit**: NO | Message: `fix(video-shorts): reposition metadata when comments open` | Files: `video-shorts.scss`, QA script, possibly acceptance test

- [x] 4. Expand Horizontal Overflow Guardrails

  **What to do**:
  - Add browser assertions to g010 QA script for:
    - `document.documentElement.scrollWidth <= window.innerWidth`
    - `document.body.scrollWidth <= window.innerWidth`
    - no element among feed/viewport/item/player/stage/rail/panel extends outside viewport by more than `1px`, except intentional offscreen browser implementation details not in the video route.
  - Test viewports:
    - desktop closed: `1280x900`
    - desktop comments-open: `1280x900`
    - phone: `390x844`
    - small tablet / large phone: `641x900`
    - tablet portrait: `768x1024`
    - tablet edge: `1023x768`
  - Preserve g009 fixes: mobile/tablet route wrapper remains fullscreen and bottom tabs hidden.

  **Must NOT do**:
  - Do not “fix” overflow by hiding all body overflow on desktop if it masks broken layout.
  - Do not use `overflow-x: hidden` as the only proof; geometry must still fit.

  **Parallelization**: Can Parallel: YES | Wave 1/3 | Blocks: 5 | Blocked By: none

  **References**:
  - Current route overflow: `discourse-video-shorts/assets/stylesheets/common/video-shorts.scss`
  - Current viewport QA: `.omo/ulw-loop/g009/viewport_layout_browser_test.mjs`
  - Reviewer-discovered tablet risk evidence: `.omo/ulw-loop/g009/evidence/mobile-768x1024-green-final-maxwidth.json`

  **Acceptance Criteria**:
  - [ ] All required viewports report no document/body horizontal overflow.
  - [ ] Rail buttons remain hit-testable.
  - [ ] Comments panel does not create horizontal scroll.

  **QA Scenarios**:
  ```text
  Scenario: No horizontal scrollbar in closed states
    Tool: Playwright
    Steps: Open `/videos` at 390x844, 641x900, 768x1024, 1023x768, 1280x900; measure scroll widths.
    Expected: document/body scrollWidth <= innerWidth; no rail hit failures.
    Evidence: .omo/ulw-loop/g010/evidence/no-horizontal-overflow-closed-green.json

  Scenario: No horizontal scrollbar with comments open
    Tool: Playwright
    Steps: Open `/videos` at 1280x900; click comments; measure scroll widths and panel rects.
    Expected: no horizontal overflow; panel visible; no stage/panel/rail overlap.
    Evidence: .omo/ulw-loop/g010/evidence/no-horizontal-overflow-comments-open-green.json
  ```

  **Commit**: NO | Message: `test(video-shorts): guard against horizontal overflow` | Files: QA scripts, possible SCSS fixes

- [x] 5. Remote Deploy And Full Regression QA

  **What to do**:
  - Package `discourse-video-shorts`.
  - Sync to `root@23.165.248.117` without writing secrets to evidence.
  - In container, replace `/var/www/discourse/plugins/discourse-video-shorts`.
  - Run production asset precompile and restart unicorn.
  - Wait for `/srv/status` and `/videos` to return `200`.
  - Run all g010 browser scenarios and HTTP/provider regression.
  - Keep cleanup receipts in each evidence JSON.

  **Must NOT do**:
  - Do not expose credentials in logs/evidence.
  - Do not leave browser sessions, tmux sessions, local servers, or temp ports running.
  - Do not claim completion from local tests alone.

  **Parallelization**: Can Parallel: NO | Wave 4 | Blocks: F1-F4 | Blocked By: 1, 2, 3, 4

  **References**:
  - Prior deploy evidence pattern: `.omo/ulw-loop/g009/evidence/remote-precompile-after-tablet-maxwidth-fix.txt`
  - Prior HTTP provider regression: `.omo/ulw-loop/g009/evidence/http-provider-regression-green-final-maxwidth.json`
  - Prior action regression: `.omo/ulw-loop/g009/evidence/action-regression-green-final-maxwidth.stdout.txt`

  **Acceptance Criteria**:
  - [ ] `/srv/status`, `/videos`, `/videos.json?page_size=10` return `200`.
  - [ ] YouTube and Bilibili items remain `iframe_candidate`.
  - [ ] All browser scenarios pass on remote.
  - [ ] Evidence includes cleanup receipts.

  **QA Scenarios**:
  ```text
  Scenario: Remote HTTP and provider regression
    Tool: node fetch or curl
    Steps: GET `/srv/status`, `/videos`, `/videos.json?page_size=10`.
    Expected: 200 statuses; feed includes YouTube and Bilibili iframe candidates.
    Evidence: .omo/ulw-loop/g010/evidence/http-provider-regression-green.json

  Scenario: Remote browser full layout matrix
    Tool: Playwright
    Steps: Run g010 viewport/comments QA against `http://23.165.248.117`.
    Expected: all matrix cases pass; screenshots captured; no plugin console/page errors.
    Evidence: .omo/ulw-loop/g010/evidence/full-browser-layout-matrix-green.json
  ```

  **Commit**: NO | Message: `chore(video-shorts): verify native user shorts layout` | Files: evidence only

## Final Verification Wave

> ALL must APPROVE. Present consolidated results to user after completion.

- [x] F1. Plan Compliance Audit
  - Verify each TODO has corresponding RED and GREEN evidence.
  - Verify no task used human-only visual inspection as proof.

- [x] F2. Code Quality Review
  - Run Prettier on changed plugin files and g010 QA scripts.
  - Run available LSP diagnostics.
  - Record local QUnit limitation if Ruby/server still blocks.

- [x] F3. Real Browser QA
  - Browser evidence required for desktop default, desktop comments-open, mobile/tablet overflow, and author link.
  - This is agent-executed Playwright QA with screenshots, geometry assertions, click/navigation assertions, and cleanup receipts; no human visual inspection is required.
  - HTTP evidence required for route/provider regression.

- [x] F4. Scope Fidelity Check
  - Confirm Discourse comments/replies semantics unchanged.
  - Confirm provider playback unchanged.
  - Confirm no unrelated UI surfaces were modified.

- [x] F5. Reviewer Gate
  - Spawn reviewer with goal, plan, diff, and evidence.
  - Fix every blocker and rerun the full scenario list.
  - Completion requires unconditional `APPROVE`.

## Commit Strategy

No automatic commit. Prepare a draft commit message only:

```text
fix(video-shorts): refine native author and comments layout
```

Expected changed files:

- `discourse-video-shorts/assets/javascripts/discourse/components/video-shorts/metadata.gjs`
- `discourse-video-shorts/assets/stylesheets/common/video-shorts.scss`
- `discourse-video-shorts/test/javascripts/acceptance/videos-dedicated-player-test.js`
- `discourse-video-shorts/test/javascripts/acceptance/videos-layout-refinement-test.js`
- `.omo/ulw-loop/g010/*.mjs`
- `.omo/ulw-loop/g010/evidence/*`
- Optional only if needed: `discourse-video-shorts/lib/discourse_video_shorts/feed.rb`, `discourse-video-shorts/spec/requests/videos_feed_spec.rb`, `discourse-video-shorts/docs/video-feed-contract.md`

## Success Criteria

- Native author username is clickable and Discourse-native.
- Desktop closed state has bottom-aligned left metadata and no horizontal overflow.
- Desktop comments-open state shifts player left, opens comments panel, and moves metadata onto the video bottom.
- Phone and tablet states keep metadata visible, action buttons clickable, and no horizontal overflow.
- Provider and comments regressions pass.
- Reviewer approves unconditionally.
