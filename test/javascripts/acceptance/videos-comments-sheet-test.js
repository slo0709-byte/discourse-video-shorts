import {
  blur,
  click,
  currentURL,
  fillIn,
  focus,
  settled,
  triggerKeyEvent,
  visit,
  waitUntil,
} from "@ember/test-helpers";
import { test } from "qunit";
import FlagModal from "discourse/components/modal/flag";
import PostFlag from "discourse/lib/flag-targets/post-flag";
import pretender, {
  pretenderHelpers,
} from "discourse/tests/helpers/create-pretender";
import { acceptance } from "discourse/tests/helpers/qunit-helpers";
import * as videoShortsComments from "discourse/plugins/discourse-video-shorts/discourse/lib/video-shorts-comments";

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

function deferredResponse() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

function viewRepliesSelector(postId) {
  return `[data-post-id="${postId}"] [data-video-shorts-view-replies]`;
}

function loadMoreRepliesSelector(postId) {
  return `[data-post-id="${postId}"] [data-video-shorts-load-more-replies]`;
}

function childListSelector(postId) {
  return `[data-post-id="${postId}"] > .video-shorts-comments-surface__comment-card [data-video-shorts-child-list]`;
}

function rowActionSelector(postId, action) {
  return `[data-post-id="${postId}"] [data-action="${action}"]`;
}

function assertViewRepliesControl(assert, postId, label, ariaLabel) {
  assert
    .dom(viewRepliesSelector(postId))
    .hasText(label)
    .hasAttribute("aria-label", ariaLabel);
}

function assertRowActions(assert, postId) {
  assert.dom(rowActionSelector(postId, "reply-to-comment")).exists();
  assert
    .dom(rowActionSelector(postId, "comment-tools-toggle"))
    .hasAttribute("aria-label", "Comment tools");
}

async function clickIfPresent(selector) {
  let clicked = false;

  if (document.querySelector(selector)) {
    await click(selector);
    clicked = true;
  }

  return clicked;
}

async function doubleClickIfPresent(selector) {
  const element = document.querySelector(selector);
  let clicked = false;

  if (element) {
    element.click();
    element.click();
    await settled();
    clicked = true;
  }

  return clicked;
}

acceptance("Video Shorts comments sheet", function (needs) {
  needs.settings({ video_shorts_enabled: true });
  needs.user();

  test("comments helper exposes only the bounded direct-replies loader", function (assert) {
    assert.strictEqual(
      typeof videoShortsComments.fetchVideoShortsComments,
      "function",
      "the direct-replies loader remains exported",
    );
    assert.strictEqual(
      videoShortsComments.fetchVideoShortsTopicComments,
      undefined,
      "the full-topic comments helper is not exported",
    );
    assert.strictEqual(
      videoShortsComments.fetchVideoShortsTopicReplies,
      undefined,
      "the dead full-topic replies helper is not exported",
    );
  });

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

  test("baseline keeps comments open, native tools, publish, and delete paths reachable", async function (assert) {
    let publishRequests = 0;

    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [feedItem(126, "Baseline comment actions clip")],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );

      server.get("/posts/126/replies.json", () =>
        helper.response([
          directReply(246, "admin_user", "<p>Baseline tool target</p>", {
            can_delete: true,
            can_edit: true,
            can_flag: true,
            post_number: 2,
            post_url: "/t/baseline-actions/126/2",
            actions_summary: [{ id: 3, can_act: true }],
          }),
        ]),
      );

      server.post("/posts.json", (request) => {
        const params = postParams(request);
        publishRequests += 1;

        assert.strictEqual(params.get("topic_id"), "126");
        assert.strictEqual(params.get("raw"), "Baseline published reply");
        assert.strictEqual(params.get("reply_to_post_number"), "1");

        return helper.response(
          directReply(247, "admin_user", "<p>Baseline published reply</p>", {
            post_number: 3,
            raw: "Baseline published reply",
            post_url: "/t/baseline-actions/126/3",
          }),
        );
      });
    });

    await visit("/videos");
    await click("[data-action='open-comments']");

    assert.dom(".video-shorts-comments-sheet").exists();
    assert
      .dom('.video-shorts-comments-surface__comment[data-post-id="246"]')
      .includesText("Baseline tool target");

    await focus("[data-video-shorts-reply-input]");
    await fillIn("[data-video-shorts-reply-input]", "Baseline published reply");
    await click("[data-action='publish-reply']");

    assert.strictEqual(
      publishRequests,
      1,
      "the top-level publish path remains reachable from the comments sheet",
    );
    assert
      .dom('.video-shorts-comments-surface__comment[data-post-id="247"]')
      .includesText("Baseline published reply");

    await click('[data-post-id="246"] [data-action="comment-tools-toggle"]');

    assert
      .dom('[data-video-shorts-comment-tools-menu="246"]')
      .exists("native comment tools still render");
    assert
      .dom('[data-post-id="246"] [data-action="delete-comment"]')
      .exists("the native delete action path remains reachable");
    assert.dom("#reply-control.open").doesNotExist();
    assert.dom(".post-action-menu").doesNotExist();
  });

  test("RED lazy replies: opening comments leaves child branches collapsed and unfetched", async function (assert) {
    let parentBranchCalls = 0;
    let grandchildBranchCalls = 0;

    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [
            feedItem(130, "Collapsed branch open clip", null, {
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

      server.get("/posts/130/replies.json", () =>
        helper.response([
          directReply(330, "parent-author", "<p>Parent with replies</p>", {
            post_number: 2,
            reply_count: 2,
            post_url: "/t/collapsed-branch-open/130/2",
          }),
          directReply(331, "second-author", "<p>Second top-level</p>", {
            post_number: 5,
            post_url: "/t/collapsed-branch-open/130/5",
          }),
        ]),
      );

      server.get("/posts/330/replies.json", () => {
        parentBranchCalls += 1;

        return helper.response([
          directReply(332, "child-author", "<p>Hidden child reply</p>", {
            post_number: 3,
            reply_count: 1,
            reply_to_post_number: 2,
            post_url: "/t/collapsed-branch-open/130/3",
          }),
        ]);
      });

      server.get("/posts/332/replies.json", () => {
        grandchildBranchCalls += 1;

        return helper.response([
          directReply(333, "grandchild-author", "<p>Hidden grandchild</p>", {
            post_number: 4,
            reply_to_post_number: 3,
            post_url: "/t/collapsed-branch-open/130/4",
          }),
        ]);
      });
    });

    await visit("/videos");
    await click("[data-action='open-comments']");

    assert
      .dom(".video-shorts-comments-surface__comment")
      .exists({ count: 2 }, "top-level comments still open normally");
    assert.strictEqual(
      parentBranchCalls,
      0,
      "opening comments does not request the parent /posts/:id/replies.json branch",
    );
    assert.strictEqual(
      grandchildBranchCalls,
      0,
      "opening comments does not fan out to grandchild /posts/:id/replies.json branches",
    );
    assert
      .dom('.video-shorts-comments-surface__child-comment[data-post-id="332"]')
      .doesNotExist("child/floor replies are hidden by default");
    assert
      .dom(childListSelector(330))
      .doesNotExist("no child list is rendered before the branch is opened");
    assert
      .dom(viewRepliesSelector(330))
      .exists("parents with reply_count expose data-video-shorts-view-replies");
    assert
      .dom(viewRepliesSelector(330))
      .hasText(
        "View more",
        "the collapsed control uses the count-free localized branch label",
      );
    assert.false(
      document
        .querySelector(viewRepliesSelector(330))
        ?.textContent.includes("2"),
      "the collapsed control visible label does not include the reply count",
    );
    assert
      .dom(viewRepliesSelector(330))
      .hasAttribute(
        "aria-label",
        "View more replies to parent-author",
        "the collapsed control has a localized aria label",
      );
    assert.dom(viewRepliesSelector(330)).hasAttribute("aria-expanded", "false");
    assert
      .dom(loadMoreRepliesSelector(330))
      .doesNotExist("unopened branches do not expose the pagination selector");
    assert
      .dom(".d-modal__title")
      .hasText(
        "4 replies",
        "the comments title remains server-count based while child branches are unloaded",
      );
  });

  test("RED lazy replies: clicking one collapsed branch loads direct children only", async function (assert) {
    let parentBranchCalls = 0;
    let siblingBranchCalls = 0;
    let grandchildBranchCalls = 0;

    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [
            feedItem(131, "Single branch load clip", null, {
              counts: {
                like_count: 0,
                reply_count: 5,
                bookmark_count: 0,
              },
            }),
          ],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );

      server.get("/posts/131/replies.json", () =>
        helper.response([
          directReply(340, "first-parent", "<p>First parent</p>", {
            post_number: 2,
            reply_count: 2,
            post_url: "/t/single-branch-load/131/2",
          }),
          directReply(341, "second-parent", "<p>Second parent</p>", {
            post_number: 6,
            reply_count: 1,
            post_url: "/t/single-branch-load/131/6",
          }),
        ]),
      );

      server.get("/posts/340/replies.json", () => {
        parentBranchCalls += 1;

        return helper.response([
          directReply(342, "first-child", "<p>First child</p>", {
            post_number: 3,
            reply_count: 1,
            reply_to_post_number: 2,
            post_url: "/t/single-branch-load/131/3",
          }),
          directReply(343, "second-child", "<p>Second child</p>", {
            post_number: 4,
            reply_to_post_number: 2,
            post_url: "/t/single-branch-load/131/4",
          }),
        ]);
      });

      server.get("/posts/341/replies.json", () => {
        siblingBranchCalls += 1;

        return helper.response([
          directReply(344, "sibling-child", "<p>Sideloaded child</p>", {
            post_number: 7,
            reply_to_post_number: 6,
            post_url: "/t/single-branch-load/131/7",
          }),
        ]);
      });

      server.get("/posts/342/replies.json", () => {
        grandchildBranchCalls += 1;

        return helper.response([
          directReply(345, "grandchild", "<p>Grandchild stays collapsed</p>", {
            post_number: 5,
            reply_to_post_number: 3,
            post_url: "/t/single-branch-load/131/5",
          }),
        ]);
      });
    });

    await visit("/videos");
    await click("[data-action='open-comments']");

    assert.strictEqual(
      parentBranchCalls,
      0,
      "opening comments does not prefetch the first parent branch",
    );
    assert.strictEqual(
      siblingBranchCalls,
      0,
      "opening comments does not prefetch sibling branches",
    );
    assert.strictEqual(
      grandchildBranchCalls,
      0,
      "opening comments does not prefetch grandchild branches",
    );
    assert.strictEqual(
      parentBranchCalls + siblingBranchCalls,
      0,
      "opening comments does not fan out to N branch requests for N parents with children",
    );
    assert
      .dom(viewRepliesSelector(340))
      .exists("the first parent exposes a collapsed branch control");

    const clickedBranch = await clickIfPresent(viewRepliesSelector(340));

    assert.true(clickedBranch, "the first parent branch control is clickable");
    assert.strictEqual(
      parentBranchCalls,
      clickedBranch ? 1 : 0,
      "clicking the first parent requests exactly that parent branch",
    );
    assert.strictEqual(
      siblingBranchCalls,
      0,
      "clicking one branch does not request a sibling parent branch",
    );
    assert.strictEqual(
      grandchildBranchCalls,
      0,
      "loading a direct child page does not request grandchildren",
    );
    assert
      .dom('.video-shorts-comments-surface__child-comment[data-post-id="342"]')
      .includesText("First child");
    assert
      .dom(childListSelector(340))
      .exists("opening the branch renders a data-video-shorts-child-list list");
    assert
      .dom('.video-shorts-comments-surface__child-comment[data-post-id="345"]')
      .doesNotExist("loading a direct child page does not fetch grandchildren");
    assert
      .dom(viewRepliesSelector(342))
      .doesNotExist("second-level rows do not expose a third-level branch");
    assert
      .dom(
        ".video-shorts-comments-surface__child-comment .video-shorts-comments-surface__child-list",
      )
      .doesNotExist("the video UI keeps replies to two visual levels");
  });

  test("RED lazy replies: double-clicking a branch does not duplicate requests or rows", async function (assert) {
    let parentBranchCalls = 0;

    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [
            feedItem(132, "Branch double click clip", null, {
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

      server.get("/posts/132/replies.json", () =>
        helper.response([
          directReply(350, "double-parent", "<p>Double parent</p>", {
            post_number: 2,
            reply_count: 1,
            post_url: "/t/branch-double-click/132/2",
          }),
        ]),
      );

      server.get("/posts/350/replies.json", () => {
        parentBranchCalls += 1;

        return helper.response([
          directReply(351, "double-child", "<p>Double child</p>", {
            post_number: 3,
            reply_to_post_number: 2,
            post_url: "/t/branch-double-click/132/3",
          }),
        ]);
      });
    });

    await visit("/videos");
    await click("[data-action='open-comments']");

    assert.strictEqual(
      parentBranchCalls,
      0,
      "opening comments does not request the double-click branch",
    );
    assert
      .dom(viewRepliesSelector(350))
      .exists("the branch exposes a deterministic control before double-click");

    const doubleClickedBranch = await doubleClickIfPresent(
      viewRepliesSelector(350),
    );

    assert.true(doubleClickedBranch, "the branch control is double-clickable");
    assert.strictEqual(
      parentBranchCalls,
      doubleClickedBranch ? 1 : 0,
      "double-clicking one branch dedupes the branch request",
    );
    assert.strictEqual(
      document.querySelectorAll(
        '.video-shorts-comments-surface__child-comment[data-post-id="351"]',
      ).length,
      doubleClickedBranch ? 1 : 0,
      "double-clicking one branch does not duplicate rendered rows",
    );
  });

  test("lazy replies: paginated branches expose a localized load-more control", async function (assert) {
    let parentBranchCalls = 0;
    const firstPage = Array.from({ length: 20 }, (_, index) =>
      directReply(
        380 + index,
        `page-child-${index + 1}`,
        `<p>Page child ${index + 1}</p>`,
        {
          post_number: 3 + index,
          reply_to_post_number: 2,
          post_url: `/t/branch-pagination/135/${3 + index}`,
        },
      ),
    );

    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [
            feedItem(135, "Branch pagination clip", null, {
              counts: {
                like_count: 0,
                reply_count: 22,
                bookmark_count: 0,
              },
            }),
          ],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );

      server.get("/posts/135/replies.json", () =>
        helper.response([
          directReply(379, "paged-parent", "<p>Paged parent</p>", {
            post_number: 2,
            reply_count: 21,
            post_url: "/t/branch-pagination/135/2",
          }),
        ]),
      );

      server.get("/posts/379/replies.json", () => {
        parentBranchCalls += 1;

        if (parentBranchCalls === 1) {
          return helper.response(firstPage);
        }

        return helper.response([
          directReply(420, "last-page-child", "<p>Last page child</p>", {
            post_number: 23,
            reply_to_post_number: 2,
            post_url: "/t/branch-pagination/135/23",
          }),
        ]);
      });
    });

    await visit("/videos");
    await click("[data-action='open-comments']");

    assert.dom(viewRepliesSelector(379)).hasText("View more");
    assert.dom(loadMoreRepliesSelector(379)).doesNotExist();

    await click(viewRepliesSelector(379));

    assert.strictEqual(parentBranchCalls, 1);
    assert
      .dom(loadMoreRepliesSelector(379))
      .exists(
        "a partially loaded branch exposes data-video-shorts-load-more-replies",
      );
    assert.dom(loadMoreRepliesSelector(379)).hasText("View more");
    assert.false(
      document
        .querySelector(loadMoreRepliesSelector(379))
        ?.textContent.includes("1"),
      "the load-more control visible label does not include the remaining count",
    );
    assert
      .dom(loadMoreRepliesSelector(379))
      .hasAttribute("aria-label", "View more replies to paged-parent");
    assert
      .dom(loadMoreRepliesSelector(379))
      .hasAttribute("aria-expanded", "true");
    assert
      .dom(viewRepliesSelector(379))
      .doesNotExist("expanded branches no longer expose the view selector");

    await click(loadMoreRepliesSelector(379));

    assert.strictEqual(
      parentBranchCalls,
      2,
      "clicking the pagination control requests the next direct child page",
    );
    assert
      .dom('.video-shorts-comments-surface__child-comment[data-post-id="420"]')
      .includesText("Last page child");
    assert
      .dom(loadMoreRepliesSelector(379))
      .doesNotExist("the pagination control hides after the final page");
  });

  test("lazy replies: exact page-size branches hide load-more when the known count is loaded", async function (assert) {
    let parentBranchCalls = 0;
    const exactPage = Array.from({ length: 20 }, (_, index) =>
      directReply(
        430 + index,
        `exact-page-child-${index + 1}`,
        `<p>Exact page child ${index + 1}</p>`,
        {
          post_number: 3 + index,
          reply_to_post_number: 2,
          post_url: `/t/branch-exact-page/137/${3 + index}`,
        },
      ),
    );

    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [
            feedItem(137, "Branch exact page clip", null, {
              counts: {
                like_count: 0,
                reply_count: 21,
                bookmark_count: 0,
              },
            }),
          ],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );

      server.get("/posts/137/replies.json", () =>
        helper.response([
          directReply(429, "exact-page-parent", "<p>Exact page parent</p>", {
            post_number: 2,
            reply_count: 20,
            post_url: "/t/branch-exact-page/137/2",
          }),
        ]),
      );

      server.get("/posts/429/replies.json", () => {
        parentBranchCalls += 1;

        return helper.response(exactPage);
      });
    });

    await visit("/videos");
    await click("[data-action='open-comments']");

    assert.dom(viewRepliesSelector(429)).hasText("View more");

    await click(viewRepliesSelector(429));

    assert.strictEqual(
      parentBranchCalls,
      1,
      "opening the exact page-size branch requests one direct child page",
    );
    assert
      .dom('.video-shorts-comments-surface__child-comment[data-post-id="449"]')
      .includesText("Exact page child 20");
    assert
      .dom(loadMoreRepliesSelector(429))
      .doesNotExist(
        "fully loaded exact page-size branches do not expose data-video-shorts-load-more-replies",
      );
    assert.false(
      document.body.textContent.includes("0 more replies"),
      "the comments surface never renders a zero-count load-more label",
    );
  });

  test("lazy replies: branch loading state is scoped and accessible", async function (assert) {
    let parentBranchCalls = 0;
    let response;
    const branchResponse = deferredResponse();

    setupPretender((server, helper) => {
      response = helper.response;

      server.get("/videos.json", () =>
        helper.response({
          items: [
            feedItem(136, "Branch loading clip", null, {
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

      server.get("/posts/136/replies.json", () =>
        helper.response([
          directReply(390, "loading-parent", "<p>Loading parent</p>", {
            post_number: 2,
            reply_count: 1,
            post_url: "/t/branch-loading/136/2",
          }),
          directReply(391, "idle-parent", "<p>Idle parent</p>", {
            post_number: 4,
            reply_count: 1,
            post_url: "/t/branch-loading/136/4",
          }),
        ]),
      );

      server.get("/posts/390/replies.json", () => {
        parentBranchCalls += 1;

        return branchResponse.promise;
      });
    });

    await visit("/videos");
    await click("[data-action='open-comments']");

    document.querySelector(viewRepliesSelector(390)).click();

    await waitUntil(() =>
      document.querySelector(
        '[data-post-id="390"] [data-video-shorts-replies-loading]',
      ),
    );

    assert.strictEqual(parentBranchCalls, 1);
    assert
      .dom('[data-post-id="390"] [data-video-shorts-replies-loading]')
      .hasText("Loading replies...");
    assert.dom(viewRepliesSelector(390)).isDisabled();
    assert
      .dom('[data-post-id="391"] [data-video-shorts-replies-loading]')
      .doesNotExist("loading state stays scoped to the clicked parent");

    branchResponse.resolve(
      response([
        directReply(392, "loaded-child", "<p>Loaded after spinner</p>", {
          post_number: 3,
          reply_to_post_number: 2,
          post_url: "/t/branch-loading/136/3",
        }),
      ]),
    );
    await settled();

    assert
      .dom('.video-shorts-comments-surface__child-comment[data-post-id="392"]')
      .includesText("Loaded after spinner");
  });

  test("lazy replies: branch controls and row actions stay consistent across loaded depths", async function (assert) {
    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [feedItem(138, "Consistent branch control clip")],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );

      server.get("/posts/138/replies.json", () =>
        helper.response([
          directReply(380, "depth-parent", "<p>Depth parent</p>", {
            post_number: 2,
            reply_count: 1,
            post_url: "/t/consistent-branch/138/2",
          }),
        ]),
      );

      server.get("/posts/380/replies.json", () =>
        helper.response([
          directReply(381, "depth-child", "<p>Depth child</p>", {
            post_number: 3,
            reply_count: 1,
            reply_to_post_number: 2,
            reply_to_username: "depth-parent",
            post_url: "/t/consistent-branch/138/3",
          }),
        ]),
      );

      server.get("/posts/381/replies.json", () =>
        helper.response([
          directReply(382, "depth-grandchild", "<p>Depth grandchild</p>", {
            post_number: 4,
            reply_to_post_number: 3,
            reply_to_username: "depth-child",
            post_url: "/t/consistent-branch/138/4",
          }),
        ]),
      );
    });

    await visit("/videos");
    await click("[data-action='open-comments']");

    assertViewRepliesControl(
      assert,
      380,
      "View more",
      "View more replies to depth-parent",
    );
    assertRowActions(assert, 380);

    await click(viewRepliesSelector(380));

    assert
      .dom('.video-shorts-comments-surface__child-comment[data-post-id="381"]')
      .includesText("Depth child");
    assert
      .dom(viewRepliesSelector(381))
      .doesNotExist("loaded second-level rows do not expose another branch");
    assertRowActions(assert, 381);
    assert
      .dom('.video-shorts-comments-surface__child-comment[data-post-id="382"]')
      .doesNotExist("deeper replies are not rendered as a third visual level");
    assert
      .dom(
        ".video-shorts-comments-surface__child-comment .video-shorts-comments-surface__child-list",
      )
      .doesNotExist("the child reply list is never nested under a child row");
  });

  test("lazy replies: top-level pagination does not stale an in-flight branch", async function (assert) {
    let sourceCalls = 0;
    let branchCalls = 0;
    let response;
    const branchResponse = deferredResponse();
    const firstPage = [
      directReply(500, "paged-parent", "<p>Paged parent</p>", {
        post_number: 2,
        reply_count: 1,
        post_url: "/t/top-level-pagination/140/2",
      }),
      ...Array.from({ length: 19 }, (_, index) =>
        directReply(
          501 + index,
          `top-level-${index + 1}`,
          `<p>Top level ${index + 1}</p>`,
          {
            post_number: 3 + index,
            post_url: `/t/top-level-pagination/140/${3 + index}`,
          },
        ),
      ),
    ];

    setupPretender((server, helper) => {
      response = helper.response;

      server.get("/videos.json", () =>
        helper.response({
          items: [
            feedItem(140, "Top-level pagination during branch clip", null, {
              counts: {
                like_count: 0,
                reply_count: 22,
                bookmark_count: 0,
              },
            }),
          ],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );

      server.get("/posts/140/replies.json", () => {
        sourceCalls += 1;

        if (sourceCalls === 1) {
          return helper.response(firstPage);
        }

        return helper.response([
          directReply(540, "next-top-level", "<p>Next top level</p>", {
            post_number: 22,
            post_url: "/t/top-level-pagination/140/22",
          }),
        ]);
      });

      server.get("/posts/500/replies.json", () => {
        branchCalls += 1;

        return branchResponse.promise;
      });
    });

    await visit("/videos");
    await click("[data-action='open-comments']");

    assert.dom(".video-shorts-comments-surface__load-more").exists();

    document.querySelector(viewRepliesSelector(500)).click();

    await waitUntil(() =>
      document.querySelector(
        '[data-post-id="500"] [data-video-shorts-replies-loading]',
      ),
    );

    document.querySelector(".video-shorts-comments-surface__load-more").click();

    await waitUntil(() => sourceCalls === 2);
    await waitUntil(() =>
      document.querySelector(
        '.video-shorts-comments-surface__comment[data-post-id="540"]',
      ),
    );

    assert.strictEqual(branchCalls, 1);
    assert
      .dom('[data-post-id="500"] [data-video-shorts-replies-loading]')
      .exists("the branch spinner remains active while pagination finishes");

    branchResponse.resolve(
      response([
        directReply(
          541,
          "branch-child",
          "<p>Branch child after pagination</p>",
          {
            post_number: 23,
            reply_to_post_number: 2,
            post_url: "/t/top-level-pagination/140/23",
          },
        ),
      ]),
    );
    await settled();

    assert
      .dom('[data-post-id="500"] [data-video-shorts-replies-loading]')
      .doesNotExist(
        "the branch spinner clears after the pending branch resolves",
      );
    assert
      .dom('.video-shorts-comments-surface__child-comment[data-post-id="541"]')
      .includesText("Branch child after pagination");
  });

  test("RED lazy replies: branch load errors show an inline retry state", async function (assert) {
    let parentBranchCalls = 0;

    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [
            feedItem(133, "Branch retry clip", null, {
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

      server.get("/posts/133/replies.json", () =>
        helper.response([
          directReply(360, "retry-parent", "<p>Retry parent</p>", {
            post_number: 2,
            reply_count: 1,
            post_url: "/t/branch-retry/133/2",
          }),
        ]),
      );

      server.get("/posts/360/replies.json", () => {
        parentBranchCalls += 1;

        return helper.response(500, { errors: ["Branch load failed"] });
      });
    });

    await visit("/videos");
    await click("[data-action='open-comments']");

    assert.strictEqual(
      parentBranchCalls,
      0,
      "opening comments does not request the retry branch",
    );
    assert
      .dom(viewRepliesSelector(360))
      .exists("the retry branch exposes a collapsed control before loading");

    const clickedRetryBranch = await clickIfPresent(viewRepliesSelector(360));

    assert.true(clickedRetryBranch, "the retry branch control is clickable");
    assert.strictEqual(
      parentBranchCalls,
      clickedRetryBranch ? 1 : 0,
      "clicking the retry branch attempts one branch request",
    );
    assert
      .dom('[data-post-id="360"] [data-video-shorts-replies-error]')
      .exists("branch load errors render inline beside the failed branch");
    assert
      .dom('[data-post-id="360"] [data-video-shorts-replies-error]')
      .hasText("Could not load replies");
    assert
      .dom('[data-post-id="360"] [data-video-shorts-retry-replies]')
      .exists("branch load errors expose a deterministic retry control");
    assert
      .dom('[data-post-id="360"] [data-video-shorts-retry-replies]')
      .hasText("Retry loading replies");
    assert
      .dom('[data-post-id="360"] [data-video-shorts-retry-replies]')
      .hasAttribute("aria-label", "Retry loading replies");
    assert
      .dom('.video-shorts-comments-surface__child-comment[data-post-id="361"]')
      .doesNotExist("a failed branch load does not insert child rows");
  });

  test("RED lazy replies: counts stay source-based while collapsed branches are unloaded", async function (assert) {
    let parentBranchCalls = 0;

    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [
            feedItem(134, "Source count branch clip", null, {
              counts: {
                like_count: 0,
                reply_count: 7,
                bookmark_count: 0,
              },
            }),
          ],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );

      server.get("/posts/134/replies.json", () =>
        helper.response([
          directReply(370, "count-parent", "<p>Count parent</p>", {
            post_number: 2,
            reply_count: 3,
            post_url: "/t/source-count-branch/134/2",
          }),
        ]),
      );

      server.get("/posts/370/replies.json", () => {
        parentBranchCalls += 1;

        return helper.response([
          directReply(371, "loaded-child", "<p>Loaded child</p>", {
            post_number: 3,
            reply_to_post_number: 2,
            post_url: "/t/source-count-branch/134/3",
          }),
        ]);
      });
    });

    await visit("/videos");

    assert
      .dom(
        '[data-post-id="134"] [data-action="open-comments"] .video-shorts-action-rail__count',
      )
      .hasText("7", "the rail starts from the server/source count");

    await click("[data-action='open-comments']");

    assert.strictEqual(
      parentBranchCalls,
      0,
      "opening comments does not load hidden children just to compute counts",
    );
    assert
      .dom(".d-modal__title")
      .hasText("7 replies", "the sheet title keeps the server/source count");
    assert
      .dom(
        '[data-post-id="134"] [data-action="open-comments"] .video-shorts-action-rail__count',
      )
      .hasText(
        "7",
        "sync-count does not overwrite the rail with the loaded DOM row count",
      );
    assert
      .dom('.video-shorts-comments-surface__child-comment[data-post-id="371"]')
      .doesNotExist("unloaded child rows do not drive displayed counts");
    assert
      .dom(viewRepliesSelector(370))
      .hasText(
        "View more",
        "the branch control omits the parent reply_count from visible text",
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
      .doesNotExist("nested replies stay collapsed before branch load");
    assert.dom(viewRepliesSelector(201)).exists();

    await click(viewRepliesSelector(201));

    assert
      .dom(".video-shorts-comments-surface__child-comment")
      .includesText("Nested direct reply");
    assert.dom("[data-video-shorts-reply-target]").doesNotExist();
    assert.dom(".topic-post article.boxed").doesNotExist();
    assert.dom(".post-action-menu").doesNotExist();
    assert.dom("#reply-control.open").doesNotExist();
    assert.dom(".d-editor").doesNotExist();
  });

  test("keeps source counts while reply branches load lazily", async function (assert) {
    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [
            feedItem(116, "Nested count reconciliation clip", null, {
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
      .hasText("4", "feed starts with the source reply count");

    await click("[data-action='open-comments']");

    assert.dom(".d-modal__title").hasText("4 replies");
    assert.dom(".video-shorts-comments-surface__comment").exists({ count: 2 });
    assert
      .dom(".video-shorts-comments-surface__child-comment")
      .doesNotExist("nested replies are collapsed before a branch click");

    await click(viewRepliesSelector(216));

    assert
      .dom('.video-shorts-comments-surface__child-comment[data-post-id="218"]')
      .includesText("Nested reply");
    assert
      .dom('.video-shorts-comments-surface__child-comment[data-post-id="219"]')
      .doesNotExist("grandchildren are not loaded with the parent branch");
    assert
      .dom(viewRepliesSelector(218))
      .doesNotExist("second-level rows do not expose third-level controls");
    assert
      .dom(
        '[data-post-id="116"] [data-action="open-comments"] .video-shorts-action-rail__count',
      )
      .hasText("4", "rail count remains source-count based");
  });

  test("loads OP video comments from direct replies without fetching topic JSON", async function (assert) {
    let directReplyCalls = 0;
    let topicJsonCalls = 0;
    let missingPostBatchCalls = 0;
    let topicBranchCalls = 0;
    let grandchildBranchCalls = 0;

    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [
            feedItem(121, "Topic comment stream clip", null, {
              counts: {
                like_count: 0,
                reply_count: 4,
                bookmark_count: 0,
              },
              topic_url: "/t/direct-op-comments/121",
            }),
          ],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );

      server.get("/t/direct-op-comments/121.json", () => {
        topicJsonCalls += 1;

        return helper.response({
          post_stream: {
            posts: [],
          },
        });
      });

      server.get("/posts/121/replies.json", () => {
        directReplyCalls += 1;

        return helper.response([
          directReply(231, "first-author", "<p>First direct comment</p>", {
            post_number: 2,
            reply_to_post_number: 1,
            reply_count: 1,
            post_url: "/t/direct-op-comments/121/2",
          }),
        ]);
      });

      server.get("/posts/231/replies.json", () => {
        topicBranchCalls += 1;

        return helper.response([
          directReply(233, "nested-author", "<p>Nested direct reply</p>", {
            post_number: 4,
            reply_to_post_number: 2,
            reply_count: 1,
            post_url: "/t/direct-op-comments/121/4",
          }),
        ]);
      });

      server.get("/posts/233/replies.json", () => {
        grandchildBranchCalls += 1;

        return helper.response([
          directReply(234, "deep-author", "<p>Deep OP reply</p>", {
            post_number: 5,
            reply_to_post_number: 4,
            post_url: "/t/direct-op-comments/121/5",
          }),
        ]);
      });

      server.get("/t/121/posts.json", () => {
        missingPostBatchCalls += 1;

        return helper.response({
          post_stream: {
            posts: [
              directReply(232, "second-author", "<p>Second topic comment</p>", {
                post_number: 3,
                reply_to_post_number: null,
                post_url: "/t/direct-op-comments/121/3",
              }),
            ],
          },
        });
      });
    });

    await visit("/videos");
    await click("[data-action='open-comments']");

    assert.strictEqual(
      directReplyCalls,
      1,
      "OP video comments use the bounded direct-replies endpoint",
    );
    assert.strictEqual(
      topicJsonCalls,
      0,
      "opening OP video comments does not fetch topic JSON",
    );
    assert.strictEqual(
      missingPostBatchCalls,
      0,
      "opening OP video comments does not fetch missing post batches",
    );
    assert.dom(".d-modal__title").hasText("4 replies");
    assert
      .dom(".video-shorts-comments-surface__comment")
      .exists(
        { count: 1 },
        "initial OP comments are bounded to direct replies",
      );
    assert
      .dom(".video-shorts-comments-surface__child-comment")
      .doesNotExist("nested topic replies stay collapsed on initial open");
    assert.strictEqual(
      topicBranchCalls,
      0,
      "OP direct-reply descendants seed counts without fetching the parent branch on open",
    );
    assert.strictEqual(
      grandchildBranchCalls,
      0,
      "opening OP video comments does not fetch deeper descendant branches",
    );
    assert
      .dom(childListSelector(231))
      .doesNotExist(
        "OP branches do not render a child list before branch click",
      );
    assert.dom(viewRepliesSelector(231)).hasText("View more");
    assert
      .dom(".video-shorts-comments-surface__cooked")
      .doesNotIncludeText(
        "Second topic comment",
        "topic JSON fallback comments are not prefetched",
      );
    assert
      .dom(
        '[data-post-id="121"] [data-action="open-comments"] .video-shorts-action-rail__count',
      )
      .hasText("4", "rail count stays aligned with the topic comment tree");

    await click(viewRepliesSelector(231));

    assert.strictEqual(
      topicBranchCalls,
      1,
      "clicking an OP direct-reply branch loads only that parent branch",
    );
    assert.strictEqual(
      topicJsonCalls,
      0,
      "branch expansion does not fall back to topic JSON",
    );
    assert.strictEqual(
      missingPostBatchCalls,
      0,
      "branch expansion does not fetch missing post batches",
    );
    assert.strictEqual(
      grandchildBranchCalls,
      0,
      "expanding an OP branch keeps deeper descendants collapsed",
    );
    assert
      .dom('.video-shorts-comments-surface__child-comment[data-post-id="233"]')
      .includesText("Nested direct reply");
    assert
      .dom('.video-shorts-comments-surface__child-comment[data-post-id="234"]')
      .doesNotExist("deeper OP descendants wait for their own branch click");
    assert
      .dom(viewRepliesSelector(233))
      .doesNotExist("second-level OP rows do not expose third-level controls");
  });

  test("keeps stale feed counts source-based when loaded rows are fewer", async function (assert) {
    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [
            feedItem(122, "Stale feed count clip", null, {
              post_number: 2,
              counts: {
                like_count: 0,
                reply_count: 5,
                bookmark_count: 0,
              },
            }),
          ],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );

      server.get("/posts/122/replies.json", () =>
        helper.response([
          directReply(241, "loaded-author", "<p>Loaded tree reply</p>", {
            post_number: 2,
            post_url: "/t/stale-feed-count/122/2",
          }),
        ]),
      );
    });

    await visit("/videos");

    assert
      .dom(
        '[data-post-id="122"] [data-action="open-comments"] .video-shorts-action-rail__count',
      )
      .hasText("5", "feed starts with the stale server count");

    await click("[data-action='open-comments']");

    assert.dom(".d-modal__title").hasText("5 replies");
    assert
      .dom(
        '[data-post-id="122"] [data-action="open-comments"] .video-shorts-action-rail__count',
      )
      .hasText("5", "rail count remains source-count based");
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
    await click(viewRepliesSelector(208));

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
          items: [
            feedItem(103, "Replyable clip", null, {
              counts: {
                like_count: 0,
                reply_count: 0,
                bookmark_count: 0,
              },
            }),
          ],
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
    assert.dom(".d-modal__title").hasText("1 reply");
    assert
      .dom(
        '[data-post-id="103"] [data-action="open-comments"] .video-shorts-action-rail__count',
      )
      .hasText("1", "counts update after create from the source count");
    assert.dom("[data-video-shorts-reply-input]").hasValue("");
    assert.dom("#reply-control.open").doesNotExist();
    assert.dom("#reply-control .d-editor").doesNotExist();
  });

  test("places the top composer before comments inside the scrollable comments list", async function (assert) {
    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [feedItem(123, "Top composer placement clip")],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );

      server.get("/posts/123/replies.json", () =>
        helper.response([
          directReply(243, "first-author", "<p>First visible comment</p>", {
            post_number: 2,
          }),
        ]),
      );
    });

    await visit("/videos");
    await click("[data-action='open-comments']");

    const list = document.querySelector(
      "[data-video-shorts-youtube-thread-list]",
    );
    const composer = document.querySelector("[data-video-shorts-reply-input]");
    const composerShell = composer?.closest(
      "[data-video-shorts-youtube-composer]",
    );
    const firstComment = list?.querySelector(
      ".video-shorts-comments-surface__comment",
    );

    assert.notStrictEqual(
      list,
      null,
      "comments render inside a scrollable list",
    );
    assert.notStrictEqual(
      composer,
      null,
      "the top comment composer is rendered",
    );
    assert.notStrictEqual(
      composerShell,
      null,
      "the top comment composer keeps the composer wrapper",
    );
    assert.true(
      Boolean(list && composer && list.contains(composer)),
      "the top composer is inside the scrollable comments content",
    );
    assert.true(
      Boolean(
        list &&
        composerShell &&
        firstComment &&
        [...list.children].indexOf(composerShell) <
          [...list.children].indexOf(firstComment),
      ),
      "the top composer appears before the first comment",
    );
    const composerPosition = composerShell
      ? getComputedStyle(composerShell).position
      : null;
    assert.notStrictEqual(
      composerPosition,
      "sticky",
      "the top composer is not sticky at the bottom",
    );
    assert.notStrictEqual(
      composerPosition,
      "fixed",
      "the top composer is not fixed at the bottom",
    );
    assert
      .dom("[data-video-shorts-reply-actions]")
      .doesNotExist("the default top composer has no persistent actions");
    assert.dom("[data-action='publish-reply']").doesNotExist();
    assert.dom("[data-action='cancel-reply']").doesNotExist();
  });

  test("locks the mobile comments sheet geometry at open time", async function (assert) {
    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [feedItem(124, "Keyboard stable sheet clip")],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );

      server.get("/posts/124/replies.json", () =>
        helper.response([
          directReply(244, "first-author", "<p>First visible comment</p>", {
            post_number: 2,
          }),
        ]),
      );
    });

    await visit("/videos");
    assert.strictEqual(
      document.body.style.getPropertyValue(
        "--video-shorts-mobile-route-height",
      ),
      `${window.innerHeight}px`,
      "video route records the opening viewport height in px",
    );

    await click("[data-action='open-comments']");

    await waitUntil(() => {
      const sheet = document.querySelector(".video-shorts-comments-sheet");
      const container = document.querySelector(
        ".video-shorts-comments-sheet .d-modal__container",
      );
      const rect = container?.getBoundingClientRect();

      return (
        rect?.height > 0 &&
        rect.top >= 0 &&
        rect.bottom <= window.innerHeight + 2 &&
        sheet?.style.getPropertyValue(
          "--video-shorts-comments-sheet-stable-top",
        ) &&
        sheet?.style.getPropertyValue(
          "--video-shorts-comments-sheet-stable-height",
        )
      );
    });

    const sheet = document.querySelector(".video-shorts-comments-sheet");

    assert
      .dom(".video-shorts-comments-sheet .d-modal__container")
      .exists("comments sheet modal container renders");
    {
      const rect = document
        .querySelector(".video-shorts-comments-sheet .d-modal__container")
        .getBoundingClientRect();

      assert.true(
        rect.bottom <= window.innerHeight + 2,
        "sheet records its stable rectangle only after entering the viewport",
      );
    }
    assert
      .dom("[data-video-shorts-reply-input]")
      .exists("top composer remains available");
    assert.true(
      sheet.style
        .getPropertyValue("--video-shorts-comments-sheet-stable-top")
        .endsWith("px"),
      "sheet records its opening top edge in px",
    );
    assert.true(
      sheet.style
        .getPropertyValue("--video-shorts-comments-sheet-stable-height")
        .endsWith("px"),
      "sheet records its opening height in px",
    );
    assert.strictEqual(
      sheet.style.getPropertyValue(
        "--video-shorts-comments-sheet-stable-bottom",
      ),
      "auto",
      "sheet releases the bottom edge after locking its opening rectangle",
    );

    document.body.style.setProperty(
      "--video-shorts-mobile-route-height",
      "777px",
    );
    await focus("[data-video-shorts-reply-input]");
    window.dispatchEvent(new Event("resize"));

    assert.strictEqual(
      document.body.style.getPropertyValue(
        "--video-shorts-mobile-route-height",
      ),
      "777px",
      "focused comment inputs do not allow keyboard resize to overwrite route height",
    );

    await blur("[data-video-shorts-reply-input]");
    document.body.style.setProperty(
      "--video-shorts-mobile-route-height",
      `${window.innerHeight}px`,
    );
  });

  test("shows top composer cancel and publish controls only while the input is focused", async function (assert) {
    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [feedItem(119, "Focused composer controls clip")],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );

      server.get("/posts/119/replies.json", () =>
        helper.response([
          directReply(229, "reply-author", "<p>Parent comment</p>", {
            post_number: 2,
          }),
        ]),
      );
    });

    await visit("/videos");
    await click("[data-action='open-comments']");

    assert.dom("[data-video-shorts-reply-actions]").doesNotExist();
    assert.dom("[data-action='publish-reply']").doesNotExist();
    assert.dom("[data-action='cancel-reply']").doesNotExist();

    await focus("[data-video-shorts-reply-input]");

    assert.dom("[data-video-shorts-reply-actions]").isVisible();
    assert.dom("[data-action='cancel-reply']").isVisible();
    assert.dom("[data-action='publish-reply']").isVisible();

    await blur("[data-video-shorts-reply-input]");

    assert.dom("[data-video-shorts-reply-actions]").doesNotExist();
    assert.dom("[data-action='publish-reply']").doesNotExist();
    assert.dom("[data-action='cancel-reply']").doesNotExist();

    await click('[data-post-id="229"] .video-shorts-comments-surface__cooked');

    const replyActionSelector =
      "[data-video-shorts-comment-action-sheet] [data-action='reply-to-comment']";

    assert
      .dom(replyActionSelector)
      .exists("the comment action sheet exposes Reply");

    await click(replyActionSelector);

    const dialogSelector = "[data-video-shorts-comment-reply-dialog]";

    assert.dom(dialogSelector).exists();
    assert
      .dom(`${dialogSelector} [data-video-shorts-comment-reply-input]`)
      .isVisible();
    assert
      .dom(`${dialogSelector} [data-video-shorts-comment-reply-actions]`)
      .isVisible("reply dialog actions are visible while the dialog is open");
    assert
      .dom(`${dialogSelector} [data-action='publish-comment-reply']`)
      .isVisible();

    await blur(`${dialogSelector} [data-video-shorts-comment-reply-input]`);

    assert
      .dom(`${dialogSelector} [data-video-shorts-comment-reply-actions]`)
      .isVisible("reply dialog actions stay visible after textarea blur");
    assert
      .dom(`${dialogSelector} [data-action='publish-comment-reply']`)
      .isVisible();
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
      .includesText("Replying to @reply-author");
    assert
      .dom('[data-post-id="204"] [data-video-shorts-reply-target]')
      .includesText("@reply-author");
    assert
      .dom("[data-video-shorts-comment-reply-dialog]")
      .exists("comment replies open the centered reply dialog");
    assert
      .dom(
        ".video-shorts-comments-surface__reply [data-video-shorts-comment-reply-input]",
      )
      .doesNotExist("comment replies do not use the sticky bottom composer");

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
    assert
      .dom('[data-post-id="226"] [data-video-shorts-reply-target]')
      .hasText(
        "@reply-author",
        "first-level comment replies render a video-only plain-text @username prefix",
      );
    assert
      .dom('[data-post-id="226"] [data-video-shorts-reply-target] a')
      .doesNotExist("the video-only @username prefix is not a link");
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
    await click(viewRepliesSelector(224));

    assert
      .dom('[data-post-id="225"] [data-video-shorts-reply-target]')
      .hasText(
        "@reply-author",
        "first-level loaded replies render a video-only plain-text @username prefix",
      );

    await click('[data-post-id="225"] [data-action="reply-to-comment"]');
    assert
      .dom("[data-video-shorts-comment-reply-status]")
      .includesText("Replying to @child-author");
    assert
      .dom('[data-post-id="225"] [data-video-shorts-reply-target]')
      .includesText("@child-author");
    assert
      .dom("[data-video-shorts-comment-reply-dialog]")
      .exists("floor replies open the centered reply dialog");
    assert
      .dom(
        ".video-shorts-comments-surface__reply [data-video-shorts-comment-reply-input]",
      )
      .doesNotExist("floor replies do not use the sticky bottom composer");
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
      .hasText(
        "@child-author",
        "floor replies render a video-only plain-text @username prefix",
      );
    assert
      .dom('[data-post-id="227"] [data-video-shorts-reply-target] a')
      .doesNotExist("the video-only @username prefix is not a link");
    assert
      .dom(
        '[data-post-id="227"] [data-video-shorts-reply-target] [data-user-card]',
      )
      .doesNotExist("the video-only @username prefix does not open user cards");
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

  test("clicking a comment body opens a direct bottom action sheet", async function (assert) {
    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [feedItem(124, "Action sheet clip")],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );

      server.get("/posts/124/replies.json", () =>
        helper.response([
          directReply(244, "sheet-author", "<p>Open the sheet</p>", {
            can_edit: true,
            can_delete: true,
            can_flag: true,
            post_number: 2,
            post_url: "/t/action-sheet/124/2",
            actions_summary: [{ id: 3, can_act: true }],
          }),
        ]),
      );
    });

    await visit("/videos");
    await click("[data-action='open-comments']");
    await click('[data-post-id="244"] .video-shorts-comments-surface__cooked');

    const sheetSelector = "[data-video-shorts-comment-action-sheet]";

    assert
      .dom(sheetSelector)
      .exists("clicking the comment body opens the comment action sheet");
    assert
      .dom(sheetSelector)
      .hasAttribute(
        "data-post-id",
        "244",
        "the bottom action sheet targets the clicked comment",
      );
    assert
      .dom(`${sheetSelector} [data-action="reply-to-comment"]`)
      .exists("the action sheet lists Reply directly");
    assert.dom(`${sheetSelector} [data-action="edit-comment"]`).exists();
    assert.dom(`${sheetSelector} [data-action="copy-comment-link"]`).exists();
    assert.dom(`${sheetSelector} [data-action="open-comment-topic"]`).exists();
    assert.dom(`${sheetSelector} [data-action="flag-comment"]`).exists();
    assert.dom(`${sheetSelector} [data-action="delete-comment"]`).exists();
    assert
      .dom(`${sheetSelector} [data-action="comment-tools-toggle"]`)
      .doesNotExist("the action sheet does not nest another three-dot menu");
    assert
      .dom('[data-video-shorts-comment-tools-menu="244"]')
      .doesNotExist("comment body click does not just open the inline tools");
  });

  test("keyboard events on cooked comment links do not open the action sheet", async function (assert) {
    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [feedItem(127, "Action sheet link keyboard clip")],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );

      server.get("/posts/127/replies.json", () =>
        helper.response([
          directReply(
            248,
            "link-author",
            '<p><a href="/t/linked-comment/127/2">Linked topic</a></p>',
            {
              post_number: 2,
              post_url: "/t/linked-comment/127/2",
            },
          ),
        ]),
      );
    });

    await visit("/videos");
    await click("[data-action='open-comments']");

    const link = document.querySelector(
      '[data-post-id="248"] .video-shorts-comments-surface__cooked a',
    );

    assert.notStrictEqual(
      link,
      null,
      "the cooked comment renders an interactive link",
    );

    const interactiveLink = link || document.createElement("a");

    for (const key of ["Enter", " "]) {
      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key,
      });

      assert.true(
        interactiveLink.dispatchEvent(event),
        `${key} on the cooked link keeps the native default available`,
      );
      assert.false(
        event.defaultPrevented,
        `${key} on the cooked link is not canceled by the action sheet handler`,
      );

      await settled();

      assert
        .dom("[data-video-shorts-comment-action-sheet]")
        .doesNotExist(
          `${key} on the cooked link does not open the action sheet`,
        );
    }
  });

  test("reply from the action sheet opens a centered reply dialog", async function (assert) {
    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [feedItem(125, "Action sheet reply dialog clip")],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );

      server.get("/posts/125/replies.json", () =>
        helper.response([
          directReply(245, "dialog-author", "<p>Open reply dialog</p>", {
            post_number: 2,
            post_url: "/t/action-sheet-reply/125/2",
          }),
        ]),
      );
    });

    await visit("/videos");
    await click("[data-action='open-comments']");
    await click('[data-post-id="245"] .video-shorts-comments-surface__cooked');

    const sheetSelector = "[data-video-shorts-comment-action-sheet]";
    const replyActionSelector = `${sheetSelector} [data-action="reply-to-comment"]`;

    assert
      .dom(sheetSelector)
      .exists("the row action sheet is open before choosing Reply");
    assert
      .dom(replyActionSelector)
      .exists("Reply is a direct action in the action sheet");

    await click(replyActionSelector);

    const surface = document.querySelector(".video-shorts-comments-surface");
    const dialog = document.querySelector(
      "[data-video-shorts-comment-reply-dialog]",
    );
    const dialogSelector = "[data-video-shorts-comment-reply-dialog]";

    assert
      .dom(sheetSelector)
      .doesNotExist("choosing Reply closes the action sheet");
    assert
      .dom(dialogSelector)
      .exists("choosing Reply opens the centered comment reply dialog");
    assert
      .dom(dialogSelector)
      .hasAttribute(
        "aria-label",
        "Reply to dialog-author",
        "the reply dialog has an accessible name",
      );
    assert.true(
      Boolean(surface && dialog && surface.contains(dialog)),
      "the reply dialog is rendered inside the comments surface",
    );
    assert
      .dom(`${dialogSelector} [data-video-shorts-comment-reply-input]`)
      .isVisible();
    assert
      .dom(`${dialogSelector} [data-action="cancel-comment-reply"]`)
      .isVisible();
    assert
      .dom(`${dialogSelector} [data-action="publish-comment-reply"]`)
      .isVisible();
    assert
      .dom(
        ".video-shorts-comments-surface__reply [data-video-shorts-comment-reply-input]",
      )
      .doesNotExist("comment replies no longer use the sticky bottom composer");
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
    await click(viewRepliesSelector(229));
    await click('[data-post-id="230"] [data-action="comment-tools-toggle"]');
    await click('[data-post-id="230"] [data-action="edit-comment"]');

    assert.dom("[data-video-shorts-edit-input]").hasValue("Fresh nested raw");

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

  test("lazy-loaded child replies expose native comment tools", async function (assert) {
    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [feedItem(124, "Lazy child native tools clip")],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );

      server.get("/posts/124/replies.json", () =>
        helper.response([
          directReply(244, "parent-author", "<p>Parent comment</p>", {
            post_number: 2,
            reply_count: 1,
            post_url: "/t/lazy-child-tools/124/2",
          }),
        ]),
      );

      server.get("/posts/244/replies.json", () =>
        helper.response([
          directReply(245, "admin_user", "<p>Lazy loaded child</p>", {
            can_edit: true,
            can_delete: true,
            can_flag: true,
            post_number: 3,
            reply_to_post_number: 2,
            post_url: "/t/lazy-child-tools/124/3",
            actions_summary: [{ id: 3, can_act: true }],
          }),
        ]),
      );
    });

    await visit("/videos");
    await click("[data-action='open-comments']");
    await click(viewRepliesSelector(244));
    await click('[data-post-id="245"] [data-action="comment-tools-toggle"]');

    assert
      .dom('[data-post-id="245"] [data-action="edit-comment"]')
      .exists("lazy child keeps the native edit action");
    assert
      .dom('[data-post-id="245"] [data-action="copy-comment-link"]')
      .exists("lazy child keeps the native copy-link action");
    assert
      .dom('[data-post-id="245"] [data-action="open-comment-topic"]')
      .exists("lazy child keeps the native open-topic action");
    assert
      .dom('[data-post-id="245"] [data-action="flag-comment"]')
      .exists("lazy child keeps the native report action");
    assert
      .dom('[data-post-id="245"] [data-action="delete-comment"]')
      .exists("lazy child keeps the native delete action");
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
    await click(viewRepliesSelector(212));

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
    await click(viewRepliesSelector(231));

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
    await click(viewRepliesSelector(235));

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
    await click(viewRepliesSelector(215));

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

  test("deleting an unloaded parent fetches only that branch and keeps placeholder children", async function (assert) {
    let deletedBranchCalls = 0;
    let unrelatedBranchCalls = 0;

    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [
            feedItem(125, "Delete unloaded parent clip", null, {
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

      server.get("/posts/125/replies.json", () =>
        helper.response([
          directReply(250, "admin_user", "<p>Unloaded parent to delete</p>", {
            can_delete: true,
            post_number: 2,
            reply_count: 2,
            post_url: "/t/delete-unloaded-parent/125/2",
          }),
          directReply(
            253,
            "unrelated-author",
            "<p>Unrelated collapsed parent</p>",
            {
              post_number: 5,
              reply_count: 1,
              post_url: "/t/delete-unloaded-parent/125/5",
            },
          ),
        ]),
      );

      server.get("/posts/250/replies.json", () => {
        deletedBranchCalls += 1;

        return helper.response([
          directReply(251, "child-one", "<p>First preserved child</p>", {
            post_number: 3,
            reply_to_post_number: 2,
            post_url: "/t/delete-unloaded-parent/125/3",
          }),
          directReply(252, "child-two", "<p>Second preserved child</p>", {
            post_number: 4,
            reply_to_post_number: 2,
            post_url: "/t/delete-unloaded-parent/125/4",
          }),
        ]);
      });

      server.get("/posts/253/replies.json", () => {
        unrelatedBranchCalls += 1;

        return helper.response([
          directReply(254, "unrelated-child", "<p>Unrelated child</p>", {
            post_number: 6,
            reply_to_post_number: 5,
            post_url: "/t/delete-unloaded-parent/125/6",
          }),
        ]);
      });

      server.delete("/posts/250.json", () => helper.response({}));
    });

    await visit("/videos");
    await click("[data-action='open-comments']");

    assert
      .dom('.video-shorts-comments-surface__child-comment[data-post-id="251"]')
      .doesNotExist("target children start unloaded");
    assert
      .dom(viewRepliesSelector(253))
      .exists("unrelated branch is collapsed");

    await click('[data-post-id="250"] [data-action="comment-tools-toggle"]');
    await click('[data-post-id="250"] [data-action="delete-comment"]');
    await click(".dialog-footer .btn-primary");

    assert.strictEqual(
      deletedBranchCalls,
      1,
      "delete placeholder fetches the target parent's direct children once",
    );
    assert.strictEqual(
      unrelatedBranchCalls,
      0,
      "delete placeholder does not expand unrelated collapsed branches",
    );
    assert
      .dom('.video-shorts-comments-surface__comment[data-post-id="250"]')
      .includesText("Deleted comment");
    assert
      .dom('.video-shorts-comments-surface__child-comment[data-post-id="251"]')
      .includesText("First preserved child");
    assert
      .dom('.video-shorts-comments-surface__child-comment[data-post-id="252"]')
      .includesText("Second preserved child");
    assert
      .dom('.video-shorts-comments-surface__child-comment[data-post-id="254"]')
      .doesNotExist("unrelated child remains unloaded");
    assert
      .dom(viewRepliesSelector(253))
      .exists("unrelated branch stays collapsed");
    assert.dom(".d-modal__title").hasText("3 replies");
    assert
      .dom(
        '[data-post-id="125"] [data-action="open-comments"] .video-shorts-action-rail__count',
      )
      .hasText("3", "rail count decrements only the deleted parent");
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
