import { click, currentURL, fillIn, visit } from "@ember/test-helpers";
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
      reply_count: 0,
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

function commentPost(id, attrs = {}) {
  return {
    id,
    post_id: id,
    post_number: attrs.post_number || 2,
    user_id: attrs.user_id || id,
    username: attrs.username || "comment-author",
    avatar_template: "/user_avatar/localhost/comment-author/{size}/1_2.png",
    cooked: attrs.cooked || "<p>Parent comment</p>",
    raw: attrs.raw || "Parent comment",
    created_at: "2026-06-08T00:00:00.000Z",
    reply_count: attrs.reply_count || 0,
    can_edit: Boolean(attrs.can_edit),
    can_delete: Boolean(attrs.can_delete),
    can_flag: Boolean(attrs.can_flag),
    post_url: attrs.post_url,
    reply_to_username: attrs.reply_to_username || null,
  };
}

function postParams(request) {
  return new URLSearchParams(request.requestBody);
}

function setupPretender(callback) {
  callback(pretender, pretenderHelpers());
}

acceptance("Video Shorts in-context reply publishing", function (needs) {
  needs.settings({ video_shorts_enabled: true });
  needs.user();

  let currentTopicId = 501;
  let postRequests = [];

  needs.hooks.beforeEach(function () {
    setupPretender((server, helper) => {
      const feeds = {
        501: feedItem(501, "Inline reply clip"),
        502: feedItem(502, "Inline comment reply clip"),
        504: feedItem(504, "Inline floor reply clip"),
        505: feedItem(505, "Inline deep floor reply clip"),
      };
      const replies = {
        501: [],
        502: [
          commentPost(602, {
            username: "comment-author",
            post_number: 2,
          }),
          commentPost(603, {
            username: "other-author",
            post_number: 3,
            cooked: "<p>Other parent</p>",
          }),
        ],
        504: [
          commentPost(604, {
            username: "parent-author",
            post_number: 2,
            reply_count: 1,
          }),
        ],
        604: [
          commentPost(614, {
            username: "child-author",
            post_number: 3,
            cooked: "<p>Child floor comment</p>",
            raw: "Child floor comment",
            reply_to_username: "parent-author",
          }),
        ],
        505: [
          commentPost(705, {
            username: "deep-parent-author",
            post_number: 2,
            reply_count: 1,
          }),
        ],
        705: [
          commentPost(715, {
            username: "deep-child-author",
            post_number: 3,
            cooked: "<p>Deep child comment</p>",
            raw: "Deep child comment",
            reply_count: 1,
            reply_to_username: "deep-parent-author",
          }),
        ],
        715: [
          commentPost(725, {
            username: "deep-grandchild-author",
            post_number: 4,
            cooked: "<p>Deep grandchild comment</p>",
            raw: "Deep grandchild comment",
            reply_to_username: "deep-child-author",
          }),
        ],
      };

      server.get("/videos.json", () =>
        helper.response({
          items: [feeds[currentTopicId]],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );

      server.get("/posts/:post_id/replies.json", (request) =>
        helper.response(replies[request.params.post_id] || []),
      );

      server.post("/posts.json", (request) => {
        const params = postParams(request);
        postRequests.push(params);

        if (params.get("topic_id") === "501") {
          return helper.response(
            commentPost(901, {
              username: "admin_user",
              post_number: 2,
              cooked: "<p>Inline top reply</p>",
              raw: "Inline top reply",
            }),
          );
        }

        if (params.get("topic_id") === "502") {
          return helper.response(
            commentPost(902, {
              username: "admin_user",
              post_number: 4,
              cooked: "<p>Inline child</p>",
              raw: "Inline child",
              reply_to_post_number: 2,
              reply_to_username: "comment-author",
            }),
          );
        }

        if (params.get("topic_id") === "505") {
          return helper.response(
            commentPost(925, {
              username: "admin_user",
              post_number: 5,
              cooked: "<p>Deep floor reply</p>",
              raw: "Deep floor reply",
              reply_to_post_number: 4,
              reply_to_username: "deep-grandchild-author",
            }),
          );
        }

        return helper.response(
          commentPost(914, {
            username: "admin_user",
            post_number: 4,
            cooked: "<p>Already mentioned</p>",
            raw: "Already mentioned",
            reply_to_post_number: 3,
            reply_to_username: "child-author",
          }),
        );
      });
    });
  });

  test("top-level reply publishes inside the comments panel and stays on /videos", async function (assert) {
    currentTopicId = 501;
    postRequests = [];

    await visit("/videos");
    const beforeURL = currentURL();

    await click('[data-action="open-comments"]');
    await fillIn("[data-video-shorts-reply-input]", "Inline top reply");
    await click("[data-action='publish-reply']");

    assert.strictEqual(postRequests.length, 1);
    assert.strictEqual(postRequests[0].get("topic_id"), "501");
    assert.strictEqual(postRequests[0].get("raw"), "Inline top reply");
    assert.strictEqual(postRequests[0].get("reply_to_post_number"), "1");
    assert.strictEqual(currentURL(), beforeURL);
    assert.dom("[data-video-shorts-reply-input]").hasValue("");
    assert
      .dom('.video-shorts-comments-surface__comment[data-post-id="901"]')
      .includesText("Inline top reply");
    assert.dom("#reply-control.open").doesNotExist();
    assert.dom(".d-editor").doesNotExist();
    assert.dom(".post-action-menu").doesNotExist();
    assert.dom("[data-action='publish-reply']").exists();
    assert.dom(".video-shorts-comments-sheet").exists();
  });

  test("comment reply publishes under selected parent without synthesizing a mention", async function (assert) {
    currentTopicId = 502;
    postRequests = [];

    await visit("/videos");
    const beforeURL = currentURL();

    await click('[data-action="open-comments"]');
    await click('[data-post-id="602"] [data-action="reply-to-comment"]');
    assert
      .dom("[data-video-shorts-comment-reply-status]")
      .includesText("Replying to comment-author");
    assert
      .dom('[data-post-id="602"] [data-video-shorts-reply-target]')
      .includesText("comment-author");

    await fillIn("[data-video-shorts-comment-reply-input]", "Inline child");
    await click("[data-action='publish-comment-reply']");

    assert.strictEqual(postRequests.length, 1);
    assert.strictEqual(postRequests[0].get("topic_id"), "502");
    assert.strictEqual(postRequests[0].get("raw"), "Inline child");
    assert.strictEqual(postRequests[0].get("reply_to_post_number"), "2");
    assert.false(
      postRequests[0].get("raw").startsWith("@comment-author"),
      "the comments surface does not synthesize an @username prefix",
    );
    assert.strictEqual(currentURL(), beforeURL);
    assert.dom("[data-video-shorts-comment-reply-input]").doesNotExist();
    assert
      .dom(
        '.video-shorts-comments-surface__comment[data-post-id="602"] .video-shorts-comments-surface__child-comment[data-post-id="902"]',
      )
      .includesText("Inline child");
    assert
      .dom(
        '.video-shorts-comments-surface__comment[data-post-id="603"] .video-shorts-comments-surface__child-comment[data-post-id="902"]',
      )
      .doesNotExist();
    assert.dom("#reply-control.open").doesNotExist();
    assert.dom(".d-editor").doesNotExist();
    assert.dom(".post-action-menu").doesNotExist();
    assert.dom(".video-shorts-comments-sheet").exists();
    assert.dom("[data-action='publish-reply']").exists();
  });

  test("floor reply targets the selected child without synthesizing a mention", async function (assert) {
    currentTopicId = 504;
    postRequests = [];

    await visit("/videos");
    await click('[data-action="open-comments"]');

    assert
      .dom('[data-post-id="614"] [data-video-shorts-reply-target]')
      .doesNotExist();

    await click('[data-post-id="614"] [data-action="reply-to-comment"]');
    assert
      .dom("[data-video-shorts-comment-reply-status]")
      .includesText("Replying to @child-author");
    assert
      .dom('[data-post-id="614"] [data-video-shorts-reply-target]')
      .includesText("@child-author");
    assert
      .dom(
        ".video-shorts-comments-surface__reply [data-video-shorts-comment-reply-input]",
      )
      .isVisible("floor replies keep the sticky input composer visible");
    assert
      .dom('[data-post-id="614"] [data-video-shorts-comment-reply-input]')
      .doesNotExist("floor replies do not render a clipped inline input");

    await fillIn(
      "[data-video-shorts-comment-reply-input]",
      "Already mentioned",
    );
    await click("[data-action='publish-comment-reply']");

    assert.strictEqual(postRequests.length, 1);
    assert.strictEqual(postRequests[0].get("topic_id"), "504");
    assert.strictEqual(postRequests[0].get("raw"), "Already mentioned");
    assert.strictEqual(postRequests[0].get("reply_to_post_number"), "3");
    assert.false(
      postRequests[0].get("raw").startsWith("@child-author"),
      "floor replies rely on Discourse reply_to_post_number instead of a generated mention",
    );
    assert
      .dom(
        '.video-shorts-comments-surface__child-comment[data-post-id="614"] .video-shorts-comments-surface__child-comment[data-post-id="914"]',
      )
      .includesText("Already mentioned");
    assert
      .dom(
        '.video-shorts-comments-surface__comment[data-post-id="604"] > .video-shorts-comments-surface__comment-card > .video-shorts-comments-surface__comment-main > .video-shorts-comments-surface__child-list > .video-shorts-comments-surface__child-comment[data-post-id="914"]',
      )
      .doesNotExist();
    assert
      .dom('[data-post-id="914"] [data-video-shorts-reply-target]')
      .doesNotExist();
    assert.dom("#reply-control.open").doesNotExist();
    assert.dom(".d-editor").doesNotExist();
    assert.dom(".post-action-menu").doesNotExist();
    assert.dom(".video-shorts-comments-sheet").exists();
  });

  test("deep floor reply renders under the selected nested comment immediately", async function (assert) {
    currentTopicId = 505;
    postRequests = [];

    await visit("/videos");
    const beforeURL = currentURL();
    await click('[data-action="open-comments"]');

    await click('[data-post-id="725"] [data-action="reply-to-comment"]');
    assert
      .dom("[data-video-shorts-comment-reply-status]")
      .includesText("Replying to @deep-grandchild-author");
    assert
      .dom('[data-post-id="725"] [data-video-shorts-reply-target]')
      .includesText("@deep-grandchild-author");

    await fillIn("[data-video-shorts-comment-reply-input]", "Deep floor reply");
    await click("[data-action='publish-comment-reply']");

    assert.strictEqual(postRequests.length, 1);
    assert.strictEqual(postRequests[0].get("topic_id"), "505");
    assert.strictEqual(postRequests[0].get("raw"), "Deep floor reply");
    assert.strictEqual(postRequests[0].get("reply_to_post_number"), "4");
    assert.strictEqual(currentURL(), beforeURL);
    assert
      .dom(
        '.video-shorts-comments-surface__child-comment[data-post-id="725"] .video-shorts-comments-surface__child-comment[data-post-id="925"]',
      )
      .includesText("Deep floor reply");
    assert
      .dom(
        '.video-shorts-comments-surface__comment[data-post-id="705"] > .video-shorts-comments-surface__comment-card > .video-shorts-comments-surface__comment-main > .video-shorts-comments-surface__child-list > .video-shorts-comments-surface__child-comment[data-post-id="925"]',
      )
      .doesNotExist();
    assert.dom("#reply-control.open").doesNotExist();
    assert.dom(".d-editor").doesNotExist();
    assert.dom(".post-action-menu").doesNotExist();
    assert.dom(".video-shorts-comments-sheet").exists();
  });
});
