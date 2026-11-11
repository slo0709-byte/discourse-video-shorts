import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const actionRailPath = new URL(
  "../../assets/javascripts/discourse/components/video-shorts/action-rail.gjs",
  import.meta.url,
);
const feedPath = new URL("../../lib/discourse_video_shorts/feed.rb", import.meta.url);

test("does not expose the removed publisher channel entry", async () => {
  const [actionRail, feed] = await Promise.all([
    readFile(actionRailPath, "utf8"),
    readFile(feedPath, "utf8"),
  ]);

  assert.doesNotMatch(actionRail, /open-channel|publisher_channel_url/);
  assert.doesNotMatch(feed, /publisher_channel_url|PublisherChannelPolicy/);
});
