import {
  click,
  currentURL,
  triggerKeyEvent,
  visit,
  waitUntil,
} from "@ember/test-helpers";
import { test } from "qunit";
import { acceptance } from "discourse/tests/helpers/qunit-helpers";

function feedItem(id, title, media = null, actions = null) {
  return {
    topic_id: id,
    post_id: id,
    post_number: 1,
    topic_url: `/t/video-${id}/${id}`,
    post_url: `/t/video-${id}/${id}/1`,
    title,
    excerpt: `Excerpt ${id}`,
    username: "video-author",
    avatar_template: "/user_avatar/localhost/video-author/{size}/1_2.png",
    created_at: "2026-06-07T00:00:00.000Z",
    counts: {
      like_count: 0,
      reply_count: 0,
      bookmark_count: 0,
    },
    actions: actions || {
      liked: false,
      can_like: false,
      bookmarked: false,
      bookmark_id: null,
      can_bookmark: false,
      can_flag: false,
      can_reply: false,
      share_url: `/t/video-${id}/${id}/1`,
    },
    native_action_summary: [
      {
        id: 2,
        can_act: true,
      },
    ],
    media: media || {
      provider: "native",
      renderability: "native",
      dedupe_key: `native:upload:${id}`,
      video_url: `/uploads/default/original/1X/video-${id}.mp4`,
      upload_id: id,
    },
  };
}

function hlsItem() {
  return feedItem(9, "HLS stream", {
    provider: "hls",
    renderability: "hls",
    hls_url: "https://stream.example.com/video.m3u8",
    dedupe_key: "hls:stream-example-video",
  });
}

acceptance("Video Shorts route", function (needs) {
  needs.settings({ video_shorts_enabled: true });

  test("loads feed items from /videos.json", async function (assert) {
    needs.pretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [feedItem(1, "Native clip")],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );
    });

    await visit("/videos");

    assert.strictEqual(currentURL(), "/videos");
    assert.dom(".video-shorts-feed").exists();
    assert.dom(".video-shorts-feed__viewport").exists();
    assert.dom(".video-shorts-item").exists({ count: 1 });
    assert.dom(".video-shorts-item-title").hasText("Native clip");
    assert.dom(".topic-post").doesNotExist();
    assert.dom(".cooked").doesNotExist();
  });

  test("keeps visible items when pagination fails and retries the cursor", async function (assert) {
    let requests = 0;

    needs.pretender((server, helper) => {
      server.get("/videos.json", (request) => {
        requests += 1;

        if (!request.queryParams.cursor) {
          return helper.response({
            items: [feedItem(1, "Visible clip")],
            next_cursor: "cursor-1",
            scan_limit_reached: false,
          });
        }

        if (requests === 2) {
          return helper.response(500, { errors: ["Server error"] });
        }

        return helper.response({
          items: [feedItem(2, "Recovered clip")],
          next_cursor: null,
          scan_limit_reached: false,
        });
      });
    });

    await visit("/videos");
    await click(".video-shorts-load-more");

    assert.dom(".video-shorts-item-title").hasText("Visible clip");
    assert.dom(".video-shorts-error").exists();

    await click(".video-shorts-retry");

    assert.dom(".video-shorts-error").doesNotExist();
    assert.dom(".video-shorts-item").exists({ count: 2 });
    assert.dom(".video-shorts-item-title").includesText("Visible clip");
    assert.dom(".video-shorts-item-title").includesText("Recovered clip");
  });

  test("auto-continues partial pages and appends without duplicate posts", async function (assert) {
    let requests = 0;

    needs.pretender((server, helper) => {
      server.get("/videos.json", (request) => {
        requests += 1;

        if (!request.queryParams.cursor) {
          return helper.response({
            items: [feedItem(1, "First clip")],
            next_cursor: "cursor-1",
            scan_limit_reached: true,
          });
        }

        if (request.queryParams.cursor === "cursor-1") {
          return helper.response({
            items: [feedItem(1, "Duplicate clip"), feedItem(2, "Second clip")],
            next_cursor: "cursor-2",
            scan_limit_reached: true,
          });
        }

        return helper.response({
          items: [feedItem(3, "Third clip")],
          next_cursor: null,
          scan_limit_reached: false,
        });
      });
    });

    await visit("/videos");

    assert.strictEqual(requests, 3);
    assert.dom(".video-shorts-item").exists({ count: 3 });
    assert.dom("[data-post-id='1']").exists({ count: 1 });
    assert.dom("[data-post-id='2']").exists();
    assert.dom("[data-post-id='3']").exists();
  });

  test("caps automatic partial-page continuation", async function (assert) {
    let requests = 0;

    needs.pretender((server, helper) => {
      server.get("/videos.json", () => {
        requests += 1;

        return helper.response({
          items: [],
          next_cursor: `cursor-${requests}`,
          scan_limit_reached: true,
        });
      });
    });

    await visit("/videos");

    assert.strictEqual(requests, 4);
    assert.dom(".video-shorts-continuation").exists();
  });

  test("renders fallback-only provider items without iframes", async function (assert) {
    needs.pretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [
            feedItem(1, "Bilibili fallback", {
              provider: "bilibili",
              renderability: "fallback",
              fallback: "post",
              fallback_reason: "provider_iframe_unverified",
              dedupe_key: "bilibili:BV1Q541167Qg:page:1",
            }),
          ],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );
    });

    await visit("/videos");

    assert.dom(".video-shorts-embed-player iframe").doesNotExist();
    assert.dom(".video-shorts-embed-player__fallback").hasText("Open topic");
  });

  test("renders media only for the active native item", async function (assert) {
    needs.pretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [1, 2, 3, 4, 5].map((id) => feedItem(id, `Clip ${id}`)),
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );
    });

    await visit("/videos");

    assert.dom(".video-shorts-native-player__video").exists({ count: 1 });
    assert.dom(".video-shorts-item__media-placeholder").exists({ count: 4 });
  });

  test("renders HLS media with the dedicated HLS player", async function (assert) {
    let previousHls = window.Hls;
    let loadedSource = null;

    window.Hls = class TestHls {
      static Events = {
        MANIFEST_PARSED: "hlsManifestParsed",
        ERROR: "hlsError",
      };

      static isSupported() {
        return true;
      }

      on(event, callback) {
        if (event === TestHls.Events.MANIFEST_PARSED) {
          setTimeout(callback, 0);
        }
      }

      loadSource(source) {
        loadedSource = source;
      }

      attachMedia() {}

      destroy() {}
    };

    needs.pretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [hlsItem()],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );
    });

    await visit("/videos");
    await waitUntil(() => loadedSource === "https://stream.example.com/video.m3u8");

    assert.dom(".video-shorts-hls-player").exists({ count: 1 });
    assert
      .dom(".video-shorts-hls-player__video")
      .hasAttribute("data-hls-url", "https://stream.example.com/video.m3u8");
    assert.strictEqual(loadedSource, "https://stream.example.com/video.m3u8");
    assert.dom(".video-shorts-embed-player iframe").doesNotExist();
    assert.dom(".video-shorts-embed-player__fallback").doesNotExist();

    window.Hls = previousHls;
  });

  test("loads HLS support from the local plugin asset when native HLS is unavailable", async function (assert) {
    let previousHls = window.Hls;
    let previousCanPlayType = HTMLMediaElement.prototype.canPlayType;
    let previousAppendChild = document.head.appendChild;
    let hlsScriptSrc = null;

    delete window.Hls;

    HTMLMediaElement.prototype.canPlayType = function (contentType) {
      if (contentType === "application/vnd.apple.mpegurl") {
        return "";
      }

      return previousCanPlayType.call(this, contentType);
    };

    document.head.appendChild = function (element) {
      if (element.id === "video-shorts-hls-js") {
        hlsScriptSrc = element.src;
        window.Hls = class TestHls {
          static Events = {
            MANIFEST_PARSED: "hlsManifestParsed",
            ERROR: "hlsError",
          };

          static isSupported() {
            return true;
          }

          on(event, callback) {
            if (event === TestHls.Events.MANIFEST_PARSED) {
              setTimeout(callback, 0);
            }
          }

          loadSource() {}

          attachMedia() {}

          destroy() {}
        };
        setTimeout(() => element.onload?.(), 0);
      }

      return previousAppendChild.call(this, element);
    };

    needs.pretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [hlsItem()],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );
    });

    await visit("/videos");
    await waitUntil(() => hlsScriptSrc);

    assert.strictEqual(
      new URL(hlsScriptSrc).pathname,
      "/plugins/discourse-video-shorts/javascripts/hls.min.js",
      "HLS fallback script is served by the plugin, not a third-party CDN",
    );

    document.head.appendChild = previousAppendChild;
    HTMLMediaElement.prototype.canPlayType = previousCanPlayType;
    window.Hls = previousHls;
    document.getElementById("video-shorts-hls-js")?.remove();
  });

  test("iframe candidates require trusted provider and safe attributes", async function (assert) {
    needs.pretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [
            feedItem(1, "Vimeo iframe", {
              provider: "vimeo",
              renderability: "iframe_candidate",
              embed_url: "https://player.vimeo.com/video/123",
              dedupe_key: "vimeo:123",
            }),
            feedItem(3, "Bilibili iframe", {
              provider: "bilibili",
              renderability: "iframe_candidate",
              embed_url:
                "https://player.bilibili.com/player.html?bvid=BV1Q541167Qg&page=1",
              dedupe_key: "bilibili:BV1Q541167Qg:page:1",
            }),
            feedItem(2, "Unsafe iframe", {
              provider: "vimeo",
              renderability: "iframe_candidate",
              embed_url: "http://player.vimeo.com/video/456",
              dedupe_key: "vimeo:456",
            }),
            feedItem(4, "Unsafe Bilibili path", {
              provider: "bilibili",
              renderability: "iframe_candidate",
              embed_url:
                "https://player.bilibili.com/not-player.html?bvid=BV1Q541167Qg",
              dedupe_key: "bilibili:unsafe",
            }),
          ],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );
    });

    await visit("/videos");

    assert.dom(".video-shorts-embed-player iframe").exists({ count: 1 });
    assert
      .dom(
        '.video-shorts-embed-player iframe[src="https://player.vimeo.com/video/123"]',
      )
      .hasAttribute("title", "vimeo video embed");
    assert
      .dom(
        '.video-shorts-embed-player iframe[src="https://player.vimeo.com/video/123"]',
      )
      .hasAttribute(
        "sandbox",
        "allow-scripts allow-same-origin allow-presentation",
      );
    assert
      .dom(
        '.video-shorts-embed-player iframe[src="https://player.vimeo.com/video/123"]',
      )
      .hasAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    assert
      .dom('.video-shorts-embed-player iframe[src*="player.bilibili.com"]')
      .doesNotExist();
    assert.dom(".video-shorts-embed-player__fallback").doesNotExist();
    assert.dom(".video-shorts-item__media-placeholder").exists({ count: 3 });

    await triggerKeyEvent(".video-shorts-feed__items", "keydown", "ArrowDown");
    await waitUntil(
      () =>
        document
          .querySelector('[data-post-id="3"]')
          ?.getAttribute("aria-current") === "true",
    );

    assert
      .dom(
        '.video-shorts-embed-player iframe[src="https://player.vimeo.com/video/123"]',
      )
      .doesNotExist();
    assert
      .dom('.video-shorts-embed-player iframe[src*="player.bilibili.com"]')
      .hasAttribute("title", "bilibili video embed");
    assert.dom(".video-shorts-embed-player__fallback").doesNotExist();
    assert.dom(".video-shorts-item__media-placeholder").exists({ count: 3 });
  });

  test("unsafe active iframe candidates render fallback links", async function (assert) {
    needs.pretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [
            feedItem(1, "Unsafe iframe", {
              provider: "vimeo",
              renderability: "iframe_candidate",
              embed_url: "http://player.vimeo.com/video/456",
              dedupe_key: "vimeo:456",
            }),
          ],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );
    });

    await visit("/videos");

    assert.dom(".video-shorts-embed-player iframe").doesNotExist();
    assert.dom(".video-shorts-embed-player__fallback").hasText("Open topic");
  });

  test("renders trusted YouTube iframe candidates as embedded players", async function (assert) {
    needs.pretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [
            feedItem(1, "YouTube iframe", {
              provider: "youtube",
              renderability: "iframe_candidate",
              embed_url: "https://www.youtube.com/embed/dQw4w9WgXcQ",
              dedupe_key: "youtube:dQw4w9WgXcQ",
            }),
          ],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );
    });

    await visit("/videos");

    assert.dom(".video-shorts-embed-player iframe").exists({ count: 1 });
    assert
      .dom(".video-shorts-embed-player iframe")
      .hasAttribute("src", "https://www.youtube.com/embed/dQw4w9WgXcQ");
    assert
      .dom(".video-shorts-embed-player iframe")
      .hasAttribute("title", "youtube video embed");
  });
});

acceptance("Video Shorts native actions", function (needs) {
  needs.settings({ video_shorts_enabled: true });
  needs.user();

  test("like and bookmark use native Discourse endpoints", async function (assert) {
    const actions = {
      liked: false,
      can_like: true,
      bookmarked: false,
      bookmark_id: null,
      can_bookmark: true,
      can_flag: true,
      can_reply: true,
      share_url: "/t/video-1/1/1",
    };

    needs.pretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [feedItem(1, "Action clip", null, actions)],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );

      server.post("/post_actions", (request) => {
        const body = new URLSearchParams(request.requestBody);

        assert.strictEqual(body.get("id"), "1");
        assert.notStrictEqual(body.get("post_action_type_id"), null);

        return helper.response({ result: {} });
      });

      server.post("/bookmarks.json", (request) => {
        const body = new URLSearchParams(request.requestBody);

        assert.strictEqual(body.get("bookmarkable_id"), "1");
        assert.strictEqual(body.get("bookmarkable_type"), "Post");

        return helper.response({ id: 99 });
      });
    });

    await visit("/videos");
    await click("[data-action='like']");
    await click("[data-action='bookmark']");
  });
});

acceptance("Video Shorts anonymous actions", function (needs) {
  needs.settings({ video_shorts_enabled: true });

  test("restricted actions open the native login route", async function (assert) {
    needs.pretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [feedItem(1, "Anonymous action clip")],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );
    });

    await visit("/videos");
    await click("[data-action='like']");

    assert.strictEqual(currentURL(), "/login");
  });
});

acceptance("Video Shorts route disabled", function (needs) {
  needs.settings({ video_shorts_enabled: false });

  needs.pretender((server, helper) => {
    server.get("/permalink-check.json", () =>
      helper.response({
        found: false,
        html: "<div class='page-not-found'>not found</div>",
      }),
    );
  });

  test("shows native unknown route without mounting the feed", async function (assert) {
    await visit("/videos");

    assert.strictEqual(currentURL(), "/videos");
    assert.dom(".page-not-found").exists();
    assert.dom(".video-shorts-feed").doesNotExist();
  });
});
