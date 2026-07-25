import { getOwner } from "@ember/owner";
import { setupTest } from "ember-qunit";
import { module, test } from "qunit";
import { publishToMessageBus } from "discourse/tests/helpers/qunit-helpers";
import {
  createVideoShortsRealtimeCommentsLedger,
  gateVideoShortsRealtimeComment,
} from "discourse/plugins/discourse-video-shorts/discourse/lib/video-shorts-realtime-comments";

function gate(ledger, data, messageId, globalId = 50) {
  return gateVideoShortsRealtimeComment(ledger, data, globalId, messageId);
}

module("Unit | Lib | video shorts realtime comments | MessageBus PIN", function (hooks) {
  setupTest(hooks);

  test("topic subscribers receive data, globalId, and messageId", async function (assert) {
    const messageBus = getOwner(this).lookup("service:message-bus");
    const channel = "/topic/4242";
    const data = { type: "created", id: "17" };
    let received;
    const callback = (...args) => (received = args);

    messageBus.subscribe(channel, callback);
    await publishToMessageBus(channel, data, 81, 144);
    messageBus.unsubscribe(channel, callback);

    assert.deepEqual(received, [data, 81, 144]);
  });
});

module("Unit | Lib | video shorts realtime comments | event gate", function () {
  test("accepts known event types and normalizes numeric string post ids", function (assert) {
    let ledger = createVideoShortsRealtimeCommentsLedger();

    for (const [index, type] of [
      "created",
      "revised",
      "deleted",
      "destroyed",
      "recovered",
    ].entries()) {
      const data = { type, id: `${index + 1}` };
      const result = gate(ledger, data, index + 10);

      assert.true(result.accepted, `${type} is accepted`);
      assert.strictEqual(result.reason, null);
      assert.deepEqual(result.event, {
        type,
        postId: index + 1,
        data,
        globalId: 50,
        messageId: index + 10,
        tombstone: type === "deleted" || type === "destroyed",
      });
      ledger = result.ledger;
    }
  });

  test("rejects malformed data, post ids, types, and message ids", function (assert) {
    const ledger = createVideoShortsRealtimeCommentsLedger();
    const malformedEvents = [
      null,
      [],
      {},
      { type: "created" },
      { type: "created", id: 0 },
      { type: "created", id: -1 },
      { type: "created", id: 1.5 },
      { type: "created", id: "0" },
      { type: "created", id: "-1" },
      { type: "created", id: "1.5" },
      { type: "created", id: " 1 " },
      { type: "liked", id: 1 },
    ];

    for (const data of malformedEvents) {
      const result = gate(ledger, data, 1);
      assert.false(result.accepted, JSON.stringify(data));
      assert.strictEqual(result.reason, "malformed-event");
      assert.strictEqual(result.event, null);
      assert.strictEqual(result.ledger, ledger, "the ledger is unchanged");
    }

    for (const messageId of [undefined, null, 0, -1, 1.5, "1"]) {
      const result = gate(ledger, { type: "created", id: 1 }, messageId);
      assert.false(result.accepted, `message id ${String(messageId)}`);
      assert.strictEqual(result.reason, "malformed-message-id");
      assert.strictEqual(result.ledger, ledger, "the ledger is unchanged");
    }
  });

  test("rejects duplicate and older events independently per post", function (assert) {
    const initial = createVideoShortsRealtimeCommentsLedger();
    const first = gate(initial, { type: "created", id: 7 }, 20);
    const duplicate = gate(first.ledger, { type: "revised", id: 7 }, 20);
    const older = gate(first.ledger, { type: "revised", id: 7 }, 19);
    const otherPost = gate(first.ledger, { type: "created", id: 8 }, 1);

    assert.true(first.accepted);
    assert.strictEqual(duplicate.reason, "duplicate");
    assert.strictEqual(duplicate.ledger, first.ledger);
    assert.strictEqual(older.reason, "older");
    assert.strictEqual(older.ledger, first.ledger);
    assert.true(otherPost.accepted, "message ids are ordered per post");
  });

  test("delete and destroy tombstones block revisions without resurrection", function (assert) {
    const initial = createVideoShortsRealtimeCommentsLedger();
    const deleted = gate(initial, { type: "deleted", id: 9 }, 30);
    const olderCreate = gate(
      deleted.ledger,
      { type: "created", id: 9 },
      29
    );
    const newerRevision = gate(
      deleted.ledger,
      { type: "revised", id: 9 },
      31
    );
    const afterRevision = gate(
      newerRevision.ledger,
      { type: "recovered", id: 9 },
      30
    );
    const destroyed = gate(
      newerRevision.ledger,
      { type: "destroyed", id: 9 },
      32
    );

    assert.true(deleted.accepted);
    assert.true(deleted.event.tombstone);
    assert.strictEqual(olderCreate.reason, "older");
    assert.strictEqual(newerRevision.reason, "tombstoned");
    assert.strictEqual(newerRevision.event, null);
    assert.strictEqual(
      newerRevision.ledger.posts[9].lastMessageId,
      31,
      "a newer blocked event still advances ordering"
    );
    assert.true(newerRevision.ledger.posts[9].tombstone);
    assert.strictEqual(afterRevision.reason, "older");
    assert.true(destroyed.accepted);
    assert.true(destroyed.ledger.posts[9].tombstone);
  });

  test("newer recovered or created events explicitly clear tombstones", function (assert) {
    const initial = createVideoShortsRealtimeCommentsLedger();
    const deleted = gate(initial, { type: "deleted", id: 11 }, 40);
    const recovered = gate(
      deleted.ledger,
      { type: "recovered", id: 11 },
      41
    );
    const destroyed = gate(
      recovered.ledger,
      { type: "destroyed", id: 11 },
      42
    );
    const recreated = gate(
      destroyed.ledger,
      { type: "created", id: 11 },
      43
    );

    assert.true(recovered.accepted);
    assert.false(recovered.event.tombstone);
    assert.false(recovered.ledger.posts[11].tombstone);
    assert.true(recreated.accepted);
    assert.false(recreated.event.tombstone);
    assert.false(recreated.ledger.posts[11].tombstone);
  });

  test("does not mutate prior ledger snapshots", function (assert) {
    const initial = createVideoShortsRealtimeCommentsLedger();
    const created = gate(initial, { type: "created", id: 12 }, 1);
    const deleted = gate(created.ledger, { type: "deleted", id: 12 }, 2);

    assert.deepEqual(initial.posts, {});
    assert.deepEqual(created.ledger.posts[12], {
      lastMessageId: 1,
      tombstone: false,
    });
    assert.deepEqual(deleted.ledger.posts[12], {
      lastMessageId: 2,
      tombstone: true,
    });
  });
});
