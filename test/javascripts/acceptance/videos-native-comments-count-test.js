import { click, visit } from "@ember/test-helpers";
import { test } from "qunit";
import pretender, {
  pretenderHelpers,
} from "discourse/tests/helpers/create-pretender";
import { acceptance } from "discourse/tests/helpers/qunit-helpers";

acceptance("Video Shorts native comments count synchronization", function (needs) {
  needs.settings({ video_shorts_enabled: true });
  needs.user();

  test("a nonnegative server reply count renders native comments without backtracking", async function (assert) {
    const helper = pretenderHelpers();

    pretender.get("/videos.json", () =>
      helper.response({
        items: [
          {
            topic_id: 860,
            post_id: 860,
            post_number: 1,
            topic_url: "/t/native-count/860",
            post_url: "/t/native-count/860/1",
            title: "Native count",
            excerpt: "Native count excerpt",
            user_id: 86,
            username: "video-author",
            avatar_template:
              "/user_avatar/localhost/video-author/{size}/1_2.png",
            created_at: "2026-07-10T00:00:00.000Z",
            counts: { like_count: 0, reply_count: 1, bookmark_count: 0 },
            actions: {
              can_reply: true,
              can_flag: true,
              can_like: true,
              can_bookmark: true,
              share_url: "/t/native-count/860/1",
            },
            native_action_summary: [{ id: 2, can_act: true }],
            media: {
              provider: "native",
              renderability: "native",
              dedupe_key: "native:upload:860",
              video_url: "/uploads/default/original/1X/native-count.mp4",
              upload_id: 860,
            },
          },
        ],
        next_cursor: null,
        scan_limit_reached: false,
      })
    );
    pretender.get("/posts/860/replies.json", () =>
      helper.response([
        {
          id: 861,
          post_id: 861,
          post_number: 2,
          topic_id: 860,
          user_id: 87,
          username: "comment-author",
          avatar_template:
            "/user_avatar/localhost/comment-author/{size}/1_2.png",
          cooked: "<p>Counted native comment</p>",
          raw: "Counted native comment",
          created_at: "2026-07-10T01:00:00.000Z",
          reply_count: 0,
          reply_to_post_number: 1,
          actions_summary: [{ id: 2, can_act: true }],
          can_flag: true,
          post_url: "/t/native-count/860/2",
        },
      ])
    );

    await visit("/videos");
    await click('[data-action="open-comments"]');

    assert
      .dom(
        '.video-shorts-comments-panel .topic-post article.boxed[data-post-id="861"]'
      )
      .exists("the real count and canonical reply remain synchronized");
    assert
      .dom(".video-shorts-comments-panel")
      .includesText("1 reply", "the authoritative nonnegative count remains visible");
  });
});
