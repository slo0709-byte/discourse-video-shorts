import { click, currentURL, visit } from "@ember/test-helpers";
import { test } from "qunit";
import pretender, {
  pretenderHelpers,
} from "discourse/tests/helpers/create-pretender";
import { acceptance } from "discourse/tests/helpers/qunit-helpers";

const LONG_EXCERPT =
  "This is a deliberately long video summary that should be shortened before expansion.";

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
      can_bookmark: false,
      can_flag: false,
      can_reply: false,
      share_url: "/t/long-summary-video/901/1",
    },
    media: {
      kind: "upload_mp4",
      identity: "v1:upload:901:fixture",
      url: "/uploads/default/original/1X/video-901.mp4",
      required_origins: [],
      policy_revision: null,
      fallback_reason: null,
    },
  };
}

acceptance("Video Shorts excerpt expansion", function (needs) {
  needs.settings({
    video_shorts_enabled: true,
    video_shorts_excerpt_character_limit: 22,
  });
  needs.pretender((server, helper) => {
    server.get("/videos/policy.json", () =>
      helper.response({
        revision: 1,
        external_media_enabled: false,
        origins: [],
        generated_at: "2026-06-07T00:00:00.000Z",
      }),
    );
  });

  test("truncates long excerpts to the configured character limit and expands in place", async function (assert) {
    ((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [feedItem()],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );
    })(pretender, pretenderHelpers());

    await visit("/videos");

    assert.strictEqual(currentURL(), "/videos");
    assert
      .dom(".video-shorts-metadata__excerpt-text")
      .hasText("This is a deliberately...");
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
      .hasText("This is a deliberately...");
    assert
      .dom(".video-shorts-metadata__excerpt-expand")
      .hasText("Show more", "collapsed excerpts expose expand again");
  });

  test("does not render an expand button when the excerpt fits the configured limit", async function (assert) {
    ((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [feedItem("Short summary")],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );
    })(pretender, pretenderHelpers());

    await visit("/videos");

    assert.dom(".video-shorts-metadata__excerpt-text").hasText("Short summary");
    assert.dom(".video-shorts-metadata__excerpt-expand").doesNotExist();
  });
});
