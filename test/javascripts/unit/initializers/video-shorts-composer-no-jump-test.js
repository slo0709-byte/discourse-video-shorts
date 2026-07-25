import { module, test } from "qunit";
import {
  extendVideoShortsComposerService,
  shouldForceVideoShortsComposerSave,
  VIDEO_SHORTS_POST_EDITED_EVENT,
} from "discourse/plugins/discourse-video-shorts/discourse/pre-initializers/video-shorts-composer-no-jump";

function serviceState(overrides = {}) {
  return {
    model: {
      action: "reply",
      replyingToTopic: true,
    },
    router: { currentRouteName: "videos" },
    skipJumpOnSave: true,
    topicModel: null,
    ...overrides,
  };
}

module("Unit | Initializer | video shorts composer no jump", function () {
  test("forces only a videos topic reply that would lose its no-jump options", function (assert) {
    assert.true(
      shouldForceVideoShortsComposerSave(serviceState(), false),
      "the missing topicModel recursion is bypassed on /videos"
    );

    const negativeCases = [
      ["normal topic route", { router: { currentRouteName: "topic.show" } }, false],
      ["missing route", { router: { currentRouteName: undefined } }, false],
      ["skip jump disabled", { skipJumpOnSave: false }, false],
      ["forced save", {}, true],
      ["edit action", { model: { action: "edit", replyingToTopic: true } }, false],
      ["not a topic reply", { model: { action: "reply", replyingToTopic: false } }, false],
      ["topic model is present", { topicModel: { id: 42 } }, false],
    ];

    for (const [label, overrides, force] of negativeCases) {
      assert.false(
        shouldForceVideoShortsComposerSave(serviceState(overrides), force),
        label
      );
    }
  });

  test("preserves the original options while delegating every other save unchanged", function (assert) {
    class BaseComposerService {
      calls = [];

      save(force, options) {
        this.calls.push({ force, options });
        return "saved";
      }
    }

    const ExtendedComposerService =
      extendVideoShortsComposerService(BaseComposerService);
    const service = Object.assign(new ExtendedComposerService(), serviceState());
    const noJumpOptions = { jump: false, marker: "same-object" };

    assert.strictEqual(service.save(false, noJumpOptions), "saved");
    assert.deepEqual(service.calls[0], {
      force: true,
      options: noJumpOptions,
    });
    assert.strictEqual(
      service.calls[0].options,
      noJumpOptions,
      "options are not recreated or discarded"
    );

    service.router = { currentRouteName: "topic.show" };
    const normalOptions = { jump: true };
    service.save(false, normalOptions);
    assert.deepEqual(service.calls[1], {
      force: false,
      options: normalOptions,
    });

    service.router = { currentRouteName: "videos" };
    service.save(true, noJumpOptions);
    assert.deepEqual(service.calls[2], {
      force: true,
      options: noJumpOptions,
    });
  });

  test("forwards the authoritative server Post after a videos edit", async function (assert) {
    const editedPost = { id: 77, cooked: "<p>Authoritative edit</p>" };
    const events = [];

    class BaseComposerService {
      save() {
        return Promise.resolve({ responseJson: { post: editedPost } });
      }
    }

    const ExtendedComposerService =
      extendVideoShortsComposerService(BaseComposerService);
    const service = Object.assign(new ExtendedComposerService(), {
      appEvents: {
        trigger(...args) {
          events.push(args);
        },
      },
      model: { action: "edit", post: { id: 77 } },
      router: { currentRouteName: "videos" },
    });
    const result = await service.save(false, { jump: false });

    assert.strictEqual(result.responseJson.post, editedPost);
    assert.deepEqual(events, [[VIDEO_SHORTS_POST_EDITED_EVENT, editedPost]]);
  });

  test("forwards the core Post when composer save resolves without a value", async function (assert) {
    const editingPost = { id: 78, cooked: "<p>Before edit</p>" };
    const events = [];

    class BaseComposerService {
      save() {
        editingPost.cooked = "<p>Authoritative edit</p>";
        return Promise.resolve();
      }
    }

    const ExtendedComposerService =
      extendVideoShortsComposerService(BaseComposerService);
    const service = Object.assign(new ExtendedComposerService(), {
      appEvents: {
        trigger(...args) {
          events.push(args);
        },
      },
      model: { action: "edit", post: editingPost },
      router: { currentRouteName: "videos" },
    });

    assert.strictEqual(await service.save(false, { jump: false }), undefined);
    assert.deepEqual(events, [
      [VIDEO_SHORTS_POST_EDITED_EVENT, editingPost],
    ]);
  });
});
