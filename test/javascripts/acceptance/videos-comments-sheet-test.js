import {
  click,
  currentURL,
  fillIn,
  triggerKeyEvent,
  visit,
} from "@ember/test-helpers";
import { test } from "qunit";
import FlagModal from "discourse/components/modal/flag";
import PostFlag from "discourse/lib/flag-targets/post-flag";
import pretender, {
  pretenderHelpers,
} from "discourse/tests/helpers/create-pretender";
import { acceptance } from "discourse/tests/helpers/qunit-helpers";

function feedItem(id, title, actions = null, attrs = {}) {
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
    ...attrs,
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

function postParams(request) {
  return new URLSearchParams(request.requestBody);
}

function setupPretender(callback) {
  callback(pretender, pretenderHelpers());
}

acceptance("Video Shorts comments sheet", function (needs) {
  needs.settings({ video_shorts_enabled: true });
  needs.user();

  test("renders comments without sort filters in Discourse reply order", async function (assert) {
    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [feedItem(106, "Sorted comment clip")],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );

      server.get("/posts/106/replies.json", () =>
        helper.response([
          directReply(206, "popular-author", "<p>Most liked comment</p>", {
            created_at: "2026-06-08T10:00:00.000Z",
            actions_summary: [{ id: 2, count: 18, can_act: true }],
            post_url: "/t/sorted-comment/106/2",
          }),
          directReply(207, "recent-author", "<p>Newest comment</p>", {
            created_at: "2026-06-08T12:00:00.000Z",
            actions_summary: [{ id: 2, count: 2, can_act: true }],
            post_url: "/t/sorted-comment/106/3",
          }),
        ]),
      );
    });

    await visit("/videos");
    await click("[data-action='open-comments']");

    assert.dom("[data-action='sort-popular']").doesNotExist();
    assert.dom("[data-action='sort-recent']").doesNotExist();

    const commentsText = () =>
      [...document.querySelectorAll(".video-shorts-comments-surface__cooked")]
        .map((node) => node.textContent.trim())
        .filter(Boolean);

    assert.deepEqual(
      commentsText().slice(0, 2),
      ["Most liked comment", "Newest comment"],
      "comments keep the source order returned by Discourse",
    );
    assert.dom(".post-action-menu").doesNotExist();
    assert.dom("#reply-control.open").doesNotExist();
  });

  test("exposes a current-video accent color to the comments surface", async function (assert) {
    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [
            feedItem(109, "Accent color clip", null, {
              visual_accent_color: "#0f766e",
            }),
          ],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );

      server.get("/posts/109/replies.json", () => helper.response([]));
    });

    await visit("/videos");
    await click("[data-action='open-comments']");

    const surface = document.querySelector(".video-shorts-comments-surface");

    assert.strictEqual(
      getComputedStyle(surface)
        .getPropertyValue("--video-shorts-current-accent")
        .trim(),
      "#0f766e",
      "comments surface inherits the active video accent color",
    );
  });

  test("opens custom comments sheet with child replies and no composer", async function (assert) {
    setupPretender((server, helper) => {
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
    assert.dom("[data-video-shorts-reply-target]").doesNotExist();
    assert.dom(".topic-post article.boxed").doesNotExist();
    assert.dom(".post-action-menu").doesNotExist();
    assert.dom("#reply-control.open").doesNotExist();
    assert.dom(".d-editor").doesNotExist();
  });

  test("reconciles the sheet and rail count after nested replies load", async function (assert) {
    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [
            feedItem(116, "Nested count reconciliation clip", null, {
              counts: {
                like_count: 0,
                reply_count: 2,
                bookmark_count: 0,
              },
            }),
          ],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );

      server.get("/posts/116/replies.json", () =>
        helper.response([
          directReply(216, "first-author", "<p>First direct reply</p>", {
            post_number: 2,
            reply_count: 1,
            post_url: "/t/nested-count/116/2",
          }),
          directReply(217, "second-author", "<p>Second direct reply</p>", {
            post_number: 3,
            post_url: "/t/nested-count/116/3",
          }),
        ]),
      );
      server.get("/posts/216/replies.json", () =>
        helper.response([
          directReply(218, "nested-author", "<p>Nested reply</p>", {
            post_number: 4,
            reply_count: 1,
            reply_to_post_number: 2,
            post_url: "/t/nested-count/116/4",
          }),
        ]),
      );
      server.get("/posts/218/replies.json", () =>
        helper.response([
          directReply(219, "deep-author", "<p>Deep reply</p>", {
            post_number: 5,
            reply_to_post_number: 4,
            post_url: "/t/nested-count/116/5",
          }),
        ]),
      );
    });

    await visit("/videos");

    assert
      .dom(
        '[data-post-id="116"] [data-action="open-comments"] .video-shorts-action-rail__count',
      )
      .hasText("2", "feed starts with the direct reply count");

    await click("[data-action='open-comments']");

    assert.dom(".d-modal__title").hasText("4 replies");
    assert.dom(".video-shorts-comments-surface__comment").exists({ count: 2 });
    assert
      .dom(".video-shorts-comments-surface__child-comment")
      .exists({ count: 2 });
    assert
      .dom(
        '[data-post-id="116"] [data-action="open-comments"] .video-shorts-action-rail__count',
      )
      .hasText("4", "rail count reconciles to the loaded comment tree");
  });

  test("keeps nested reply avatars stable inside the comments surface", async function (assert) {
    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [feedItem(108, "Nested avatar clip")],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );

      server.get("/posts/108/replies.json", () =>
        helper.response([
          directReply(
            208,
            "reply-author-with-a-long-name",
            "<p>Parent direct reply with enough text to wrap in the panel.</p>",
            {
              reply_count: 1,
              post_url: "/t/video-108/108/2",
            },
          ),
        ]),
      );

      server.get("/posts/208/replies.json", () =>
        helper.response([
          directReply(
            218,
            "nested-author-with-a-long-name",
            "<p>Nested direct reply with enough text to prove the avatar track does not collapse.</p>",
            {
              post_number: 3,
              reply_to_username: "reply-author-with-a-long-name",
              post_url: "/t/video-108/108/3",
            },
          ),
        ]),
      );
    });

    await visit("/videos");
    await click("[data-action='open-comments']");

    assert
      .dom(
        ".video-shorts-comments-surface__child-comment .video-shorts-comments-surface__avatar-link--small",
      )
      .exists("nested reply uses the fixed small avatar container");
  });

  test("renders empty state without opening composer", async function (assert) {
    setupPretender((server, helper) => {
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

  test("top-level reply publishes inline in the custom sheet", async function (assert) {
    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [feedItem(103, "Replyable clip")],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );

      server.get("/posts/103/replies.json", () => helper.response([]));
      server.post("/posts.json", (request) => {
        const params = postParams(request);

        assert.strictEqual(params.get("topic_id"), "103");
        assert.strictEqual(params.get("raw"), "Sheet inline reply");
        assert.strictEqual(params.get("reply_to_post_number"), "1");

        return helper.response(
          directReply(223, "admin_user", "<p>Sheet inline reply</p>", {
            post_number: 2,
            raw: "Sheet inline reply",
            post_url: "/t/replyable/103/2",
          }),
        );
      });
    });

    await visit("/videos");
    const beforeURL = currentURL();

    await click("[data-action='open-comments']");
    await fillIn("[data-video-shorts-reply-input]", "Sheet inline reply");
    await click("[data-action='publish-reply']");

    assert.strictEqual(currentURL(), beforeURL);
    assert
      .dom('.video-shorts-comments-surface__comment[data-post-id="223"]')
      .includesText("Sheet inline reply");
    assert.dom("[data-video-shorts-reply-input]").hasValue("");
    assert.dom("#reply-control.open").doesNotExist();
    assert.dom("#reply-control .d-editor").doesNotExist();
  });

  test("comment reply publishes inline for a top-level comment", async function (assert) {
    setupPretender((server, helper) => {
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

      server.post("/posts.json", (request) => {
        const params = postParams(request);

        assert.strictEqual(params.get("topic_id"), "104");
        assert.strictEqual(params.get("raw"), "Inline parent child");
        assert.strictEqual(params.get("reply_to_post_number"), "2");
        assert.false(params.get("raw").startsWith("@reply-author"));

        return helper.response(
          directReply(226, "admin_user", "<p>Inline parent child</p>", {
            post_number: 3,
            raw: "Inline parent child",
            reply_to_post_number: 2,
            post_url: "/t/nested-replyable/104/3",
          }),
        );
      });
    });

    await visit("/videos");
    const beforeURL = currentURL();

    await click("[data-action='open-comments']");
    await click('[data-post-id="204"] [data-action="reply-to-comment"]');
    assert
      .dom("[data-video-shorts-comment-reply-status]")
      .includesText("Replying to reply-author");
    assert
      .dom('[data-post-id="204"] [data-video-shorts-reply-target]')
      .includesText("reply-author");

    await fillIn(
      "[data-video-shorts-comment-reply-input]",
      "Inline parent child",
    );
    await click("[data-action='publish-comment-reply']");

    assert.strictEqual(currentURL(), beforeURL);
    assert
      .dom(
        '.video-shorts-comments-surface__comment[data-post-id="204"] .video-shorts-comments-surface__child-comment[data-post-id="226"]',
      )
      .includesText("Inline parent child");
    assert.dom("#reply-control.open").doesNotExist();
    assert.dom("#reply-control .d-editor").doesNotExist();
    assert.dom("[data-video-shorts-comment-reply-status]").doesNotExist();
    assert.dom("[data-video-shorts-comment-reply-input]").doesNotExist();
  });

  test("floor comment reply publishes inline for the selected child", async function (assert) {
    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [feedItem(118, "Inline floor reply clip")],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );

      server.get("/posts/118/replies.json", () =>
        helper.response([
          directReply(224, "reply-author", "<p>Parent comment</p>", {
            post_number: 2,
            reply_count: 1,
            post_url: "/t/native-floor-reply/118/2",
          }),
        ]),
      );

      server.get("/posts/224/replies.json", () =>
        helper.response([
          directReply(225, "child-author", "<p>Child floor comment</p>", {
            post_number: 3,
            reply_to_post_number: 2,
            reply_to_username: "reply-author",
            post_url: "/t/native-floor-reply/118/3",
          }),
        ]),
      );

      server.post("/posts.json", (request) => {
        const params = postParams(request);

        assert.strictEqual(params.get("topic_id"), "118");
        assert.strictEqual(params.get("raw"), "Inline floor child");
        assert.strictEqual(params.get("reply_to_post_number"), "3");
        assert.false(params.get("raw").startsWith("@child-author"));

        return helper.response(
          directReply(227, "admin_user", "<p>Inline floor child</p>", {
            post_number: 4,
            raw: "Inline floor child",
            reply_to_post_number: 3,
            post_url: "/t/native-floor-reply/118/4",
          }),
        );
      });
    });

    await visit("/videos");
    const beforeURL = currentURL();

    await click("[data-action='open-comments']");

    assert
      .dom('[data-post-id="225"] [data-video-shorts-reply-target]')
      .doesNotExist("the shorts panel does not synthesize @target badges");

    await click('[data-post-id="225"] [data-action="reply-to-comment"]');
    assert
      .dom("[data-video-shorts-comment-reply-status]")
      .includesText("Replying to @child-author");
    assert
      .dom('[data-post-id="225"] [data-video-shorts-reply-target]')
      .includesText("@child-author");
    assert
      .dom(
        ".video-shorts-comments-surface__reply [data-video-shorts-comment-reply-input]",
      )
      .isVisible("floor replies keep the bottom composer visible");
    assert
      .dom('[data-post-id="225"] [data-video-shorts-comment-reply-input]')
      .doesNotExist("floor replies do not render a cramped inline input");

    await fillIn(
      "[data-video-shorts-comment-reply-input]",
      "Inline floor child",
    );
    await click("[data-action='publish-comment-reply']");

    assert.strictEqual(currentURL(), beforeURL);
    assert
      .dom(
        '.video-shorts-comments-surface__child-comment[data-post-id="225"] .video-shorts-comments-surface__child-comment[data-post-id="227"]',
      )
      .includesText("Inline floor child");
    assert
      .dom(
        '.video-shorts-comments-surface__comment[data-post-id="224"] > .video-shorts-comments-surface__comment-card > .video-shorts-comments-surface__comment-main > .video-shorts-comments-surface__child-list > .video-shorts-comments-surface__child-comment[data-post-id="227"]',
      )
      .doesNotExist();
    assert
      .dom('[data-post-id="227"] [data-video-shorts-reply-target]')
      .doesNotExist();
    assert.dom("#reply-control.open").doesNotExist();
    assert.dom("#reply-control .d-editor").doesNotExist();
    assert.dom("[data-video-shorts-comment-reply-status]").doesNotExist();
    assert.dom("[data-video-shorts-comment-reply-input]").doesNotExist();
  });

  test("renders permission-aware custom tools menu", async function (assert) {
    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [feedItem(105, "Managed comment clip")],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );

      server.get("/posts/105/replies.json", () =>
        helper.response([
          directReply(205, "admin_user", "<p>Comment with tools</p>", {
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

  test("opens native flag modal for a comment report", async function (assert) {
    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [feedItem(113, "Flaggable comment clip")],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );

      server.get("/posts/113/replies.json", () =>
        helper.response([
          directReply(213, "flag-author", "<p>Comment to report</p>", {
            can_flag: true,
            post_number: 2,
            post_url: "/t/flaggable-comment/113/2",
            actions_summary: [{ id: 3, can_act: true }],
          }),
        ]),
      );
    });

    const shownModals = [];
    const modal = this.owner.lookup("service:modal");
    const originalShow = modal.show;
    const valueFor = (model, key) => {
      return typeof model?.get === "function" ? model.get(key) : model?.[key];
    };

    modal.show = (component, options) => {
      shownModals.push({
        component,
        flagTarget: options?.model?.flagTarget,
        flagModel: options?.model?.flagModel,
        setHidden: options?.model?.setHidden,
      });
    };

    try {
      await visit("/videos");
      await click("[data-action='open-comments']");
      await click('[data-post-id="213"] [data-action="comment-tools-toggle"]');
      await click('[data-post-id="213"] [data-action="flag-comment"]');
    } finally {
      modal.show = originalShow;
    }

    assert.strictEqual(shownModals.length, 1);
    assert.strictEqual(shownModals[0].component, FlagModal);
    assert.true(
      shownModals[0].flagTarget instanceof PostFlag,
      "comment report uses the native PostFlag target",
    );
    assert.strictEqual(String(valueFor(shownModals[0].flagModel, "id")), "213");
    assert.strictEqual(
      Number(valueFor(shownModals[0].flagModel, "topic_id")),
      113,
    );
    assert.strictEqual(
      Number(valueFor(shownModals[0].flagModel, "post_number")),
      2,
    );
    assert.strictEqual(
      typeof shownModals[0].flagModel.set,
      "function",
      "flag model is a store-backed post record",
    );

    shownModals[0].setHidden();

    assert.true(valueFor(shownModals[0].flagModel, "hidden"));
    assert.dom('[data-video-shorts-comment-tools-menu="213"]').doesNotExist();
  });

  test("hides comment report action when native flagging is unavailable", async function (assert) {
    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [feedItem(114, "Unflaggable comment clip")],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );

      server.get("/posts/114/replies.json", () =>
        helper.response([
          directReply(214, "no-flag-author", "<p>Comment without report</p>", {
            can_flag: false,
            post_number: 2,
            post_url: "/t/unflaggable-comment/114/2",
            actions_summary: [{ id: 2, can_act: true }],
          }),
        ]),
      );
    });

    await visit("/videos");
    await click("[data-action='open-comments']");
    await click('[data-post-id="214"] [data-action="comment-tools-toggle"]');

    assert.dom('[data-video-shorts-comment-tools-menu="214"]').exists();
    assert.dom('[data-action="flag-comment"]').doesNotExist();
  });

  test("closes custom comment tools menu on outside click and Escape", async function (assert) {
    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [feedItem(107, "Closable tools clip")],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );

      server.get("/posts/107/replies.json", () =>
        helper.response([
          directReply(207, "admin_user", "<p>Comment with closable tools</p>", {
            can_edit: true,
            can_delete: true,
            can_flag: true,
            post_url: "/t/closable-tools/107/2",
          }),
        ]),
      );
    });

    await visit("/videos");
    await click("[data-action='open-comments']");
    await click('[data-post-id="207"] [data-action="comment-tools-toggle"]');

    assert.dom('[data-video-shorts-comment-tools-menu="207"]').exists();

    await click(".video-shorts-comments-surface");

    assert
      .dom('[data-video-shorts-comment-tools-menu="207"]')
      .doesNotExist("outside surface click closes the custom tools menu");

    await click('[data-post-id="207"] [data-action="comment-tools-toggle"]');
    await triggerKeyEvent(
      ".video-shorts-comments-surface",
      "keydown",
      "Escape",
    );

    assert
      .dom('[data-video-shorts-comment-tools-menu="207"]')
      .doesNotExist("Escape closes the custom tools menu");
    assert.dom(".post-action-menu").doesNotExist();
  });

  test("updates mobile sheet and rail counts after deleting a comment", async function (assert) {
    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [feedItem(110, "Delete count clip")],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );

      server.get("/posts/110/replies.json", () =>
        helper.response([
          directReply(210, "admin_user", "<p>Comment to delete</p>", {
            can_delete: true,
            post_url: "/t/delete-count/110/2",
          }),
          directReply(211, "reply-author", "<p>Comment to keep</p>", {
            post_url: "/t/delete-count/110/3",
          }),
        ]),
      );

      server.delete("/posts/210.json", () => helper.response({}));
    });

    await visit("/videos");

    assert
      .dom(
        '[data-post-id="110"] [data-action="open-comments"] .video-shorts-action-rail__count',
      )
      .hasText("2");

    await click("[data-action='open-comments']");

    assert.dom(".d-modal__title").hasText("2 replies");

    await click('[data-post-id="210"] [data-action="comment-tools-toggle"]');
    await click('[data-post-id="210"] [data-action="delete-comment"]');
    await click(".dialog-footer .btn-primary");

    assert
      .dom('.video-shorts-comments-surface__comment[data-post-id="210"]')
      .doesNotExist("deleted comment is removed from the open sheet");
    assert.dom(".d-modal__title").hasText("1 reply");
    assert
      .dom(
        '[data-post-id="110"] [data-action="open-comments"] .video-shorts-action-rail__count',
      )
      .hasText("1", "rail count updates immediately after delete");
  });

  test("refreshes comment surface after delete without closing comments", async function (assert) {
    let refreshRepliesRequests = 0;

    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [feedItem(116, "Refresh after delete clip")],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );

      server.get("/posts/116/replies.json", () => {
        refreshRepliesRequests += 1;

        return helper.response(
          refreshRepliesRequests === 1
            ? [
                directReply(218, "admin_user", "<p>Stale delete target</p>", {
                  can_delete: true,
                  post_url: "/t/refresh-after-delete/116/2",
                }),
                directReply(219, "keep-author", "<p>Keep after refresh</p>", {
                  post_url: "/t/refresh-after-delete/116/3",
                }),
              ]
            : [
                directReply(219, "keep-author", "<p>Keep after refresh</p>", {
                  post_url: "/t/refresh-after-delete/116/3",
                }),
                directReply(220, "server-author", "<p>Fresh after delete</p>", {
                  post_url: "/t/refresh-after-delete/116/4",
                }),
              ],
        );
      });

      server.get("/posts/218/replies.json", () => helper.response([]));
      server.delete("/posts/218.json", () => helper.response({}));
    });

    await visit("/videos");
    await click("[data-action='open-comments']");

    assert.dom("[data-action='sort-recent']").doesNotExist();
    assert.dom(".d-modal__body").exists("comments sheet is open before delete");

    await click('[data-post-id="218"] [data-action="comment-tools-toggle"]');
    await click('[data-post-id="218"] [data-action="delete-comment"]');
    await click(".dialog-footer .btn-primary");

    assert.strictEqual(
      refreshRepliesRequests,
      2,
      "source replies are refetched after the destructive mutation",
    );
    assert.dom(".d-modal__body").exists("comments sheet stays open");
    assert.strictEqual(currentURL(), "/videos");
    assert.dom("[data-action='sort-recent']").doesNotExist();
    assert
      .dom('.video-shorts-comments-surface__comment[data-post-id="218"]')
      .doesNotExist("stale deleted comment is gone");
    assert
      .dom('.video-shorts-comments-surface__comment[data-post-id="220"]')
      .includesText("Fresh after delete");
    assert.strictEqual(
      document.querySelectorAll(
        '.video-shorts-comments-surface__comment[data-post-id="219"]',
      ).length,
      1,
      "refresh does not duplicate existing comments",
    );
  });

  test("reconciles edited comment from core post response", async function (assert) {
    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [feedItem(117, "Edit reconcile clip")],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );

      server.get("/posts/117/replies.json", () =>
        helper.response([
          directReply(221, "admin_user", "<p>Original editable comment</p>", {
            can_edit: true,
            post_url: "/t/edit-reconcile/117/2",
          }),
        ]),
      );

      server.get("/posts/221.json", () =>
        helper.response(
          directReply(221, "admin_user", "<p>Fresh raw before edit</p>", {
            can_edit: true,
            raw: "Fresh raw before edit",
            post_url: "/t/edit-reconcile/117/2",
          }),
        ),
      );

      server.put("/posts/221.json", () =>
        helper.response({
          post: directReply(
            221,
            "admin_user",
            "<p>Server cooked after edit</p>",
            {
              can_edit: true,
              raw: "Server raw after edit",
              updated_at: "2026-06-08T13:00:00.000Z",
              post_url: "/t/edit-reconcile/117/2",
            },
          ),
        }),
      );
    });

    await visit("/videos");
    await click("[data-action='open-comments']");
    await click('[data-post-id="221"] [data-action="comment-tools-toggle"]');
    await click('[data-post-id="221"] [data-action="edit-comment"]');

    assert
      .dom("[data-video-shorts-edit-input]")
      .hasValue("Fresh raw before edit");

    await fillIn("[data-video-shorts-edit-input]", "Typed draft not echoed");
    await click('[data-action="save-edit"]');

    assert.dom("[data-video-shorts-edit-input]").doesNotExist();
    assert
      .dom('.video-shorts-comments-surface__comment[data-post-id="221"]')
      .includesText("Server cooked after edit");
    assert
      .dom('.video-shorts-comments-surface__comment[data-post-id="221"]')
      .doesNotIncludeText("Typed draft not echoed");
    assert.strictEqual(currentURL(), "/videos");
  });

  test("reconciles edited child reply from core post response", async function (assert) {
    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [feedItem(119, "Edit nested child clip")],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );

      server.get("/posts/119/replies.json", () =>
        helper.response([
          directReply(229, "parent-author", "<p>Parent for nested edit</p>", {
            post_number: 2,
            reply_count: 1,
            post_url: "/t/edit-nested-child/119/2",
          }),
        ]),
      );

      server.get("/posts/229/replies.json", () =>
        helper.response([
          directReply(230, "admin_user", "<p>Original nested child</p>", {
            can_edit: true,
            post_number: 3,
            reply_to_post_number: 2,
            raw: "Original nested child",
            post_url: "/t/edit-nested-child/119/3",
          }),
        ]),
      );

      server.get("/posts/230.json", () =>
        helper.response(
          directReply(230, "admin_user", "<p>Fresh nested raw</p>", {
            can_edit: true,
            post_number: 3,
            reply_to_post_number: 2,
            raw: "Fresh nested raw",
            post_url: "/t/edit-nested-child/119/3",
          }),
        ),
      );

      server.put("/posts/230.json", () =>
        helper.response({
          post: directReply(
            230,
            "admin_user",
            "<p>Server nested after edit</p>",
            {
              can_edit: true,
              post_number: 3,
              reply_to_post_number: 2,
              raw: "Server nested after edit",
              updated_at: "2026-06-08T13:30:00.000Z",
              post_url: "/t/edit-nested-child/119/3",
            },
          ),
        }),
      );
    });

    await visit("/videos");
    await click("[data-action='open-comments']");
    await click('[data-post-id="230"] [data-action="comment-tools-toggle"]');
    await click('[data-post-id="230"] [data-action="edit-comment"]');

    assert
      .dom("[data-video-shorts-edit-input]")
      .hasValue("Fresh nested raw");

    await fillIn("[data-video-shorts-edit-input]", "Typed nested draft");
    await click('[data-action="save-edit"]');

    assert.dom("[data-video-shorts-edit-input]").doesNotExist();
    assert
      .dom('.video-shorts-comments-surface__child-comment[data-post-id="230"]')
      .includesText("Server nested after edit");
    assert
      .dom('.video-shorts-comments-surface__child-comment[data-post-id="230"]')
      .doesNotIncludeText("Typed nested draft");
    assert.strictEqual(currentURL(), "/videos");
  });

  test("updates mobile sheet and rail counts after deleting a child reply", async function (assert) {
    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [
            feedItem(111, "Delete child count clip", null, {
              counts: {
                like_count: 0,
                reply_count: 3,
                bookmark_count: 0,
              },
            }),
          ],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );

      server.get("/posts/111/replies.json", () =>
        helper.response([
          directReply(212, "parent-author", "<p>Parent comment</p>", {
            post_number: 2,
            reply_count: 1,
            post_url: "/t/delete-child-count/111/2",
          }),
          directReply(214, "second-author", "<p>Second comment</p>", {
            post_number: 4,
            post_url: "/t/delete-child-count/111/4",
          }),
        ]),
      );
      server.get("/posts/212/replies.json", () =>
        helper.response([
          directReply(213, "admin_user", "<p>Child reply to delete</p>", {
            can_delete: true,
            post_number: 3,
            reply_to_post_number: 2,
            reply_to_username: "parent-author",
            post_url: "/t/delete-child-count/111/3",
          }),
        ]),
      );

      server.delete("/posts/213.json", () => helper.response({}));
    });

    await visit("/videos");

    assert
      .dom(
        '[data-post-id="111"] [data-action="open-comments"] .video-shorts-action-rail__count',
      )
      .hasText("3");

    await click("[data-action='open-comments']");

    assert.dom(".d-modal__title").hasText("3 replies");
    assert
      .dom('.video-shorts-comments-surface__child-comment[data-post-id="213"]')
      .includesText("Child reply to delete");

    await click('[data-post-id="213"] [data-action="comment-tools-toggle"]');
    await click('[data-post-id="213"] [data-action="delete-comment"]');
    await click(".dialog-footer .btn-primary");

    assert
      .dom('.video-shorts-comments-surface__child-comment[data-post-id="213"]')
      .doesNotExist("deleted child reply is removed from the open sheet");
    assert
      .dom('.video-shorts-comments-surface__comment[data-post-id="212"]')
      .doesNotIncludeText("1 reply");
    assert.dom(".d-modal__title").hasText("2 replies");
    assert
      .dom(
        '[data-post-id="111"] [data-action="open-comments"] .video-shorts-action-rail__count',
      )
      .hasText("2", "rail count updates after child deletion");
  });

  test("updates counts after deleting a deep child reply", async function (assert) {
    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [
            feedItem(120, "Delete deep child count clip", null, {
              counts: {
                like_count: 0,
                reply_count: 4,
                bookmark_count: 0,
              },
            }),
          ],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );

      server.get("/posts/120/replies.json", () =>
        helper.response([
          directReply(231, "parent-author", "<p>Parent comment</p>", {
            post_number: 2,
            reply_count: 1,
            post_url: "/t/delete-deep-child/120/2",
          }),
          directReply(234, "second-author", "<p>Second comment</p>", {
            post_number: 5,
            post_url: "/t/delete-deep-child/120/5",
          }),
        ]),
      );
      server.get("/posts/231/replies.json", () =>
        helper.response([
          directReply(232, "child-author", "<p>Child comment remains</p>", {
            post_number: 3,
            reply_count: 1,
            reply_to_post_number: 2,
            post_url: "/t/delete-deep-child/120/3",
          }),
        ]),
      );
      server.get("/posts/232/replies.json", () =>
        helper.response([
          directReply(233, "admin_user", "<p>Deep child to delete</p>", {
            can_delete: true,
            post_number: 4,
            reply_to_post_number: 3,
            post_url: "/t/delete-deep-child/120/4",
          }),
        ]),
      );

      server.delete("/posts/233.json", () => helper.response({}));
    });

    await visit("/videos");
    await click("[data-action='open-comments']");

    assert.dom(".d-modal__title").hasText("4 replies");
    assert
      .dom('.video-shorts-comments-surface__child-comment[data-post-id="233"]')
      .includesText("Deep child to delete");

    await click('[data-post-id="233"] [data-action="comment-tools-toggle"]');
    await click('[data-post-id="233"] [data-action="delete-comment"]');
    await click(".dialog-footer .btn-primary");

    assert
      .dom('.video-shorts-comments-surface__child-comment[data-post-id="233"]')
      .doesNotExist("deleted deep child reply is removed from the open sheet");
    assert
      .dom('.video-shorts-comments-surface__child-comment[data-post-id="232"]')
      .includesText("Child comment remains");
    assert.dom(".d-modal__title").hasText("3 replies");
    assert
      .dom(
        '[data-post-id="120"] [data-action="open-comments"] .video-shorts-action-rail__count',
      )
      .hasText("3", "rail count updates after deep child deletion");
  });

  test("preserves descendant replies when deleting a child reply", async function (assert) {
    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [
            feedItem(121, "Delete child with descendant clip", null, {
              counts: {
                like_count: 0,
                reply_count: 3,
                bookmark_count: 0,
              },
            }),
          ],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );

      server.get("/posts/121/replies.json", () =>
        helper.response([
          directReply(235, "parent-author", "<p>Parent comment</p>", {
            post_number: 2,
            reply_count: 1,
            post_url: "/t/delete-child-descendant/121/2",
          }),
          directReply(238, "second-author", "<p>Second comment</p>", {
            post_number: 5,
            post_url: "/t/delete-child-descendant/121/5",
          }),
        ]),
      );
      server.get("/posts/235/replies.json", () =>
        helper.response([
          directReply(236, "admin_user", "<p>Child with descendant</p>", {
            can_delete: true,
            post_number: 3,
            reply_count: 1,
            reply_to_post_number: 2,
            post_url: "/t/delete-child-descendant/121/3",
          }),
        ]),
      );
      server.get("/posts/236/replies.json", () =>
        helper.response([
          directReply(237, "grandchild-author", "<p>Grandchild remains</p>", {
            post_number: 4,
            reply_to_post_number: 3,
            post_url: "/t/delete-child-descendant/121/4",
          }),
        ]),
      );

      server.delete("/posts/236.json", () => helper.response({}));
    });

    await visit("/videos");
    await click("[data-action='open-comments']");

    assert.dom(".d-modal__title").hasText("3 replies");
    assert
      .dom('.video-shorts-comments-surface__child-comment[data-post-id="237"]')
      .includesText("Grandchild remains");

    await click('[data-post-id="236"] [data-action="comment-tools-toggle"]');
    await click('[data-post-id="236"] [data-action="delete-comment"]');
    await click(".dialog-footer .btn-primary");

    assert
      .dom('.video-shorts-comments-surface__child-comment[data-post-id="236"]')
      .includesText("Deleted comment");
    assert
      .dom('.video-shorts-comments-surface__child-comment[data-post-id="237"]')
      .includesText("Grandchild remains");
    assert.dom(".d-modal__title").hasText("2 replies");
    assert
      .dom(
        '[data-post-id="121"] [data-action="open-comments"] .video-shorts-action-rail__count',
      )
      .hasText("2", "rail count decrements only the deleted child reply");
  });

  test("updates mobile sheet and rail counts after deleting a parent with children", async function (assert) {
    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [
            feedItem(112, "Delete parent with child count clip", null, {
              counts: {
                like_count: 0,
                reply_count: 3,
                bookmark_count: 0,
              },
            }),
          ],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );

      server.get("/posts/112/replies.json", () =>
        helper.response([
          directReply(215, "admin_user", "<p>Mobile parent to delete</p>", {
            can_delete: true,
            post_number: 2,
            reply_count: 1,
            post_url: "/t/delete-parent-child-count/112/2",
          }),
          directReply(217, "second-author", "<p>Mobile second comment</p>", {
            post_number: 4,
            post_url: "/t/delete-parent-child-count/112/4",
          }),
        ]),
      );
      server.get("/posts/215/replies.json", () =>
        helper.response([
          directReply(
            216,
            "child-author",
            "<p>Mobile child reply remains</p>",
            {
              post_number: 3,
              reply_to_post_number: 2,
              reply_to_username: "admin_user",
              post_url: "/t/delete-parent-child-count/112/3",
            },
          ),
        ]),
      );

      server.delete("/posts/215.json", () => helper.response({}));
    });

    await visit("/videos");

    assert
      .dom(
        '[data-post-id="112"] [data-action="open-comments"] .video-shorts-action-rail__count',
      )
      .hasText("3");

    await click("[data-action='open-comments']");

    assert.dom(".d-modal__title").hasText("3 replies");
    assert
      .dom('.video-shorts-comments-surface__child-comment[data-post-id="216"]')
      .includesText("Mobile child reply remains");

    await click('[data-post-id="215"] [data-action="comment-tools-toggle"]');
    await click('[data-post-id="215"] [data-action="delete-comment"]');
    await click(".dialog-footer .btn-primary");

    assert
      .dom('.video-shorts-comments-surface__comment[data-post-id="215"]')
      .includesText("Deleted comment");
    assert
      .dom('.video-shorts-comments-surface__child-comment[data-post-id="216"]')
      .includesText("Mobile child reply remains");
    assert.dom(".d-modal__title").hasText("2 replies");
    assert
      .dom(
        '[data-post-id="112"] [data-action="open-comments"] .video-shorts-action-rail__count',
      )
      .hasText("2", "mobile rail count decrements only the deleted parent");
  });
});

acceptance("Video Shorts comments sheet anonymous report", function (needs) {
  needs.settings({ video_shorts_enabled: true });

  test("opens comments read-only when logged out", async function (assert) {
    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [feedItem(116, "Anonymous comments clip")],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );

      server.get("/posts/116/replies.json", () =>
        helper.response([
          directReply(
            216,
            "guest-visible",
            "<p>Visible to anonymous users</p>",
            {
              post_number: 2,
              post_url: "/t/anonymous-comments/116/2",
            },
          ),
        ]),
      );
    });

    await visit("/videos");
    await click("[data-action='open-comments']");

    assert.strictEqual(currentURL(), "/videos");
    assert.dom(".video-shorts-comments-sheet").exists();
    assert
      .dom(".video-shorts-comments-surface__cooked")
      .includesText("Visible to anonymous users");
    assert
      .dom("[data-video-shorts-reply-input]")
      .doesNotExist("anonymous users get a read-only comments sheet");
  });

  test("comment report opens the native login flow when logged out", async function (assert) {
    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [feedItem(115, "Anonymous comment report clip")],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );

      server.get("/posts/115/replies.json", () =>
        helper.response([
          directReply(215, "report-author", "<p>Anonymous report target</p>", {
            can_flag: true,
            post_number: 2,
            post_url: "/t/anonymous-comment-report/115/2",
            actions_summary: [{ id: 3, can_act: true }],
          }),
        ]),
      );
    });

    await visit("/videos");
    await click("[data-action='open-comments']");
    await click('[data-post-id="215"] [data-action="comment-tools-toggle"]');
    await click('[data-post-id="215"] [data-action="flag-comment"]');

    assert.strictEqual(currentURL(), "/login");
  });
});
