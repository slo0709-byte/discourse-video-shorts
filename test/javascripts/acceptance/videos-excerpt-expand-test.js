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

    const playbackGeometry = () => {
      const scroller = document.querySelector(".video-shorts-feed__items");
      const activeItem = document.querySelector(
        '.video-shorts-feed__item[aria-current="true"]',
      );
      const player = activeItem.querySelector(".video-shorts-item__player");
      const stage = activeItem.querySelector(".video-shorts-item__stage");

      return {
        scrollTop: scroller.scrollTop,
        itemTop: activeItem.getBoundingClientRect().top,
        playerTop: player.getBoundingClientRect().top,
        stageTop: stage.getBoundingClientRect().top,
        stageHeight: stage.getBoundingClientRect().height,
      };
    };
    const collapsedGeometry = playbackGeometry();

    await click(".video-shorts-metadata__excerpt-expand");

    assert.strictEqual(currentURL(), "/videos");
    assert.dom(".video-shorts-metadata__excerpt-text").hasText(LONG_EXCERPT);
    assert
      .dom(".video-shorts-metadata__excerpt-expand")
      .hasText("Show less", "expanded excerpts expose a collapse control");
    assert.deepEqual(
      playbackGeometry(),
      collapsedGeometry,
      "expanding metadata cannot move the feed, snap item, player, or video stage",
    );

    await click(".video-shorts-metadata__excerpt-expand");

    assert.strictEqual(currentURL(), "/videos");
    assert
      .dom(".video-shorts-metadata__excerpt-text")
      .hasText(COLLAPSED_EXCERPT);
    assert
      .dom(".video-shorts-metadata__excerpt-expand")
      .hasText("Show more", "collapsed excerpts expose expand again");
    assert.deepEqual(
      playbackGeometry(),
      collapsedGeometry,
      "collapsing metadata restores text without moving the video stage",
    );
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

  test("keeps Chinese metadata on natural phrase boundaries", async function (assert) {
    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [
            feedItem(
              "原视频作者：ZGL蛇语者 视频来源：哔哩哔哩 原片是竖屏，用来检查较长视频的播放与评论切换",
            ),
          ],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );
    });

    await visit("/videos");

    const excerpt = document.querySelector(
      ".video-shorts-metadata__excerpt",
    );
    const excerptStyle = getComputedStyle(excerpt);

    assert.strictEqual(
      excerptStyle.wordBreak,
      "keep-all",
      "Chinese metadata keeps CJK words and proper names together",
    );
    assert.strictEqual(
      excerptStyle.lineBreak,
      "strict",
      "Chinese punctuation follows strict line-breaking rules",
    );
    assert.true(
      excerpt.scrollWidth <= excerpt.clientWidth,
      "phrase-aware wrapping does not introduce horizontal overflow",
    );
  });

  test("keeps the final Chinese phrase on one line", async function (assert) {
    const excerptText = "竖向信息流里的小字是否仍然可读。";

    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [feedItem(excerptText)],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );
    });

    await visit("/videos");

    assert
      .dom(".video-shorts-metadata__excerpt-text")
      .hasText(excerptText, "the rendered excerpt preserves its source text");
    assert
      .dom(".video-shorts-metadata__excerpt-tail")
      .hasText(
        "是否仍然可读。",
        "the final semantic phrase is rendered as one protected unit",
      );

    const tail = document.querySelector(
      ".video-shorts-metadata__excerpt-tail",
    );
    const tailStyle = getComputedStyle(tail);

    assert.strictEqual(
      tailStyle.display,
      "inline-block",
      "the protected tail is an atomic inline formatting box",
    );
    assert.strictEqual(
      tailStyle.whiteSpace,
      "nowrap",
      "the browser cannot split the protected phrase",
    );
  });
});
