import { click, currentURL, fillIn, visit } from "@ember/test-helpers";
import { test } from "qunit";
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

acceptance("Video Shorts in-context reply publishing", function (needs) {
  needs.settings({ video_shorts_enabled: true });
  needs.user();

  test("top-level reply publishes inline and stays on /videos", async function (assert) {
    needs.pretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [feedItem(501, "Reply composer clip")],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );

      server.get("/posts/501/replies.json", () => helper.response([]));
      server.post("/posts.json", (request) => {
        const params = postParams(request);

        assert.strictEqual(params.get("topic_id"), "501");
        assert.strictEqual(params.get("raw"), "Inline top reply");
        assert.strictEqual(params.get("reply_to_post_number"), "1");

        return helper.response(
          commentPost(901, {
            username: "rootadmin",
            post_number: 2,
            cooked: "<p>Inline top reply</p>",
            raw: "Inline top reply",
          }),
        );
      });
    });

    await visit("/videos");
    const beforeURL = currentURL();

    await click('[data-action="open-comments"]');
    await click('[data-action="reply"]');
    await fillIn("[data-video-shorts-reply-input]", "Inline top reply");
    await click("[data-action='publish-reply']");

    assert.strictEqual(currentURL(), beforeURL);
    assert.dom("[data-video-shorts-reply-input]").doesNotExist();
    assert
      .dom('.video-shorts-comments-surface__comment[data-post-id="901"]')
      .includesText("Inline top reply");
    assert.dom("#reply-control.open").doesNotExist();
    assert.dom(".d-editor").doesNotExist();
    assert.dom(".post-action-menu").doesNotExist();
    assert.dom("[data-action='reply']").exists();
    assert.dom(".video-shorts-comments-sheet").exists();
  });

  test("comment reply publishes under selected parent with @target", async function (assert) {
    needs.pretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [feedItem(502, "Comment reply composer clip")],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );

      server.get("/posts/502/replies.json", () =>
        helper.response([
          commentPost(602, {
            username: "comment-author",
            post_number: 2,
          }),
          commentPost(603, {
            username: "other-author",
            post_number: 3,
            cooked: "<p>Other parent</p>",
          }),
        ]),
      );

      server.post("/posts.json", (request) => {
        const params = postParams(request);

        assert.strictEqual(params.get("topic_id"), "502");
        assert.strictEqual(params.get("raw"), "@comment-author Inline child");
        assert.strictEqual(params.get("reply_to_post_number"), "2");

        return helper.response(
          commentPost(902, {
            username: "rootadmin",
            post_number: 4,
            cooked: "<p>@comment-author Inline child</p>",
            raw: "@comment-author Inline child",
            reply_to_username: "comment-author",
          }),
        );
      });
    });

    await visit("/videos");
    const beforeURL = currentURL();

    await click('[data-action="open-comments"]');
    await click('[data-post-id="602"] [data-action="reply-to-comment"]');
    await fillIn("[data-video-shorts-comment-reply-input]", "Inline child");
    await click("[data-action='publish-comment-reply']");

    assert.strictEqual(currentURL(), beforeURL);
    assert.dom("[data-video-shorts-comment-reply-input]").doesNotExist();
    assert
      .dom(
        '.video-shorts-comments-surface__comment[data-post-id="602"] .video-shorts-comments-surface__child-comment[data-post-id="902"]',
      )
      .includesText("@comment-author Inline child");
    assert
      .dom(
        '.video-shorts-comments-surface__comment[data-post-id="602"] .video-shorts-comments-surface__child-comment[data-post-id="902"] [data-video-shorts-reply-target]',
      )
      .doesNotExist();
    assert
      .dom(
        '.video-shorts-comments-surface__comment[data-post-id="603"] .video-shorts-comments-surface__child-comment[data-post-id="902"]',
      )
      .doesNotExist();
    assert.dom("#reply-control.open").doesNotExist();
    assert.dom(".d-editor").doesNotExist();
    assert.dom(".post-action-menu").doesNotExist();
    assert.dom(".video-shorts-comments-sheet").exists();
    assert.dom("[data-action='reply']").exists();
  });

  test("floor reply targets the selected child and de-duplicates @mention", async function (assert) {
    needs.pretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [feedItem(504, "Floor reply composer clip")],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );

      server.get("/posts/504/replies.json", () =>
        helper.response([
          commentPost(604, {
            username: "parent-author",
            post_number: 2,
            reply_count: 1,
          }),
        ]),
      );

      server.get("/posts/604/replies.json", () =>
        helper.response([
          commentPost(614, {
            username: "child-author",
            post_number: 3,
            cooked: "<p>Child floor comment</p>",
            raw: "Child floor comment",
            reply_to_username: "parent-author",
          }),
        ]),
      );

      server.post("/posts.json", (request) => {
        const params = postParams(request);

        assert.strictEqual(params.get("topic_id"), "504");
        assert.strictEqual(params.get("raw"), "@child-author Already mentioned");
        assert.strictEqual(params.get("reply_to_post_number"), "3");

        return helper.response(
          commentPost(914, {
            username: "rootadmin",
            post_number: 4,
            cooked: "<p>@child-author Already mentioned</p>",
            raw: "@child-author Already mentioned",
            reply_to_username: "child-author",
          }),
        );
      });
    });

    await visit("/videos");
    await click('[data-action="open-comments"]');

    assert
      .dom('[data-post-id="614"] [data-video-shorts-reply-target]')
      .includesText("@parent-author");

    await click('[data-post-id="614"] [data-action="reply-to-comment"]');
    await fillIn(
      "[data-video-shorts-comment-reply-input]",
      "@child-author Already mentioned",
    );
    await click("[data-action='publish-comment-reply']");

    assert
      .dom('[data-post-id="914"]')
      .includesText("@child-author Already mentioned");
    assert.dom('[data-post-id="914"] [data-video-shorts-reply-target]').doesNotExist();
    assert.dom("#reply-control.open").doesNotExist();
    assert.dom(".d-editor").doesNotExist();
    assert.dom(".post-action-menu").doesNotExist();
    assert.dom(".video-shorts-comments-sheet").exists();
  });
});
