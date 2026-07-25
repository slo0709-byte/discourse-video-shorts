import {
  click,
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

function setupPretender(callback) {
  callback(pretender, pretenderHelpers());
}

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
      bookmark_id: null,
      can_bookmark: false,
      can_flag: false,
      can_reply: false,
      share_url: "/t/youtube-short/101/1",
    },
    native_action_summary: [],
    media: {
      provider: "youtube",
      renderability: "iframe_candidate",
      embed_url: "https://www.youtube.com/embed/dQw4w9WgXcQ",
      dedupe_key: "youtube:dQw4w9WgXcQ",
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
      provider: "bilibili",
      renderability: "iframe_candidate",
      embed_url:
        "https://player.bilibili.com/player.html?bvid=BV1Q541167Qg&page=2",
      dedupe_key: "bilibili:BV1Q541167Qg:page:2",
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
      provider: "native",
      renderability: "native",
      video_url: `/uploads/short-${index}.mp4`,
      dedupe_key: `native:upload:${index}`,
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
    native_action_summary: [
      {
        id: 2,
        can_act: true,
      },
    ],
  };
}

function untrustedYoutubeItem() {
  return {
    ...youtubeItem(),
    media: {
      provider: "youtube",
      renderability: "iframe_candidate",
      embed_url: "https://example.com/embed/dQw4w9WgXcQ",
      dedupe_key: "youtube:dQw4w9WgXcQ",
    },
  };
}

acceptance("Video Shorts dedicated playback surface", function (needs) {
  needs.settings({ video_shorts_enabled: true });
  needs.user();

  test("renders a dedicated playback surface for YouTube iframe candidates", async function (assert) {
    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [youtubeItem()],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );
    });

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

  test("renders a real iframe for Bilibili iframe candidates", async function (assert) {
    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [bilibiliItem()],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );
    });

    await visit("/videos");

    assert.dom(".video-shorts-embed-player iframe").exists({ count: 1 });
    assert
      .dom(".video-shorts-embed-player iframe")
      .hasAttribute(
        "src",
        "https://player.bilibili.com/player.html?bvid=BV1Q541167Qg&page=2&autoplay=0",
      );
    assert
      .dom(".video-shorts-embed-player iframe")
      .hasAttribute(
        "sandbox",
        "allow-scripts allow-same-origin allow-presentation",
      );
    assert.dom(".video-shorts-embed-player__fallback").doesNotExist();
  });

  test("rejects untrusted iframe candidates before rendering provider iframes", async function (assert) {
    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [untrustedYoutubeItem()],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );
    });

    await visit("/videos");

    assert.dom(".video-shorts-embed-player iframe").doesNotExist();
    assert
      .dom(".video-shorts-embed-player__fallback")
      .hasAttribute("href", "/t/youtube-short/101/1");
    assert.dom(".video-shorts-embed-player").doesNotIncludeText("<iframe");
    assert
      .dom(".video-shorts-embed-player")
      .doesNotIncludeText("example.com/embed");
  });

  test("renders only native Discourse actions in the action rail", async function (assert) {
    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [actionableYoutubeItem()],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );
    });

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
    const store = this.owner.lookup("service:store");
    const canonicalTopic = store.createRecord("topic", {
      id: 101,
      title: "Canonical action topic",
      category_id: 17,
      posters: [],
      details: {
        id: 101,
        can_create_post: false,
        can_edit_staff_notes: true,
        participants: [],
      },
    });
    const canonicalPost = store.createRecord("post", {
      id: 101,
      topic_id: 101,
      topic: canonicalTopic,
      post_number: 1,
      cooked: "<p>Canonical action post</p>",
      reply_count: 8,
      can_edit: true,
    });

    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [actionableYoutubeItem()],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );
    });

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
    assert.strictEqual(
      store.createRecord("topic", { id: 101 }),
      canonicalTopic,
      "share and flag preserve the canonical Topic identity",
    );
    assert.strictEqual(canonicalTopic.title, "Canonical action topic");
    assert.strictEqual(canonicalTopic.category_id, 17);
    assert.true(canonicalTopic.details.can_edit_staff_notes);
    assert.strictEqual(
      store.createRecord("post", { id: 101 }),
      canonicalPost,
      "share and flag preserve the canonical Post identity",
    );
    assert.strictEqual(canonicalPost.topic, canonicalTopic);
    assert.strictEqual(canonicalPost.cooked, "<p>Canonical action post</p>");
    assert.strictEqual(canonicalPost.reply_count, 8);
    assert.true(canonicalPost.can_edit);
  });

  test("bounds media players to the active screen", async function (assert) {
    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
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
    });

    await visit("/videos");

    assert
      .dom(
        '.video-shorts-embed-player iframe[src="https://www.youtube.com/embed/dQw4w9WgXcQ"]',
      )
      .doesNotExist();
    assert
      .dom(
        '.video-shorts-embed-player iframe[src="https://player.bilibili.com/player.html?bvid=BV1Q541167Qg&page=2&autoplay=0"]',
      )
      .doesNotExist();
    assert.dom(".video-shorts-native-player__video").exists({ count: 1 });
    assert.dom(".video-shorts-item__media-placeholder").exists({ count: 4 });
  });

  test("unmounts provider iframes when the active item changes", async function (assert) {
    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [youtubeItem(), bilibiliItem(), nativeItem(0)],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );
    });

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

  test("defines the vertical snap player layout contract", async function (assert) {
    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [nativeItem(0), youtubeItem(), bilibiliItem()],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );
    });

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

  test("restores the requested active video after refresh", async function (assert) {
    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [youtubeItem(), bilibiliItem(), nativeItem(0)],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );
    });

    await visit("/videos?post_id=102");

    assert
      .dom('.video-shorts-feed__item[aria-current="true"]')
      .hasAttribute("data-post-id", "102");

    await triggerKeyEvent(".video-shorts-feed__items", "keydown", "ArrowDown");
    assert
      .dom('.video-shorts-feed__item[aria-current="true"]')
      .hasAttribute("data-post-id", "200");

    await visit("/videos?post_id=200");

    assert
      .dom('.video-shorts-feed__item[aria-current="true"]')
      .hasAttribute("data-post-id", "200");
    assert.dom(".video-shorts-embed-player iframe").doesNotExist();
    assert.dom(".video-shorts-native-player__video").exists({ count: 1 });
  });

  test("falls back safely for stale video post_id", async function (assert) {
    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [nativeItem(0), nativeItem(1)],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );
    });

    await visit("/videos?post_id=999999");

    await waitUntil(
      () =>
        document
          .querySelector('[data-post-id="200"]')
          ?.getAttribute("aria-current") === "true",
    );

    assert
      .dom('.video-shorts-feed__item[aria-current="true"]')
      .hasAttribute("data-post-id", "200");
    assert.dom(".video-shorts-item").exists({ count: 2 });
  });
});
