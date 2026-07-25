import { getOwner } from "@ember/owner";
import { setupTest } from "ember-qunit";
import { module, test } from "qunit";
import Post from "discourse/models/post";
import { flushMap } from "discourse/services/store";
import { normalizeComment } from "discourse/plugins/discourse-video-shorts/discourse/lib/video-shorts-comments";
import { videoShortsNativePost } from "discourse/plugins/discourse-video-shorts/discourse/lib/video-shorts-native-post";
import { createVideoShortsNativeTopic } from "discourse/plugins/discourse-video-shorts/discourse/lib/video-shorts-native-topic";

function comment(overrides = {}) {
  return {
    id: 802,
    post_id: 802,
    post_number: 4,
    topic_id: 701,
    user_id: 91,
    username: "commenter",
    name: "Comment Author",
    avatar_template: "/user_avatar/localhost/commenter/{size}/1_2.png",
    cooked: "<p>Server-cooked comment</p>",
    raw: "Server-cooked comment",
    created_at: "2026-07-10T10:00:00.000Z",
    updated_at: "2026-07-10T11:00:00.000Z",
    version: 2,
    post_type: 1,
    reply_count: 3,
    reply_to_post_number: 2,
    reply_to_user: {
      id: 44,
      username: "parent-author",
      name: "Parent Author",
      avatar_template: "/user_avatar/localhost/parent-author/{size}/1_2.png",
    },
    link_counts: [{ url: "https://example.com", clicks: 1 }],
    actions_summary: [
      { id: 2, count: 7, acted: true, can_act: false, can_undo: true },
      { id: 3, count: 0, acted: false, can_act: true, can_undo: false },
    ],
    can_edit: true,
    can_delete: false,
    can_recover: true,
    can_flag: true,
    can_permanently_delete: false,
    can_see_hidden_post: true,
    can_view_edit_history: true,
    can_wiki: true,
    hidden: false,
    hidden_reason_id: null,
    yours: true,
    bookmarked: true,
    bookmark_id: 129,
    bookmark_name: "Revisit",
    bookmark_reminder_at: "2026-07-12T10:00:00.000Z",
    bookmark_auto_delete_preference: 3,
    cooked_hidden: false,
    user_deleted: false,
    moderator: false,
    admin: false,
    staff: false,
    group_moderator: false,
    wiki: true,
    locked: true,
    notice: { type: "returning_user", description: "Staff notice" },
    notice_created_by_user: {
      id: 1,
      username: "admin",
      name: "Admin",
      avatar_template: "/user_avatar/localhost/admin/{size}/1_2.png",
    },
    last_wiki_edit: "2026-07-10T10:30:00.000Z",
    trust_level: 2,
    read: true,
    edit_reason: "Typo",
    user_suspended: false,
    user_status: { emoji: "speech_balloon", description: "Available" },
    arbitrary_payload_key: "must not be copied",
    ...overrides,
  };
}

function feedItem(overrides = {}) {
  return {
    topic_id: 701,
    post_id: 700,
    post_number: 1,
    topic_url: "/t/video-topic/701/1",
    title: "Video topic",
    actions: { can_reply: true },
    ...overrides,
  };
}

module("Unit | Lib | video shorts native post", function (hooks) {
  setupTest(hooks);

  hooks.beforeEach(function () {
    this.store = getOwner(this).lookup("service:store");
    this.topic = createVideoShortsNativeTopic(feedItem(), this.store);
  });

  test("creates a native Post with the bounded core rendering contract", function (assert) {
    const loadedComment = comment();
    const item = feedItem();
    const commentSnapshot = structuredClone(loadedComment);
    const itemSnapshot = structuredClone(item);

    const post = videoShortsNativePost({
      comment: loadedComment,
      item,
      topic: this.topic,
      store: this.store,
    });

    assert.true(post instanceof Post, "the result is the core Post model");
    assert.strictEqual(post.__type, "post", "the record belongs to the store");
    assert.false(post.isNew, "the loaded comment is a created record");
    assert.strictEqual(post.id, 802);
    assert.strictEqual(post.post_number, 4);
    assert.strictEqual(post.topic_id, 701);
    assert.strictEqual(post.topic, this.topic, "the caller's Topic is reused");
    assert.strictEqual(post.username, "commenter");
    assert.strictEqual(post.name, "Comment Author");
    assert.strictEqual(post.user_id, 91);
    assert.strictEqual(
      post.avatar_template,
      "/user_avatar/localhost/commenter/{size}/1_2.png"
    );
    assert.strictEqual(post.cooked, "<p>Server-cooked comment</p>");
    assert.strictEqual(post.raw, "Server-cooked comment");
    assert.strictEqual(post.created_at, "2026-07-10T10:00:00.000Z");
    assert.strictEqual(post.updated_at, "2026-07-10T11:00:00.000Z");
    assert.strictEqual(post.version, 2);
    assert.strictEqual(post.post_type, 1);
    assert.strictEqual(post.reply_count, 3);
    assert.strictEqual(post.reply_to_post_number, 2);
    assert.strictEqual(post.reply_to_user.username, "parent-author");
    assert.deepEqual(post.link_counts, [
      { url: "https://example.com", clicks: 1 },
    ]);
    assert.true(post.can_edit);
    assert.false(post.can_delete);
    assert.true(post.can_recover);
    assert.true(post.can_flag);
    assert.false(post.can_permanently_delete);
    assert.true(post.can_see_hidden_post);
    assert.true(post.can_view_edit_history);
    assert.true(post.can_wiki);
    assert.false(post.hidden);
    assert.true(post.yours);
    assert.true(post.bookmarked);
    assert.strictEqual(post.bookmark_id, 129);
    assert.strictEqual(post.bookmark_name, "Revisit");
    assert.strictEqual(
      post.bookmark_reminder_at,
      "2026-07-12T10:00:00.000Z"
    );
    assert.strictEqual(post.bookmark_auto_delete_preference, 3);
    assert.false(post.cooked_hidden);
    assert.false(post.user_deleted);
    assert.true(post.wiki);
    assert.true(post.locked);
    assert.deepEqual(post.notice, {
      type: "returning_user",
      description: "Staff notice",
    });
    assert.strictEqual(
      post.notice_created_by_user.username,
      "admin",
      "staff notice attribution reaches core Post"
    );
    assert.strictEqual(post.last_wiki_edit, "2026-07-10T10:30:00.000Z");
    assert.strictEqual(post.trust_level, 2);
    assert.true(post.read);
    assert.strictEqual(post.edit_reason, "Typo");
    assert.false(post.user_suspended);
    assert.deepEqual(post.user_status, {
      emoji: "speech_balloon",
      description: "Available",
    });
    assert.strictEqual(post.actions_summary.length, 2);
    assert.strictEqual(post.likeAction, post.actions_summary[0]);
    assert.strictEqual(post.likeAction.count, 7);
    assert.true(post.likeAction.acted);
    assert.true(post.actions_summary[1].can_act, "flag capability is retained");
    assert.strictEqual(
      post.arbitrary_payload_key,
      undefined,
      "unrelated payload fields are not copied"
    );
    assert.deepEqual(loadedComment, commentSnapshot, "comment input is unchanged");
    assert.deepEqual(item, itemSnapshot, "feed item input is unchanged");
  });

  test("normalization preserves the bounded PostSerializer state used by core Post", function (assert) {
    const serverPost = comment();
    const normalized = normalizeComment(serverPost);

    for (const field of [
      "can_permanently_delete",
      "can_see_hidden_post",
      "can_view_edit_history",
      "can_wiki",
      "hidden",
      "hidden_reason_id",
      "yours",
      "bookmarked",
      "bookmark_id",
      "bookmark_name",
      "bookmark_reminder_at",
      "bookmark_auto_delete_preference",
      "cooked_hidden",
      "user_deleted",
      "moderator",
      "admin",
      "staff",
      "group_moderator",
      "wiki",
      "locked",
      "notice",
      "notice_created_by_user",
      "last_wiki_edit",
      "trust_level",
      "read",
      "edit_reason",
      "user_suspended",
      "user_status",
    ]) {
      assert.deepEqual(
        normalized[field],
        serverPost[field],
        `${field} survives the replies endpoint normalization boundary`
      );
    }

    assert.strictEqual(
      normalized.arbitrary_payload_key,
      undefined,
      "normalization remains an explicit allowlist"
    );
  });

  test("rejects malformed post identity before creating a record", function (assert) {
    for (const id of [undefined, null, 0, -1, 1.5, "802", NaN]) {
      assert.throws(
        () =>
          videoShortsNativePost({
            comment: comment({ id, post_id: id }),
            item: feedItem(),
            topic: this.topic,
            store: this.store,
          }),
        /comment id must be a positive integer/,
        `rejects comment id ${String(id)}`
      );
    }

    assert.throws(
      () =>
        videoShortsNativePost({
          comment: comment({ id: 802, post_id: 803 }),
          item: feedItem(),
          topic: this.topic,
          store: this.store,
        }),
      /comment id fields must match/
    );

    for (const postNumber of [undefined, null, 0, -1, 1.5, "4", NaN]) {
      assert.throws(
        () =>
          videoShortsNativePost({
            comment: comment({ post_number: postNumber }),
            item: feedItem(),
            topic: this.topic,
            store: this.store,
          }),
        /post_number must be a positive integer/,
        `rejects post_number ${String(postNumber)}`
      );
    }
  });

  test("rejects topic identity mismatches before touching the store", function (assert) {
    assert.throws(
      () =>
        videoShortsNativePost({
          comment: comment({ topic_id: 702 }),
          item: feedItem(),
          topic: this.topic,
          store: this.store,
        }),
      /comment topic_id must match feed item topic_id/
    );

    assert.throws(
      () =>
        videoShortsNativePost({
          comment: comment(),
          item: feedItem({ topic_id: 702 }),
          topic: this.topic,
          store: this.store,
        }),
      /feed item topic_id must match Topic id/
    );

    assert.throws(
      () =>
        videoShortsNativePost({
          comment: comment(),
          item: feedItem({ topic_id: "701" }),
          topic: this.topic,
          store: this.store,
        }),
      /feed item topic_id must be a positive integer/
    );
  });

  test("keeps a deleted placeholder safe when cooked data is malformed", function (assert) {
    const post = videoShortsNativePost({
      comment: comment({
        id: 804,
        post_id: 804,
        post_number: 5,
        cooked: null,
        raw: { untrusted: true },
        video_shorts_deleted_placeholder: true,
        can_edit: false,
        can_delete: false,
        can_recover: false,
        can_flag: false,
        actions_summary: null,
      }),
      item: feedItem(),
      topic: this.topic,
      store: this.store,
    });

    assert.strictEqual(post.cooked, "", "non-string cooked is never forwarded");
    assert.strictEqual(post.raw, "", "raw is not used as an HTML fallback");
    assert.true(post.deleted_post_placeholder);
    assert.deepEqual(post.actions_summary, []);
    assert.false(post.can_edit);
    assert.false(post.can_delete);
    assert.false(post.can_recover);
    assert.false(post.can_flag);
  });

  test("reuses and refreshes the store record without stale permissions", function (assert) {
    const records = new Map();
    const initialComment = comment({
      id: 806,
      post_id: 806,
      post_number: 6,
    });
    const initialSnapshot = structuredClone(initialComment);
    const first = videoShortsNativePost({
      comment: initialComment,
      item: feedItem(),
      topic: this.topic,
      store: this.store,
      records,
    });
    const revisedComment = comment({
      id: 806,
      post_id: 806,
      post_number: 6,
      cooked: "<p>Revised on the server</p>",
      raw: "Revised on the server",
      updated_at: "2026-07-10T12:00:00.000Z",
      version: 3,
      reply_count: 0,
      reply_to_post_number: null,
      reply_to_user: null,
      link_counts: [],
      actions_summary: [{ id: 3, count: 0, can_act: true }],
      can_edit: false,
      can_delete: true,
      can_recover: false,
      can_flag: true,
      can_see_hidden_post: false,
      can_view_edit_history: false,
      yours: false,
      bookmarked: false,
    });
    const revisedSnapshot = structuredClone(revisedComment);

    const second = videoShortsNativePost({
      comment: revisedComment,
      item: feedItem(),
      topic: this.topic,
      store: this.store,
      records,
    });

    assert.strictEqual(second, first, "the isolated panel map reuses the Post");
    assert.strictEqual(second.cooked, "<p>Revised on the server</p>");
    assert.strictEqual(second.version, 3);
    assert.strictEqual(second.reply_count, 0);
    assert.strictEqual(second.reply_to_post_number, null);
    assert.strictEqual(second.reply_to_user, null);
    assert.deepEqual(second.link_counts, []);
    assert.strictEqual(second.actions_summary.length, 1);
    assert.strictEqual(second.actions_summary[0].id, 3);
    assert.strictEqual(second.likeAction, null, "stale like state is cleared");
    assert.false(second.can_edit);
    assert.true(second.can_delete);
    assert.false(second.can_recover);
    assert.false(second.can_see_hidden_post);
    assert.false(second.can_view_edit_history);
    assert.false(second.yours);
    assert.false(second.bookmarked);
    assert.deepEqual(initialComment, initialSnapshot);
    assert.deepEqual(revisedComment, revisedSnapshot);
  });

  test("does not mutate a canonical store Post with the same id", function (assert) {
    flushMap();
    const canonical = this.store.createRecord("post", {
      id: 807,
      post_number: 7,
      topic_id: 701,
      cooked: "<p>Canonical topic post</p>",
      reply_count: 9,
      can_edit: true,
    });
    const records = new Map();
    const isolated = videoShortsNativePost({
      comment: comment({
        id: 807,
        post_id: 807,
        post_number: 7,
        cooked: "<p>Video panel post</p>",
        reply_count: 0,
        can_edit: false,
      }),
      item: feedItem(),
      topic: this.topic,
      store: this.store,
      records,
    });

    assert.notStrictEqual(isolated, canonical, "the panel Post is isolated");
    assert.strictEqual(isolated.cooked, "<p>Video panel post</p>");
    assert.strictEqual(canonical.topic, undefined);
    assert.strictEqual(canonical.cooked, "<p>Canonical topic post</p>");
    assert.strictEqual(canonical.reply_count, 9);
    assert.true(canonical.can_edit);
  });
});
