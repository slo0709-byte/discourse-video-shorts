import { getOwner } from "@ember/owner";
import { setupTest } from "ember-qunit";
import { module, test } from "qunit";
import PostStream from "discourse/models/post-stream";
import Topic from "discourse/models/topic";
import TopicDetails from "discourse/models/topic-details";
import { createVideoShortsNativeTopic } from "discourse/plugins/discourse-video-shorts/discourse/lib/video-shorts-native-topic";

function videoItem(overrides = {}) {
  return {
    topic_id: 42,
    post_id: 84,
    post_number: 3,
    topic_url: "/t/native-video-topic/42",
    title: "Native video topic",
    counts: {
      reply_count: 2,
    },
    actions: {
      can_reply: true,
    },
    topic_details: {
      can_edit_staff_notes: true,
    },
    ...overrides,
  };
}

module("Unit | Lib | video shorts native topic", function (hooks) {
  setupTest(hooks);

  test("creates the minimum native Topic contract without mutating the feed item", function (assert) {
    const store = getOwner(this).lookup("service:store");
    const item = videoItem();
    const snapshot = structuredClone(item);

    const topic = createVideoShortsNativeTopic(item, store);

    assert.true(topic instanceof Topic, "the result is a native Topic model");
    assert.notStrictEqual(topic.store, store, "the Topic store is isolated");
    assert.strictEqual(
      Object.getPrototypeOf(topic.store),
      store,
      "the isolated store delegates to the Discourse store"
    );
    assert.strictEqual(topic.id, 42);
    assert.strictEqual(topic.slug, "native-video-topic");
    assert.strictEqual(topic.title, "Native video topic");
    assert.strictEqual(topic.fancy_title, "Native video topic");
    assert.strictEqual(topic.archetype, "regular");
    assert.strictEqual(topic.draft_key, "topic_42");
    assert.strictEqual(topic.draft_sequence, 0);
    assert.true(topic.details instanceof TopicDetails);
    assert.true(topic.details.can_create_post);
    assert.true(topic.details.can_edit_staff_notes);
    assert.true(topic.postStream instanceof PostStream);
    assert.strictEqual(topic.postStream.topic, topic);
    assert.deepEqual(item, snapshot, "the input feed item is unchanged");
  });

  test("normalizes identifiers without mutating the canonical store Topic", function (assert) {
    const store = getOwner(this).lookup("service:store");
    const canonical = store.createRecord("topic", {
      id: 42,
      category_id: 9,
      posters: [],
    });
    const canonicalDetails = canonical.details;
    canonicalDetails.setProperties({
      can_delete: true,
      can_create_post: false,
      participants: [],
    });
    assert.strictEqual(
      canonicalDetails.topic,
      canonical,
      "PIN: canonical TopicDetails belongs to the canonical Topic"
    );
    const item = videoItem({
      topic_id: "42",
      post_id: "84",
      post_number: "3",
      title: "Updated native video topic",
      actions: { can_reply: false },
      topic_details: { can_edit_staff_notes: false },
    });

    const isolated = createVideoShortsNativeTopic(item, store);

    assert.notStrictEqual(isolated, canonical, "the panel Topic is isolated");
    assert.strictEqual(isolated.id, 42, "numeric string ids are normalized");
    assert.strictEqual(isolated.title, "Updated native video topic");
    assert.false(isolated.details.can_create_post);
    assert.false(isolated.details.can_edit_staff_notes);
    assert.strictEqual(canonical.title, undefined, "canonical title is untouched");
    assert.strictEqual(canonical.details, canonicalDetails);
    assert.strictEqual(
      canonicalDetails.topic,
      canonical,
      "isolated Topic creation cannot retarget canonical TopicDetails"
    );
    assert.true(canonical.details.can_delete);
    assert.false(canonical.details.can_create_post);
    assert.strictEqual(
      canonical.category_id,
      9,
      "canonical Topic state is preserved"
    );
  });

  test("rejects malformed item identifiers and stores with a clear typed error", function (assert) {
    const store = getOwner(this).lookup("service:store");
    const malformedItems = [
      null,
      [],
      videoItem({ topic_id: 0 }),
      videoItem({ topic_id: -1 }),
      videoItem({ topic_id: 1.5 }),
      videoItem({ topic_id: " 42 " }),
      videoItem({ post_id: 0 }),
      videoItem({ post_id: "84.5" }),
      videoItem({ post_number: 0 }),
      videoItem({ post_number: Number.MAX_SAFE_INTEGER + 1 }),
    ];

    for (const item of malformedItems) {
      assert.throws(
        () => createVideoShortsNativeTopic(item, store),
        TypeError,
        `rejects ${JSON.stringify(item)}`
      );
    }

    assert.throws(
      () => createVideoShortsNativeTopic(videoItem(), {}),
      new TypeError("A Discourse store is required")
    );
  });
});
