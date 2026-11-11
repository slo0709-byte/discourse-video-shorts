# TikTok-Style Discourse Video Page

## TL;DR
> **Summary**: Rework `/videos` from a Discourse-style 16:9 list into a TikTok/YouTube Shorts-style vertical snap player while preserving Discourse shell, theme compatibility, native post actions, and safe provider iframe policy.
> **Deliverables**:
> - Vertical 9:16 short-video feed with one active item per viewport
> - Overlay metadata and action rail inside the player
> - Real iframe playback for trusted YouTube and Bilibili embeds
> - Regression coverage for unsafe providers and Discourse layout compatibility
> **Effort**: Medium
> **Parallel**: YES - 3 waves
> **Critical Path**: Task 1 -> Task 2 -> Task 4 -> Final Verification

## Context
### Original Request
The user clarified that the intended interaction is YouTube Shorts/TikTok-like: a vertical short-video player with swipe/scroll between videos. Prior work overcorrected into a Discourse-compatible 16:9 list, which is not the requested product shape.

### Interview Summary
- The page must be a dedicated short-video playback route.
- It must not clone YouTube/TikTok branding or replace Discourse chrome.
- It must preserve Discourse-native interactions and theme behavior.
- Trusted YouTube and Bilibili embeds must render as playable iframes.

### Metis Review (gaps addressed)
Metis classified this as an immersive route-layout rewrite, not a component polish pass. Gaps addressed in this plan:
- Current implementation contradicts the target: it is a Discourse-width 16:9 list, not a vertical short-video feed.
- Active-index behavior exists, but snap semantics are incomplete without `scroll-snap`, viewport-height items, and header-adjusted geometry.
- Provider iframe loading needs an explicit performance decision.
- Existing tests do not assert full-height panels, 9:16 stage, active-item centering, mobile safe-area fit, or Discourse header compatibility.
- “Compatible with Discourse” means a route-local immersive viewport inside Discourse chrome, not a full-site takeover.

## Work Objectives
### Core Objective
Make `/videos` behave like a TikTok/YouTube Shorts vertical feed inside Discourse: one active vertical player centered in the content area, snap navigation by scroll and keyboard, overlay metadata/action rail, and trusted provider playback.

### Deliverables
- `/videos` route visual layout: vertical player, snap feed, Discourse-safe surrounding shell.
- Frontend behavior: active item updates reliably on scroll and keyboard.
- Media behavior: native MP4, YouTube iframe, Bilibili iframe render in the active/near-active player path.
- Tests and browser QA artifacts proving the exact user-visible behavior.

### Definition of Done
- `node .omo/ulw-loop/g004/tiktok_layout_browser_test.mjs` passes against `http://23.165.248.117/videos`.
- `node .omo/ulw-loop/g004/provider_browser_test.mjs` passes for YouTube and Bilibili active items.
- `curl -i http://23.165.248.117/videos.json?page_size=10` shows YouTube and Bilibili trusted embeds as `iframe_candidate` and unsafe providers as fallback.
- Prettier, ESLint, Stylelint, and Ruby syntax checks pass for touched files.
- Independent reviewer returns unconditional approval.

### Must Have
- One active video item per viewport in the feed.
- Stage aspect ratio is approximately 9:16, not 16:9.
- Feed uses scroll snap and keyboard ArrowUp/ArrowDown/J/K to move between items.
- Discourse header/sidebar/theme remain present; no global body/html black takeover.
- Black/dark background is scoped to the video feed viewing area and player stage, not the whole site.
- Metadata/action rail overlay player content.
- Provider iframes render as real iframes when trusted and active/near active.
- The route uses `calc(100dvh - var(--header-offset, 0px))` or equivalent measured header-adjusted viewport height for feed panels.

### Must NOT Have
- No ordinary stacked 16:9 list.
- No full-site clone branding or non-Discourse action system.
- No unsafe arbitrary iframe rendering.
- No raw iframe/provider text leaking into excerpts.
- No global layout hacks that break topic lists, sidebar, header, composer, or other routes.

## Verification Strategy
> ZERO HUMAN INTERVENTION - all verification is agent-executed.
- Test decision: TDD where environment allows. Add/adjust QUnit acceptance tests first; local QUnit may be blocked by Ruby mismatch, so use test files plus live Playwright RED/GREEN evidence as execution proof.
- QA policy: Every task has agent-executed browser or HTTP scenarios.
- Evidence: `.omo/ulw-loop/g004/evidence/task-{N}-*.txt|json|png`

## Execution Strategy
### Parallel Execution Waves
Wave 1:
- Task 1: write RED browser QA and acceptance tests for TikTok-style vertical layout.
- Task 2: write RED provider-active playback regression test.
- Task 3: preserve HTTP provider/security contract tests.

Wave 2:
- Task 4: implement vertical snap layout and active-item behavior.
- Task 5: tune player overlay/action rail for vertical stage.
- Task 6: keep provider iframe rendering compatible with active/near-active window.
- Task 6b: verify native video active playback boundaries.

Wave 3:
- Task 7: deploy to remote and run browser/HTTP QA.
- Task 8: update docs to describe the final UX contract.

### Dependency Matrix
| Task | Depends on | Blocks | Can parallelize with |
|---|---|---|---|
| 1 | none | 4, 7 | 2, 3 |
| 2 | none | 6, 7 | 1, 3 |
| 3 | none | 7 | 1, 2 |
| 4 | 1 | 5, 7 | 6 after Task 2 |
| 5 | 4 | 7 | 6 |
| 6 | 2 | 7 | 5, 6b |
| 6b | 4 | 7 | 5, 6 |
| 7 | 4, 5, 6, 6b, 3 | Final Verification | 8 |
| 8 | behavior settled from 4-7 | Final Verification | 7 |

## TODOs
- [x] 1. Add RED TikTok-Style Layout Tests

  **What to do**: Add a new Playwright QA script `.omo/ulw-loop/g004/tiktok_layout_browser_test.mjs` and update `test/javascripts/acceptance/videos-dedicated-player-test.js`. The test must fail on current 16:9 list behavior by asserting vertical 9:16 stage, scroll-snap feed, one active item centered in the viewport, and overlay controls inside stage.
  **Must NOT do**: Do not change production code in this task.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 4, 7 | Blocked By: none

  **References**:
  - Current CSS: `discourse-video-shorts/assets/stylesheets/common/video-shorts.scss` - currently 16:9 list, must fail.
  - Current active tracking: `discourse-video-shorts/assets/javascripts/discourse/components/video-shorts/feed.gjs` - reuse active index behavior.
  - Existing acceptance pattern: `discourse-video-shorts/test/javascripts/acceptance/videos-dedicated-player-test.js`.

  **Acceptance Criteria**:
  - [ ] RED browser script fails before production CSS/JS changes with message containing `expected 9:16 vertical stage`.
  - [ ] QUnit acceptance test fixture includes at least three items and asserts snap feed/player semantics.

  **QA Scenarios**:
  ```text
  Scenario: Current layout fails vertical short-player contract
    Tool: bash + Playwright
    Steps: node .omo/ulw-loop/g004/tiktok_layout_browser_test.mjs against http://23.165.248.117/videos
    Expected: non-zero exit before implementation because stage aspect is 16:9 or feed is list-like
    Evidence: .omo/ulw-loop/g004/evidence/task-1-red-layout.txt

  Scenario: Acceptance test exists and is syntax-safe
    Tool: bash
    Steps: pnpm prettier --check plugins/discourse-video-shorts/test/javascripts/acceptance/videos-dedicated-player-test.js
    Expected: command exits 0
    Evidence: .omo/ulw-loop/g004/evidence/task-1-test-format.txt
  ```

  **Commit**: YES | Message: `test(video-shorts): define vertical shorts layout contract` | Files: acceptance test, QA script

- [x] 2. Add RED Provider Playback Within Active Vertical Feed Test

  **What to do**: Extend browser QA to scroll through the vertical feed and assert YouTube and Bilibili active items each render one iframe with exact `src`, no fallback, and no raw iframe text.
  **Must NOT do**: Do not weaken provider security checks or render all arbitrary iframes.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 6, 7 | Blocked By: none

  **References**:
  - Provider policy: `discourse-video-shorts/assets/javascripts/discourse/lib/video-shorts-embed-policy.js`.
  - Provider component: `discourse-video-shorts/assets/javascripts/discourse/components/video-shorts/embed-player.gjs`.
  - Current QA script pattern: `.omo/ulw-loop/g003/provider_browser_test.mjs`.

  **Acceptance Criteria**:
  - [ ] Browser script asserts exact YouTube and Bilibili iframe `src`.
  - [ ] Script also asserts active item is the provider item when checked.

  **QA Scenarios**:
  ```text
  Scenario: Provider iframe renders in active vertical player
    Tool: Playwright
    Steps: open /videos, scroll/keyboard to YouTube QA item, then Bilibili QA item
    Expected: each active item has exactly one iframe with expected src and fallbackCount=0
    Evidence: .omo/ulw-loop/g004/evidence/task-2-provider-browser.json

  Scenario: Unsafe provider remains blocked
    Tool: curl + Node assertion
    Steps: curl -i http://23.165.248.117/videos.json?page_size=10 and inspect unsupported QA item
    Expected: unsupported item renderability=fallback and no embed_url
    Evidence: .omo/ulw-loop/g004/evidence/task-2-unsafe-http.txt
  ```

  **Commit**: YES | Message: `test(video-shorts): cover provider playback in vertical feed` | Files: acceptance test, QA script

- [x] 3. Preserve HTTP Provider and Escaped-Iframe Contracts

  **What to do**: Keep or extend request/spec coverage for YouTube, Bilibili, escaped iframe text, and unsupported provider fallback. Add one contract assertion if missing for Bilibili canonical URL as iframe_candidate.
  **Must NOT do**: Do not introduce b23.tv expansion or arbitrary iframe trust.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 7 | Blocked By: none

  **References**:
  - Extractor: `discourse-video-shorts/lib/discourse_video_shorts/media_extractor.rb`.
  - Feed serialization: `discourse-video-shorts/lib/discourse_video_shorts/feed.rb`.
  - Specs: `discourse-video-shorts/spec/lib/media_extractor_spec.rb`, `discourse-video-shorts/spec/requests/videos_feed_spec.rb`.

  **Acceptance Criteria**:
  - [ ] Existing tests still assert Bilibili iframe_candidate and escaped iframe scrub.
  - [ ] Unsafe arbitrary provider still has no `embed_url`.

  **QA Scenarios**:
  ```text
  Scenario: Provider HTTP contract remains valid
    Tool: curl + Node assertion
    Steps: curl -i http://23.165.248.117/videos.json?page_size=10
    Expected: YouTube/Bilibili iframe_candidate; unsafe fallback
    Evidence: .omo/ulw-loop/g004/evidence/task-3-provider-http.txt

  Scenario: Escaped iframe text does not leak
    Tool: curl + Node assertion
    Steps: inspect existing "Video Shorts QA Escaped Bilibili Iframe" item
    Expected: media is Bilibili iframe_candidate; excerpt has no <iframe, &lt;iframe, or player.bilibili.com
    Evidence: .omo/ulw-loop/g004/evidence/task-3-escaped-http.txt
  ```

  **Commit**: YES | Message: `test(video-shorts): preserve provider serialization contract` | Files: specs/QA scripts

- [x] 4. Implement Vertical Snap Feed Inside Discourse Shell

  **What to do**: Update `video-shorts.scss` and, if needed, `feed.gjs` so `/videos` becomes a vertical snap feed. Use a viewport-height feed area under Discourse header, one item per snap page, centered 9:16 stage. Restore dark viewing area locally inside `.video-shorts-feed__viewport`, not globally on body/html or unrelated routes. Keep route inside Discourse app shell.
  **Must NOT do**: Do not use previous `left:50%; width:100vw; margin-left:-50vw` as a global full-bleed hack. Do not remove header/sidebar compatibility.

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: 5, 7 | Blocked By: 1

  **References**:
  - Existing Shorts-like earlier behavior was closer in `feed.gjs`: active index, keyboard nav, `scrollIntoView`.
  - Current list CSS in `video-shorts.scss` must change from `display:grid` list and `16 / 9`.
  - Use Discourse CSS variables such as `--header-offset`, `--secondary`, and existing BEM class names.

  **Acceptance Criteria**:
  - [ ] `.video-shorts-feed__items` has vertical overflow and `scroll-snap-type: y mandatory`.
  - [ ] `.video-shorts-feed__item` height approximates one viewport below header.
  - [ ] `.video-shorts-item__stage` aspect ratio is `9 / 16`.
  - [ ] Desktop page keeps Discourse chrome; black/dark area is scoped to feed viewport/player.

  **QA Scenarios**:
  ```text
  Scenario: Vertical player geometry
    Tool: Playwright
    Steps: open /videos at 390x844 and 1280x900; measure active stage rect and feed background scope
    Expected: stage aspect between 0.52 and 0.60; active item centered; no body/html full black takeover
    Evidence: .omo/ulw-loop/g004/evidence/task-4-geometry.json

  Scenario: Keyboard snap navigation
    Tool: Playwright
    Steps: focus feed, press ArrowDown/J, inspect aria-current and scroll position
    Expected: exactly one item has aria-current=true and it changes to the next item
    Evidence: .omo/ulw-loop/g004/evidence/task-4-keyboard.json
  ```

  **Commit**: YES | Message: `fix(video-shorts): restore vertical snap player layout` | Files: SCSS, feed component if needed

- [x] 5. Tune Overlay Metadata and Action Rail for Vertical Stage

  **What to do**: Adjust metadata and action rail placement for 9:16 player. Title/excerpt sit near bottom-left within stage; action rail sits right-center/bottom-right inside stage; controls do not overflow on mobile.
  **Must NOT do**: Do not put metadata/action controls outside the player or into separate cards.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 7 | Blocked By: 4

  **References**:
  - `discourse-video-shorts/assets/javascripts/discourse/components/video-shorts/metadata.gjs`.
  - `discourse-video-shorts/assets/javascripts/discourse/components/video-shorts/action-rail.gjs`.
  - Current overlay styles in `video-shorts.scss`.

  **Acceptance Criteria**:
  - [ ] Metadata/action rail are descendants of `.video-shorts-item__stage`.
  - [ ] Buttons remain at least 44px touch targets.
  - [ ] Long title/excerpt wraps/clamps without covering action rail.

  **QA Scenarios**:
  ```text
  Scenario: Overlay controls inside vertical player
    Tool: Playwright
    Steps: open /videos mobile and desktop; inspect bounding boxes of metadata/action rail/stage
    Expected: controls are inside stage rect and do not overlap incoherently
    Evidence: .omo/ulw-loop/g004/evidence/task-5-overlay.json

  Scenario: Long text clamp
    Tool: Playwright
    Steps: inspect existing long-titled QA item
    Expected: title/excerpt visible but clipped/wrapped within stage; no horizontal overflow
    Evidence: .omo/ulw-loop/g004/evidence/task-5-long-text.png
  ```

  **Commit**: YES | Message: `fix(video-shorts): fit overlays to vertical player` | Files: SCSS, component markup only if necessary

- [x] 6. Preserve Provider Rendering in the Vertical Active Window

  **What to do**: Decide and implement the provider iframe loading policy for the vertical feed: provider iframes render for active±1 only, matching native preload bounds, but the active provider item must never be a placeholder after scroll/keyboard navigation. Update the previous “provider iframes outside preload window” acceptance test to the new vertical-feed contract.
  **Must NOT do**: Do not eagerly render all third-party iframes across the full response page; keep performance bounded.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 7 | Blocked By: 2

  **References**:
  - `item.gjs` currently has `hasProviderIframe` and `shouldRenderMedia`.
  - `feed.gjs` computes `isWithinPreloadWindow`.
  - `embed-player.gjs` uses browser-side trusted iframe policy.

  **Acceptance Criteria**:
  - [ ] Active provider item always renders iframe.
  - [ ] Provider iframe and native video rendering remain bounded to active±1.
  - [ ] Unsafe provider still renders fallback link.

  **QA Scenarios**:
  ```text
  Scenario: Active provider item renders iframe after snap
    Tool: Playwright
    Steps: keyboard/scroll to YouTube and Bilibili QA items
    Expected: active provider item has one iframe and zero placeholders
    Evidence: .omo/ulw-loop/g004/evidence/task-6-provider-active.json

  Scenario: Unsafe candidate is fallback
    Tool: Playwright
    Steps: inspect unsupported QA item
    Expected: no iframe, fallback link exists
    Evidence: .omo/ulw-loop/g004/evidence/task-6-unsafe-browser.json
  ```

  **Commit**: YES | Message: `fix(video-shorts): render active provider embeds in snap feed` | Files: item/feed components, tests


- [x] 6b. Verify Native Video Active Playback Boundaries

  **What to do**: Add browser QA for native MP4 behavior in the vertical feed. Active native video should be loaded/visible; off-window native videos should not eagerly load heavy media. If autoplay policy blocks playback, the pass condition is loaded active video element with controls and no page errors, not automatic play.
  **Must NOT do**: Do not depend on browser autoplay succeeding for pass/fail.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 7 | Blocked By: 4

  **References**:
  - Native player: `discourse-video-shorts/assets/javascripts/discourse/components/video-shorts/native-player.gjs`.
  - Item render policy: `discourse-video-shorts/assets/javascripts/discourse/components/video-shorts/item.gjs`.

  **Acceptance Criteria**:
  - [ ] Active native item has one `<video>` element.
  - [ ] Off-window native items render placeholders or unloaded media according to the bounded preload policy.
  - [ ] Browser console has no page errors.

  **QA Scenarios**:
  ```text
  Scenario: Active native video loads in vertical player
    Tool: Playwright
    Steps: navigate to native MP4 QA item; inspect active item
    Expected: active item has one video element, correct src, controls available
    Evidence: .omo/ulw-loop/g004/evidence/task-6b-native-active.json

  Scenario: Off-window native videos remain bounded
    Tool: Playwright
    Steps: inspect native item two or more panels away from active item
    Expected: no eager video element outside active±1
    Evidence: .omo/ulw-loop/g004/evidence/task-6b-native-bounded.json
  ```

  **Commit**: YES | Message: `test(video-shorts): verify native playback bounds` | Files: QA scripts, acceptance tests if needed

- [x] 7. Remote Deployment and End-to-End QA

  **What to do**: Sync plugin to remote test site, precompile assets, restart service, then run the full browser and HTTP scenario suite against `23.165.248.117`.
  **Must NOT do**: Do not print secrets in evidence or final answer.

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: Final Verification | Blocked By: 3, 4, 5, 6, 6b

  **References**:
  - Prior deployment command pattern in `.omo/ulw-loop/g003/evidence/remote-precompile-provider-preload-fix.txt`.
  - Remote URL: `http://23.165.248.117/videos`.

  **Acceptance Criteria**:
  - [ ] Remote service returns `/srv/status` OK after deploy.
  - [ ] All browser scripts pass at mobile and desktop viewports.
  - [ ] HTTP provider/security contracts pass.

  **QA Scenarios**:
  ```text
  Scenario: Remote vertical TikTok-style playback
    Tool: Playwright
    Steps: open /videos at mobile 390x844 and desktop 1280x900, scroll through native, YouTube, Bilibili
    Expected: snap feed, active 9:16 stage, provider iframes correct, action rail overlay
    Evidence: .omo/ulw-loop/g004/evidence/task-7-remote-browser.json

  Scenario: Remote HTTP provider contract
    Tool: curl
    Steps: curl -i http://23.165.248.117/videos.json?page_size=10
    Expected: trusted providers iframe_candidate; unsafe fallback
    Evidence: .omo/ulw-loop/g004/evidence/task-7-remote-http.txt
  ```

  **Commit**: NO | Message: n/a | Files: deployment evidence only

- [x] 8. Update UX Contract Documentation

  **What to do**: Update README/docs to describe the intended UX as Discourse-compatible vertical short-video feed, not ordinary 16:9 list. Include provider iframe contract and explicit exclusions.
  **Must NOT do**: Do not describe it as a YouTube/TikTok clone or imply custom social actions.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: Final Verification | Blocked By: 4 final behavior

  **References**:
  - `discourse-video-shorts/README.md`.
  - `discourse-video-shorts/docs/video-feed-contract.md`.

  **Acceptance Criteria**:
  - [ ] Docs say vertical 9:16 snap feed inside Discourse shell.
  - [ ] Docs say provider iframes are allowlisted and revalidated.
  - [ ] Docs say unsupported providers fallback.

  **QA Scenarios**:
  ```text
  Scenario: Docs match implementation
    Tool: bash
    Steps: rg -n "vertical|9:16|iframe_candidate|fallback" discourse-video-shorts/README.md discourse-video-shorts/docs/video-feed-contract.md
    Expected: all required contract terms present
    Evidence: .omo/ulw-loop/g004/evidence/task-8-docs-contract.txt

  Scenario: Docs formatting
    Tool: bash
    Steps: pnpm prettier --check ../discourse-video-shorts/README.md ../discourse-video-shorts/docs/video-feed-contract.md from /root/shipinye/discourse
    Expected: exits 0
    Evidence: .omo/ulw-loop/g004/evidence/task-8-docs-prettier.txt
  ```

  **Commit**: YES | Message: `docs(video-shorts): document vertical short-feed contract` | Files: README/docs

## Final Verification Wave
> ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
- [x] F1. Plan Compliance Audit: compare changed files and evidence against every TODO.
- [x] F2. Code Quality Review: independent reviewer checks layout, JS behavior, provider security, docs.
- [x] F3. Real Manual QA: rerun browser and HTTP QA on remote after all changes.
- [x] F4. Scope Fidelity Check: confirm no custom non-Discourse actions, no unsafe provider expansion, no global theme breakage.

## Commit Strategy
- Do not auto-commit unless user explicitly authorizes.
- Suggested final commit if authorized: `fix(video-shorts): restore vertical short-form player`
- Keep docs in the same commit only if behavior and docs are deployed together; otherwise use `docs(video-shorts): document vertical short-feed contract`.

## Success Criteria
- `/videos` visually and behaviorally matches TikTok/YouTube Shorts core interaction: vertical, 9:16, one active item, snap navigation.
- It remains a Discourse page: Discourse chrome/theme/actions preserved.
- YouTube and Bilibili trusted embeds play as iframes in the active vertical player.
- Escaped iframe text does not leak.
- Unsafe providers remain fallback-only.
- Remote browser/HTTP QA and reviewer approval are captured.
