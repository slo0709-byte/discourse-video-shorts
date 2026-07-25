import {
  click,
  currentURL,
  fillIn,
  settled,
  triggerKeyEvent,
  visit,
  waitUntil,
} from "@ember/test-helpers";
import { test } from "qunit";
import AnonymousFlagModal from "discourse/components/modal/anonymous-flag";
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

function setupPretender(callback) {
  const helpers = pretenderHelpers();
  const repliesByPostId = new Map();
  let hasExplicitBranchHandler = false;
  const server = new Proxy(pretender, {
    get(target, property) {
      if (property === "get") {
        return (path, handler, ...args) => {
          const directRepliesMatch = path.match(
            /^\/posts\/(\d+)\/replies\.json$/,
          );

          if (directRepliesMatch) {
            repliesByPostId.set(directRepliesMatch[1], handler);
          } else if (path === "/video-shorts/comments/replies.json") {
            hasExplicitBranchHandler = true;
          }

          return target.get(path, handler, ...args);
        };
      }

      const value = Reflect.get(target, property);

      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  callback(server, helpers);

  if (!hasExplicitBranchHandler) {
    pretender.get("/video-shorts/comments/replies.json", (request) => {
      const handler = repliesByPostId.get(request.queryParams.post_id);

      if (!handler) {
        return helpers.response(404, { error: "not_found" });
      }

      const normalizeResponse = (response) => {
        const [status, headers, posts] = response;

        if (status !== 200 || !Array.isArray(posts)) {
          return response;
        }

        return [
          status,
          headers,
          {
            posts,
            has_more: false,
            next_after: posts.at(-1)?.post_number || null,
          },
        ];
      };
      const response = handler(request);

      return typeof response?.then === "function"
        ? response.then(normalizeResponse)
        : normalizeResponse(response);
    });
  }
}

function nativeCreateResponse(post) {
  return { success: true, action: "create_post", post };
}

function deferredResponse() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

async function waitForStableRect(element, maxFrames = 30) {
  let previousRect;

  for (let frame = 0; frame < maxFrames; frame += 1) {
    await new Promise((resolve) => requestAnimationFrame(resolve));

    const rect = element.getBoundingClientRect();
    const currentRect = {
      height: rect.height,
      left: rect.left,
      top: rect.top,
      width: rect.width,
    };

    if (
      previousRect &&
      currentRect.height === previousRect.height &&
      currentRect.left === previousRect.left &&
      currentRect.top === previousRect.top &&
      currentRect.width === previousRect.width
    ) {
      return rect;
    }

    previousRect = currentRect;
  }

  throw new Error(`Element geometry did not stabilize within ${maxFrames} frames`);
}

function viewRepliesSelector(postId) {
  return `[data-post-id="${postId}"] [data-video-shorts-view-replies]`;
}

function loadMoreRepliesSelector(postId) {
  return `[data-post-id="${postId}"] [data-video-shorts-load-more-replies]`;
}

function childListSelector() {
  return '[data-video-shorts-native-comment][data-depth="1"]';
}

function rowActionSelector(postId, action) {
  const nativeAction =
    action === "reply" ? ".post-action-menu__reply" : ".post-menu-area";

  return `[data-post-id="${postId}"] ${nativeAction}`;
}

function nativePostSelector(postId) {
  return `[data-video-shorts-native-comment][data-post-id="${postId}"]`;
}

function nativePostActionSelector(postId, action) {
  return `${nativePostSelector(postId)} .post-action-menu__${action}, [data-content] .post-action-menu__${action}`;
}

async function revealNativePostActions(postId) {
  await clickIfPresent(`${nativePostSelector(postId)} .show-more-actions`);
}

function replyEditorSelector(postId = null) {
  return postId === null
    ? '[data-video-shorts-reply-editor][data-reply-kind="top-level"]'
    : `.video-shorts-comments-surface__comment[data-post-id="${postId}"] [data-video-shorts-inline-reply-editor][data-reply-kind="nested"]`;
}

async function openLightweightReplyEditor(postId = null) {
  if (postId === null) {
    await click('[data-action="native-top-level-reply"]');
  } else {
    await click(nativePostActionSelector(postId, "reply"));
  }

  await waitUntil(() => document.querySelector(replyEditorSelector(postId)));
}

async function publishLightweightReply(raw, postId = null) {
  const editor = replyEditorSelector(postId);
  await fillIn(`${editor} [data-video-shorts-reply-input]`, raw);
  await click(`${editor} [data-video-shorts-reply-submit]`);
}

function assertViewRepliesControl(assert, postId, label, ariaLabel) {
  assert
    .dom(viewRepliesSelector(postId))
    .hasText(label)
    .hasAttribute("aria-label", ariaLabel);
}

function assertRowActions(assert, postId) {
  assert.dom(rowActionSelector(postId, "reply")).exists();
  assert
    .dom(rowActionSelector(postId, "post-menu"))
    .exists("the native PostMenu remains available for this reply");
}

function assertNativePostContract(assert, postId, depth = null) {
  const selector = nativePostSelector(postId);

  assert.dom(selector).exists();
  assert.dom(`${selector} article.boxed[data-post-id="${postId}"]`).exists();
  assert.dom(`${selector} .cooked`).exists();
  assert.dom(`${selector} .post-menu-area`).exists();

  if (depth !== null) {
    assert.dom(selector).hasAttribute("data-depth", String(depth));
  }
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
      [
        ...document.querySelectorAll(
          ".video-shorts-comments-surface .topic-post .cooked",
        ),
      ]
        .map((node) => node.textContent.trim())
        .filter(Boolean);

    assert.deepEqual(
      commentsText().slice(0, 2),
      ["Most liked comment", "Newest comment"],
      "comments keep the source order returned by Discourse",
    );
    assert.dom(".video-shorts-comments-surface .post-menu-area").exists();
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

  test("baseline keeps native PostMenu, reply editor, and delete paths reachable", async function (assert) {
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
        assert.strictEqual(params.get("reply_to_post_number"), null);

        return helper.response(
          nativeCreateResponse(
            directReply(
              91247,
              "admin_user",
              "<p>Baseline published reply</p>",
              {
                post_number: 3,
                raw: "Baseline published reply",
                topic_id: 126,
                post_url: "/t/baseline-actions/126/3",
              },
            ),
          ),
        );
      });
    });

    await visit("/videos");
    await click("[data-action='open-comments']");

    assert.dom(".video-shorts-comments-panel").exists();
    assert
      .dom('.video-shorts-comments-surface__comment[data-post-id="246"]')
      .includesText("Baseline tool target");
    assertNativePostContract(assert, 246, 0);

    await openLightweightReplyEditor();
    await publishLightweightReply("Baseline published reply");

    assert.strictEqual(
      publishRequests,
      1,
      "the top-level publish path remains reachable from the comments sheet",
    );
    assert.dom("#reply-control.open").doesNotExist();
    assert.dom(".video-shorts-comments-panel").exists();

    await revealNativePostActions(246);

    assert.dom(`${nativePostSelector(246)} .post-menu-area`).exists();
    assert
      .dom(nativePostActionSelector(246, "delete"))
      .exists("the native delete action path remains reachable");
    assert.dom("#reply-control.open").doesNotExist();
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
      .dom('[data-video-shorts-native-comment][data-depth="0"]')
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
      .dom(
        '[data-video-shorts-native-comment][data-depth="1"][data-post-id="332"]',
      )
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
      .dom(".video-shorts-comments-panel__count")
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
      .dom(
        '[data-video-shorts-native-comment][data-depth="1"][data-post-id="342"]',
      )
      .includesText("First child");
    assert
      .dom(childListSelector(340))
      .exists("opening the branch renders a data-video-shorts-child-list list");
    assert
      .dom(
        '[data-video-shorts-native-comment][data-depth="1"][data-post-id="345"]',
      )
      .doesNotExist("loading a direct child page does not fetch grandchildren");
    assert
      .dom(viewRepliesSelector(342))
      .doesNotExist("second-level rows do not expose a third-level branch");
    assert
      .dom(
        '[data-video-shorts-native-comment][data-depth="1"] [data-video-shorts-native-comment]',
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
        '[data-video-shorts-native-comment][data-depth="1"][data-post-id="351"]',
      ).length,
      doubleClickedBranch ? 1 : 0,
      "double-clicking one branch does not duplicate rendered rows",
    );
  });

  test("lazy replies: paginated deep branches expose a localized load-more control", async function (assert) {
    let parentBranchCalls = 0;
    const firstPage = Array.from({ length: 20 }, (_, index) =>
      directReply(
        380 + index,
        `page-child-${index + 1}`,
        `<p>Page child ${index + 1}</p>`,
        {
          post_number: 3 + index,
          reply_to_post_number: index === 0 ? 2 : 2 + index,
          reply_count: 1,
          post_url: `/t/branch-pagination/135/${3 + index}`,
        },
      ),
    );
    const branchPages = [
      {
        after: undefined,
        response: {
          posts: firstPage,
          has_more: true,
          next_after: firstPage.at(-1).post_number,
        },
      },
      {
        after: "22",
        response: {
          posts: [
            directReply(420, "last-page-child", "<p>Last page child</p>", {
              post_number: 23,
              reply_to_post_number: 22,
              post_url: "/t/branch-pagination/135/23",
            }),
          ],
          has_more: false,
          next_after: 23,
        },
      },
    ];

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
            reply_count: 1,
            post_url: "/t/branch-pagination/135/2",
          }),
        ]),
      );

      server.get("/video-shorts/comments/replies.json", (request) => {
        const branchPage = branchPages[parentBranchCalls];
        parentBranchCalls += 1;
        assert.strictEqual(request.queryParams.post_id, "379");
        assert.strictEqual(request.queryParams.after, branchPage.after);

        return helper.response(branchPage.response);
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
      .dom(
        '[data-video-shorts-native-comment][data-depth="1"][data-post-id="420"]',
      )
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
      .dom(
        '[data-video-shorts-native-comment][data-depth="1"][data-post-id="449"]',
      )
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
      .dom(
        '[data-video-shorts-native-comment][data-depth="1"][data-post-id="392"]',
      )
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
      .dom(
        '[data-video-shorts-native-comment][data-depth="1"][data-post-id="381"]',
      )
      .includesText("Depth child");
    assert
      .dom(viewRepliesSelector(381))
      .doesNotExist("loaded second-level rows do not expose another branch");
    assertRowActions(assert, 381);
    assert
      .dom(
        '[data-video-shorts-native-comment][data-depth="1"][data-post-id="382"]',
      )
      .doesNotExist("deeper replies are not rendered as a third visual level");
    assert
      .dom(
        '[data-video-shorts-native-comment][data-depth="1"] [data-video-shorts-native-comment]',
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
      .dom(
        '[data-video-shorts-native-comment][data-depth="1"][data-post-id="541"]',
      )
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
      .dom(
        '[data-video-shorts-native-comment][data-depth="1"][data-post-id="361"]',
      )
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
      .dom(".video-shorts-comments-panel__count")
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
      .dom(
        '[data-video-shorts-native-comment][data-depth="1"][data-post-id="371"]',
      )
      .doesNotExist("unloaded child rows do not drive displayed counts");
    assert
      .dom(viewRepliesSelector(370))
      .hasText(
        "View more",
        "the branch control omits the parent reply_count from visible text",
      );
  });

  test("opens native comments panel with collapsed child replies", async function (assert) {
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
    assert.dom(".video-shorts-comments-panel").exists();
    assert.dom(".video-shorts-comments-panel").hasAttribute("aria-label");
    assertNativePostContract(assert, 201, 0);
    assert
      .dom('[data-video-shorts-native-comment][data-depth="0"]')
      .exists({ count: 1 });
    assert.dom(".cooked").includesText("First direct reply");
    assert
      .dom('[data-video-shorts-native-comment][data-depth="1"]')
      .doesNotExist("nested replies stay collapsed before branch load");
    assert.dom(viewRepliesSelector(201)).exists();

    await click(viewRepliesSelector(201));

    assert
      .dom('[data-video-shorts-native-comment][data-depth="1"]')
      .includesText("Nested direct reply");
    assert.dom("[data-video-shorts-reply-target]").doesNotExist();
    assert.dom(".topic-post article.boxed").exists();
    assert.dom(".video-shorts-comments-surface .post-menu-area").exists();
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

    assert.dom(".video-shorts-comments-panel__count").hasText("4 replies");
    assert
      .dom('[data-video-shorts-native-comment][data-depth="0"]')
      .exists({ count: 2 });
    assert
      .dom('[data-video-shorts-native-comment][data-depth="1"]')
      .doesNotExist("nested replies are collapsed before a branch click");

    await click(viewRepliesSelector(216));

    assert
      .dom(
        '[data-video-shorts-native-comment][data-depth="1"][data-post-id="218"]',
      )
      .includesText("Nested reply");
    assert
      .dom(
        '[data-video-shorts-native-comment][data-depth="1"][data-post-id="219"]',
      )
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
    assert.dom(".video-shorts-comments-panel__count").hasText("4 replies");
    assert
      .dom('[data-video-shorts-native-comment][data-depth="0"]')
      .exists(
        { count: 1 },
        "initial OP comments are bounded to direct replies",
      );
    assert
      .dom('[data-video-shorts-native-comment][data-depth="1"]')
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
      .dom(".cooked")
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
      .dom(
        '[data-video-shorts-native-comment][data-depth="1"][data-post-id="233"]',
      )
      .includesText("Nested direct reply");
    assert
      .dom(
        '[data-video-shorts-native-comment][data-depth="1"][data-post-id="234"]',
      )
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

    assert.dom(".video-shorts-comments-panel__count").hasText("5 replies");
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
        '[data-video-shorts-native-comment][data-depth="1"] .topic-avatar .avatar',
      )
      .exists("nested reply uses the fixed small avatar container");
  });

  test("loads every descendant into one native second-level branch", async function (assert) {
    let branchRequests = 0;

    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [feedItem(139, "Flattened descendant branch clip")],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );

      server.get("/posts/139/replies.json", () =>
        helper.response([
          directReply(400, "branch-parent", "<p>Branch parent</p>", {
            post_number: 2,
            reply_count: 1,
            post_url: "/t/video-139/139/2",
          }),
        ]),
      );

      server.get("/video-shorts/comments/replies.json", (request) => {
        branchRequests += 1;

        assert.strictEqual(request.queryParams.post_id, "400");
        assert.strictEqual(request.queryParams.after, undefined);

        return helper.response({
          posts: [
            directReply(401, "branch-child", "<p>Branch child</p>", {
              post_number: 3,
              reply_to_post_number: 2,
              reply_count: 1,
              post_url: "/t/video-139/139/3",
            }),
            directReply(402, "branch-grandchild", "<p>Branch grandchild</p>", {
              post_number: 4,
              reply_to_post_number: 3,
              post_url: "/t/video-139/139/4",
            }),
          ],
          has_more: false,
          next_after: 4,
        });
      });
    });

    await visit("/videos");
    await click("[data-action='open-comments']");

    assert.dom('[data-post-id="402"]').doesNotExist();

    await click(viewRepliesSelector(400));

    assert.strictEqual(branchRequests, 1);
    assert
      .dom('[data-video-shorts-native-comment][data-depth="1"]')
      .exists({ count: 2 });
    assert.dom('[data-post-id="401"]').includesText("Branch child");
    assert.dom('[data-post-id="402"]').includesText("Branch grandchild");
    assert
      .dom('[data-video-shorts-native-comment][data-depth="2"]')
      .doesNotExist("deeper descendants remain visually flattened");
  });

  test("renders empty state with the lightweight editor closed until requested", async function (assert) {
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

    assert.dom(".video-shorts-comments-panel").includesText("No comments yet");
    assert.dom("#reply-control.open .d-editor").doesNotExist();
    assert.dom('[data-action="native-top-level-reply"]').exists();
  });

  test("hides the top-level reply entry for an authenticated user without reply permission", async function (assert) {
    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [
            feedItem(127, "Read-only clip", {
              liked: false,
              can_like: true,
              bookmarked: false,
              bookmark_id: null,
              can_bookmark: true,
              can_flag: true,
              can_reply: false,
              share_url: "/t/video-127/127/1",
            }),
          ],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );

      server.get("/posts/127/replies.json", () => helper.response([]));
    });

    await visit("/videos");
    await click("[data-action='open-comments']");

    assert.dom('[data-action="native-top-level-reply"]').doesNotExist();
  });

  test("top-level reply publishes through the lightweight editor and stays on /videos", async function (assert) {
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
        assert.strictEqual(params.get("raw"), "Native sheet inline reply");
        assert.strictEqual(params.get("reply_to_post_number"), null);

        return helper.response(
          nativeCreateResponse(
            directReply(
              91223,
              "admin_user",
              "<p>Native sheet inline reply</p>",
              {
                post_number: 2,
                raw: "Native sheet inline reply",
                topic_id: 103,
                post_url: "/t/replyable/103/2",
              },
            ),
          ),
        );
      });
    });

    await visit("/videos");
    const beforeURL = currentURL();

    await click("[data-action='open-comments']");
    await openLightweightReplyEditor();
    await publishLightweightReply("Native sheet inline reply");

    assert.strictEqual(currentURL(), beforeURL);
    assert.dom("#reply-control.open").doesNotExist();
    assert.dom(replyEditorSelector()).doesNotExist();
    assert.dom(".video-shorts-comments-panel").exists();
  });

  test("keeps the native reply entry and editor above comments outside the list", async function (assert) {
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
    const replyEntry = document.querySelector(
      '[data-action="native-top-level-reply"]',
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
      replyEntry,
      null,
      "the native top-level reply entry is rendered",
    );
    assert.true(
      replyEntry?.classList.contains(
        "video-shorts-comments-surface__composer-entry",
      ),
      "the top-level entry uses the lightweight input appearance",
    );
    assert.strictEqual(
      replyEntry?.getAttribute("data-video-shorts-top-level-composer-entry"),
      "",
      "the input-like entry exposes a stable inline editor hook",
    );
    assert
      .dom(replyEntry)
      .hasText(
        "Add a comment...",
        "the top-level entry renders the exact localized plain-text prompt",
      );
    assert.false(
      /\{\{|\}\}|video_shorts|<|>/.test(replyEntry?.textContent || ""),
      "the top-level prompt does not expose a translation key or template markup",
    );
    assert.false(
      Boolean(list && replyEntry && list.contains(replyEntry)),
      "the native reply entry stays in the toolbar outside the thread list",
    );
    assert.true(
      Boolean(
        list &&
        replyEntry &&
        firstComment &&
        replyEntry.closest(".video-shorts-comments-surface__native-toolbar")
          ?.nextElementSibling === list,
      ),
      "the native reply entry appears before the first comment",
    );
    assert.dom("#reply-control.open").doesNotExist();

    await openLightweightReplyEditor();

    const replyInput = document.querySelector(
      `${replyEditorSelector()} [data-video-shorts-reply-input]`,
    );
    assert.strictEqual(
      document.activeElement,
      replyInput,
      "the top-level reply input receives focus when the editor opens",
    );

    const editor = document.querySelector(replyEditorSelector());
    const toolbar = document.querySelector(
      ".video-shorts-comments-surface__native-toolbar",
    );
    assert.notStrictEqual(editor, null, "the top-level entry opens the editor");
    assert
      .dom(`${replyEditorSelector()} [data-video-shorts-reply-input]`)
      .hasAttribute(
        "placeholder",
        "Reply",
        "the opened textarea renders the exact localized reply placeholder",
      );
    assert.true(
      Boolean(editor && toolbar?.contains(editor)),
      "the editor remains in the toolbar above the thread list",
    );
    assert.strictEqual(
      toolbar?.nextElementSibling,
      list,
      "the editor toolbar remains immediately before the thread list",
    );
    assert
      .dom(".video-shorts-comments-surface #reply-control")
      .doesNotExist("core Composer is not nested in the comments scroll owner");
  });

  test("preserves desktop comments panel geometry while the reply editor is open", async function (assert) {
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
    await click("[data-action='open-comments']");
    const panel = document.querySelector(".video-shorts-comments-panel");
    const panelRect = await waitForStableRect(panel);

    assert.true(panelRect.height > 0, "desktop panel has measurable height");
    assert.true(
      panelRect.bottom <= window.innerHeight + 2,
      "desktop panel remains within the viewport",
    );

    await openLightweightReplyEditor();

    const stablePanelRect = await waitForStableRect(panel);
    const bodyStyle = getComputedStyle(document.body);
    const panelWidth = Number.parseFloat(
      bodyStyle.getPropertyValue("--video-shorts-comments-panel-width"),
    );
    const panelHeight = Number.parseFloat(
      bodyStyle.getPropertyValue("--video-shorts-comments-panel-height"),
    );
    const panelLeft = Number.parseFloat(
      bodyStyle.getPropertyValue("--video-shorts-comments-panel-left"),
    );
    const panelTop = Number.parseFloat(
      bodyStyle.getPropertyValue("--video-shorts-comments-panel-top"),
    );

    assert
      .dom(replyEditorSelector())
      .isVisible("lightweight editor is visible");
    assert.true(
      document.body.classList.contains("video-shorts-comments-panel-open"),
      "the route exposes the desktop panel state",
    );
    assert.true(panelWidth > 0, "the route exposes a panel width");
    assert.true(panelHeight > 0, "the route exposes a panel height");
    assert.true(Number.isFinite(panelLeft), "the route exposes a panel left edge");
    assert.true(Number.isFinite(panelTop), "the route exposes a panel top edge");
    assert.strictEqual(
      stablePanelRect.left,
      panelRect.left,
      "opening the lightweight editor does not move the comments panel horizontally",
    );
    assert.strictEqual(
      stablePanelRect.top,
      panelRect.top,
      "opening the lightweight editor does not move the comments panel vertically",
    );
    assert.strictEqual(
      stablePanelRect.width,
      panelRect.width,
      "opening the lightweight editor does not resize the comments panel width",
    );
    assert.strictEqual(
      stablePanelRect.height,
      panelRect.height,
      "opening the lightweight editor does not resize the comments panel",
    );
  });

  test("dedicated editor owns reply controls for top-level and post replies", async function (assert) {
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

    assert.dom("#reply-control.open").doesNotExist();

    await openLightweightReplyEditor();

    const topLevelEditor = replyEditorSelector();
    assert.dom(`${topLevelEditor} [data-video-shorts-reply-input]`).isVisible();
    assert.dom(`${topLevelEditor} [data-video-shorts-reply-cancel]`).exists();
    assert
      .dom(`${topLevelEditor} [data-video-shorts-reply-submit]`)
      .isVisible();

    await click(`${topLevelEditor} [data-video-shorts-reply-cancel]`);
    assert.dom(topLevelEditor).doesNotExist();

    await openLightweightReplyEditor(229);

    const nestedEditor = replyEditorSelector(229);
    assert
      .dom(nestedEditor)
      .hasClass(
        "video-shorts-comments-surface__edit-editor",
        "nested replies reuse the lightweight edit layout",
      );
    assert.dom(`${nestedEditor} [data-video-shorts-reply-input]`).isVisible();
    assert.dom(`${nestedEditor} [data-video-shorts-reply-cancel]`).exists();
    assert.dom(`${nestedEditor} [data-video-shorts-reply-submit]`).isVisible();
    assert.dom("#reply-control.open").doesNotExist();
  });

  test("comment reply publishes through the lightweight editor for the selected Post", async function (assert) {
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
        assert.strictEqual(params.get("raw"), "Native inline parent child");
        assert.strictEqual(params.get("reply_to_post_number"), "2");
        assert.false(params.get("raw").startsWith("@reply-author"));

        return helper.response(
          nativeCreateResponse(
            directReply(
              91226,
              "admin_user",
              "<p>Native inline parent child</p>",
              {
                post_number: 3,
                raw: "Native inline parent child",
                topic_id: 104,
                reply_to_post_number: 2,
                post_url: "/t/nested-replyable/104/3",
              },
            ),
          ),
        );
      });
    });

    await visit("/videos");
    const beforeURL = currentURL();

    await click("[data-action='open-comments']");
    await openLightweightReplyEditor(204);

    assert.dom(replyEditorSelector(204)).isVisible();
    assert.dom("[data-video-shorts-comment-reply-dialog]").doesNotExist();
    await publishLightweightReply("Native inline parent child", 204);

    assert.strictEqual(currentURL(), beforeURL);
    assert.dom("#reply-control.open").doesNotExist();
    assert.dom(replyEditorSelector(204)).doesNotExist();
    assert.dom(".video-shorts-comments-panel").exists();
  });

  test("floor comment reply targets the selected native child Post", async function (assert) {
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
        assert.strictEqual(params.get("raw"), "Native inline floor child");
        assert.strictEqual(params.get("reply_to_post_number"), "3");
        assert.false(params.get("raw").startsWith("@child-author"));

        return helper.response(
          nativeCreateResponse(
            directReply(
              91227,
              "admin_user",
              "<p>Native inline floor child</p>",
              {
                post_number: 4,
                raw: "Native inline floor child",
                topic_id: 118,
                reply_to_post_number: 3,
                post_url: "/t/native-floor-reply/118/4",
              },
            ),
          ),
        );
      });
    });

    await visit("/videos");
    const beforeURL = currentURL();

    await click("[data-action='open-comments']");
    await click(viewRepliesSelector(224));

    await openLightweightReplyEditor(225);

    assert.dom(replyEditorSelector(225)).isVisible();
    assert.dom("[data-video-shorts-comment-reply-dialog]").doesNotExist();
    await publishLightweightReply("Native inline floor child", 225);

    assert.strictEqual(currentURL(), beforeURL);
    assert.dom("#reply-control.open").doesNotExist();
    assert.dom(replyEditorSelector(225)).doesNotExist();
    assert.dom(".video-shorts-comments-panel").exists();
  });

  test("renders permission-aware native PostMenu actions", async function (assert) {
    const flagActionId = this.owner.lookup("service:site").flagTypes[0].id;

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
          directReply(205, "managed-author", "<p>Comment with tools</p>", {
            can_edit: true,
            can_delete: true,
            can_flag: true,
            post_url: "/t/managed-comment/105/2",
            actions_summary: [{ id: flagActionId, can_act: true }],
          }),
        ]),
      );
    });

    await visit("/videos");
    await click("[data-action='open-comments']");
    await revealNativePostActions(205);

    assertNativePostContract(assert, 205, 0);
    assert.dom(`${nativePostSelector(205)} .post-menu-area`).exists();
    assert.dom(nativePostActionSelector(205, "edit")).exists();
    assert.dom(nativePostActionSelector(205, "copy-link")).exists();
    assert.dom(nativePostActionSelector(205, "flag")).exists();
    assert.dom(nativePostActionSelector(205, "delete")).exists();
  });

  test("comment body stays native and actions remain in PostMenu", async function (assert) {
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
    await click(`${nativePostSelector(244)} .cooked`);

    assertNativePostContract(assert, 244, 0);
    assert
      .dom("[data-video-shorts-comment-action-sheet]")
      .doesNotExist(
        "native cooked content does not open a plugin action sheet",
      );
    assert.dom(nativePostActionSelector(244, "reply")).exists();

    await revealNativePostActions(244);

    assert.dom(nativePostActionSelector(244, "edit")).exists();
    assert.dom(nativePostActionSelector(244, "copy-link")).exists();
    assert.dom(nativePostActionSelector(244, "flag")).exists();
    assert.dom(nativePostActionSelector(244, "delete")).exists();
  });

  test("preserves native cooked-link keyboard behavior", async function (assert) {
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

    const link = document.querySelector(`${nativePostSelector(248)} .cooked a`);

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
        .doesNotExist(`${key} on the cooked link stays in native Post content`);
    }
  });

  test("native PostMenu reply opens the inline lightweight editor", async function (assert) {
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
    await openLightweightReplyEditor(245);

    assertNativePostContract(assert, 245, 0);
    assert.dom("[data-video-shorts-comment-action-sheet]").doesNotExist();
    const editor = replyEditorSelector(245);
    assert.dom(editor).isVisible();
    assert.dom("[data-video-shorts-comment-reply-dialog]").doesNotExist();
    assert.dom(`${editor} [data-video-shorts-reply-input]`).isVisible();
    assert.dom(`${editor} [data-video-shorts-reply-cancel]`).exists();
    assert.dom(`${editor} [data-video-shorts-reply-submit]`).isVisible();
    assert.dom("#reply-control.open").doesNotExist();
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
      await revealNativePostActions(213);
      assertNativePostContract(assert, 213, 0);
      await click(nativePostActionSelector(213, "flag"));
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
    assert.dom("[data-video-shorts-comment-tools-menu]").doesNotExist();
  });

  test("hides native PostMenu flag action when flagging is unavailable", async function (assert) {
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
    await revealNativePostActions(214);

    assertNativePostContract(assert, 214, 0);
    assert.dom(`${nativePostSelector(214)} .post-menu-area`).exists();
    assert.dom(nativePostActionSelector(214, "flag")).doesNotExist();
  });

  test("native PostMenu does not create plugin menus on outside click or Escape", async function (assert) {
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
    await revealNativePostActions(207);

    assertNativePostContract(assert, 207, 0);
    assert.dom(`${nativePostSelector(207)} .post-menu-area`).exists();
    assert.dom("[data-video-shorts-comment-tools-menu]").doesNotExist();

    await click(".video-shorts-comments-surface");

    await triggerKeyEvent(
      ".video-shorts-comments-surface",
      "keydown",
      "Escape",
    );

    assert.dom("[data-video-shorts-comment-tools-menu]").doesNotExist();
    assert.dom(`${nativePostSelector(207)} .post-menu-area`).exists();
  });

  test("updates comments panel and rail counts after deleting a comment", async function (assert) {
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

    assert.dom(".video-shorts-comments-panel__count").hasText("2 replies");

    await revealNativePostActions(210);
    await click(nativePostActionSelector(210, "delete"));
    await click(".dialog-footer .btn-primary");

    assert
      .dom('.video-shorts-comments-surface__comment[data-post-id="210"]')
      .doesNotExist("deleted comment is removed from the open sheet");
    assert.dom(".video-shorts-comments-panel__count").hasText("1 reply");
    assert
      .dom(
        '[data-post-id="110"] [data-action="open-comments"] .video-shorts-action-rail__count',
      )
      .hasText("1", "rail count updates immediately after delete");
  });

  test("reconciles a loaded native delete without refetching or closing comments", async function (assert) {
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
    assert
      .dom(".video-shorts-comments-panel")
      .exists("comments panel is open before delete");

    await revealNativePostActions(218);
    await click(nativePostActionSelector(218, "delete"));
    await click(".dialog-footer .btn-primary");

    assert.strictEqual(
      refreshRepliesRequests,
      1,
      "a loaded native Post delete is reconciled locally without a full source refetch",
    );
    assert
      .dom(".video-shorts-comments-panel")
      .exists("comments panel stays open");
    assert.strictEqual(currentURL(), "/videos");
    assert.dom("[data-action='sort-recent']").doesNotExist();
    assert
      .dom('.video-shorts-comments-surface__comment[data-post-id="218"]')
      .doesNotExist("stale deleted comment is gone");
    assert
      .dom('.video-shorts-comments-surface__comment[data-post-id="220"]')
      .doesNotExist("unrelated server rows are not fetched by a local delete");
    assert.strictEqual(
      document.querySelectorAll(
        '.video-shorts-comments-surface__comment[data-post-id="219"]',
      ).length,
      1,
      "local delete does not duplicate existing comments",
    );
  });

  test("edits a comment with the lightweight editor and reconciles the server response", async function (assert) {
    let updateRequests = 0;
    let updatedRaw;

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

      server.put("/posts/221.json", (request) => {
        updateRequests += 1;
        updatedRaw = postParams(request).get("post[raw]");

        return helper.response(
          directReply(221, "admin_user", "<p>Server cooked after edit</p>", {
            can_edit: true,
            raw: "Server raw after edit",
            topic_id: 117,
            updated_at: "2026-06-08T13:00:00.000Z",
            post_url: "/t/edit-reconcile/117/2",
          }),
        );
      });
    });

    await visit("/videos");
    await click("[data-action='open-comments']");
    await revealNativePostActions(221);
    await click(nativePostActionSelector(221, "edit"));

    const editor =
      '[data-video-shorts-edit-editor][data-post-id="221"]';

    assert
      .dom(`${editor} [data-video-shorts-edit-input]`)
      .hasValue("Fresh raw before edit");
    assert.dom("#reply-control.open").doesNotExist();

    await fillIn(
      `${editor} [data-video-shorts-edit-input]`,
      "Cancelled lightweight draft",
    );
    await click(`${editor} [data-video-shorts-edit-cancel]`);

    assert.dom(editor).doesNotExist();
    assert.strictEqual(updateRequests, 0, "cancel does not update the post");
    assert
      .dom('.video-shorts-comments-surface__comment[data-post-id="221"]')
      .includesText("Original editable comment");

    await revealNativePostActions(221);
    await click(nativePostActionSelector(221, "edit"));
    await fillIn(
      `${editor} [data-video-shorts-edit-input]`,
      "Typed lightweight draft",
    );
    await click(`${editor} [data-video-shorts-edit-save]`);

    assert.dom(editor).doesNotExist();
    assert.strictEqual(updateRequests, 1);
    assert.strictEqual(updatedRaw, "Typed lightweight draft");
    assert
      .dom('.video-shorts-comments-surface__comment[data-post-id="221"]')
      .includesText("Server cooked after edit");
    assert
      .dom('.video-shorts-comments-surface__comment[data-post-id="221"]')
      .doesNotIncludeText("Typed lightweight draft");
    assert.strictEqual(currentURL(), "/videos");
  });

  test("edits a child reply with the lightweight editor", async function (assert) {
    let updatedRaw;

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

      server.put("/posts/230.json", (request) => {
        updatedRaw = postParams(request).get("post[raw]");

        return helper.response(
          directReply(230, "admin_user", "<p>Server nested after edit</p>", {
            can_edit: true,
            post_number: 3,
            reply_to_post_number: 2,
            raw: "Server nested after edit",
            topic_id: 119,
            updated_at: "2026-06-08T13:30:00.000Z",
            post_url: "/t/edit-nested-child/119/3",
          }),
        );
      });
    });

    await visit("/videos");
    await click("[data-action='open-comments']");
    await click(viewRepliesSelector(229));
    await revealNativePostActions(230);
    await click(nativePostActionSelector(230, "edit"));

    const editor =
      '[data-video-shorts-edit-editor][data-post-id="230"]';

    assert
      .dom(`${editor} [data-video-shorts-edit-input]`)
      .hasValue("Fresh nested raw");
    assert.dom("#reply-control.open").doesNotExist();

    await fillIn(
      `${editor} [data-video-shorts-edit-input]`,
      "Typed lightweight nested draft",
    );
    await click(`${editor} [data-video-shorts-edit-save]`);

    assert.dom(editor).doesNotExist();
    assert.strictEqual(updatedRaw, "Typed lightweight nested draft");
    assert
      .dom(
        '[data-video-shorts-native-comment][data-depth="1"][data-post-id="230"]',
      )
      .includesText("Server nested after edit");
    assert
      .dom(
        '[data-video-shorts-native-comment][data-depth="1"][data-post-id="230"]',
      )
      .doesNotIncludeText("Typed lightweight nested draft");
    assert.strictEqual(currentURL(), "/videos");
  });

  test("lazy-loaded child replies expose native PostMenu actions", async function (assert) {
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
    await revealNativePostActions(245);

    assertNativePostContract(assert, 245, 1);
    assert
      .dom(nativePostActionSelector(245, "edit"))
      .exists("lazy child keeps the native edit action");
    assert
      .dom(nativePostActionSelector(245, "copy-link"))
      .exists("lazy child keeps the native copy-link action");
    assert
      .dom(nativePostActionSelector(245, "flag"))
      .exists("lazy child keeps the native report action");
    assert
      .dom(nativePostActionSelector(245, "delete"))
      .exists("lazy child keeps the native delete action");
  });

  test("updates comments panel and rail counts after deleting a child reply", async function (assert) {
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

    assertNativePostContract(assert, 213, 1);
    assert.dom(".video-shorts-comments-panel__count").hasText("3 replies");
    assert
      .dom(
        '[data-video-shorts-native-comment][data-depth="1"][data-post-id="213"]',
      )
      .includesText("Child reply to delete");

    await revealNativePostActions(213);
    await click(nativePostActionSelector(213, "delete"));
    await click(".dialog-footer .btn-primary");

    assert
      .dom(
        '[data-video-shorts-native-comment][data-depth="1"][data-post-id="213"]',
      )
      .doesNotExist("deleted child reply is removed from the open sheet");
    assert
      .dom('.video-shorts-comments-surface__comment[data-post-id="212"]')
      .doesNotIncludeText("1 reply");
    assert.dom(".video-shorts-comments-panel__count").hasText("2 replies");
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

    assert.dom(".video-shorts-comments-panel__count").hasText("4 replies");
    assert
      .dom(
        '[data-video-shorts-native-comment][data-depth="1"][data-post-id="233"]',
      )
      .includesText("Deep child to delete");

    await revealNativePostActions(233);
    await click(nativePostActionSelector(233, "delete"));
    await click(".dialog-footer .btn-primary");

    assert
      .dom(
        '[data-video-shorts-native-comment][data-depth="1"][data-post-id="233"]',
      )
      .doesNotExist("deleted deep child reply is removed from the open sheet");
    assert
      .dom(
        '[data-video-shorts-native-comment][data-depth="1"][data-post-id="232"]',
      )
      .includesText("Child comment remains");
    assert.dom(".video-shorts-comments-panel__count").hasText("3 replies");
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
    await click(viewRepliesSelector(235));

    assert.dom(".video-shorts-comments-panel__count").hasText("3 replies");
    assert
      .dom(
        '[data-video-shorts-native-comment][data-depth="1"][data-post-id="237"]',
      )
      .includesText("Grandchild remains");

    await revealNativePostActions(236);
    await click(nativePostActionSelector(236, "delete"));
    await click(".dialog-footer .btn-primary");

    assert
      .dom(
        '[data-video-shorts-native-comment][data-depth="1"][data-post-id="236"]',
      )
      .includesText("Deleted comment");
    assert
      .dom(
        '[data-video-shorts-native-comment][data-depth="1"][data-post-id="237"]',
      )
      .includesText("Grandchild remains");
    assert.dom(".video-shorts-comments-panel__count").hasText("2 replies");
    assert
      .dom(
        '[data-post-id="121"] [data-action="open-comments"] .video-shorts-action-rail__count',
      )
      .hasText("2", "rail count decrements only the deleted child reply");
  });

  test("updates comments panel and rail counts after deleting a parent with children", async function (assert) {
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

    assert.dom(".video-shorts-comments-panel__count").hasText("3 replies");
    assert
      .dom(
        '[data-video-shorts-native-comment][data-depth="1"][data-post-id="216"]',
      )
      .includesText("Mobile child reply remains");

    await revealNativePostActions(215);
    await click(nativePostActionSelector(215, "delete"));
    await click(".dialog-footer .btn-primary");

    assert
      .dom('.video-shorts-comments-surface__comment[data-post-id="215"]')
      .includesText("Deleted comment");
    assert
      .dom(
        '[data-video-shorts-native-comment][data-depth="1"][data-post-id="216"]',
      )
      .includesText("Mobile child reply remains");
    assert.dom(".video-shorts-comments-panel__count").hasText("2 replies");
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
      .dom(
        '[data-video-shorts-native-comment][data-depth="1"][data-post-id="251"]',
      )
      .doesNotExist("target children start unloaded");
    assert
      .dom(viewRepliesSelector(253))
      .exists("unrelated branch is collapsed");

    await revealNativePostActions(250);
    await click(nativePostActionSelector(250, "delete"));
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
      .dom(
        '[data-video-shorts-native-comment][data-depth="1"][data-post-id="251"]',
      )
      .includesText("First preserved child");
    assert
      .dom(
        '[data-video-shorts-native-comment][data-depth="1"][data-post-id="252"]',
      )
      .includesText("Second preserved child");
    assert
      .dom(
        '[data-video-shorts-native-comment][data-depth="1"][data-post-id="254"]',
      )
      .doesNotExist("unrelated child remains unloaded");
    assert
      .dom(viewRepliesSelector(253))
      .exists("unrelated branch stays collapsed");
    assert.dom(".video-shorts-comments-panel__count").hasText("3 replies");
    assert
      .dom(
        '[data-post-id="125"] [data-action="open-comments"] .video-shorts-action-rail__count',
      )
      .hasText("3", "rail count decrements only the deleted parent");
  });
});

acceptance("Video Shorts mobile comments sheet viewport", function (needs) {
  needs.settings({ video_shorts_enabled: true });
  needs.user();
  needs.mobileView();

  test("keeps the sheet stable and scrolls an inline reply above the mobile keyboard", async function (assert) {
    class FakeVisualViewport extends EventTarget {
      height = window.innerHeight;
      offsetTop = 0;
      listenerCounts = new Map();

      addEventListener(type, callback, options) {
        super.addEventListener(type, callback, options);
        this.listenerCounts.set(type, (this.listenerCounts.get(type) || 0) + 1);
      }

      removeEventListener(type, callback, options) {
        super.removeEventListener(type, callback, options);
        this.listenerCounts.set(
          type,
          Math.max((this.listenerCounts.get(type) || 0) - 1, 0),
        );
      }
    }

    const originalVisualViewport = Object.getOwnPropertyDescriptor(
      window,
      "visualViewport",
    );
    const originalMatchMedia = window.matchMedia;
    const visualViewport = new FakeVisualViewport();
    const mobileLayoutQuery = new EventTarget();

    mobileLayoutQuery.matches = false;
    mobileLayoutQuery.media = "(min-width: 1024px)";

    window.matchMedia = (query) =>
      query === mobileLayoutQuery.media
        ? mobileLayoutQuery
        : originalMatchMedia.call(window, query);

    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: visualViewport,
    });

    try {
      setupPretender((server, helper) => {
        server.get("/videos.json", () =>
          helper.response({
            items: [feedItem(131, "Keyboard-safe nested reply clip")],
            next_cursor: null,
            scan_limit_reached: false,
          }),
        );

        server.get("/posts/131/replies.json", () =>
          helper.response([
            directReply(251, "keyboard-author", "<p>Reply above keyboard</p>", {
              post_number: 2,
              post_url: "/t/keyboard-safe-reply/131/2",
            }),
          ]),
        );
      });

      await visit("/videos");
      const baselineResizeListeners =
        visualViewport.listenerCounts.get("resize") || 0;
      const baselineScrollListeners =
        visualViewport.listenerCounts.get("scroll") || 0;
      await click("[data-action='open-comments']");

      const sheet = document.querySelector(".video-shorts-comments-sheet");
      await waitUntil(
        () =>
          sheet.style.getPropertyValue(
            "--video-shorts-comments-sheet-stable-height",
          ) !== "",
      );

      const stableTop = sheet.style.getPropertyValue(
        "--video-shorts-comments-sheet-stable-top",
      );
      const stableHeight = sheet.style.getPropertyValue(
        "--video-shorts-comments-sheet-stable-height",
      );

      const list = document.querySelector(
        ".video-shorts-comments-surface__list",
      );
      const originalInlinePaddingBottom =
        list.style.getPropertyValue("padding-bottom");

      await openLightweightReplyEditor(251);
      const editorSelector = replyEditorSelector(251);
      const editor = document.querySelector(editorSelector);
      const textarea = editor.querySelector(
        "[data-video-shorts-reply-input]",
      );
      const initialScrollTop = list.scrollTop;
      const initialPaddingBottom =
        Number.parseFloat(getComputedStyle(list).paddingBottom) || 0;
      let scrollTop = initialScrollTop;

      Object.defineProperty(list, "scrollTop", {
        configurable: true,
        get: () => scrollTop,
        set: (value) => {
          const paddingBottom =
            Number.parseFloat(getComputedStyle(list).paddingBottom) || 0;
          const maxScrollTop =
            initialScrollTop +
            Math.max(paddingBottom - initialPaddingBottom, 0);

          scrollTop = Math.min(Math.max(value, 0), maxScrollTop);
        },
      });
      list.getBoundingClientRect = () => ({
        bottom: 800,
        height: 600,
        left: 0,
        right: 390,
        top: 200,
        width: 390,
        x: 0,
        y: 200,
      });
      editor.getBoundingClientRect = () => {
        const scrollDelta = scrollTop - initialScrollTop;

        return {
          bottom: 800 - scrollDelta,
          height: 170,
          left: 24,
          right: 366,
          top: 630 - scrollDelta,
          width: 342,
          x: 24,
          y: 630 - scrollDelta,
        };
      };

      textarea.focus();
      visualViewport.height = 520;
      visualViewport.dispatchEvent(new Event("resize"));
      visualViewport.dispatchEvent(new Event("scroll"));
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );

      assert.dom(sheet).exists("the actual comments sheet remains mounted");
      assert.dom(editorSelector).isVisible();
      assert.dom("[data-video-shorts-comment-reply-dialog]").doesNotExist();
      assert.true(
        (visualViewport.listenerCounts.get("resize") || 0) > 0,
        "the nested reply registers a visual viewport resize listener",
      );
      assert.true(
        (visualViewport.listenerCounts.get("scroll") || 0) > 0,
        "the nested reply registers a visual viewport scroll listener",
      );

      assert.strictEqual(
        sheet.style.getPropertyValue("--video-shorts-comments-sheet-stable-top"),
        stableTop,
        "keyboard events do not rewrite the stable sheet top",
      );
      assert.strictEqual(
        sheet.style.getPropertyValue(
          "--video-shorts-comments-sheet-stable-height",
        ),
        stableHeight,
        "keyboard events do not rewrite the stable sheet height",
      );
      assert.strictEqual(
        editor.closest(".video-shorts-comments-surface__comment")?.dataset
          .postId,
        "251",
        "the reply editor stays inside the selected comment row",
      );
      assert.strictEqual(
        list.style.getPropertyValue(
          "--video-shorts-comments-edit-keyboard-reserve",
        ),
        "292px",
        "the inline reply receives the keyboard occlusion plus action margin",
      );
      assert.true(
        scrollTop > initialScrollTop,
        "keyboard resize scrolls the comments list toward the inline reply",
      );
      assert.strictEqual(
        Number.parseFloat(getComputedStyle(list).paddingBottom),
        initialPaddingBottom + 292,
        "keyboard occlusion adds real scroll range below the inline reply",
      );
      assert.true(
        editor.getBoundingClientRect().bottom <=
          visualViewport.offsetTop + visualViewport.height - 12,
        "the inline reply actions remain above the keyboard",
      );
      assert
        .dom(`${editorSelector} [data-video-shorts-reply-submit]`)
        .isVisible("publish remains reachable");

      await click(`${editorSelector} [data-video-shorts-reply-cancel]`);
      assert
        .dom(editorSelector)
        .doesNotExist("cancel removes the inline reply editor");
      await waitUntil(
        () =>
          list.style.getPropertyValue(
            "--video-shorts-comments-edit-keyboard-reserve",
          ) === "",
      );
      assert.strictEqual(
        list.style.getPropertyValue("padding-bottom"),
        originalInlinePaddingBottom,
        "cancel restores the comments list padding",
      );
      assert.false(
        document.body.classList.contains(
          "video-shorts-lightweight-composer-open",
        ),
        "cancel releases the body interaction lock",
      );

      await click(".video-shorts-comments-sheet .modal-close");
      assert.dom(".video-shorts-comments-sheet").doesNotExist();
      await waitUntil(
        () =>
          visualViewport.listenerCounts.get("resize") ===
            baselineResizeListeners &&
          visualViewport.listenerCounts.get("scroll") ===
            baselineScrollListeners,
      );
      assert.strictEqual(
        visualViewport.listenerCounts.get("resize"),
        baselineResizeListeners,
      );
      assert.strictEqual(
        visualViewport.listenerCounts.get("scroll"),
        baselineScrollListeners,
      );
    } finally {
      window.matchMedia = originalMatchMedia;

      if (originalVisualViewport) {
        Object.defineProperty(window, "visualViewport", originalVisualViewport);
      } else {
        delete window.visualViewport;
      }
    }
  });

  test("scrolls a focused lightweight edit above the mobile keyboard", async function (assert) {
    class FakeVisualViewport extends EventTarget {
      height = window.innerHeight;
      offsetTop = 0;
    }

    const originalVisualViewport = Object.getOwnPropertyDescriptor(
      window,
      "visualViewport",
    );
    const originalMatchMedia = window.matchMedia;
    const visualViewport = new FakeVisualViewport();
    const mobileLayoutQuery = new EventTarget();

    mobileLayoutQuery.matches = false;
    mobileLayoutQuery.media = "(min-width: 1024px)";

    window.matchMedia = (query) =>
      query === mobileLayoutQuery.media
        ? mobileLayoutQuery
        : originalMatchMedia.call(window, query);

    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: visualViewport,
    });

    try {
      setupPretender((server, helper) => {
        server.get("/videos.json", () =>
          helper.response({
            items: [feedItem(132, "Keyboard-safe lightweight edit clip")],
            next_cursor: null,
            scan_limit_reached: false,
          }),
        );

        server.get("/posts/132/replies.json", () =>
          helper.response([
            directReply(261, "admin_user", "<p>Edit above keyboard</p>", {
              can_edit: true,
              post_number: 2,
              post_url: "/t/keyboard-safe-edit/132/2",
              raw: "Edit above keyboard",
            }),
          ]),
        );

        server.get("/posts/261.json", () =>
          helper.response(
            directReply(261, "admin_user", "<p>Edit above keyboard</p>", {
              can_edit: true,
              post_number: 2,
              post_url: "/t/keyboard-safe-edit/132/2",
              raw: "Edit above keyboard",
            }),
          ),
        );
      });

      await visit("/videos");
      await click("[data-action='open-comments']");
      const list = document.querySelector(
        ".video-shorts-comments-surface__list",
      );
      const originalInlinePaddingBottom =
        list.style.getPropertyValue("padding-bottom");

      await revealNativePostActions(261);
      await click(nativePostActionSelector(261, "edit"));

      const sheet = document.querySelector(".video-shorts-comments-sheet");
      const editor = document.querySelector(
        '[data-video-shorts-edit-editor][data-post-id="261"]',
      );
      const textarea = editor.querySelector(
        "[data-video-shorts-edit-input]",
      );
      const initialScrollTop = list.scrollTop;
      const initialPaddingBottom =
        Number.parseFloat(getComputedStyle(list).paddingBottom) || 0;
      let scrollTop = initialScrollTop;

      Object.defineProperty(list, "scrollTop", {
        configurable: true,
        get: () => scrollTop,
        set: (value) => {
          const paddingBottom =
            Number.parseFloat(getComputedStyle(list).paddingBottom) || 0;
          const maxScrollTop =
            initialScrollTop +
            Math.max(paddingBottom - initialPaddingBottom, 0);

          scrollTop = Math.min(Math.max(value, 0), maxScrollTop);
        },
      });

      list.getBoundingClientRect = () => ({
        bottom: 800,
        height: 600,
        left: 0,
        right: 390,
        top: 200,
        width: 390,
        x: 0,
        y: 200,
      });
      editor.getBoundingClientRect = () => {
        const scrollDelta = scrollTop - initialScrollTop;

        return {
          bottom: 800 - scrollDelta,
          height: 170,
          left: 24,
          right: 366,
          top: 630 - scrollDelta,
          width: 342,
          x: 24,
          y: 630 - scrollDelta,
        };
      };

      textarea.focus();
      visualViewport.height = 520;
      visualViewport.dispatchEvent(new Event("resize"));
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );

      assert.dom(sheet).exists();
      assert.strictEqual(
        document.activeElement,
        textarea,
        "the edit textarea remains the keyboard focus target",
      );
      assert.strictEqual(
        list.style.getPropertyValue(
          "--video-shorts-comments-edit-keyboard-reserve",
        ),
        "292px",
        "the list receives the keyboard occlusion plus action margin",
      );
      assert.true(
        scrollTop > initialScrollTop,
        "keyboard resize scrolls the comments list toward the editor",
      );
      assert.strictEqual(
        Number.parseFloat(getComputedStyle(list).paddingBottom),
        initialPaddingBottom + 292,
        "keyboard occlusion adds real scroll range below the editor",
      );
      assert.true(
        editor.getBoundingClientRect().bottom <=
          visualViewport.offsetTop + visualViewport.height - 12,
        "the editor actions remain above the keyboard",
      );
      assert
        .dom(
          '[data-video-shorts-edit-editor][data-post-id="261"] [data-video-shorts-edit-save]',
        )
        .isVisible("save remains reachable");
      assert.dom("#reply-control.open").doesNotExist();

      await click(
        '[data-video-shorts-edit-editor][data-post-id="261"] [data-video-shorts-edit-cancel]',
      );
      await waitUntil(
        () =>
          list.style.getPropertyValue(
            "--video-shorts-comments-edit-keyboard-reserve",
          ) === "",
      );
      assert.strictEqual(
        list.style.getPropertyValue("padding-bottom"),
        originalInlinePaddingBottom,
        "cancel restores the comments list padding",
      );
      await click(".video-shorts-comments-sheet .modal-close");
    } finally {
      window.matchMedia = originalMatchMedia;

      if (originalVisualViewport) {
        Object.defineProperty(window, "visualViewport", originalVisualViewport);
      } else {
        delete window.visualViewport;
      }
    }
  });

  test("locks the sheet before a fast top-level composer focus can suppress the initial viewport capture", async function (assert) {
    class FakeVisualViewport extends EventTarget {
      height = window.innerHeight;
      offsetTop = 0;
    }

    const originalVisualViewport = Object.getOwnPropertyDescriptor(
      window,
      "visualViewport",
    );
    const originalMatchMedia = window.matchMedia;
    const visualViewport = new FakeVisualViewport();
    const mobileLayoutQuery = new EventTarget();

    mobileLayoutQuery.matches = false;
    mobileLayoutQuery.media = "(min-width: 1024px)";

    window.matchMedia = (query) =>
      query === mobileLayoutQuery.media
        ? mobileLayoutQuery
        : originalMatchMedia.call(window, query);

    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: visualViewport,
    });

    try {
      setupPretender((server, helper) => {
        server.get("/videos.json", () =>
          helper.response({
            items: [feedItem(132, "Fast top-level focus clip")],
            next_cursor: null,
            scan_limit_reached: false,
          }),
        );

        server.get("/posts/132/replies.json", () => helper.response([]));
      });

      await visit("/videos");
      await click("[data-action='open-comments']");

      const sheet = document.querySelector(".video-shorts-comments-sheet");
      await waitUntil(
        () =>
          sheet.style.getPropertyValue(
            "--video-shorts-comments-sheet-stable-height",
          ) !== "",
      );

      const initialStableTop = sheet.style.getPropertyValue(
        "--video-shorts-comments-sheet-stable-top",
      );
      const initialStableHeight = sheet.style.getPropertyValue(
        "--video-shorts-comments-sheet-stable-height",
      );

      await click('[data-video-shorts-top-level-composer-entry]');
      const textarea = document.querySelector(
        `${replyEditorSelector()} [data-video-shorts-reply-input]`,
      );
      sheet.style.removeProperty("--video-shorts-comments-sheet-stable-top");
      sheet.style.removeProperty("--video-shorts-comments-sheet-stable-height");
      textarea.focus();

      assert.strictEqual(
        sheet.style.getPropertyValue("--video-shorts-comments-sheet-stable-top"),
        "",
        "the simulated initial capture is still pending when focus wins the race",
      );
      assert.strictEqual(
        sheet.style.getPropertyValue(
          "--video-shorts-comments-sheet-stable-height",
        ),
        "",
        "the simulated initial height capture is still pending when focus wins the race",
      );

      visualViewport.height = Math.max(window.innerHeight / 2, 40);
      visualViewport.dispatchEvent(new Event("resize"));
      visualViewport.dispatchEvent(new Event("scroll"));
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await settled();

      const stableTop = sheet.style.getPropertyValue(
        "--video-shorts-comments-sheet-stable-top",
      );
      const stableHeight = sheet.style.getPropertyValue(
        "--video-shorts-comments-sheet-stable-height",
      );

      assert.notStrictEqual(
        stableTop,
        "",
        "a focused textarea cannot suppress the first stable top capture",
      );
      assert.notStrictEqual(
        stableHeight,
        "",
        "a focused textarea cannot suppress the first stable height capture",
      );
      assert.strictEqual(
        stableTop,
        initialStableTop,
        "the focused retry restores the exact original sheet top",
      );
      assert.strictEqual(
        stableHeight,
        initialStableHeight,
        "the focused retry restores the exact original sheet height",
      );

      visualViewport.offsetTop = 24;
      visualViewport.height = Math.max(window.innerHeight / 3, 40);
      visualViewport.dispatchEvent(new Event("resize"));
      visualViewport.dispatchEvent(new Event("scroll"));
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await settled();

      assert.strictEqual(
        sheet.style.getPropertyValue("--video-shorts-comments-sheet-stable-top"),
        stableTop,
        "later keyboard viewport events do not rewrite the captured top",
      );
      assert.strictEqual(
        sheet.style.getPropertyValue(
          "--video-shorts-comments-sheet-stable-height",
        ),
        stableHeight,
        "later keyboard viewport events do not rewrite the captured height",
      );

      await click(
        `${replyEditorSelector()} [data-video-shorts-reply-cancel]`,
      );
      await click('[data-video-shorts-top-level-composer-entry]');
      document
        .querySelector(`${replyEditorSelector()} [data-video-shorts-reply-input]`)
        .focus();
      visualViewport.dispatchEvent(new Event("resize"));
      await new Promise((resolve) => requestAnimationFrame(resolve));

      assert.strictEqual(
        sheet.style.getPropertyValue("--video-shorts-comments-sheet-stable-top"),
        stableTop,
        "cancel and refocus preserve the original top lock",
      );
      assert.strictEqual(
        sheet.style.getPropertyValue(
          "--video-shorts-comments-sheet-stable-height",
        ),
        stableHeight,
        "cancel and refocus preserve the original height lock",
      );
    } finally {
      window.matchMedia = originalMatchMedia;

      if (originalVisualViewport) {
        Object.defineProperty(window, "visualViewport", originalVisualViewport);
      } else {
        delete window.visualViewport;
      }
    }
  });

  test("bounds invalid sheet geometry retries and cancels the queued frame on teardown", async function (assert) {
    class FakeVisualViewport extends EventTarget {
      height = window.innerHeight;
      offsetTop = 0;
    }

    const originalRequestAnimationFrame = window.requestAnimationFrame;
    const originalCancelAnimationFrame = window.cancelAnimationFrame;
    const originalVisualViewport = Object.getOwnPropertyDescriptor(
      window,
      "visualViewport",
    );
    const originalMatchMedia = window.matchMedia;
    const queuedFrames = new Map();
    const canceledFrames = [];
    const visualViewport = new FakeVisualViewport();
    const mobileLayoutQuery = new EventTarget();
    let nextFrameId = 1;
    let callbackRuns = 0;

    mobileLayoutQuery.matches = false;
    mobileLayoutQuery.media = "(min-width: 1024px)";

    window.matchMedia = (query) =>
      query === mobileLayoutQuery.media
        ? mobileLayoutQuery
        : originalMatchMedia.call(window, query);

    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: visualViewport,
    });

    try {
      setupPretender((server, helper) => {
        server.get("/videos.json", () =>
          helper.response({
            items: [feedItem(133, "Invalid sheet geometry clip")],
            next_cursor: null,
            scan_limit_reached: false,
          }),
        );

        server.get("/posts/133/replies.json", () => helper.response([]));
      });

      await visit("/videos");
      await click("[data-action='open-comments']");

      await waitUntil(() =>
        document.querySelector(".video-shorts-comments-sheet"),
      );
      const sheet = document.querySelector(".video-shorts-comments-sheet");
      const container = sheet.querySelector(".d-modal__container");
      await waitUntil(
        () =>
          sheet.style.getPropertyValue(
            "--video-shorts-comments-sheet-stable-height",
          ) !== "",
      );

      const originalGetBoundingClientRect =
        container.getBoundingClientRect.bind(container);
      const validRect = originalGetBoundingClientRect();

      window.requestAnimationFrame = (callback) => {
        const id = nextFrameId++;
        queuedFrames.set(id, callback);
        return id;
      };
      window.cancelAnimationFrame = (id) => {
        canceledFrames.push(id);
        queuedFrames.delete(id);
      };
      container.getBoundingClientRect = () => ({
        bottom: 0,
        height: 0,
        left: 0,
        right: 0,
        top: 0,
        width: 0,
        x: 0,
        y: 0,
        toJSON() {
          return {};
        },
      });
      sheet.style.removeProperty("--video-shorts-comments-sheet-stable-top");
      sheet.style.removeProperty("--video-shorts-comments-sheet-stable-height");
      sheet.style.removeProperty("--video-shorts-comments-sheet-captured-top");
      sheet.style.removeProperty(
        "--video-shorts-comments-sheet-captured-height",
      );

      window.dispatchEvent(new Event("resize"));
      assert.strictEqual(
        queuedFrames.size,
        1,
        "invalid geometry schedules one bounded retry chain",
      );

      for (let index = 0; index < 13; index += 1) {
        const [id, callback] = queuedFrames.entries().next().value || [];
        if (!callback) {
          break;
        }

        queuedFrames.delete(id);
        callbackRuns += 1;
        callback(performance.now());
      }

      assert.true(
        callbackRuns <= 12,
        "invalid geometry stops retrying within the finite frame budget",
      );
      assert.strictEqual(
        queuedFrames.size,
        0,
        "invalid geometry leaves no perpetual animation frame queued",
      );

      container.getBoundingClientRect = originalGetBoundingClientRect;
      visualViewport.dispatchEvent(new Event("resize"));
      const resumedFrameId = queuedFrames.keys().next().value;
      assert.notStrictEqual(
        resumedFrameId,
        undefined,
        "a later visual viewport event can schedule a fresh geometry check",
      );

      const resumedCallback = queuedFrames.get(resumedFrameId);
      queuedFrames.delete(resumedFrameId);
      resumedCallback(performance.now());

      const lockedTop = sheet.style.getPropertyValue(
        "--video-shorts-comments-sheet-stable-top",
      );
      const lockedHeight = sheet.style.getPropertyValue(
        "--video-shorts-comments-sheet-stable-height",
      );

      assert.strictEqual(
        lockedTop,
        `${validRect.top}px`,
        "an external event locks the valid sheet top after retries were exhausted",
      );
      assert.strictEqual(
        lockedHeight,
        `${validRect.height}px`,
        "an external event locks the valid sheet height after retries were exhausted",
      );
      assert.strictEqual(
        queuedFrames.size,
        0,
        "a successful lock ends the restarted retry chain",
      );

      window.dispatchEvent(new Event("resize"));
      sheet.dispatchEvent(new Event("focusin", { bubbles: true }));
      visualViewport.dispatchEvent(new Event("scroll"));
      const lockedFrameId = queuedFrames.keys().next().value;
      const lockedCallback = queuedFrames.get(lockedFrameId);
      queuedFrames.delete(lockedFrameId);
      lockedCallback(performance.now());

      assert.strictEqual(
        sheet.style.getPropertyValue("--video-shorts-comments-sheet-stable-top"),
        lockedTop,
        "later external events do not rewrite a successful top lock",
      );
      assert.strictEqual(
        sheet.style.getPropertyValue(
          "--video-shorts-comments-sheet-stable-height",
        ),
        lockedHeight,
        "later external events do not rewrite a successful height lock",
      );

      container.getBoundingClientRect = () => ({
        bottom: 0,
        height: 0,
        left: 0,
        right: 0,
        top: 0,
        width: 0,
        x: 0,
        y: 0,
        toJSON() {
          return {};
        },
      });
      sheet.style.removeProperty("--video-shorts-comments-sheet-stable-top");
      sheet.style.removeProperty("--video-shorts-comments-sheet-stable-height");
      sheet.style.removeProperty("--video-shorts-comments-sheet-captured-top");
      sheet.style.removeProperty(
        "--video-shorts-comments-sheet-captured-height",
      );
      sheet.dispatchEvent(new Event("focusin", { bubbles: true }));
      const queuedRetryId = queuedFrames.keys().next().value;

      document.querySelector(".video-shorts-comments-sheet .modal-close").click();
      await waitUntil(
        () => !document.querySelector(".video-shorts-comments-sheet"),
      );

      assert.true(
        canceledFrames.includes(queuedRetryId),
        "teardown cancels the outstanding geometry retry frame",
      );
      assert.false(
        queuedFrames.has(queuedRetryId),
        "the canceled teardown frame cannot run after modal destruction",
      );

      container.getBoundingClientRect = originalGetBoundingClientRect;
    } finally {
      window.requestAnimationFrame = originalRequestAnimationFrame;
      window.cancelAnimationFrame = originalCancelAnimationFrame;
      window.matchMedia = originalMatchMedia;

      if (originalVisualViewport) {
        Object.defineProperty(window, "visualViewport", originalVisualViewport);
      } else {
        delete window.visualViewport;
      }
    }
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
    assert.dom(".video-shorts-comments-panel").exists();
    assert.dom(".cooked").includesText("Visible to anonymous users");
    assert.dom("#reply-control.open").doesNotExist();
    assert.dom(`${nativePostSelector(216)} .post-menu-area`).exists();
  });

  test("comment report opens native anonymous flag modal without leaving /videos", async function (assert) {
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

    const shownModals = [];
    const modal = this.owner.lookup("service:modal");
    const originalShow = modal.show;

    modal.show = (component, options) => {
      shownModals.push({ component, model: options?.model });
    };

    try {
      await visit("/videos");
      await click("[data-action='open-comments']");
      await revealNativePostActions(215);
      await click(nativePostActionSelector(215, "flag"));
    } finally {
      modal.show = originalShow;
    }

    assert.strictEqual(shownModals.length, 1);
    assert.strictEqual(shownModals[0].component, AnonymousFlagModal);
    assert.strictEqual(String(shownModals[0].model.flagModel.id), "215");
    assert.strictEqual(currentURL(), "/videos");
  });
});
