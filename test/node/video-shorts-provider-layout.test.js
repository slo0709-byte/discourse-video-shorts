import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const stylesheetPath = new URL(
  "../../assets/stylesheets/common/video-shorts.scss",
  import.meta.url,
);

test("keeps compact provider chrome below native player controls", async () => {
  const stylesheet = await readFile(stylesheetPath, "utf8");

  assert.match(
    stylesheet,
    /\.video-shorts-item\[data-video-shorts-provider="youtube"\]\s*\{[^}]*--video-shorts-desktop-metadata-controls-reserve:\s*7\.5rem;[^}]*--video-shorts-action-bottom-clearance:\s*1\.5rem;/s,
    "desktop YouTube restores its original metadata and action reserves",
  );
  assert.match(
    stylesheet,
    /\.video-shorts-item\[data-video-shorts-provider="bilibili"\]\s*\{[^}]*--video-shorts-desktop-metadata-controls-reserve:\s*3\.25rem;[^}]*--video-shorts-action-bottom-clearance:\s*1rem;/s,
    "desktop Bilibili restores its original metadata and action reserves",
  );
  assert.doesNotMatch(
    stylesheet,
    /--video-shorts-desktop-metadata-external-gap|grid-template-rows:\s*auto auto/,
    "desktop provider metadata no longer uses the new external grid row",
  );
  assert.match(
    stylesheet,
    /\.video-shorts-item\[data-video-shorts-provider="youtube"\]\s*\{[^}]*--video-shorts-mobile-metadata-controls-reserve:\s*6\.5rem;[^}]*--video-shorts-mobile-rail-controls-reserve:\s*6\.5rem;/s,
    "mobile YouTube metadata and actions stay above its native pause row",
  );
  assert.match(
    stylesheet,
    /\.video-shorts-item\[data-video-shorts-provider="bilibili"\]\s*\{[^}]*--video-shorts-mobile-metadata-controls-reserve:\s*3rem;[^}]*--video-shorts-mobile-rail-controls-reserve:\s*2\.5rem;/s,
    "mobile Bilibili metadata and actions move down independently",
  );
  assert.match(
    stylesheet,
    /\.video-shorts-item:is\(\s*\[data-video-shorts-provider="youtube"\],\s*\[data-video-shorts-provider="bilibili"\]\s*\)\s+\.video-shorts-metadata__excerpt\s*\{[^}]*-webkit-line-clamp:\s*1;/s,
    "provider excerpts occupy at most one line over the player",
  );
  assert.match(
    stylesheet,
    /\.video-shorts-item:is\(\s*\[data-video-shorts-provider="youtube"\],\s*\[data-video-shorts-provider="bilibili"\]\s*\)\s+\.video-shorts-item-title\s*\{[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s,
    "provider titles stay on one compact line",
  );

  const compactRules = stylesheet.indexOf(
    '.video-shorts-item:is(\n      [data-video-shorts-provider="youtube"],',
  );
  const mobileMedia = stylesheet.lastIndexOf(
    "@media (width < 1024px)",
    compactRules,
  );
  const desktopMedia = stylesheet.lastIndexOf(
    "@media (width >= 1024px)",
    compactRules,
  );

  assert.ok(compactRules > -1, "provider compact rules exist");
  assert.ok(
    mobileMedia > desktopMedia,
    "provider compact text rules apply only inside the mobile media query",
  );
});

test("uses Discourse theme tokens for polished desktop chrome", async () => {
  const stylesheet = await readFile(stylesheetPath, "utf8");
  const desktopStart = stylesheet.indexOf("@media (width >= 1024px)");
  const mobileStart = stylesheet.indexOf(
    "@media (width < 1024px)",
    desktopStart,
  );
  const desktopStyles = stylesheet.slice(desktopStart, mobileStart);

  assert.match(
    desktopStyles,
    /--video-shorts-desktop-stage-border:\s*1px solid var\(--primary-low\);/,
    "desktop stage border follows the active Discourse theme",
  );
  assert.match(
    desktopStyles,
    /--video-shorts-desktop-control-background:\s*var\(--secondary\);/,
    "desktop controls use the theme surface",
  );
  assert.match(
    desktopStyles,
    /--video-shorts-desktop-control-border:\s*var\(--primary-low\);/,
    "desktop controls use the theme border",
  );
  assert.match(
    desktopStyles,
    /\.video-shorts-item\s*\{[^}]*background:\s*transparent;/s,
    "desktop item no longer paints a hard-coded background",
  );
  assert.match(
    desktopStyles,
    /\.video-shorts-metadata__publisher\s*\{[^}]*font-size:\s*var\(--font-down-1\);/s,
    "desktop publisher uses the secondary theme type step",
  );
  assert.match(
    desktopStyles,
    /\.video-shorts-item-title\s*\{[^}]*font-size:\s*var\(--font-up-1\);/s,
    "desktop title uses the refined theme title step",
  );
  assert.match(
    desktopStyles,
    /\.video-shorts-metadata__excerpt\s*\{[^}]*font-size:\s*var\(--font-down-1\);/s,
    "desktop excerpt uses the secondary theme type step",
  );
  assert.match(
    desktopStyles,
    /\.video-shorts-action-rail__button\s*\{[^}]*border:\s*1px solid var\(--video-shorts-desktop-control-border\)\s*!important;[^}]*background:\s*var\(--video-shorts-desktop-control-background\)\s*!important;/s,
    "desktop rail buttons use theme-owned surfaces and borders",
  );
});

test("keeps desktop metadata unboxed over a YouTube-style fade", async () => {
  const stylesheet = await readFile(stylesheetPath, "utf8");
  const desktopStart = stylesheet.indexOf("@media (width >= 1024px)");
  const mobileStart = stylesheet.indexOf(
    "@media (width < 1024px)",
    desktopStart,
  );
  const desktopStyles = stylesheet.slice(desktopStart, mobileStart);

  assert.match(
    desktopStyles,
    /\.video-shorts-item__stage::after\s*\{[^}]*height:\s*42%;[^}]*background:\s*linear-gradient\(\s*to top,\s*rgb\(0 0 0 \/ 0\.78\),\s*rgb\(0 0 0 \/ 0\.42\) 52%,\s*transparent\s*\);/s,
    "desktop media uses a bottom fade behind metadata",
  );
  assert.match(
    desktopStyles,
    /\.video-shorts-metadata\s*\{[^}]*padding:\s*0;[^}]*border:\s*0;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/s,
    "desktop metadata has no independent card surface",
  );
  assert.match(
    desktopStyles,
    /\.video-shorts-metadata__excerpt-expand\s*\{[^}]*border:\s*0;[^}]*color:\s*inherit;[^}]*background:\s*transparent;/s,
    "desktop expand affordance remains inline instead of becoming a badge",
  );
});
