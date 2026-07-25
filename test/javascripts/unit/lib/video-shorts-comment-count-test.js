import { module, test } from "qunit";
import { createVideoShortsCommentCountSync } from "discourse/plugins/discourse-video-shorts/discourse/lib/video-shorts-comment-count";

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

function createHarness(fetchCount = async () => 0) {
  const subscriptions = new Map();
  const counts = [];
  const sync = createVideoShortsCommentCountSync({
    subscribe(channel, callback) {
      subscriptions.set(channel, callback);
    },
    unsubscribe(channel, callback) {
      if (subscriptions.get(channel) === callback) {
        subscriptions.delete(channel);
      }
    },
    fetchCount,
    createLedger: () => ({ posts: {} }),
    gateEvent(ledger, data, _globalId, messageId) {
      const previous = ledger.posts[data.id];

      if (previous?.messageId >= messageId) {
        return { accepted: false, ledger };
      }

      return {
        accepted: true,
        event: {
          type: data.type,
          postId: data.id,
          messageId,
        },
        ledger: {
          posts: {
            ...ledger.posts,
            [data.id]: { messageId },
          },
        },
      };
    },
    onCount(postId, count) {
      counts.push([postId, count]);
    },
  });

  return { counts, subscriptions, sync };
}

function localDelete(sync, sourcePostId, commentId, currentCount) {
  return sync.reconcileMutation({
    sourcePostId,
    currentCount,
    mutation: {
      type: "delete",
      post: { id: commentId },
      countDelta: -1,
      replyCountValue: currentCount - 1,
    },
  });
}

module("Unit | Lib | video shorts authoritative comment count", function () {
  test("authority-first deletion consumes the matching local mutation exactly once", async function (assert) {
    const harness = createHarness(async () => 3);
    harness.sync.activate({ topicId: 41, postId: 401 });

    await harness.subscriptions.get("/topic/41")(
      { type: "deleted", id: 9001 },
      1,
      11
    );

    assert.deepEqual(harness.counts, [[401, 3]], "authority publishes three");
    assert.deepEqual(localDelete(harness.sync, 401, 9001, 3), {
      applied: false,
      count: 3,
      reason: "already-authoritative",
    });
    assert.deepEqual(localDelete(harness.sync, 401, 9001, 3), {
      applied: false,
      count: 3,
      reason: "duplicate-local-mutation",
    });
  });

  test("local-first deletion updates immediately and later authority corrects it", async function (assert) {
    const harness = createHarness(async () => 5);
    harness.sync.activate({ topicId: 42, postId: 402 });

    assert.deepEqual(localDelete(harness.sync, 402, 9002, 7), {
      applied: true,
      count: 6,
      reason: "local-mutation",
    });
    assert.deepEqual(localDelete(harness.sync, 402, 9002, 6), {
      applied: false,
      count: 6,
      reason: "duplicate-local-mutation",
    });

    const callback = harness.subscriptions.get("/topic/42");
    await callback({ type: "deleted", id: 9002 }, 2, 12);
    await callback({ type: "deleted", id: 9002 }, 2, 12);

    assert.deepEqual(
      harness.counts,
      [[402, 5]],
      "one accepted authority response corrects the optimistic value"
    );
    assert.deepEqual(localDelete(harness.sync, 402, 9002, 5), {
      applied: false,
      count: 5,
      reason: "duplicate-local-mutation",
    });
  });

  test("authority receipts are isolated by source post and stale switched responses are ignored", async function (assert) {
    const stale = deferred();
    const harness = createHarness((postId) =>
      postId === 403 ? stale.promise : Promise.resolve(8)
    );

    harness.sync.activate({ topicId: 43, postId: 403 });
    const oldCallback = harness.subscriptions.get("/topic/43");
    const oldRequest = oldCallback({ type: "deleted", id: 9003 }, 3, 13);

    harness.sync.activate({ topicId: 44, postId: 404 });
    await harness.subscriptions.get("/topic/44")(
      { type: "deleted", id: 9003 },
      4,
      14
    );

    stale.resolve(1);
    await oldRequest;

    assert.deepEqual(harness.counts, [[404, 8]], "stale authority is discarded");
    assert.deepEqual(localDelete(harness.sync, 403, 9003, 4), {
      applied: true,
      count: 3,
      reason: "local-mutation",
    });
    assert.deepEqual(localDelete(harness.sync, 404, 9003, 8), {
      applied: false,
      count: 8,
      reason: "already-authoritative",
    });
  });
});
