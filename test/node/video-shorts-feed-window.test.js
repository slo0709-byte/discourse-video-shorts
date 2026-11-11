import assert from "node:assert/strict";
import test from "node:test";

import {
  videoShortsFeedKeyAction,
  videoShortsItemIsMounted,
} from "../../assets/javascripts/discourse/lib/video-shorts-feed-window.js";

test("mounts only the active item and up to two neighbors on either side", () => {
  const mounted = Array.from({ length: 9 }, (_, index) =>
    videoShortsItemIsMounted(index, 4),
  );

  assert.deepEqual(mounted, [
    false,
    false,
    true,
    true,
    true,
    true,
    true,
    false,
    false,
  ]);
  assert.equal(videoShortsItemIsMounted(0, 0), true);
  assert.equal(videoShortsItemIsMounted(1, 0), true);
  assert.equal(videoShortsItemIsMounted(2, 0), true);
  assert.equal(videoShortsItemIsMounted(3, 0), false);
});

test("maps route keyboard shortcuts to feed actions", () => {
  const cases = new Map([
    ["ArrowDown", "next"],
    ["j", "next"],
    ["J", "next"],
    ["ArrowUp", "previous"],
    ["k", "previous"],
    ["K", "previous"],
    [" ", "toggle-playback"],
    ["Spacebar", "toggle-playback"],
    ["m", "toggle-mute"],
    ["M", "toggle-mute"],
    ["Escape", "escape"],
  ]);

  for (const [key, expected] of cases) {
    assert.equal(videoShortsFeedKeyAction(key), expected, key);
  }

  assert.equal(videoShortsFeedKeyAction("Enter"), null);
  assert.equal(videoShortsFeedKeyAction("MediaPlayPause"), null);
});
