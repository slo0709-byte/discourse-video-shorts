import { triggerKeyEvent, visit, waitUntil } from "@ember/test-helpers";
import { test } from "qunit";
import pretender, {
  pretenderHelpers,
} from "discourse/tests/helpers/create-pretender";
import { acceptance } from "discourse/tests/helpers/qunit-helpers";

function feedItem(id, provider, embedUrl) {
  return {
    topic_id: id,
    post_id: id,
    post_number: 1,
    topic_url: `/t/${provider}-video/${id}`,
    post_url: `/t/${provider}-video/${id}/1`,
    title: `${provider} video`,
    excerpt: `${provider} excerpt`,
    username: "video-author",
    avatar_template: "/user_avatar/localhost/video-author/{size}/1_2.png",
    created_at: "2026-07-28T00:00:00.000Z",
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
      share_url: `/t/${provider}-video/${id}/1`,
    },
    native_action_summary: [],
    media: {
      provider,
      renderability: "iframe_candidate",
      embed_url: embedUrl,
      dedupe_key: `${provider}:${id}`,
    },
  };
}

acceptance("Video Shorts TikTok and Douyin providers", function (needs) {
  needs.settings({ video_shorts_enabled: true });

  test("hands the single active iframe from TikTok to Douyin", async function (assert) {
    pretender.get("/videos.json", () =>
      pretenderHelpers().response({
        items: [
          feedItem(
            1,
            "tiktok",
            "https://www.tiktok.com/player/v1/6718335390845095173?autoplay=0&loop=1&rel=0"
          ),
          feedItem(
            2,
            "douyin",
            "https://open.douyin.com/player/video?vid=7380000000000000001&autoplay=0"
          ),
        ],
        next_cursor: null,
        scan_limit_reached: false,
      })
    );

    await visit("/videos");

    assert.dom(".video-shorts-embed-player iframe").exists({ count: 1 });
    assert
      .dom(
        ".video-shorts-feed__item[aria-current='true'] .video-shorts-item"
      )
      .hasAttribute("data-video-shorts-provider", "tiktok");
    assert
      .dom(".video-shorts-embed-player iframe")
      .hasAttribute("data-video-shorts-provider", "tiktok");

    await triggerKeyEvent(".video-shorts-feed__items", "keydown", "ArrowDown");
    await waitUntil(
      () =>
        document
          .querySelector('[data-post-id="2"]')
          ?.getAttribute("aria-current") === "true"
    );

    assert.dom(".video-shorts-embed-player iframe").exists({ count: 1 });
    assert
      .dom(
        ".video-shorts-feed__item[aria-current='true'] .video-shorts-item"
      )
      .hasAttribute("data-video-shorts-provider", "douyin");
    assert
      .dom(".video-shorts-embed-player iframe")
      .hasAttribute("data-video-shorts-provider", "douyin");
    assert.dom('iframe[src*="/player/v1/"]').doesNotExist();
  });
});
