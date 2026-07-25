import { module, test } from "qunit";
import {
  normalizeDirectReplies,
  normalizeReplyBranch,
} from "discourse/plugins/discourse-video-shorts/discourse/lib/video-shorts-comments";

module("Unit | Lib | video shorts comments transport", function () {
  test("rejects malformed successful reply payloads instead of showing an empty thread", function (assert) {
    for (const payload of [null, {}, "", 1]) {
      assert.throws(
        () => normalizeDirectReplies(payload),
        TypeError,
        `rejects ${JSON.stringify(payload)}`
      );
    }

    assert.deepEqual(normalizeDirectReplies([]), {
      comments: [],
      hasMore: false,
      nextAfter: null,
    });
  });

  test("normalizes the native direct-comments envelope used after refresh", function (assert) {
    assert.deepEqual(
      normalizeDirectReplies({
        posts: [{ id: 51, post_number: 11, cooked: "<p>Latest</p>" }],
        has_more: false,
        next_after: 11,
      }),
      {
        comments: [
          {
            ...normalizeDirectReplies([
              { id: 51, post_number: 11, cooked: "<p>Latest</p>" },
            ]).comments[0],
          },
        ],
        hasMore: false,
        nextAfter: 11,
      },
    );
  });

  test("normalizes only bounded reply branch payloads", function (assert) {
    assert.deepEqual(
      normalizeReplyBranch({
        posts: [{ id: 44, post_number: 4, cooked: "<p>Reply</p>" }],
        has_more: true,
        next_after: 4,
      }),
      {
        comments: [
          {
            ...normalizeDirectReplies([
              { id: 44, post_number: 4, cooked: "<p>Reply</p>" },
            ]).comments[0],
          },
        ],
        hasMore: true,
        nextAfter: 4,
      },
    );

    for (const payload of [
      null,
      [],
      {},
      { posts: null, has_more: false, next_after: null },
      { posts: [], has_more: "false", next_after: null },
      { posts: [], has_more: true, next_after: null },
      { posts: [], has_more: false, next_after: -1 },
    ]) {
      assert.throws(
        () => normalizeReplyBranch(payload),
        TypeError,
        `rejects ${JSON.stringify(payload)}`,
      );
    }
  });
});
