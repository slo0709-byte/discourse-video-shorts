import {
  click,
  currentURL,
  triggerKeyEvent,
  visit,
  waitUntil,
} from "@ember/test-helpers";
import { test } from "qunit";
import FlagModal from "discourse/components/modal/flag";
import ShareTopicModal from "discourse/components/modal/share-topic";
import pretender, {
  pretenderHelpers,
} from "discourse/tests/helpers/create-pretender";
import { acceptance } from "discourse/tests/helpers/qunit-helpers";

function youtubeItem() {
  return {
    topic_id: 101,
    post_id: 101,
    post_number: 1,
    topic_url: "/t/youtube-short/101",
    post_url: "/t/youtube-short/101/1",
    title: "YouTube short",
    excerpt:
      '<a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ">raw link</a>',
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
      share_url: "/t/youtube-short/101/1",
    },
    media: {
      kind: "youtube",
      identity: "v1:youtube:dQw4w9WgXcQ",
      url: "https://www.youtube.com/embed/dQw4w9WgXcQ",
      required_origins: [],
      policy_revision: null,
      fallback_reason: null,
    },
  };
}

function bilibiliItem() {
  return {
    ...youtubeItem(),
    topic_id: 102,
    post_id: 102,
    post_url: "/t/bilibili-short/102/1",
    title: "Bilibili short",
    media: {
      kind: "bilibili",
      identity: "v1:bilibili:BV1Q541167Qg",
      url: "https://player.bilibili.com/player.html?bvid=BV1Q541167Qg&page=1",
      required_origins: [],
      policy_revision: null,
      fallback_reason: null,
    },
  };
}

function nativeItem(index) {
  return {
    ...youtubeItem(),
    topic_id: 200 + index,
    post_id: 200 + index,
    post_url: `/t/native-short/${200 + index}/1`,
    title: `Native short ${index}`,
    media: {
      kind: "upload_mp4",
      identity: `v1:upload:${index}:fixture`,
      url: `/uploads/short-${index}.mp4`,
      required_origins: [],
      policy_revision: null,
      fallback_reason: null,
    },
  };
}

function actionableYoutubeItem() {
  const item = youtubeItem();

  return {
    ...item,
    actions: {
      ...item.actions,
      can_like: true,
      can_bookmark: true,
      can_flag: true,
      can_reply: true,
    },
  };
}

function fallbackItem() {
  return {
    ...youtubeItem(),
    media: {
      kind: "fallback",
      identity: "v1:external:fixture-fallback-youtube",
      required_origins: [],
      policy_revision: null,
      fallback_reason: "invalid_youtube_url",
    },
  };
}
function feedResponse(helper, payload) {
  const { scan_limit_reached, ...feed } = payload;

  return helper.response({
    schema_version: 1,
    feed_revision: "fixture-feed-revision",
    ...feed,
    scan: {
      candidates_scanned: feed.items?.length || 0,
      scan_limit_reached: Boolean(scan_limit_reached),
      end_reached: feed.next_cursor === null,
    },
  });
}

function installVideoShortsContractHandlers(needs) {
  needs.pretender((server, helper) => {
    server.get("/videos/policy.json", () =>
      helper.response({
        revision: 0,
        external_media_enabled: false,
        origins: [],
        generated_at: "2026-06-07T00:00:00.000Z",
      }),
    );
    server.get("/posts/:post_id.json", (request) =>
      helper.response({
        id: Number(request.params.post_id),
        topic_id: Number(request.params.post_id),
        post_number: 1,
        username: "video-author",
      }),
    );
    server.get("/videos/posts/:post_id/comments.json", (request) =>
      helper.response({
        comments: [],
        has_more: false,
        next_cursor: null,
        visible_reply_count: 0,
        change_cursor: null,
        source_post_id: Number(request.params.post_id),
      }),
    );
    server.get("/videos/posts/:post_id/comments/delta.json", () =>
      helper.response({
        changes: [],
        has_more: false,
        next_change_cursor: null,
        visible_reply_count: 0,
      }),
    );
    server.post("/videos/authorization-leases.json", () =>
      helper.response({ leases: [] }),
    );
  });
}

acceptance("Video Shorts dedicated playback surface", function (needs) {
  needs.settings({ video_shorts_enabled: true });
  installVideoShortsContractHandlers(needs);
  needs.user();

  test("renders a dedicated playback surface for YouTube embeds", async function (assert) {
    ((server, helper) => {
      server.get("/videos.json", () =>
        feedResponse(helper, {
          items: [youtubeItem()],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );
    })(pretender, pretenderHelpers());

    await visit("/videos");

    assert.dom(".video-shorts-feed").exists();
    assert.dom(".video-shorts-item").exists({ count: 1 });
    assert.dom(".video-shorts-embed-player iframe").exists({ count: 1 });
    assert
      .dom(".video-shorts-embed-player iframe")
      .hasAttribute("src", "https://www.youtube.com/embed/dQw4w9WgXcQ");
    assert
      .dom(".video-shorts-embed-player iframe")
      .hasAttribute(
        "allow",
        "autoplay; fullscreen; picture-in-picture; encrypted-media",
      );
    assert
      .dom(".video-shorts-embed-player iframe")
      .hasAttribute(
        "sandbox",
        "allow-scripts allow-same-origin allow-presentation",
      );
    assert
      .dom(".video-shorts-embed-player iframe")
      .hasAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    assert.dom(".video-shorts-embed-player__fallback").doesNotExist();
    assert.dom(".video-shorts-item > .video-shorts-metadata").doesNotExist();
    assert.dom(".video-shorts-item > .video-shorts-action-rail").doesNotExist();
    assert.dom(".video-shorts-item > .video-shorts-item__info").exists();
    assert
      .dom(".video-shorts-item__info .video-shorts-metadata")
      .includesText("@video-author");
    assert
      .dom(".video-shorts-item__info .video-shorts-metadata__publisher-link")
      .exists({ count: 1 });
    assert
      .dom(".video-shorts-item__info .video-shorts-metadata__publisher-link")
      .hasText("@video-author");
    assert
      .dom(".video-shorts-item__info .video-shorts-metadata__publisher-link")
      .hasAttribute("href", "/u/video-author");
    assert
      .dom(".video-shorts-item__info .video-shorts-metadata__publisher-link")
      .hasAttribute("data-user-card", "video-author");
    assert
      .dom(".video-shorts-item__info .video-shorts-metadata")
      .includesText("YouTube short");
    assert
      .dom(".video-shorts-item__info .video-shorts-metadata")
      .includesText("raw link");
    assert
      .dom(".video-shorts-item__stage .video-shorts-metadata")
      .doesNotExist();
    assert
      .dom(".video-shorts-item__stage .video-shorts-action-rail")
      .doesNotExist();
    assert
      .dom(".video-shorts-item__player > .video-shorts-action-rail")
      .exists();
  });

  test("renders a real iframe for Bilibili embeds", async function (assert) {
    ((server, helper) => {
      server.get("/videos.json", () =>
        feedResponse(helper, {
          items: [bilibiliItem()],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );
    })(pretender, pretenderHelpers());

    await visit("/videos");

    assert.dom(".video-shorts-embed-player iframe").exists({ count: 1 });
    assert
      .dom(".video-shorts-embed-player iframe")
      .hasAttribute(
        "src",
        "https://player.bilibili.com/player.html?bvid=BV1Q541167Qg&page=1",
      );
    assert
      .dom(".video-shorts-embed-player iframe")
      .hasAttribute(
        "sandbox",
        "allow-scripts allow-same-origin allow-presentation",
      );
    assert.dom(".video-shorts-embed-player__fallback").doesNotExist();
  });

  test("uses the post URL for fallback media instead of rendering an iframe", async function (assert) {
    ((server, helper) => {
      server.get("/videos.json", () =>
        feedResponse(helper, {
          items: [fallbackItem()],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );
    })(pretender, pretenderHelpers());

    await visit("/videos");

    assert.dom(".video-shorts-embed-player iframe").doesNotExist();
    assert
      .dom(".video-shorts-embed-player__fallback")
      .hasAttribute("href", "/t/youtube-short/101/1");
  });

  test("renders only native Discourse actions in the action rail", async function (assert) {
    ((server, helper) => {
      server.get("/videos.json", () =>
        feedResponse(helper, {
          items: [actionableYoutubeItem()],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );
    })(pretender, pretenderHelpers());

    await visit("/videos");

    const actions = [
      ...document.querySelectorAll(".video-shorts-action-rail [data-action]"),
    ].map((element) => element.dataset.action);

    assert.deepEqual(actions, [
      "like",
      "bookmark",
      "open-comments",
      "share",
      "flag",
      "open-topic",
    ]);
    assert.dom('[data-action="dislike"]').doesNotExist();
    assert.dom('[data-action="subscribe"]').doesNotExist();
    assert.dom('[data-action="sound"]').doesNotExist();
    assert.dom('[data-action="music"]').doesNotExist();
    assert
      .dom('[data-action="open-topic"]')
      .hasAttribute("href", "/t/youtube-short/101/1");
  });

  test("opens native Discourse share and flag modals from the action rail", async function (assert) {
    ((server, helper) => {
      server.get("/videos.json", () =>
        feedResponse(helper, {
          items: [actionableYoutubeItem()],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );
    })(pretender, pretenderHelpers());

    const shownModals = [];
    const modal = this.owner.lookup("service:modal");
    const originalShow = modal.show;

    modal.show = (component, options) => {
      shownModals.push({
        component,
        topicId: options?.model?.topic?.id,
        postId: options?.model?.post?.id,
        flagPostId: options?.model?.flagModel?.id,
      });
    };

    try {
      await visit("/videos");
      await click('[data-action="share"]');
      await click('[data-action="flag"]');
    } finally {
      modal.show = originalShow;
    }

    assert.deepEqual(shownModals, [
      {
        component: ShareTopicModal,
        topicId: 101,
        postId: 101,
        flagPostId: undefined,
      },
      {
        component: FlagModal,
        topicId: undefined,
        postId: undefined,
        flagPostId: 101,
      },
    ]);
  });

  test("mounts native players for the active item and immediate neighbor only", async function (assert) {
    ((server, helper) => {
      server.get("/videos.json", () =>
        feedResponse(helper, {
          items: [
            nativeItem(0),
            nativeItem(1),
            nativeItem(2),
            youtubeItem(),
            bilibiliItem(),
          ],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );
    })(pretender, pretenderHelpers());

    await visit("/videos");

    assert
      .dom(
        '.video-shorts-embed-player iframe[src="https://www.youtube.com/embed/dQw4w9WgXcQ"]',
      )
      .doesNotExist();
    assert
      .dom(
        '.video-shorts-embed-player iframe[src="https://player.bilibili.com/player.html?bvid=BV1Q541167Qg&page=2"]',
      )
      .doesNotExist();
    assert.dom(".video-shorts-native-player__video").exists({ count: 2 });
    assert.dom(".video-shorts-item__media-placeholder").exists({ count: 3 });

    await triggerKeyEvent(".video-shorts-feed__items", "keydown", "ArrowDown");
    await waitUntil(
      () =>
        document
          .querySelector('[data-post-id="201"]')
          ?.getAttribute("aria-current") === "true",
    );

    assert.dom(".video-shorts-native-player__video").exists({ count: 3 });
    assert.strictEqual(
      document.querySelectorAll(
        ".video-shorts-native-player__video, .video-shorts-embed-player iframe",
      ).length,
      3,
      "only the active native player and its immediate neighbors are mounted",
    );
  });

  test("unmounts embeds when the active item changes", async function (assert) {
    ((server, helper) => {
      server.get("/videos.json", () =>
        feedResponse(helper, {
          items: [youtubeItem(), bilibiliItem(), nativeItem(0)],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );
    })(pretender, pretenderHelpers());

    await visit("/videos");

    const youtube = document.querySelector('[data-post-id="101"]');
    const bilibili = document.querySelector('[data-post-id="102"]');
    const native = document.querySelector('[data-post-id="200"]');

    assert
      .dom('[data-post-id="101"] .video-shorts-embed-player iframe')
      .exists({ count: 1 });

    await triggerKeyEvent(".video-shorts-feed__items", "keydown", "ArrowDown");
    await waitUntil(() => bilibili?.getAttribute("aria-current") === "true");

    assert.strictEqual(
      youtube.querySelectorAll(".video-shorts-embed-player iframe").length,
      0,
      "the previous YouTube iframe is unmounted after it leaves the active screen",
    );
    assert.strictEqual(
      bilibili.querySelectorAll(".video-shorts-embed-player iframe").length,
      1,
      "the active Bilibili item renders one iframe",
    );
    assert.dom(".video-shorts-embed-player iframe").exists({ count: 1 });

    await triggerKeyEvent(".video-shorts-feed__items", "keydown", "ArrowDown");
    await waitUntil(() => native?.getAttribute("aria-current") === "true");

    assert.strictEqual(
      bilibili.querySelectorAll(".video-shorts-embed-player iframe").length,
      0,
      "the previous Bilibili iframe is unmounted after it leaves the active screen",
    );
    assert.dom(".video-shorts-embed-player iframe").doesNotExist();
    assert
      .dom('[data-post-id="200"] .video-shorts-native-player__video')
      .exists({ count: 1 });
  });

  test("cleans up active-only embeds when navigating A to B to A", async function (assert) {
    ((server, helper) => {
      server.get("/videos.json", () =>
        feedResponse(helper, {
          items: [nativeItem(0), youtubeItem(), nativeItem(1)],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );
    })(pretender, pretenderHelpers());

    await visit("/videos");

    assert.dom(".video-shorts-native-player").exists({ count: 1 });
    assert.dom(".video-shorts-embed-player iframe").doesNotExist();

    await triggerKeyEvent(".video-shorts-feed__items", "keydown", "ArrowDown");
    await waitUntil(
      () =>
        document
          .querySelector('[data-post-id="101"]')
          ?.getAttribute("aria-current") === "true",
    );

    assert.dom(".video-shorts-native-player").exists({ count: 2 });
    assert.dom(".video-shorts-embed-player iframe").exists({ count: 1 });

    await triggerKeyEvent(".video-shorts-feed__items", "keydown", "ArrowUp");
    await waitUntil(
      () =>
        document
          .querySelector('[data-post-id="200"]')
          ?.getAttribute("aria-current") === "true",
    );

    assert.dom(".video-shorts-native-player").exists({ count: 1 });
    assert.dom(".video-shorts-embed-player iframe").doesNotExist();
  });

  test("pauses a preloaded neighbor when it starts playback", async function (assert) {
    ((server, helper) => {
      server.get("/videos.json", () =>
        feedResponse(helper, {
          items: [nativeItem(0), nativeItem(1)],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );
    })(pretender, pretenderHelpers());

    await visit("/videos");

    const [, neighbor] = document.querySelectorAll(
      ".video-shorts-native-player__video",
    );
    let pauses = 0;
    neighbor.pause = () => pauses++;

    neighbor.dispatchEvent(new Event("play"));

    assert.strictEqual(pauses, 1, "the inactive player is paused");
  });

  test("resumes mounted native players after hidden to visible", async function (assert) {
    ((server, helper) => {
      server.get("/videos.json", () =>
        feedResponse(helper, {
          items: [nativeItem(0), nativeItem(1)],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );
    })(pretender, pretenderHelpers());

    await visit("/videos");

    const visibilityState = Object.getOwnPropertyDescriptor(
      document,
      "visibilityState",
    );

    try {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));

      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));

      await waitUntil(() =>
        [...document.querySelectorAll(".video-shorts-native-player__video")].every(
          (video) => video.getAttribute("src"),
        ),
      );
      assert.dom(".video-shorts-native-player__video").exists({ count: 2 });
    } finally {
      if (visibilityState) {
        Object.defineProperty(document, "visibilityState", visibilityState);
      } else {
        delete document.visibilityState;
      }
    }
  });

  test("continues loading near the end without a load-more button", async function (assert) {
    let continuationRequests = 0;

    ((server, helper) => {
      server.get("/videos.json", (request) => {
        if (request.queryParams.cursor === "next") {
          continuationRequests += 1;
          return feedResponse(helper, {
            items: [nativeItem(1)],
            next_cursor: null,
            scan_limit_reached: false,
          });
        }

        return feedResponse(helper, {
          items: [nativeItem(0)],
          next_cursor: "next",
          scan_limit_reached: true,
        });
      });
    })(pretender, pretenderHelpers());

    await visit("/videos");

    await waitUntil(() => document.querySelector('[data-post-id="201"]'));

    assert.strictEqual(continuationRequests, 1);
    assert.dom(".video-shorts-load-more").doesNotExist();
  });
  test("defines the vertical snap player layout contract", async function (assert) {
    ((server, helper) => {
      server.get("/videos.json", () =>
        feedResponse(helper, {
          items: [nativeItem(0), youtubeItem(), bilibiliItem()],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );
    })(pretender, pretenderHelpers());

    await visit("/videos");

    const feedItems = document.querySelector(".video-shorts-feed__items");
    const firstItem = document.querySelector(".video-shorts-feed__item");
    const stage = firstItem.querySelector(".video-shorts-item__stage");
    const metadata = firstItem.querySelector(
      ".video-shorts-item__info .video-shorts-metadata",
    );
    const actionRail = firstItem.querySelector(
      ".video-shorts-item__player > .video-shorts-action-rail",
    );

    assert.dom(".video-shorts-feed__item").exists({ count: 3 });
    assert
      .dom('.video-shorts-feed__item[aria-current="true"]')
      .exists({ count: 1 });
    assert.strictEqual(
      getComputedStyle(feedItems).scrollSnapType,
      "y mandatory",
      "the feed snaps vertically between shorts",
    );
    assert.strictEqual(
      getComputedStyle(firstItem).scrollSnapAlign,
      "center",
      "each short is a centered snap target",
    );
    assert.strictEqual(
      getComputedStyle(stage).aspectRatio,
      "9 / 16",
      "the player stage is a vertical short",
    );
    assert.true(
      Boolean(metadata),
      "metadata is rendered in the item info column outside the player stage",
    );
    assert.strictEqual(
      stage.querySelector(".video-shorts-metadata"),
      null,
      "desktop metadata is not nested inside the player stage",
    );
    assert.true(
      Boolean(actionRail),
      "action rail is rendered beside the player stage inside the item player",
    );
  });

  test("keeps the active video in the URL and restores it after refresh", async function (assert) {
    ((server, helper) => {
      server.get("/videos.json", () =>
        feedResponse(helper, {
          items: [youtubeItem(), bilibiliItem(), nativeItem(0)],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );
    })(pretender, pretenderHelpers());

    await visit("/videos?post_id=102");

    const bilibili = document.querySelector('[data-post-id="102"]');
    const native = document.querySelector('[data-post-id="200"]');

    await waitUntil(() => bilibili?.getAttribute("aria-current") === "true", {
      timeoutMessage: "requested Bilibili item did not become active",
    });

    assert.strictEqual(
      currentURL(),
      "/videos?post_id=102",
      "the requested post id is restored as the active short",
    );

    await triggerKeyEvent(".video-shorts-feed__items", "keydown", "ArrowDown");
    await waitUntil(() => native?.getAttribute("aria-current") === "true", {
      timeoutMessage: "keyboard navigation did not activate the native item",
    });

    assert.strictEqual(
      currentURL(),
      "/videos?post_id=200",
      "active short changes replace the URL state",
    );

    await visit("/videos?post_id=200");
    await waitUntil(
      () =>
        document
          .querySelector('[data-post-id="200"]')
          ?.getAttribute("aria-current") === "true",
      {
        timeoutMessage: "refreshed native item did not restore as active",
      },
    );

    assert
      .dom('.video-shorts-feed__item[aria-current="true"]')
      .hasAttribute("data-post-id", "200");
    assert.dom(".video-shorts-embed-player iframe").doesNotExist();
    assert.dom(".video-shorts-native-player").exists({ count: 1 });
  });

  test("falls back safely for stale video post_id", async function (assert) {
    ((server, helper) => {
      server.get("/videos.json", () =>
        feedResponse(helper, {
          items: [nativeItem(0), nativeItem(1)],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );
    })(pretender, pretenderHelpers());

    await visit("/videos?post_id=999999");

    await waitUntil(
      () =>
        document
          .querySelector('[data-post-id="200"]')
          ?.getAttribute("aria-current") === "true",
    );

    await waitUntil(() => currentURL() === "/videos?post_id=200", {
      timeoutMessage: "stale post id was not normalized to the visible item",
    });

    assert
      .dom('.video-shorts-feed__item[aria-current="true"]')
      .hasAttribute("data-post-id", "200");
    assert.strictEqual(
      currentURL(),
      "/videos?post_id=200",
      "stale ids fall back visibly and normalize the URL to the visible item",
    );
    assert.dom(".video-shorts-item").exists({ count: 2 });
  });
});
