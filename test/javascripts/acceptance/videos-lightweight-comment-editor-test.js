import { click, fillIn, visit } from "@ember/test-helpers";
import { test } from "qunit";
import pretender, {
  pretenderHelpers,
} from "discourse/tests/helpers/create-pretender";
import { acceptance } from "discourse/tests/helpers/qunit-helpers";

function feedItem(id, postNumber = 1) {
  return {
    topic_id: id,
    post_id: id,
    post_number: postNumber,
    topic_url: `/t/video-${id}/${id}`,
    post_url: `/t/video-${id}/${id}/${postNumber}`,
    title: `Lightweight editor clip ${id}`,
    excerpt: `Excerpt ${id}`,
    user_id: id,
    username: "video-author",
    avatar_template: "/user_avatar/localhost/video-author/{size}/1_2.png",
    created_at: "2026-07-12T00:00:00.000Z",
    counts: { like_count: 0, reply_count: 1, bookmark_count: 0 },
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

function commentPost(id, postNumber = 2) {
  return {
    id,
    post_id: id,
    post_number: postNumber,
    user_id: id,
    username: "comment-author",
    avatar_template: "/user_avatar/localhost/comment-author/{size}/1_2.png",
    cooked: "<p>Parent comment</p>",
    raw: "Parent comment",
    created_at: "2026-07-12T00:01:00.000Z",
    reply_count: 0,
    can_edit: false,
    can_delete: false,
    can_flag: false,
    reply_to_post_number: null,
    reply_to_username: null,
  };
}

function postParams(request) {
  const body = request.requestBody || "";
  const data = body.startsWith("{")
    ? JSON.parse(body)
    : Object.fromEntries(new URLSearchParams(body));

  return {
    get(key) {
      return data[key] === undefined || data[key] === null
        ? null
        : String(data[key]);
    },
  };
}

acceptance(
  "Video Shorts dedicated lightweight comment editor",
  function (needs) {
    needs.settings({ video_shorts_enabled: true });
    needs.user();

    let feedItems;
    let postRequests;

    needs.hooks.beforeEach(function () {
      feedItems = [feedItem(901), feedItem(902, 4)];
      postRequests = [];
      const helper = pretenderHelpers();

      pretender.get("/videos.json", () => {
        return helper.response({
          items: feedItems,
          next_cursor: null,
          scan_limit_reached: false,
        });
      });
      pretender.get("/posts/:post_id/replies.json", (request) =>
        helper.response(
          request.params.post_id === "901" ? [commentPost(991, 2)] : [],
        ),
      );
      pretender.get("/video-shorts/comments/replies.json", (request) =>
        helper.response({
          posts:
            request.queryParams.post_id === "901" ? [commentPost(991, 2)] : [],
          has_more: false,
          next_after: null,
        }),
      );
      pretender.post("/posts.json", (request) => {
        const params = postParams(request);
        const replyToPostNumber = params.get("reply_to_post_number");
        postRequests.push(params);
        return helper.response({
          success: true,
          action: "create_post",
          post: {
            ...commentPost(
              999,
              Math.max(3, Number(replyToPostNumber || 0) + 1),
            ),
            username: "admin_user",
            raw: params.get("raw"),
            cooked: `<p>${params.get("raw")}</p>`,
            topic_id: Number(params.get("topic_id")),
            reply_to_post_number: replyToPostNumber,
          },
        });
      });
    });

    test("PIN: preserves native comment and thread-list rendering contracts", async function (assert) {
      await visit("/videos");
      await click('[data-action="open-comments"]');

      const nativeComment =
        '[data-video-shorts-native-comment][data-post-id="991"]';
      assert.dom("[data-video-shorts-youtube-thread-list]").exists();
      assert.dom(`${nativeComment} article.boxed[data-post-id="991"]`).exists();
      assert.dom(`${nativeComment} .post-menu-area`).exists();
      assert.dom('[data-action="native-top-level-reply"]').exists();
      assert.dom("#reply-control.open").doesNotExist();
    });

    test("RED C1: top-level entry owns a dedicated editor and publishes exact raw", async function (assert) {
      await visit("/videos");
      await click('[data-action="open-comments"]');
      await click('[data-action="native-top-level-reply"]');

      const editor =
        '[data-video-shorts-reply-editor][data-reply-kind="top-level"]';
      assert.dom(editor).isVisible();
      assert.dom(`${editor} [data-video-shorts-reply-input]`).isVisible();
      assert
        .dom(`${editor} [data-video-shorts-reply-submit]`)
        .isDisabled("disables submit while the top-level input is blank");
      assert.dom("#reply-control.open").doesNotExist();

      await fillIn(
        `${editor} [data-video-shorts-reply-input]`,
        "Exact direct raw",
      );
      assert
        .dom(`${editor} [data-video-shorts-reply-submit]`)
        .isNotDisabled("enables submit after top-level input is nonblank");
      await click(`${editor} [data-video-shorts-reply-submit]`);

      assert.strictEqual(postRequests.length, 1);
      assert.strictEqual(postRequests[0].get("topic_id"), "901");
      assert.strictEqual(postRequests[0].get("raw"), "Exact direct raw");
      assert.strictEqual(postRequests[0].get("reply_to_post_number"), null);
    });

    test("RED C2: nested editor targets the selected post without a mention", async function (assert) {
      await visit("/videos");
      await click('[data-action="open-comments"]');
      await click(
        '[data-video-shorts-native-comment][data-post-id="991"] .post-action-menu__reply',
      );

      const inlineEditor =
        '.video-shorts-comments-surface__comment[data-post-id="991"] [data-video-shorts-inline-reply-editor][data-reply-kind="nested"]';
      assert.dom(inlineEditor).isVisible();
      assert.dom("[data-video-shorts-comment-reply-dialog]").doesNotExist();
      assert
        .dom(`${inlineEditor} [data-video-shorts-reply-input]`)
        .hasAttribute("data-target-post-id", "991");
      assert
        .dom(`${inlineEditor} [data-video-shorts-reply-submit]`)
        .isDisabled("disables submit while the nested input is blank");
      assert.dom("#reply-control.open").doesNotExist();

      await fillIn(
        `${inlineEditor} [data-video-shorts-reply-input]`,
        "Exact nested raw",
      );
      assert
        .dom(`${inlineEditor} [data-video-shorts-reply-submit]`)
        .isNotDisabled("enables submit after nested input is nonblank");
      await click(`${inlineEditor} [data-video-shorts-reply-submit]`);

      assert.strictEqual(postRequests.length, 1);
      assert.strictEqual(postRequests[0].get("raw"), "Exact nested raw");
      assert.strictEqual(postRequests[0].get("reply_to_post_number"), "2");
      assert.false(postRequests[0].get("raw").startsWith("@comment-author"));
    });

    test("top-level comments on a non-first source post target that source post", async function (assert) {
      feedItems = [feedItem(902, 4)];
      await visit("/videos");
      await click('[data-action="open-comments"]');
      await click('[data-action="native-top-level-reply"]');

      const editor =
        '[data-video-shorts-reply-editor][data-reply-kind="top-level"]';
      await fillIn(
        `${editor} [data-video-shorts-reply-input]`,
        "Direct comment for source post",
      );
      await click(`${editor} [data-video-shorts-reply-submit]`);

      assert.strictEqual(postRequests.length, 1);
      assert.strictEqual(postRequests[0].get("topic_id"), "902");
      assert.strictEqual(
        postRequests[0].get("reply_to_post_number"),
        "4",
        "the direct comment remains attributable to the non-first video post",
      );
      assert
        .dom('[data-video-shorts-native-comment][data-post-id="999"]')
        .exists("the canonical response stays visible under the source video");
    });

    test("RED C2: cancel clears draft and target without posting", async function (assert) {
      await visit("/videos");
      await click('[data-action="open-comments"]');
      await click(
        '[data-video-shorts-native-comment][data-post-id="991"] .post-action-menu__reply',
      );

      const inlineEditor =
        '.video-shorts-comments-surface__comment[data-post-id="991"] [data-video-shorts-inline-reply-editor][data-reply-kind="nested"]';
      assert.dom(inlineEditor).isVisible();
      assert.dom("[data-video-shorts-comment-reply-dialog]").doesNotExist();
      assert.dom(`${inlineEditor} [data-video-shorts-reply-input]`).isVisible();
      await fillIn(
        `${inlineEditor} [data-video-shorts-reply-input]`,
        "Discard me",
      );
      await click(`${inlineEditor} [data-video-shorts-reply-cancel]`);

      assert.dom(inlineEditor).doesNotExist();
      assert.dom("[data-video-shorts-comment-reply-dialog]").doesNotExist();
      assert.strictEqual(postRequests.length, 0);

      await click('[data-action="native-top-level-reply"]');
      assert
        .dom(
          '[data-video-shorts-reply-editor][data-reply-kind="top-level"] [data-video-shorts-reply-input]',
        )
        .hasValue("");
    });
  },
);
