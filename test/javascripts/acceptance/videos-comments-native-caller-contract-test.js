import { click, settled, visit } from "@ember/test-helpers";
import { test } from "qunit";
import pretender, {
  pretenderHelpers,
} from "discourse/tests/helpers/create-pretender";
import { acceptance } from "discourse/tests/helpers/qunit-helpers";

function feedItem(id) {
  return {
    topic_id: id,
    post_id: id,
    post_number: 1,
    topic_url: `/t/native-caller-contract-${id}/${id}`,
    post_url: `/t/native-caller-contract-${id}/${id}/1`,
    title: `Native caller contract ${id}`,
    excerpt: `Excerpt ${id}`,
    user_id: id,
    username: "video-author",
    avatar_template: "/user_avatar/localhost/video-author/{size}/1_2.png",
    created_at: "2026-07-01T00:00:00.000Z",
    counts: {
      like_count: 0,
      reply_count: 1,
      bookmark_count: 0,
    },
    actions: {
      liked: false,
      can_like: true,
      bookmarked: false,
      bookmark_id: null,
      can_bookmark: true,
      can_flag: true,
      can_reply: true,
      share_url: `/t/native-caller-contract-${id}/${id}/1`,
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

function comment(id, topicId) {
  return {
    id,
    post_id: id,
    post_number: 2,
    topic_id: topicId,
    user_id: id,
    username: "native-comment-author",
    avatar_template:
      "/user_avatar/localhost/native-comment-author/{size}/1_2.png",
    cooked: "<p>Native caller contract comment</p>",
    raw: "Native caller contract comment",
    created_at: "2026-07-02T00:00:00.000Z",
    reply_count: 0,
    reply_to_post_number: 1,
    can_edit: false,
    can_delete: false,
    can_flag: false,
    can_reply: true,
    post_url: `/t/native-caller-contract-${topicId}/${topicId}/2`,
    actions_summary: [{ id: 2, can_act: true }],
  };
}

function setupServer(topicId) {
  const helper = pretenderHelpers();

  pretender.get("/videos.json", () =>
    helper.response({
      items: [feedItem(topicId)],
      next_cursor: null,
      scan_limit_reached: false,
    }),
  );
  pretender.get(`/posts/${topicId}/replies.json`, () =>
    helper.response([comment(topicId + 1, topicId)]),
  );
}

acceptance("Video Shorts native comments caller contract", function (needs) {
  needs.settings({ video_shorts_enabled: true });
  needs.user();

  test("native reply uses the inline dedicated lightweight editor", async function (assert) {
    setupServer(960);

    await visit("/videos");
    await click("[data-action='open-comments']");

    assert.dom("[data-video-shorts-comment-reply-dialog]").doesNotExist();

    await click(".video-shorts-comments-panel .post-menu-area button.reply");

    assert
      .dom(
        '.video-shorts-comments-surface__comment[data-post-id="961"] [data-video-shorts-inline-reply-editor][data-reply-kind="nested"]',
      )
      .exists(
        "the native post reply opens the dedicated editor inside its comment",
      );
    assert.dom("[data-video-shorts-comment-reply-dialog]").doesNotExist();
    assert.dom("#reply-control.open").doesNotExist();
  });

  test("video comments close reopen focus ignores a stale close animation frame", async function (assert) {
    setupServer(970);

    await visit("/videos");
    await click("[data-action='open-comments']");

    const originalRequestAnimationFrame = window.requestAnimationFrame;
    const queuedAnimationFrames = [];

    window.requestAnimationFrame = (callback) => {
      queuedAnimationFrames.push(callback);
      return queuedAnimationFrames.length;
    };

    try {
      document.querySelector("[data-action='close-comments']").click();
    } finally {
      window.requestAnimationFrame = originalRequestAnimationFrame;
    }

    await settled();

    assert.strictEqual(
      queuedAnimationFrames.length,
      1,
      "closing queues exactly one deferred feed-focus callback",
    );

    await click("[data-action='open-comments']");

    const reopenedPanelBody = document.querySelector(
      ".video-shorts-comments-panel__body",
    );
    reopenedPanelBody.focus({ preventScroll: true });
    assert.strictEqual(
      document.activeElement,
      reopenedPanelBody,
      "the reopened comments panel owns focus before the stale frame runs",
    );

    queuedAnimationFrames[0](performance.now());
    await settled();

    assert.strictEqual(
      document.activeElement,
      reopenedPanelBody,
      "a stale close frame cannot steal focus from reopened comments",
    );
  });
});
