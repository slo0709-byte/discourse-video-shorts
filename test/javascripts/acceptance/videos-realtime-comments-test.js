import { click, settled, visit, waitUntil } from "@ember/test-helpers";
import { test } from "qunit";
import pretender, {
  pretenderHelpers,
} from "discourse/tests/helpers/create-pretender";
import {
  acceptance,
  publishToMessageBus,
} from "discourse/tests/helpers/qunit-helpers";

function feedItem(id, replyCount = 2) {
  return {
    topic_id: id,
    post_id: id,
    post_number: 1,
    topic_url: `/t/realtime-${id}/${id}`,
    post_url: `/t/realtime-${id}/${id}/1`,
    title: `Realtime ${id}`,
    excerpt: `Excerpt ${id}`,
    user_id: id,
    username: "video-author",
    avatar_template: "/user_avatar/localhost/video-author/{size}/1_2.png",
    created_at: "2026-07-01T00:00:00.000Z",
    message_bus_last_id: id * 1000,
    counts: { like_count: 0, reply_count: replyCount, bookmark_count: 0 },
    actions: {
      liked: false,
      can_like: true,
      bookmarked: false,
      bookmark_id: null,
      can_bookmark: true,
      can_flag: true,
      can_reply: true,
      share_url: `/t/realtime-${id}/${id}/1`,
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

function post(id, postNumber, cooked, attrs = {}) {
  return {
    id,
    post_number: postNumber,
    user_id: id,
    username: attrs.username || "comment-author",
    avatar_template: "/user_avatar/localhost/comment-author/{size}/1_2.png",
    cooked,
    raw: cooked.replace(/<[^>]*>/g, ""),
    created_at: "2026-07-02T00:00:00.000Z",
    reply_count: attrs.reply_count || 0,
    reply_to_post_number: attrs.reply_to_post_number || null,
    can_edit: false,
    can_delete: false,
    can_flag: false,
  };
}

function setupServer(callback) {
  const helper = pretenderHelpers();
  const repliesByPostId = new Map();
  const server = new Proxy(pretender, {
    get(target, property) {
      if (property === "get") {
        return (path, handler, ...args) => {
          const match = path.match(/^\/posts\/(\d+)\/replies\.json$/);

          if (match) {
            repliesByPostId.set(match[1], handler);
          }

          return target.get(path, handler, ...args);
        };
      }

      const value = Reflect.get(target, property);

      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  pretender.get("/video-shorts/comments/count.json", () =>
    helper.response({ count: 2 })
  );
  callback(server, helper);
  pretender.get("/video-shorts/comments/replies.json", (request) => {
    const handler = repliesByPostId.get(request.queryParams.post_id);

    if (!handler) {
      return helper.response(404, { error: "not_found" });
    }

    const normalizeResponse = (response) => {
      const [status, headers, posts] = response;

      return status === 200 && Array.isArray(posts)
        ? [
            status,
            headers,
            {
              posts,
              has_more: posts.length === 20,
              next_after: posts.at(-1)?.post_number || null,
            },
          ]
        : response;
    };
    const response = handler(request);

    return typeof response?.then === "function"
      ? response.then(normalizeResponse)
      : normalizeResponse(response);
  });
}

async function publish(topicId, type, id, messageId) {
  await publishToMessageBus(
    `/topic/${topicId}`,
    { type, id },
    topicId * 100 + messageId,
    messageId
  );
  await settled();
}

function row(id) {
  return `.video-shorts-comments-surface [data-video-shorts-native-comment][data-post-id="${id}"]`;
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

async function closeComments() {
  const selector = document.querySelector("[data-action='close-comments']")
    ? "[data-action='close-comments']"
    : ".d-modal__close";

  await click(selector);
}

acceptance("Video Shorts realtime comment content", function (needs) {
  needs.settings({ video_shorts_enabled: true });
  needs.user();

  test("PIN: comments stay bounded and unloaded until the surface opens", async function (assert) {
    let directRepliesRequests = 0;

    setupServer((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({ items: [feedItem(700, 0)], next_cursor: null })
      );
      server.get("/posts/700/replies.json", () => {
        directRepliesRequests += 1;
        return helper.response([]);
      });
    });

    await visit("/videos");
    assert.strictEqual(
      directRepliesRequests,
      0,
      "a closed comments surface does not load direct replies"
    );

    await click("[data-action='open-comments']");
    assert.strictEqual(
      directRepliesRequests,
      1,
      "opening uses one bounded /posts/:source/replies.json request"
    );
  });

  test("created, revised, deleted, destroyed, and recovered update loaded content without changing the count", async function (assert) {
    const canonical = new Map();
    const fetches = new Map();

    setupServer((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({ items: [feedItem(701)], next_cursor: null })
      );
      server.get("/posts/701/replies.json", () =>
        helper.response([post(711, 2, "<p>Original</p>")])
      );
      for (const id of [711, 712]) {
        server.get(`/posts/${id}.json`, () => {
          fetches.set(id, (fetches.get(id) || 0) + 1);
          return helper.response(canonical.get(id));
        });
      }
    });

    await visit("/videos");
    await click("[data-action='open-comments']");
    const countText = document.querySelector(".d-modal__title")?.textContent;

    canonical.set(712, post(712, 3, "<p>Created once</p>"));
    await publish(701, "created", 712, 1);
    assert.strictEqual(
      fetches.get(712),
      1,
      "the accepted realtime event completes its canonical fetch"
    );
    await waitUntil(() => Boolean(document.querySelector(row(712))));
    await publish(701, "created", 712, 1);
    await publish(701, "liked", 712, 6);
    assert
      .dom(row(712))
      .exists({ count: 1 })
      .includesText(
        "Created once",
        "awaiting the MessageBus callback observes canonical DOM"
      );
    assert.strictEqual(
      fetches.get(712),
      1,
      "duplicate and malformed events do not refetch"
    );

    canonical.set(711, post(711, 2, "<p>Revised canonical</p>"));
    await publish(701, "revised", 711, 2);
    await publish(701, "revised", 711, 1);
    assert.dom(row(711)).exists({ count: 1 }).includesText("Revised canonical");
    assert.strictEqual(fetches.get(711), 1, "an older revision is ignored");

    await publish(701, "deleted", 711, 3);
    await publish(701, "destroyed", 711, 4);
    assert.dom(row(711)).doesNotExist("delete and destroy remove only once");

    canonical.set(711, post(711, 2, "<p>Recovered canonical</p>"));
    await publish(701, "recovered", 711, 5);
    assert.dom(row(711)).exists({ count: 1 }).includesText("Recovered canonical");
    assert.strictEqual(
      document.querySelector(".d-modal__title")?.textContent,
      countText,
      "content events do not own the displayed reply count"
    );
  });

  test("initial loading preserves realtime creates and tombstones realtime deletes", async function (assert) {
    let resolveInitialReplies;
    let canonicalFetches = 0;
    const messageBus = this.owner.lookup("service:message-bus");
    const originalSubscribe = messageBus.subscribe.bind(messageBus);
    const subscriptionCursors = [];

    messageBus.subscribe = (channel, callback, lastId, ...args) => {
      if (channel === "/topic/706") {
        subscriptionCursors.push(lastId);
      }

      return originalSubscribe(channel, callback, lastId, ...args);
    };

    setupServer((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({ items: [feedItem(706, 1)], next_cursor: null })
      );
      server.get("/posts/706/replies.json", () => {
        return new Promise((resolve) => {
          resolveInitialReplies = () =>
            resolve(
              helper.response([
                post(761, 2, "<p>Existing reply</p>"),
                post(763, 4, "<p>Deleted during loading</p>"),
              ])
            );
        });
      });
      server.get("/posts/762.json", () => {
        canonicalFetches += 1;
        return helper.response(post(762, 3, "<p>Concurrent realtime reply</p>"));
      });
    });

    try {
      await visit("/videos");
      const openingComments = click("[data-action='open-comments']");
      await waitUntil(() => Boolean(resolveInitialReplies));
      const callback = window.MessageBus.callbacks
        .filter(({ channel }) => channel === "/topic/706")
        .at(-1);
      await callback.func({ type: "created", id: 762 }, 70601, 1);
      await waitUntil(() => canonicalFetches === 1);
      callback.func({ type: "deleted", id: 763 }, 70602, 2);
      resolveInitialReplies();
      await openingComments;
      await settled();

      assert.dom(row(761)).exists("the initial response remains visible");
      assert
        .dom(row(762))
        .exists({ count: 1 })
        .includesText(
          "Concurrent realtime reply",
          "the realtime reply survives the older initial response"
        );
      assert
        .dom(row(763))
        .doesNotExist(
          "a realtime delete cannot be reinserted by the old response"
        );
      assert.deepEqual(
        [...new Set(subscriptionCursors)],
        [706000],
        "topic subscriptions replay from the feed snapshot cursor"
      );
    } finally {
      resolveInitialReplies?.();
      messageBus.subscribe = originalSubscribe;
      await settled();
    }
  });

  test("loaded branches receive one child while unloaded branches stay folded and use the native loader", async function (assert) {
    let branchFetches = 0;
    const canonical = new Map([
      [
        723,
        post(723, 4, "<p>Realtime hidden child</p>", {
          reply_to_post_number: 2,
        }),
      ],
    ]);

    setupServer((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({ items: [feedItem(702, 3)], next_cursor: null })
      );
      server.get("/posts/702/replies.json", () =>
        helper.response([
          post(721, 2, "<p>Collapsed parent</p>", { reply_count: 2 }),
          post(722, 3, "<p>Other top level</p>"),
        ])
      );
      server.get("/posts/721/replies.json", () => {
        branchFetches += 1;
        return helper.response([
          post(724, 5, "<p>Native loaded child</p>", {
            reply_to_post_number: 2,
          }),
          canonical.get(723),
        ]);
      });
      for (const id of [723, 725]) {
        server.get(`/posts/${id}.json`, () =>
          helper.response(canonical.get(id))
        );
      }
    });

    await visit("/videos");
    await click("[data-action='open-comments']");
    await publish(702, "created", 723, 1);

    assert.strictEqual(branchFetches, 0, "realtime does not pull an unloaded branch");
    assert.dom(row(723)).doesNotExist("unloaded child is not rendered");

    await click(`${row(721)} [data-video-shorts-view-replies]`);
    assert.strictEqual(branchFetches, 1, "expansion uses the native branch loader");
    assert.dom(row(723)).exists({ count: 1 });

    canonical.set(
      725,
      post(725, 6, "<p>Loaded branch realtime child</p>", {
        reply_to_post_number: 2,
      })
    );
    await publish(702, "created", 725, 2);
    await publish(702, "created", 725, 2);
    assert.dom(row(725)).exists({ count: 1 });
    assert.strictEqual(branchFetches, 1, "realtime never reloads the branch");

    await publish(702, "deleted", 721, 3);
    assert
      .dom(row(721))
      .exists({ count: 1 })
      .includesText(
        "Deleted comment",
        "a realtime-deleted expanded parent remains as a placeholder"
      );
    assert.dom(row(724)).exists({ count: 1 }, "the native child remains visible");
    assert.dom(row(723)).exists({ count: 1 }, "the loaded child remains visible");
    assert.dom(row(725)).exists({ count: 1 }, "the realtime child remains visible");
    assert.strictEqual(branchFetches, 1, "delete does not reload the branch");
  });

  test("realtime deleting an unloaded parent preserves its direct children under a native placeholder", async function (assert) {
    let branchFetches = 0;

    setupServer((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({ items: [feedItem(708, 3)], next_cursor: null })
      );
      server.get("/posts/708/replies.json", () =>
        helper.response([
          post(781, 2, "<p>Collapsed parent deleted elsewhere</p>", {
            reply_count: 2,
          }),
        ])
      );
      server.get("/posts/781/replies.json", () => {
        branchFetches += 1;

        return helper.response([
          post(782, 3, "<p>First preserved remote child</p>", {
            reply_to_post_number: 2,
          }),
          post(783, 4, "<p>Second preserved remote child</p>", {
            reply_to_post_number: 2,
          }),
        ]);
      });
    });

    await visit("/videos");
    await click("[data-action='open-comments']");

    assert.strictEqual(branchFetches, 0, "the branch starts collapsed");
    assert.dom(row(782)).doesNotExist();
    assert.dom(row(783)).doesNotExist();

    await publish(708, "deleted", 781, 1);

    assert.strictEqual(
      branchFetches,
      1,
      "the remote delete fetches only the deleted parent's direct branch"
    );
    assert
      .dom(row(781))
      .exists({ count: 1 })
      .includesText("Deleted comment");
    assert
      .dom(row(782))
      .exists({ count: 1 })
      .includesText("First preserved remote child");
    assert
      .dom(row(783))
      .exists({ count: 1 })
      .includesText("Second preserved remote child");
  });

  test("a superseded realtime delete cannot expand or mutate its stale reply branch", async function (assert) {
    const pendingBranch = deferred();
    let branchFetches = 0;

    setupServer((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({ items: [feedItem(709, 1)], next_cursor: null })
      );
      server.get("/posts/709/replies.json", () =>
        helper.response([
          post(791, 2, "<p>Parent before recovery</p>", { reply_count: 1 }),
        ])
      );
      server.get("/posts/791/replies.json", () => {
        branchFetches += 1;
        return pendingBranch.promise;
      });
      server.get("/posts/791.json", () =>
        helper.response(post(791, 2, "<p>Recovered canonical parent</p>", {
          reply_count: 1,
        }))
      );
    });

    await visit("/videos");
    await click("[data-action='open-comments']");

    const callbacks = window.MessageBus.callbacks.filter(
      ({ channel }) => channel === "/topic/709"
    );
    const staleDelete = Promise.all(
      callbacks.map(({ func }) => func({ type: "deleted", id: 791 }, 70901, 1))
    );

    await waitUntil(() => branchFetches === 1);
    await Promise.all(
      callbacks.map(({ func }) =>
        func({ type: "recovered", id: 791 }, 70902, 2)
      )
    );

    pendingBranch.resolve(
      pretenderHelpers().response([
        post(792, 3, "<p>Child from stale delete request</p>", {
          reply_to_post_number: 2,
        }),
      ])
    );
    await staleDelete;
    await settled();

    assert.dom(row(791)).includesText("Recovered canonical parent");
    assert.dom(row(792)).doesNotExist("the stale branch never enters the tree");
    assert
      .dom("[data-post-id='791'] [data-video-shorts-load-more-replies]")
      .doesNotExist("the stale branch does not force an expanded state");
  });

  test("the video panel exposes one reply expansion path per native comment", async function (assert) {
    setupServer((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({ items: [feedItem(710, 1)], next_cursor: null })
      );
      server.get("/posts/710/replies.json", () =>
        helper.response([
          post(801, 2, "<p>One branch entry</p>", { reply_count: 1 }),
        ])
      );
    });

    await visit("/videos");
    await click("[data-action='open-comments']");

    assert
      .dom("[data-post-id='801'] [data-video-shorts-view-replies]")
      .exists({ count: 1 }, "the panel owns one full-native-comment loader");
    assert
      .dom("[data-post-id='801'] .post-action-menu__show-replies")
      .doesNotExist("core embedded replies are not exposed as a second path");
  });

  test("closing unsubscribes, reopening subscribes once, and closed events do not fetch", async function (assert) {
    let canonicalFetches = 0;

    setupServer((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({ items: [feedItem(703, 0)], next_cursor: null })
      );
      server.get("/posts/703/replies.json", () => helper.response([]));
      const canonicalResponse = (id) => {
        return () => {
          canonicalFetches += 1;
          return helper.response(
            post(id, 2, "<p>Open only</p>", {
              reply_to_post_number: 1,
            })
          );
        };
      };
      server.get("/posts/731.json", canonicalResponse(731));
      server.get("/posts/732.json", canonicalResponse(732));
    });

    await visit("/videos");
    await click("[data-action='open-comments']");
    (
      document.querySelector("[data-action='close-comments']") ||
      document.querySelector(".d-modal__close")
    ).click();
    await waitUntil(
      () => !document.querySelector(".video-shorts-comments-surface")
    );
    await publish(703, "created", 731, 1);
    assert.strictEqual(canonicalFetches, 0, "closed surface does not fetch");

    await click("[data-action='open-comments']");
    await publish(703, "created", 732, 2);
    assert.strictEqual(canonicalFetches, 1, "one reopened subscription handles the event");
    assert.dom(row(732)).exists({ count: 1 });
  });

  test("network recovery reloads only an open comments surface", async function (assert) {
    let directRepliesRequests = 0;
    let replies = [
      post(751, 2, "<p>Recovered before offline</p>", {
        can_edit: false,
        version: 1,
      }),
    ];

    setupServer((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({ items: [feedItem(705, 0)], next_cursor: null })
      );
      server.get("/posts/705/replies.json", () => {
        directRepliesRequests += 1;
        return helper.response(replies);
      });
    });

    await visit("/videos");
    window.dispatchEvent(new Event("online"));
    await settled();
    assert.strictEqual(
      directRepliesRequests,
      0,
      "a closed surface remains lazy after reconnect"
    );

    await click("[data-action='open-comments']");
    assert.strictEqual(directRepliesRequests, 1, "opening performs the first request");
    assert
      .dom(row(751))
      .exists({ count: 1 })
      .includesText("Recovered before offline");

    replies = [
      post(751, 2, "<p>Recovered while offline</p>", {
        can_edit: true,
        version: 2,
      }),
    ];
    window.dispatchEvent(new Event("online"));
    await settled();
    assert.strictEqual(directRepliesRequests, 2, "reconnect refreshes exactly once");
    assert
      .dom(row(751))
      .exists({ count: 1 })
      .includesText(
        "Recovered while offline",
        "the cached native post refreshes before the reconnected tree renders"
      );

    await closeComments();
    window.dispatchEvent(new Event("online"));
    await settled();
    assert.strictEqual(
      directRepliesRequests,
      2,
      "closing removes the reconnect listener"
    );
  });

  test("a canonical response from a closed surface cannot pollute a reopened surface", async function (assert) {
    let canonicalRequests = 0;
    let resolveCanonical;

    setupServer((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({ items: [feedItem(704, 0)], next_cursor: null })
      );
      server.get("/posts/704/replies.json", () => helper.response([]));
      server.get("/posts/741.json", () => {
        canonicalRequests += 1;

        return new Promise((resolve) => {
          resolveCanonical = () =>
            resolve(
              helper.response(
                post(741, 2, "<p>Stale response</p>", {
                  reply_to_post_number: 1,
                })
              )
            );
        });
      });
    });

    await visit("/videos");
    await click("[data-action='open-comments']");

    try {
      const callback = window.MessageBus.callbacks
        .filter(({ channel }) => channel === "/topic/704")
        .at(-1);
      callback.func({ type: "created", id: 741 }, 70401, 1);
      await waitUntil(() => canonicalRequests === 1);
      assert.strictEqual(
        canonicalRequests,
        1,
        "the old surface starts its fetch"
      );

      (
        document.querySelector("[data-action='close-comments']") ||
        document.querySelector(".d-modal__close")
      ).click();
      await waitUntil(
        () => !document.querySelector(".video-shorts-comments-surface")
      );
      assert.dom(".video-shorts-comments-surface").doesNotExist();

      resolveCanonical();
      await settled();
      await click("[data-action='open-comments']");

      assert
        .dom(row(741))
        .doesNotExist("the stale response cannot enter the new tree");
    } finally {
      resolveCanonical?.();
      await settled();
    }
  });
});
