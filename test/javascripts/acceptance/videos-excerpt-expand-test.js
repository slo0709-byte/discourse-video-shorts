import { click, currentURL, visit } from "@ember/test-helpers";
import { test } from "qunit";
import pretender, {
  pretenderHelpers,
} from "discourse/tests/helpers/create-pretender";
import { acceptance } from "discourse/tests/helpers/qunit-helpers";

const LONG_EXCERPT =
  "This is a deliberately long video summary that should be shortened before expansion.";
const EXCERPT_LIMIT = 24;
const COLLAPSED_EXCERPT = `${LONG_EXCERPT.slice(0, EXCERPT_LIMIT).trimEnd()}...`;

function setupPretender(callback) {
  callback(pretender, pretenderHelpers());
}

function feedItem(excerpt = LONG_EXCERPT) {
  return {
    topic_id: 901,
    post_id: 901,
    post_number: 1,
    topic_url: "/t/long-summary-video/901",
    post_url: "/t/long-summary-video/901/1",
    title: "Long summary video",
    excerpt,
    username: "video-author",
    avatar_template: "/user_avatar/localhost/video-author/{size}/1_2.png",
    created_at: "2026-06-07T00:00:00.000Z",
    counts: {
      like_count: 0,
      reply_count: 0,
      bookmark_count: 0,
    },
    actions: {
      liked: false,
      can_like: false,
      bookmarked: false,
      bookmark_id: null,
      can_bookmark: false,
      can_flag: false,
      can_reply: false,
      share_url: "/t/long-summary-video/901/1",
    },
    native_action_summary: [],
    media: {
      provider: "native",
      renderability: "native",
      dedupe_key: "native:upload:901",
      video_url: "/uploads/default/original/1X/video-901.mp4",
      upload_id: 901,
    },
  };
}

acceptance("Video Shorts excerpt expansion", function (needs) {
  needs.settings({
    video_shorts_enabled: true,
    video_shorts_excerpt_character_limit: EXCERPT_LIMIT,
  });

  test("truncates long excerpts to the configured character limit and expands in place", async function (assert) {
    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [feedItem()],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );
    });

    await visit("/videos");

    assert.strictEqual(currentURL(), "/videos");
    assert
      .dom(".video-shorts-metadata__excerpt-text")
      .hasText(COLLAPSED_EXCERPT);
    assert
      .dom(".video-shorts-metadata__excerpt-expand")
      .hasText("Show more", "long excerpts expose an expand control");

    await click(".video-shorts-metadata__excerpt-expand");

    assert.strictEqual(currentURL(), "/videos");
    assert.dom(".video-shorts-metadata__excerpt-text").hasText(LONG_EXCERPT);
    assert
      .dom(".video-shorts-metadata__excerpt-expand")
      .hasText("Show less", "expanded excerpts expose a collapse control");

    await click(".video-shorts-metadata__excerpt-expand");

    assert.strictEqual(currentURL(), "/videos");
    assert
      .dom(".video-shorts-metadata__excerpt-text")
      .hasText(COLLAPSED_EXCERPT);
    assert
      .dom(".video-shorts-metadata__excerpt-expand")
      .hasText("Show more", "collapsed excerpts expose expand again");
  });

  test("does not render an expand button when the excerpt fits the configured limit", async function (assert) {
    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [feedItem("Short summary")],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );
    });

    await visit("/videos");

    assert
      .dom(".video-shorts-metadata__excerpt-text")
      .hasText("Short summary");
    assert.dom(".video-shorts-metadata__excerpt-expand").doesNotExist();
  });
});
