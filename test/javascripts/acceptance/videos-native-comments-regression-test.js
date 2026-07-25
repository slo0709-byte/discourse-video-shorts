import { click, settled, visit } from "@ember/test-helpers";
import { test } from "qunit";
import { cloneJSON } from "discourse/lib/object";
import topicFixtures from "discourse/tests/fixtures/topic";
import pretender, {
  pretenderHelpers,
} from "discourse/tests/helpers/create-pretender";
import {
  acceptance,
  publishToMessageBus,
} from "discourse/tests/helpers/qunit-helpers";

const COMMENTS_SELECTOR =
  ".video-shorts-comments-panel, .video-shorts-comments-sheet, .video-shorts-comments-surface";

function feedItem(id, replyCount = -1) {
  return {
    topic_id: id,
    post_id: id,
    post_number: 1,
    topic_url: `/t/native-regression-${id}/${id}`,
    post_url: `/t/native-regression-${id}/${id}/1`,
    title: `Native comments regression ${id}`,
    excerpt: `Excerpt ${id}`,
    user_id: id,
    username: "video-author",
    avatar_template: "/user_avatar/localhost/video-author/{size}/1_2.png",
    created_at: "2026-07-01T00:00:00.000Z",
    message_bus_last_id: id * 1000,
    counts: {
      like_count: 0,
      reply_count: replyCount,
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
      share_url: `/t/native-regression-${id}/${id}/1`,
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

function comment(id, topicId, cooked) {
  return {
    id,
    post_id: id,
    post_number: id - topicId + 1,
    topic_id: topicId,
    user_id: id,
    username: `comment-author-${id}`,
    avatar_template: "/user_avatar/localhost/comment-author/{size}/1_2.png",
    cooked,
    raw: cooked.replace(/<[^>]*>/g, ""),
    created_at: "2026-07-02T00:00:00.000Z",
    reply_count: 0,
    reply_to_post_number: 1,
    can_edit: false,
    can_delete: false,
    can_flag: false,
    post_url: `/t/native-regression-${topicId}/${topicId}/${id - topicId + 1}`,
  };
}

function setupServer(callback) {
  const helper = pretenderHelpers();

  pretender.get("/video-shorts/comments/count.json", () =>
    helper.response({ count: -1 }),
  );
  callback(pretender, helper);
}

function topicCallbacks(topicId) {
  return window.MessageBus.callbacks.filter(
    ({ channel }) => channel === `/topic/${topicId}`,
  );
}

acceptance("Video Shorts native comments regression", function (needs) {
  needs.settings({
    nested_replies_enabled: true,
    video_shorts_enabled: true,
  });
  needs.user();

  test("comments stay lazy while the panel preserves its scroll and playback shell", async function (assert) {
    let repliesRequests = 0;
    const item = feedItem(910);
    item.comments_endpoint = "/video-shorts/comments/direct.json";

    setupServer((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [item],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );
      server.get("/video-shorts/comments/direct.json", () => {
        repliesRequests += 1;
        return helper.response({
          posts: [comment(911, 910, "<p>One bounded comment</p>")],
          has_more: false,
          next_after: 2,
        });
      });
    });

    await visit("/videos");

    assert.strictEqual(
      repliesRequests,
      0,
      "closed comments do not fetch replies",
    );
    assert.dom(COMMENTS_SELECTOR).doesNotExist();
    assert
      .dom(".video-shorts-native-player__video")
      .hasAttribute("controls");
    assert
      .dom(".video-shorts-action-rail [data-action='open-comments']")
      .exists("the action rail remains reachable before comments open");

    await click("[data-action='open-comments']");

    assert.strictEqual(
      repliesRequests,
      1,
      "opening performs exactly one bounded replies request",
    );
    assert.dom(".video-shorts-comments-panel").includesText("One bounded comment");

    const panelBody = document.querySelector(
      ".video-shorts-comments-panel__body",
    );
    const surface = document.querySelector(".video-shorts-comments-surface");
    const commentsBody = document.querySelector(
      "[data-video-shorts-youtube-thread-list]",
    );
    const scrollOwners = [panelBody, surface, commentsBody]
      .filter(Boolean)
      .filter((element) =>
        ["auto", "scroll"].includes(getComputedStyle(element).overflowY),
      );

    assert.deepEqual(
      scrollOwners,
      [commentsBody],
      "the comments body is the panel's single vertical scroll owner",
    );
    assert.strictEqual(
      getComputedStyle(panelBody).overflowY,
      "hidden",
      "the stable panel shell does not compete for scrolling",
    );
    assert
      .dom(".video-shorts-native-player__video")
      .hasAttribute("controls");
    assert
      .dom(".video-shorts-action-rail [data-action='open-comments']")
      .exists("comments do not cover or remove the action rail");
  });

  test("close and reopen discard stale realtime work and keep one active subscriber", async function (assert) {
    const topicId = 920;
    let repliesRequests = 0;
    let canonicalRequests = 0;

    setupServer((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [feedItem(topicId)],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );
      server.get(`/posts/${topicId}/replies.json`, () => {
        repliesRequests += 1;
        return helper.response([
          comment(921, topicId, "<p>Initial comment</p>"),
        ]);
      });
      server.get("/posts/:post_id.json", (request) => {
        canonicalRequests += 1;
        const postId = Number(request.params.post_id);
        return helper.response(
          comment(postId, topicId, "<p>Realtime comment</p>"),
        );
      });
    });

    await visit("/videos");
    const baselineCallbacks = topicCallbacks(topicId);
    await click("[data-action='open-comments']");

    assert.strictEqual(repliesRequests, 1, "the first open loads once");
    assert.strictEqual(
      topicCallbacks(topicId).length,
      baselineCallbacks.length + 1,
      "the open surface adds one realtime subscription",
    );

    const surfaceCallback = topicCallbacks(topicId).find(
      (callback) => !baselineCallbacks.includes(callback),
    );
    const staleCallback = surfaceCallback.func;
    await click("[data-action='close-comments']");

    assert.strictEqual(
      topicCallbacks(topicId).length,
      baselineCallbacks.length,
      "closing removes only the surface subscription",
    );
    await staleCallback({ type: "created", id: 922 }, 92001, 1);
    await settled();
    assert.strictEqual(
      canonicalRequests,
      0,
      "a stale callback cannot apply work after close",
    );

    await click("[data-action='open-comments']");

    assert.strictEqual(repliesRequests, 2, "reopening creates one fresh surface");
    assert.strictEqual(
      topicCallbacks(topicId).length,
      baselineCallbacks.length + 1,
      "reopening leaves exactly one active subscriber",
    );
    assert
      .dom('.video-shorts-comments-surface__comment[data-post-id="921"]')
      .exists({ count: 1 }, "the initial row is not duplicated on reopen");
    assert
      .dom('.video-shorts-comments-surface__comment[data-post-id="922"]')
      .doesNotExist("stale work did not leak");

    await publishToMessageBus(
      `/topic/${topicId}`,
      { type: "created", id: 923 },
      92002,
      2,
    );
    await publishToMessageBus(
      `/topic/${topicId}`,
      { type: "created", id: 923 },
      92002,
      2,
    );

    assert.strictEqual(
      canonicalRequests,
      1,
      "duplicate realtime input causes one canonical application fetch",
    );
    assert.true(
      document.querySelectorAll(
        '.video-shorts-comments-surface__comment[data-post-id="923"]',
      ).length <= 1,
      "duplicate realtime input cannot render duplicate rows",
    );
  });

  test("ordinary and nested topic routes do not inherit comments DOM or route state", async function (assert) {
    setupServer((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [feedItem(930)],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );
      server.get("/posts/930/replies.json", () => helper.response([]));

      const flatTopic = cloneJSON(topicFixtures["/t/280/1.json"]);
      server.get("/n/-/280.json", () =>
        helper.response({
          topic: flatTopic,
          op_post: flatTopic.post_stream.posts[0],
          roots: [],
          page: 0,
          has_more_roots: false,
          sort: "top",
          message_bus_last_id: -1,
          pinned_post_ids: [],
        }),
      );
    });

    await visit("/videos");
    await click("[data-action='open-comments']");
    assert.dom(".video-shorts-comments-panel").exists();

    await visit("/t/internationalization-localization/280");

    assert.dom(".post-stream").exists("the ordinary topic keeps its post stream");
    assert.dom(COMMENTS_SELECTOR).doesNotExist();
    assert
      .dom(document.body)
      .doesNotHaveClass(
        "video-shorts-route",
        "ordinary topics do not inherit the videos route style scope",
      );

    await visit("/n/-/280");

    assert.dom(".nested-view").exists("the core nested route fixture renders");
    assert.dom(COMMENTS_SELECTOR).doesNotExist();
    assert
      .dom(document.body)
      .doesNotHaveClass(
        "video-shorts-route",
        "nested topics do not inherit the videos route style scope",
      );
  });

  test("opening video comments does not mutate canonical Topic and Post store identities", async function (assert) {
    const topicId = 940;
    const commentId = 941;
    const store = this.owner.lookup("service:store");
    const canonicalTopic = store.createRecord("topic", {
      id: topicId,
      title: "Canonical topic title",
      category_id: 12,
      posters: [],
      details: {
        id: topicId,
        can_create_post: true,
        can_edit_staff_notes: true,
        participants: [],
      },
    });
    const canonicalPost = store.createRecord("post", {
      id: commentId,
      topic_id: topicId,
      topic: canonicalTopic,
      post_number: 2,
      cooked: "<p>Canonical topic comment</p>",
      reply_count: 7,
      can_edit: true,
    });

    setupServer((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [feedItem(topicId, 1)],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );
      server.get(`/posts/${topicId}/replies.json`, () =>
        helper.response([
          {
            ...comment(commentId, topicId, "<p>Video panel comment</p>"),
            reply_count: 1,
          },
        ]),
      );
    });

    await visit("/videos");
    await click("[data-action='open-comments']");

    assert.strictEqual(canonicalTopic.title, "Canonical topic title");
    assert.strictEqual(canonicalTopic.category_id, 12);
    assert.true(canonicalTopic.details.can_edit_staff_notes);
    assert.strictEqual(canonicalPost.topic, canonicalTopic);
    assert.strictEqual(canonicalPost.cooked, "<p>Canonical topic comment</p>");
    assert.strictEqual(canonicalPost.reply_count, 7);
    assert.true(canonicalPost.can_edit);
  });
});
