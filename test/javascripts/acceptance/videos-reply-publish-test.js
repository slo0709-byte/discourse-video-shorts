import { click, currentURL, fillIn, visit } from "@ember/test-helpers";
import { test } from "qunit";
import pretender, {
  pretenderHelpers,
} from "discourse/tests/helpers/create-pretender";
import { acceptance } from "discourse/tests/helpers/qunit-helpers";

const LEASE_EXPIRY = "2035-01-01T00:00:00.000Z";

function feedItem(id, title, replyCount = 0) {
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
    counts: { like_count: 0, reply_count: replyCount, bookmark_count: 0 },
    actions: {
      can_reply: true,
      can_like: true,
      can_bookmark: true,
      can_flag: true,
    },
    native_action_summary: [{ id: 2, can_act: true }],
    media: {
      kind: "upload_mp4",
      identity: `v1:upload:${id}:fixture`,
      url: `/uploads/default/original/1X/video-${id}.mp4`,
      required_origins: [],
      policy_revision: null,
      fallback_reason: null,
    },
  };
}

function comment(id, username, cooked, attrs = {}) {
  return {
    id,
    post_id: id,
    post_number: attrs.post_number || 2,
    user_id: id,
    username,
    avatar_template: `/user_avatar/localhost/${username}/{size}/1_2.png`,
    cooked,
    raw: cooked.replace(/<[^>]*>/g, ""),
    created_at: "2026-06-08T00:00:00.000Z",
    updated_at: "2026-06-08T00:00:00.000Z",
    reply_count: 0,
    reply_to_post_number: attrs.reply_to_post_number || 1,
    reply_to_username: attrs.reply_to_username || null,
    can_edit: false,
    can_delete: false,
    can_flag: false,
    ...attrs,
  };
}

function installCurrentApi(
  server,
  helper,
  sourcePostId,
  comments,
  postRequests,
) {
  server.get("/videos.json", () =>
    helper.response({
      items: [feedItem(sourcePostId, "In-context reply", comments.length)],
      next_cursor: null,
      scan_limit_reached: false,
    }),
  );
  server.get("/videos/policy.json", () =>
    helper.response({
      revision: 1,
      external_media_enabled: false,
      origins: [],
      generated_at: "2026-06-08T00:00:00.000Z",
    }),
  );
  server.get(`/videos/posts/${sourcePostId}/comments.json`, () =>
    helper.response({
      schema_version: 1,
      snapshot_at: "2026-06-08T00:00:00.000Z",
      source_post_id: sourcePostId,
      comments,
      next_cursor: null,
      has_more: false,
      visible_reply_count: comments.length,
      change_cursor: "cursor-0",
      authorization_lease: {
        token: `lease-${sourcePostId}`,
        source_post_id: sourcePostId,
        expires_at: LEASE_EXPIRY,
      },
    }),
  );
  server.get(`/videos/posts/${sourcePostId}/comments/delta.json`, () =>
    helper.response({
      changes: [],
      next_change_cursor: "cursor-0",
      has_more: false,
      visible_reply_count: comments.length,
    }),
  );
  server.post("/videos/authorization-leases.json", () =>
    helper.response({
      leases: [
        {
          token: `lease-${sourcePostId}`,
          source_post_id: sourcePostId,
          expires_at: LEASE_EXPIRY,
        },
      ],
    }),
  );
  server.post("/posts.json", (request) => {
    let params = new URLSearchParams(request.requestBody);
    postRequests.push(params);
    let replyToPostNumber = Number(params.get("reply_to_post_number"));
    return helper.response(
      comment(
        900 + postRequests.length,
        "admin_user",
        `<p>${params.get("raw")}</p>`,
        {
          post_number: comments.length + postRequests.length + 1,
          reply_to_post_number: replyToPostNumber,
          reply_to_username: replyToPostNumber === 1 ? null : "parent-author",
        },
      ),
    );
  });
}

acceptance("Video Shorts in-context reply publishing", function (needs) {
  needs.settings({ video_shorts_enabled: true });
  needs.user();
  needs.mobileView();

  test("publishes a top-level reply through native Discourse post writes", async function (assert) {
    let postRequests = [];
    ((server, helper) =>
      installCurrentApi(server, helper, 501, [], postRequests))(
      pretender,
      pretenderHelpers(),
    );

    await visit("/videos");
    let beforeURL = currentURL();
    await click("[data-action='open-comments']");
    await fillIn("[data-video-shorts-reply-input]", "Inline top reply");
    await click("[data-action='publish-reply']");

    assert.strictEqual(postRequests.length, 1);
    assert.strictEqual(postRequests[0].get("topic_id"), "501");
    assert.strictEqual(postRequests[0].get("raw"), "Inline top reply");
    assert.strictEqual(postRequests[0].get("reply_to_post_number"), "1");
    assert.strictEqual(currentURL(), beforeURL);
    assert.dom('[data-post-id="901"]').includesText("Inline top reply");
    assert.dom("#reply-control.open").doesNotExist();
    await click(".modal-close");
  });

  test("publishes a selected comment reply without synthesizing a mention", async function (assert) {
    let parent = comment(602, "parent-author", "<p>Parent comment</p>", {
      post_number: 2,
    });
    let postRequests = [];
    ((server, helper) =>
      installCurrentApi(server, helper, 502, [parent], postRequests))(
      pretender,
      pretenderHelpers(),
    );

    await visit("/videos");
    await click("[data-action='open-comments']");
    await click('[data-post-id="602"] [data-action="reply-to-comment"]');
    await fillIn("[data-video-shorts-comment-reply-input]", "Inline child");
    await click("[data-action='publish-comment-reply']");

    assert.strictEqual(postRequests.length, 1);
    assert.strictEqual(postRequests[0].get("topic_id"), "502");
    assert.strictEqual(postRequests[0].get("raw"), "Inline child");
    assert.strictEqual(postRequests[0].get("reply_to_post_number"), "2");
    assert.false(postRequests[0].get("raw").startsWith("@parent-author"));
    assert
      .dom('[data-post-id="901"] [data-video-shorts-reply-target]')
      .hasText("@parent-author");
    assert.dom("#reply-control.open").doesNotExist();
    await click(".modal-close");
  });
});
