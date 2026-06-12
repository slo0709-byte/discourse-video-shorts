import { click, currentURL, fillIn, visit } from "@ember/test-helpers";
import { test } from "qunit";
import { acceptance } from "discourse/tests/helpers/qunit-helpers";

function feedItem(id, title, actions = null) {
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
      reply_count: 2,
      bookmark_count: 0,
    },
    actions: actions || {
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

function directReply(id, username, cooked, attrs = {}) {
  return {
    id,
    post_id: id,
    post_number: attrs.post_number || 2,
    user_id: attrs.user_id || id,
    username,
    avatar_template: `/user_avatar/localhost/${username}/{size}/1_2.png`,
    cooked,
    raw: cooked.replace(/<[^>]*>/g, ""),
    created_at: "2026-06-08T12:00:00.000Z",
    reply_count: 0,
    can_edit: false,
    can_delete: false,
    can_flag: false,
    ...attrs,
  };
}

acceptance("Video Shorts comments sheet", function (needs) {
  needs.settings({ video_shorts_enabled: true });
  needs.user();

  test("opens custom comments sheet with child replies and no composer", async function (assert) {
    needs.pretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [feedItem(101, "Commentable clip")],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );

      server.get("/posts/101/replies.json", () =>
        helper.response([
          directReply(201, "reply-author", "<p>First direct reply</p>", {
            reply_count: 1,
            post_url: "/t/video-101/101/2",
          }),
        ]),
      );

      server.get("/posts/201/replies.json", () =>
        helper.response([
          directReply(211, "nested-author", "<p>Nested direct reply</p>", {
            post_number: 3,
            reply_to_username: "reply-author",
            post_url: "/t/video-101/101/3",
          }),
        ]),
      );
    });

    await visit("/videos");
    const beforeURL = currentURL();

    await click("[data-action='open-comments']");

    assert.strictEqual(currentURL(), beforeURL);
    assert.dom(".video-shorts-comments-sheet").exists();
    assert.dom(".video-shorts-comments-sheet").hasAttribute("role", "dialog");
    assert.dom(".video-shorts-comments-surface__comment").exists({ count: 1 });
    assert
      .dom(".video-shorts-comments-surface__cooked")
      .includesText("First direct reply");
    assert
      .dom(".video-shorts-comments-surface__child-comment")
      .includesText("Nested direct reply");
    assert
      .dom("[data-video-shorts-reply-target]")
      .includesText("@reply-author");
    assert.dom(".topic-post article.boxed").doesNotExist();
    assert.dom(".post-action-menu").doesNotExist();
    assert.dom("#reply-control.open").doesNotExist();
    assert.dom(".d-editor").doesNotExist();
  });

  test("renders empty state without opening composer", async function (assert) {
    needs.pretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [feedItem(102, "Quiet clip")],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );

      server.get("/posts/102/replies.json", () => helper.response([]));
    });

    await visit("/videos");
    await click("[data-action='open-comments']");

    assert.dom(".video-shorts-comments-sheet").includesText("No comments yet");
    assert.dom(".d-editor").doesNotExist();
    assert.dom("[data-action='reply']").exists();
  });

  test("opens an inline top-level reply field", async function (assert) {
    needs.pretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [feedItem(103, "Replyable clip")],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );

      server.get("/posts/103/replies.json", () => helper.response([]));
    });

    await visit("/videos");
    const beforeURL = currentURL();

    await click("[data-action='open-comments']");
    await click(".video-shorts-comments-sheet [data-action='reply']");

    assert.strictEqual(currentURL(), beforeURL);
    assert.dom("[data-video-shorts-reply-input]").exists();
    assert.dom("[data-action='publish-reply']").exists();
    assert.dom("#reply-control.open").doesNotExist();
    assert.dom(".d-editor").doesNotExist();
  });

  test("opens inline comment reply status and cancel controls", async function (assert) {
    needs.pretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [feedItem(104, "Nested replyable clip")],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );

      server.get("/posts/104/replies.json", () =>
        helper.response([
          directReply(204, "reply-author", "<p>Parent comment</p>", {
            post_number: 2,
          }),
        ]),
      );
    });

    await visit("/videos");
    const beforeURL = currentURL();

    await click("[data-action='open-comments']");
    await click('[data-post-id="204"] [data-action="reply-to-comment"]');

    assert.strictEqual(currentURL(), beforeURL);
    assert
      .dom("[data-video-shorts-comment-reply-status]")
      .includesText("Replying to @reply-author");
    assert.dom("[data-video-shorts-comment-reply-input]").exists();
    assert.dom("[data-action='publish-comment-reply']").exists();
    assert.dom("#reply-control.open").doesNotExist();
    assert.dom(".d-editor").doesNotExist();

    await fillIn("[data-video-shorts-comment-reply-input]", "Draft child");
    await click("[data-action='cancel-comment-reply']");

    assert.dom("[data-video-shorts-comment-reply-status]").doesNotExist();
    assert.dom("[data-video-shorts-comment-reply-input]").doesNotExist();
  });

  test("renders permission-aware custom tools menu", async function (assert) {
    needs.pretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [feedItem(105, "Managed comment clip")],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );

      server.get("/posts/105/replies.json", () =>
        helper.response([
          directReply(205, "rootadmin", "<p>Comment with tools</p>", {
            can_edit: true,
            can_delete: true,
            can_flag: true,
            post_url: "/t/managed-comment/105/2",
          }),
        ]),
      );
    });

    await visit("/videos");
    await click("[data-action='open-comments']");
    await click('[data-post-id="205"] [data-action="comment-tools-toggle"]');

    assert.dom('[data-post-id="205"] .post-action-menu').doesNotExist();
    assert.dom('[data-video-shorts-comment-tools-menu="205"]').exists();
    assert.dom('[data-action="edit-comment"]').exists();
    assert.dom('[data-action="copy-comment-link"]').exists();
    assert.dom('[data-action="open-comment-topic"]').exists();
    assert.dom('[data-action="flag-comment"]').exists();
    assert.dom('[data-action="delete-comment"]').exists();
  });
});
