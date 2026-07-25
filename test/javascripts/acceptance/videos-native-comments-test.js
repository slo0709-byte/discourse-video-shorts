import { click, currentURL, triggerKeyEvent, visit } from "@ember/test-helpers";
import { test } from "qunit";
import pretender, {
  pretenderHelpers,
} from "discourse/tests/helpers/create-pretender";
import { acceptance } from "discourse/tests/helpers/qunit-helpers";

function feedItem(id, title) {
  return {
    topic_id: id,
    post_id: id,
    post_number: 1,
    topic_url: `/t/video-${id}/${id}`,
    post_url: `/t/video-${id}/${id}/1`,
    title,
    excerpt: `Excerpt ${id}`,
    user_id: id,
    username: "video-author",
    avatar_template: "/user_avatar/localhost/video-author/{size}/1_2.png",
    created_at: "2026-06-07T00:00:00.000Z",
    counts: {
      like_count: 0,
      reply_count: -1,
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

function directReply(id, topicId, username, cooked) {
  return {
    id,
    post_id: id,
    post_number: 2,
    topic_id: topicId,
    user_id: id,
    username,
    avatar_template: `/user_avatar/localhost/${username}/{size}/1_2.png`,
    cooked,
    raw: cooked.replace(/<[^>]*>/g, ""),
    created_at: "2026-06-08T12:00:00.000Z",
    reply_count: 0,
    can_edit: false,
    can_delete: false,
    can_flag: false,
    can_reply: true,
    post_url: `/t/video-${topicId}/${topicId}/2`,
    actions_summary: [{ id: 2, can_act: true }],
  };
}

function setupPretender(callback) {
  callback(pretender, pretenderHelpers());
}

acceptance("Video Shorts native comments contract", function (needs) {
  needs.settings({ video_shorts_enabled: true });
  needs.user();

  test("PIN keeps comments lazy and preserves the videos panel shell", async function (assert) {
    const requestedPostIds = [];

    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [
            feedItem(810, "First native comments clip"),
            feedItem(811, "Second native comments clip"),
          ],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );

      server.get("/posts/:post_id/replies.json", (request) => {
        const postId = Number(request.params.post_id);
        requestedPostIds.push(postId);

        return helper.response([
          directReply(
            postId + 100,
            postId,
            `reply-author-${postId}`,
            `<p>Comment for video ${postId}</p>`,
          ),
        ]);
      });
    });

    await visit("/videos");

    assert.deepEqual(
      requestedPostIds,
      [],
      "comments are not requested before the opener is clicked",
    );
    assert
      .dom(".video-shorts-comments-surface")
      .doesNotExist("comments are not surfaced before the opener is clicked");
    assert.dom(".video-shorts-comments-panel").doesNotExist();
    assert.dom(".video-shorts-comments-sheet").doesNotExist();

    await click('[data-post-id="810"] [data-action="open-comments"]');

    assert.strictEqual(currentURL(), "/videos", "opening stays on /videos");
    assert
      .dom(".video-shorts-comments-panel")
      .hasAttribute("data-comments-post-id", "810");
    assert.dom(".video-shorts-comments-sheet").doesNotExist();
    assert.deepEqual(requestedPostIds, [810]);
    assert
      .dom(".video-shorts-comments-panel")
      .includesText("Comment for video 810");

    await click('[data-action="close-comments"]');

    assert.dom(".video-shorts-comments-panel").doesNotExist();
    assert
      .dom(".video-shorts-comments-surface")
      .doesNotExist("closing removes the comments surface");
    assert.strictEqual(
      document.activeElement,
      document.querySelector(".video-shorts-feed__items"),
      "closing restores focus to the feed",
    );

    await triggerKeyEvent(".video-shorts-feed__items", "keydown", "ArrowDown");

    assert
      .dom(".video-shorts-feed__viewport")
      .hasAttribute(
        "data-active-post-id",
        "811",
        "feed interaction works after close",
      );

    await click('[data-post-id="811"] [data-action="open-comments"]');

    assert.strictEqual(currentURL(), "/videos", "reopening stays on /videos");
    assert
      .dom(".video-shorts-comments-panel")
      .hasAttribute(
        "data-comments-post-id",
        "811",
        "reopening binds the panel to the current video",
      );
    assert.deepEqual(
      requestedPostIds,
      [810, 811],
      "reopening requests the current video without retaining stale state",
    );
    assert
      .dom(".video-shorts-comments-panel")
      .includesText("Comment for video 811");
    assert
      .dom(".video-shorts-comments-panel")
      .doesNotIncludeText("Comment for video 810");
  });

  test("renders native Discourse posts and post menu in video comments", async function (assert) {
    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [feedItem(820, "Native post identity clip")],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );

      server.get("/posts/820/replies.json", () =>
        helper.response([
          directReply(
            920,
            820,
            "native-comment-author",
            "<p>Native comment row</p>",
          ),
        ]),
      );
    });

    await visit("/videos");
    await click('[data-action="open-comments"]');

    const nativePostSelector =
      ".video-shorts-comments-panel .topic-post article.boxed[data-post-id]";

    assert
      .dom(nativePostSelector)
      .exists("comments render through the native Discourse Post component");
    assert
      .dom(".video-shorts-comments-panel .post-menu-area")
      .exists("comments render the native Discourse PostMenu");

    const nativeReplyButton = document.querySelector(
      ".video-shorts-comments-panel .post-menu-area button.reply",
    );

    if (nativeReplyButton) {
      await click(nativeReplyButton);
    }

    assert
      .dom('[data-video-shorts-reply-editor][data-reply-kind="nested"]')
      .exists("native PostMenu reply opens the lightweight editor");
    assert.dom("#reply-control.open").doesNotExist();
  });
});
