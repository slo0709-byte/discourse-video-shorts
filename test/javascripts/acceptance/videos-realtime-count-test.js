import {
  click,
  fillIn,
  settled,
  triggerKeyEvent,
  visit,
  waitUntil,
} from "@ember/test-helpers";
import { test } from "qunit";
import {
  acceptance,
  publishToMessageBus,
} from "discourse/tests/helpers/qunit-helpers";

function feedItem(id) {
  return {
    topic_id: id,
    post_id: id,
    post_number: 1,
    topic_url: `/t/video-${id}/${id}`,
    post_url: `/t/video-${id}/${id}/1`,
    title: `Video ${id}`,
    excerpt: `Excerpt ${id}`,
    username: "video-author",
    avatar_template: "/user_avatar/localhost/video-author/{size}/1_2.png",
    created_at: "2026-07-10T00:00:00.000Z",
    message_bus_last_id: id * 1000,
    counts: { like_count: 0, reply_count: 2, bookmark_count: 0 },
    actions: {
      liked: false,
      can_like: true,
      bookmarked: false,
      bookmark_id: null,
      can_bookmark: true,
      can_flag: true,
      can_reply: true,
      share_url: `/t/video-${id}/${id}/1`,
    },
    native_action_summary: [{ id: 2, can_act: true }],
    media: {
      provider: "native",
      renderability: "native",
      dedupe_key: `native:upload:${id}`,
      video_url: `/uploads/default/original/1X/video-${id}.mp4`,
      upload_id: id,
    },
  };
}

function railCount(postId) {
  return `[data-post-id="${postId}"] [data-action="open-comments"] .video-shorts-action-rail__count`;
}

const OPEN_COMMENTS_COUNT =
  ".video-shorts-comments-panel__count, .d-modal__title";

function deferredResponse() {
  let resolve;
  const promise = new Promise((resolvePromise) => (resolve = resolvePromise));

  return { promise, resolve };
}

function nativeCreateResponse(topicId, raw = "Local reply", postId = 9001) {
  return {
    success: true,
    action: "create_post",
    post: {
      id: postId,
      topic_id: topicId,
      topic_slug: `video-${topicId}`,
      post_number: 2,
      post_url: `/t/video-${topicId}/${topicId}/2`,
      username: "admin_user",
      display_username: "admin_user",
      avatar_template: "/user_avatar/localhost/admin_user/{size}/1_2.png",
      cooked: `<p>${raw}</p>`,
      raw,
      created_at: "2026-07-10T00:01:00.000Z",
      updated_at: "2026-07-10T00:01:00.000Z",
      reply_count: 0,
      reply_to_post_number: null,
      actions_summary: [{ id: 2, can_act: true }],
      yours: true,
    },
  };
}

function deletableReply(id, topicId) {
  return {
    id,
    post_id: id,
    topic_id: topicId,
    post_number: 2,
    user_id: 1,
    username: "admin_user",
    avatar_template: "/user_avatar/localhost/admin_user/{size}/1_2.png",
    cooked: "<p>Delete race target</p>",
    raw: "Delete race target",
    created_at: "2026-07-10T00:01:00.000Z",
    updated_at: "2026-07-10T00:01:00.000Z",
    reply_count: 0,
    reply_to_post_number: 1,
    actions_summary: [{ id: 2, can_act: true }],
    can_delete: true,
    post_url: `/t/video-${topicId}/${topicId}/2`,
    yours: true,
  };
}

function nativePostSelector(postId) {
  return `[data-video-shorts-native-comment][data-post-id="${postId}"]`;
}

function nativePostActionSelector(postId, action) {
  return `${nativePostSelector(postId)} .post-action-menu__${action}, [data-content] .post-action-menu__${action}`;
}

async function waitForActivePostId(postId) {
  await waitUntil(
    () =>
      document
        .querySelector(".video-shorts-feed__viewport")
        ?.getAttribute("data-active-post-id") === String(postId),
  );
}

async function revealNativePostActions(postId) {
  const moreActions = `${nativePostSelector(postId)} .show-more-actions`;

  if (document.querySelector(moreActions)) {
    await click(moreActions);
  }
}

acceptance("Video shorts | realtime authoritative count", function (needs) {
  let items;
  let countHandler;
  let countRequests;
  let pendingDelete;
  let deleteResponse;
  let deleteRequests;

  needs.user();
  needs.pretender((server, helper) => {
    server.get("/videos.json", () =>
      helper.response({
        items,
        next_cursor: null,
        scan_limit_reached: false,
      }),
    );
    server.get("/video-shorts/comments/count.json", (request) => {
      countRequests.push(request.queryParams.post_id);
      return countHandler(request, helper);
    });
    server.get("/posts/619/replies.json", () =>
      helper.response([deletableReply(9201, 619)]),
    );
    server.get("/posts/:post_id/replies.json", () => helper.response([]));
    server.get("/posts/9001.json", () =>
      helper.response(nativeCreateResponse(items[0].topic_id).post),
    );
    server.get("/posts/7017.json", () =>
      helper.response(nativeCreateResponse(617, "Remote reply", 7017).post),
    );
    server.post("/posts.json", (request) => {
      const body = request.requestBody || "";
      const params = body.startsWith("{")
        ? JSON.parse(body)
        : Object.fromEntries(new URLSearchParams(body));

      return helper.response(
        nativeCreateResponse(Number(params.topic_id), params.raw),
      );
    });
    server.delete("/posts/9201", () => {
      deleteRequests += 1;
      deleteResponse = helper.response;

      return pendingDelete.promise;
    });
  });

  test("closed panels sync cardinality changes while revisions only advance ordering", async function (assert) {
    items = [feedItem(611)];
    countRequests = [];
    countHandler = (_request, helper) => helper.response({ count: 7 });

    await visit("/videos");
    assert
      .dom(".video-shorts-feed__viewport")
      .hasAttribute("data-comments-open", "false");

    await publishToMessageBus(
      "/topic/611",
      { type: "created", id: 7001 },
      80,
      100,
    );

    assert.deepEqual(countRequests, ["611"], "one authoritative request");
    assert.dom(railCount(611)).hasText("7");

    await publishToMessageBus(
      "/topic/611",
      { type: "revised", id: 7001 },
      80,
      102,
    );
    assert.deepEqual(
      countRequests,
      ["611"],
      "an accepted revision makes no count request",
    );

    for (const [data, messageId] of [
      [{ type: "deleted", id: 7001 }, 101],
      [{ type: "created", id: 7001 }, 100],
      [{ type: "liked", id: 7001 }, 101],
      [{ type: "deleted" }, 102],
    ]) {
      await publishToMessageBus("/topic/611", data, 80, messageId);
    }

    assert.deepEqual(
      countRequests,
      ["611"],
      "rejected events do not make extra count requests",
    );

    await publishToMessageBus(
      "/topic/611",
      { type: "deleted", id: 7001 },
      80,
      103,
    );
    await publishToMessageBus(
      "/topic/611",
      { type: "recovered", id: 7001 },
      80,
      104,
    );
    assert.deepEqual(
      countRequests,
      ["611", "611", "611"],
      "delete and recover each refresh the authoritative count",
    );
  });

  test("network recovery refreshes the active authoritative count once", async function (assert) {
    items = [feedItem(618)];
    countRequests = [];
    countHandler = (_request, helper) => helper.response({ count: 12 });

    await visit("/videos");
    window.dispatchEvent(new Event("online"));
    await settled();

    assert.deepEqual(
      countRequests,
      ["618"],
      "reconnect makes one active count request",
    );
    assert.dom(railCount(618)).hasText("12");
  });

  test("a native local publish waits for its authoritative bus echo without double counting", async function (assert) {
    items = [feedItem(612)];
    countRequests = [];
    let authoritativeCount = 9;
    countHandler = (_request, helper) =>
      helper.response({ count: authoritativeCount });

    await visit("/videos");
    await click('[data-action="open-comments"]');
    await click('[data-action="native-top-level-reply"]');
    await fillIn("[data-video-shorts-reply-input]", "Local reply");
    await click("[data-video-shorts-reply-submit]");
    assert
      .dom(railCount(612))
      .hasText("2", "native publish does not invent an optimistic count");

    await publishToMessageBus(
      "/topic/612",
      { type: "created", id: 9001 },
      81,
      101,
    );

    assert.deepEqual(countRequests, ["612"]);
    assert
      .dom(railCount(612))
      .hasText("9", "the bus echo replaces the count with authority once");
  });

  test("an open mobile sheet follows the authoritative count before its next local mutation", async function (assert) {
    items = [feedItem(617)];
    countRequests = [];
    let authoritativeCount = 8;
    countHandler = (_request, helper) =>
      helper.response({ count: authoritativeCount });

    await visit("/videos");
    await click('[data-action="open-comments"]');
    assert.dom(OPEN_COMMENTS_COUNT).includesText("2");

    await publishToMessageBus(
      "/topic/617",
      { type: "created", id: 7017 },
      84,
      105,
    );

    assert.dom(railCount(617)).hasText("8");
    assert
      .dom(OPEN_COMMENTS_COUNT)
      .includesText(
        "8",
        "the open sheet observes the same authority as the rail",
      );

    await click('[data-action="native-top-level-reply"]');
    await fillIn("[data-video-shorts-reply-input]", "Local after remote");
    await click("[data-video-shorts-reply-submit]");
    assert.dom(railCount(617)).hasText("8");
    assert
      .dom(OPEN_COMMENTS_COUNT)
      .includesText(
        "8",
        "a local publish leaves both count surfaces at the current authority",
      );

    authoritativeCount = 9;
    await publishToMessageBus(
      "/topic/617",
      { type: "created", id: 9001 },
      84,
      106,
    );

    assert.deepEqual(countRequests, ["617", "617"]);
    assert
      .dom(railCount(617))
      .hasText("9", "the local echo updates the rail exactly once");
    assert
      .dom(OPEN_COMMENTS_COUNT)
      .includesText("9", "the open sheet follows the same authoritative value");
  });

  test("an authority-first delete does not decrement again when its local request finishes", async function (assert) {
    const item = feedItem(619);
    item.counts.reply_count = 4;
    items = [item];
    countRequests = [];
    countHandler = (_request, helper) => helper.response({ count: 3 });
    pendingDelete = deferredResponse();
    deleteResponse = null;
    deleteRequests = 0;

    try {
      await visit("/videos");
      await click('[data-action="open-comments"]');
      await revealNativePostActions(9201);
      await click(nativePostActionSelector(9201, "delete"));

      document.querySelector(".dialog-footer .btn-primary").click();

      try {
        await waitUntil(() => deleteRequests === 1);
      } catch (error) {
        throw new Error(
          `delete request did not start: requests=${deleteRequests}, dialog=${Boolean(
            document.querySelector(".dialog-footer"),
          )}, responseFactory=${Boolean(deleteResponse)}; ${error.message}`,
          { cause: error },
        );
      }

      const callbacks = window.MessageBus.callbacks.filter(
        ({ channel }) => channel === "/topic/619",
      );

      for (const callback of callbacks) {
        await callback.func({ type: "deleted", id: 9201 }, 91, 111);
      }

      try {
        await waitUntil(
          () =>
            document.querySelector(railCount(619))?.textContent.trim() === "3",
        );
      } catch (error) {
        throw new Error(
          `authority count did not render: requests=${JSON.stringify(
            countRequests,
          )}, callbacks=${callbacks.length}, rail=${document
            .querySelector(railCount(619))
            ?.textContent.trim()}; ${error.message}`,
          { cause: error },
        );
      }
      assert.deepEqual(countRequests, ["619"], "one authority request wins");

      pendingDelete.resolve(deleteResponse({}));
      await settled();

      assert.dom(railCount(619)).hasText("3");
      assert
        .dom(OPEN_COMMENTS_COUNT)
        .includesText("3", "the late local delete cannot decrement twice");

      for (const callback of callbacks) {
        await callback.func({ type: "deleted", id: 9201 }, 91, 111);
      }

      assert.deepEqual(
        countRequests,
        ["619"],
        "duplicate bus delivery is ignored",
      );
      assert.dom(railCount(619)).hasText("3");
    } finally {
      if (deleteResponse) {
        pendingDelete.resolve(deleteResponse({}));
      }
      await settled();
    }
  });

  test("switching active items rejects stale and out-of-order count responses", async function (assert) {
    items = [feedItem(613), feedItem(614)];
    countRequests = [];
    const firstResponse = deferredResponse();
    let response;
    countHandler = (request, helper) => {
      response = helper.response;
      return request.queryParams.post_id === "613"
        ? firstResponse.promise
        : helper.response({ count: 11 });
    };

    try {
      await visit("/videos");
      const firstCallback = window.MessageBus.callbacks
        .filter(({ channel }) => channel === "/topic/613")
        .at(-1);
      firstCallback.func({ type: "created", id: 7101 }, 82, 102);
      await waitUntil(() => countRequests.length === 1);

      document
        .querySelector(".video-shorts-feed__items")
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
        );
      await waitUntil(
        () =>
          document
            .querySelector(".video-shorts-feed__viewport")
            ?.getAttribute("data-active-post-id") === "614",
      );
      const secondCallback = window.MessageBus.callbacks
        .filter(({ channel }) => channel === "/topic/614")
        .at(-1);
      await secondCallback.func({ type: "deleted", id: 7102 }, 83, 103);
      await waitUntil(
        () =>
          document.querySelector(railCount(614))?.textContent.trim() === "11",
      );
      assert.dom(railCount(614)).hasText("11");

      firstResponse.resolve(response({ count: 40 }));
      await settled();

      assert.deepEqual(countRequests, ["613", "614"]);
      assert.dom(railCount(613)).hasText("2", "old active response is stale");
      assert.dom(railCount(614)).hasText("11");
    } finally {
      if (response) {
        firstResponse.resolve(response({ count: 40 }));
      }
      await settled();
    }
  });

  test("active changes and teardown unsubscribe the exact subscribed callback", async function (assert) {
    items = [feedItem(615), feedItem(616)];
    countRequests = [];
    countHandler = (_request, helper) => helper.response({ count: 1 });
    const messageBus = this.owner.lookup("service:message-bus");
    const originalSubscribe = messageBus.subscribe.bind(messageBus);
    const originalUnsubscribe = messageBus.unsubscribe.bind(messageBus);
    const subscriptions = [];
    const unsubscriptions = [];

    messageBus.subscribe = (channel, callback, ...args) => {
      if (channel.startsWith("/topic/61")) {
        subscriptions.push([channel, callback, args[0]]);
      }
      return originalSubscribe(channel, callback, ...args);
    };
    messageBus.unsubscribe = (channel, callback, ...args) => {
      if (channel.startsWith("/topic/61")) {
        unsubscriptions.push([channel, callback]);
      }
      return originalUnsubscribe(channel, callback, ...args);
    };

    try {
      await visit("/videos");
      await triggerKeyEvent(
        ".video-shorts-feed__items",
        "keydown",
        "ArrowDown",
      );
      await waitForActivePostId(616);
      await waitUntil(() =>
        subscriptions.some(([channel]) => channel === "/topic/616"),
      );
      await visit("/latest");
      await waitUntil(
        () =>
          unsubscriptions.length === subscriptions.length &&
          subscriptions.length >= 2,
      );

      assert.deepEqual(
        [...new Set(subscriptions.map(([channel]) => channel))],
        ["/topic/615", "/topic/616"],
      );
      assert.deepEqual(
        [...new Set(subscriptions.map(([, , lastId]) => lastId))],
        [615000, 616000],
        "active count subscriptions replay from their feed snapshot cursor",
      );
      assert.strictEqual(
        unsubscriptions.length,
        subscriptions.length,
        "every activation is torn down",
      );
      for (const [channel, callback] of subscriptions) {
        assert.true(
          unsubscriptions.some(
            ([closedChannel, closedCallback]) =>
              closedChannel === channel && closedCallback === callback,
          ),
          `the exact ${channel} callback is unsubscribed`,
        );
      }
    } finally {
      messageBus.subscribe = originalSubscribe;
      messageBus.unsubscribe = originalUnsubscribe;
    }
  });
});
