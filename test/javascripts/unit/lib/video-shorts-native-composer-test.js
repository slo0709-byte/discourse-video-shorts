import { module, test } from "qunit";
import Composer from "discourse/models/composer";
import { createVideoShortsNativeComposerBridge } from "discourse/plugins/discourse-video-shorts/discourse/lib/video-shorts-native-composer";

function topic({ id = 42, canCreatePost = true } = {}) {
  return {
    id,
    draft_key: `topic_${id}`,
    draft_sequence: 3,
    details: { can_create_post: canCreatePost },
  };
}

function post(topicRecord, { id = 70, postNumber = 7 } = {}) {
  return {
    id,
    post_number: postNumber,
    topic_id: topicRecord.id,
    topic: topicRecord,
    username: "sora",
  };
}

function harness({ currentUser = { id: 9 } } = {}) {
  const openCalls = [];
  const loginCalls = [];
  const composer = {
    open(options) {
      openCalls.push(options);
      return "composer-opened";
    },
  };
  const showLogin = (...args) => {
    loginCalls.push(args);
    return "login-opened";
  };

  return {
    bridge: createVideoShortsNativeComposerBridge({
      composer,
      currentUser,
      showLogin,
    }),
    loginCalls,
    openCalls,
  };
}

module("Unit | Lib | video shorts native composer", function () {
  test("top-level replies target the source Post, or the Topic for its first Post, without navigation", function (assert) {
    const topicRecord = topic();
    const sourcePost = post(topicRecord);
    const { bridge, loginCalls, openCalls } = harness();

    assert.strictEqual(
      bridge.openTopLevelReply({ topic: topicRecord, sourcePost }),
      "composer-opened"
    );
    assert.deepEqual(openCalls[0], {
      action: Composer.REPLY,
      draftKey: "topic_42",
      draftSequence: 3,
      post: sourcePost,
      skipJumpOnSave: true,
      topic: undefined,
    });

    const firstPost = post(topicRecord, { id: 10, postNumber: 1 });
    bridge.openTopLevelReply({ topic: topicRecord, sourcePost: firstPost });

    assert.deepEqual(openCalls[1], {
      action: Composer.REPLY,
      draftKey: "topic_42",
      draftSequence: 3,
      post: null,
      skipJumpOnSave: true,
      topic: topicRecord,
    });
    assert.strictEqual(loginCalls.length, 0, "login was not opened");
  });

  test("comment replies target the selected Post without synthesizing reply text", function (assert) {
    const topicRecord = topic();
    const selectedPost = post(topicRecord, { id: 88, postNumber: 12 });
    const { bridge, openCalls } = harness();

    bridge.openPostReply({ topic: topicRecord, post: selectedPost });

    assert.strictEqual(openCalls[0].post, selectedPost);
    assert.strictEqual(openCalls[0].action, Composer.REPLY);
    assert.false("reply" in openCalls[0], "no @ mention or other text is added");
    assert.false("quote" in openCalls[0], "no quote is added");
    assert.false(
      "reply_to_post_number" in openCalls[0],
      "the native Post target owns reply_to_post_number semantics"
    );
  });

  test("anonymous users invoke native login and denied users do not open the composer", function (assert) {
    const topicRecord = topic();
    const sourcePost = post(topicRecord);
    const anonymous = harness({ currentUser: null });

    assert.strictEqual(
      anonymous.bridge.openTopLevelReply({ topic: topicRecord, sourcePost }),
      "login-opened"
    );
    assert.deepEqual(
      anonymous.loginCalls,
      [[]],
      "native login is invoked without panel redirect arguments"
    );
    assert.strictEqual(anonymous.openCalls.length, 0);

    const deniedTopic = topic({ canCreatePost: false });
    const denied = harness();
    assert.false(
      denied.bridge.openTopLevelReply({
        topic: deniedTopic,
        sourcePost: post(deniedTopic),
      })
    );
    assert.strictEqual(denied.openCalls.length, 0);
    assert.strictEqual(denied.loginCalls.length, 0);
  });

  test("repeated calls replace the draft target and explicitly clear a stale Post target", function (assert) {
    const topicRecord = topic();
    const selectedPost = post(topicRecord, { id: 88, postNumber: 12 });
    const firstPost = post(topicRecord, { id: 10, postNumber: 1 });
    const { bridge, openCalls } = harness();

    bridge.openPostReply({ topic: topicRecord, post: selectedPost });
    bridge.openTopLevelReply({ topic: topicRecord, sourcePost: firstPost });

    assert.strictEqual(openCalls.length, 2);
    assert.strictEqual(openCalls[0].post, selectedPost);
    assert.strictEqual(openCalls[1].post, null, "the old Post target is cleared");
    assert.strictEqual(openCalls[1].topic, topicRecord);
    assert.strictEqual(openCalls[0].draftKey, openCalls[1].draftKey);
  });

  test("malformed and cross-topic targets are rejected without side effects", function (assert) {
    const topicRecord = topic();
    const { bridge, loginCalls, openCalls } = harness();
    const malformedTargets = [
      { topic: null, post: post(topicRecord) },
      { topic: topicRecord, post: { ...post(topicRecord), id: 0 } },
      {
        topic: topicRecord,
        post: { ...post(topicRecord), post_number: "7" },
      },
      {
        topic: topicRecord,
        post: { ...post(topicRecord), topic_id: 99 },
      },
    ];

    for (const target of malformedTargets) {
      assert.throws(
        () => bridge.openPostReply(target),
        /valid Topic and Post from the same topic/
      );
    }

    assert.strictEqual(openCalls.length, 0);
    assert.strictEqual(loginCalls.length, 0);
  });
});
