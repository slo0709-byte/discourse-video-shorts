import { click, settled, visit, waitUntil } from "@ember/test-helpers";
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
    reply_to_post_number: attrs.reply_to_post_number || 1,
    username,
    avatar_template: `/user_avatar/localhost/${username}/{size}/1_2.png`,
    cooked,
    raw: cooked.replace(/<[^>]*>/g, ""),
    created_at: "2026-06-08T12:00:00.000Z",
    updated_at: "2026-06-08T12:00:00.000Z",
    reply_count: 0,
    can_edit: false,
    can_delete: false,
    can_flag: false,
    ...attrs,
  };
}

function snapshot(sourcePostId, comments, cursor, count = comments.length) {
  return {
    schema_version: 1,
    snapshot_at: "2026-06-08T12:00:00.000Z",
    source_post_id: sourcePostId,
    comments,
    next_cursor: null,
    has_more: false,
    visible_reply_count: count,
    change_cursor: cursor,
    authorization_lease: {
      token: `lease-${sourcePostId}`,
      source_post_id: sourcePostId,
      expires_at: LEASE_EXPIRY,
    },
  };
}

function installCurrentApi(
  server,
  helper,
  { sourcePostId, title, snapshots, deltas, revokeAfter = null },
) {
  let snapshotRequests = 0;
  let deltaRequests = 0;
  let leaseRequests = 0;

  server.get("/videos.json", () =>
    helper.response({
      items: [feedItem(sourcePostId, title, snapshots[0].visible_reply_count)],
      next_cursor: null,
      scan_limit_reached: false,
    }),
  );
  server.get("/videos/policy.json", () =>
    helper.response({
      revision: 1,
      external_media_enabled: false,
      origins: [],
      generated_at: "2026-06-08T12:00:00.000Z",
    }),
  );
  server.get(`/videos/posts/${sourcePostId}/comments.json`, () => {
    let body = snapshots[Math.min(snapshotRequests, snapshots.length - 1)];
    snapshotRequests += 1;
    return body.status
      ? helper.response(body.status, body.body)
      : helper.response(body);
  });
  server.get(`/videos/posts/${sourcePostId}/comments/delta.json`, () => {
    let body = deltas[Math.min(deltaRequests, deltas.length - 1)];
    deltaRequests += 1;
    return body.status
      ? helper.response(body.status, body.body)
      : helper.response(body);
  });
  server.post("/videos/authorization-leases.json", () => {
    leaseRequests += 1;
    return revokeAfter && leaseRequests >= revokeAfter
      ? helper.response(403, { error: "forbidden" })
      : helper.response({
          leases: [
            {
              token: `lease-${sourcePostId}`,
              source_post_id: sourcePostId,
              expires_at: LEASE_EXPIRY,
            },
          ],
        });
  });

  return {
    get snapshotRequests() {
      return snapshotRequests;
    },
    get deltaRequests() {
      return deltaRequests;
    },
    get leaseRequests() {
      return leaseRequests;
    },
  };
}

acceptance("Video Shorts comments sheet", function (needs) {
  needs.settings({ video_shorts_enabled: true });
  needs.user();
  needs.mobileView();

  test("opens an empty snapshot with the current policy, lease, and snapshot contracts", async function (assert) {
    let api;
    ((server, helper) => {
      api = installCurrentApi(server, helper, {
        sourcePostId: 101,
        title: "Empty comments",
        snapshots: [snapshot(101, [], "cursor-0", 0)],
        deltas: [
          {
            changes: [],
            next_change_cursor: "cursor-0",
            has_more: false,
            visible_reply_count: 0,
          },
        ],
      });
    })(pretender, pretenderHelpers());

    await visit("/videos");
    await click("[data-action='open-comments']");

    assert.dom(".video-shorts-comments-sheet").exists();
    assert.dom(".video-shorts-comments-surface__comment").doesNotExist();
    assert.strictEqual(api.snapshotRequests, 1);
    assert.strictEqual(api.leaseRequests, 1);
    await click(".modal-close");
  });

  test("uses flat descendant snapshots and create, edit, and delete deltas", async function (assert) {
    let root = comment(201, "parent", "<p>Parent</p>", { post_number: 2 });
    let existingChild = comment(
      202,
      "existing-child",
      "<p>Snapshot child</p>",
      {
        post_number: 3,
        reply_to_post_number: 2,
      },
    );
    let child = comment(203, "child", "<p>Created child</p>", {
      post_number: 4,
      reply_to_post_number: 2,
    });
    let edited = {
      ...root,
      cooked: "<p>Edited parent</p>",
      raw: "Edited parent",
    };
    let api;
    let handlers = new Map();
    let messageBus = this.owner.lookup("service:message-bus");
    let originalSubscribe = messageBus.subscribe;
    let originalUnsubscribe = messageBus.unsubscribe;
    messageBus.subscribe = (channel, callback) =>
      handlers.set(channel, callback);
    messageBus.unsubscribe = (channel, callback) => {
      if (handlers.get(channel) === callback) {
        handlers.delete(channel);
      }
    };
    try {
      ((server, helper) => {
        api = installCurrentApi(server, helper, {
          sourcePostId: 102,
          title: "Delta comments",
          snapshots: [snapshot(102, [root, existingChild], "cursor-0", 2)],
          deltas: [
            {
              changes: [
                {
                  sequence: 1,
                  changed_post_id: 203,
                  operation: "create",
                  changed_at: "2026-06-08T12:00:01.000Z",
                  comment: child,
                },
              ],
              next_change_cursor: "cursor-1",
              has_more: false,
              visible_reply_count: 3,
            },
            {
              changes: [
                {
                  sequence: 2,
                  changed_post_id: 201,
                  operation: "edit",
                  changed_at: "2026-06-08T12:00:02.000Z",
                  comment: edited,
                },
              ],
              next_change_cursor: "cursor-2",
              has_more: false,
              visible_reply_count: 3,
            },
            {
              changes: [
                {
                  sequence: 3,
                  changed_post_id: 203,
                  operation: "delete",
                  changed_at: "2026-06-08T12:00:03.000Z",
                  tombstone: { id: 203 },
                },
              ],
              next_change_cursor: "cursor-3",
              has_more: false,
              visible_reply_count: 2,
            },
          ],
        });
      })(pretender, pretenderHelpers());

      await visit("/videos");
      await click("[data-action='open-comments']");
      assert.dom('[data-post-id="202"]').includesText("Snapshot child");

      await waitUntil(() => api.deltaRequests === 1);
      assert.dom('[data-post-id="203"]').includesText("Created child");

      handlers.get("/video-shorts/comments/102")({
        source_post_id: 102,
        change_sequence: 2,
      });
      await waitUntil(() => api.deltaRequests === 2);
      assert.dom('[data-post-id="201"]').includesText("Edited parent");

      handlers.get("/video-shorts/comments/102")({
        source_post_id: 102,
        change_sequence: 3,
      });
      await waitUntil(() => api.deltaRequests === 3);
      assert.dom('[data-post-id="203"]').doesNotExist();
      await click(".modal-close");
      assert.false(handlers.has("/video-shorts/comments/102"));
    } finally {
      messageBus.subscribe = originalSubscribe;
      messageBus.unsubscribe = originalUnsubscribe;
    }
  });

  test("reconciles an expired delta after reconnect and closes on a revoked lease", async function (assert) {
    let initial = comment(301, "first", "<p>First</p>", { post_number: 2 });
    let reconciled = comment(
      302,
      "reconnected",
      "<p>Recovered after reconnect</p>",
      { post_number: 3 },
    );
    let api;
    let handlers = new Map();
    let messageBus = this.owner.lookup("service:message-bus");
    let originalSubscribe = messageBus.subscribe;
    let originalUnsubscribe = messageBus.unsubscribe;
    messageBus.subscribe = (channel, callback) =>
      handlers.set(channel, callback);
    messageBus.unsubscribe = (channel, callback) => {
      if (handlers.get(channel) === callback) {
        handlers.delete(channel);
      }
    };
    try {
      ((server, helper) => {
        api = installCurrentApi(server, helper, {
          sourcePostId: 103,
          title: "Reconnect and revocation",
          snapshots: [
            snapshot(103, [initial], "cursor-0", 1),
            snapshot(103, [initial, reconciled], "cursor-2", 2),
          ],
          deltas: [
            {
              changes: [],
              next_change_cursor: "cursor-0",
              has_more: false,
              visible_reply_count: 1,
            },
            { status: 409, body: { error: "delta_expired" } },
          ],
          revokeAfter: 3,
        });
      })(pretender, pretenderHelpers());

      await visit("/videos");
      await click("[data-action='open-comments']");
      window.dispatchEvent(new Event("online"));
      await waitUntil(() => api.snapshotRequests >= 2);
      await waitUntil(() => document.querySelector('[data-post-id="302"]'));
      assert
        .dom('[data-post-id="302"]')
        .includesText("Recovered after reconnect");

      window.dispatchEvent(new Event("focus"));
      await waitUntil(() => api.leaseRequests >= 3);
      await waitUntil(
        () => !document.querySelector(".video-shorts-comments-sheet"),
      );
      assert.dom(".video-shorts-comments-sheet").doesNotExist();
      assert.false(handlers.has("/video-shorts/comments/103"));
      await settled();
    } finally {
      messageBus.subscribe = originalSubscribe;
      messageBus.unsubscribe = originalUnsubscribe;
    }
  });
  test("closes and clears comments when expired-delta reconciliation is revoked", async function (assert) {
    let initial = comment(401, "private", "<p>Sensitive comment</p>", {
      post_number: 2,
    });
    let handlers = new Map();
    let messageBus = this.owner.lookup("service:message-bus");
    let originalSubscribe = messageBus.subscribe;
    let originalUnsubscribe = messageBus.unsubscribe;
    messageBus.subscribe = (channel, callback) =>
      handlers.set(channel, callback);
    messageBus.unsubscribe = (channel, callback) => {
      if (handlers.get(channel) === callback) {
        handlers.delete(channel);
      }
    };

    try {
      let api;
      ((server, helper) => {
        api = installCurrentApi(server, helper, {
          sourcePostId: 104,
          title: "Revoked reconciliation",
          snapshots: [
            snapshot(104, [initial], "cursor-0", 1),
            { status: 403, body: { error: "forbidden" } },
          ],
          deltas: [
            {
              changes: [],
              next_change_cursor: "cursor-0",
              has_more: false,
              visible_reply_count: 1,
            },
            { status: 409, body: { error: "delta_expired" } },
          ],
        });
      })(pretender, pretenderHelpers());

      await visit("/videos");
      await click("[data-action='open-comments']");
      assert.dom('[data-post-id="401"]').includesText("Sensitive comment");

      window.dispatchEvent(new Event("online"));
      await waitUntil(() => api.snapshotRequests >= 2);
      await waitUntil(
        () => !document.querySelector(".video-shorts-comments-sheet"),
      );

      assert.dom(".video-shorts-comments-sheet").doesNotExist();
      assert.dom('[data-post-id="401"]').doesNotExist();
      assert.false(handlers.has("/video-shorts/comments/104"));
    } finally {
      messageBus.subscribe = originalSubscribe;
      messageBus.unsubscribe = originalUnsubscribe;
    }
  });
  test("late comment snapshots cannot restore data after authorization revocation", async function (assert) {
    const sourcePostId = 105;
    const lateSnapshot = Promise.withResolvers();
    const messageBus = this.owner.lookup("service:message-bus");
    const originalSubscribe = messageBus.subscribe;
    const originalUnsubscribe = messageBus.unsubscribe;
    messageBus.subscribe = () => {};
    messageBus.unsubscribe = () => {};

    try {
      ((server, helper) => {
        server.get("/videos.json", () =>
          helper.response({
            items: [feedItem(sourcePostId, "Late revoked snapshot", 1)],
            next_cursor: null,
            scan_limit_reached: false,
          }),
        );
        server.get("/videos/policy.json", () =>
          helper.response({
            revision: 1,
            external_media_enabled: false,
            origins: [],
            generated_at: "2026-06-08T12:00:00.000Z",
          }),
        );
        server.get(
          `/videos/posts/${sourcePostId}/comments.json`,
          () =>
            lateSnapshot.promise.then((payload) => helper.response(payload)),
        );
        server.get(
          `/videos/posts/${sourcePostId}/comments/delta.json`,
          () =>
            helper.response({
              changes: [],
              next_change_cursor: "late-cursor",
              has_more: false,
              visible_reply_count: 0,
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
      })(pretender, pretenderHelpers());

      await visit("/videos");
      document.querySelector("[data-action='open-comments']").click();

      const leases = this.owner.lookup(
        "service:video-shorts-authorization-lease",
      );
      await waitUntil(() => leases.activeSourceIds.has(sourcePostId));
      leases.revoke();
      await waitUntil(
        () => !document.querySelector(".video-shorts-comments-sheet"),
      );

      lateSnapshot.resolve(
        snapshot(
          sourcePostId,
          [comment(501, "private", "<p>Late sensitive comment</p>")],
          "late-cursor",
          1,
        ),
      );
      await settled();

      assert.dom(".video-shorts-comments-sheet").doesNotExist();
      assert.dom('[data-post-id="501"]').doesNotExist();
    } finally {
      messageBus.subscribe = originalSubscribe;
      messageBus.unsubscribe = originalUnsubscribe;
    }
  });
});
