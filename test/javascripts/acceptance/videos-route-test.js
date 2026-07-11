import {
  click,
  currentURL,
  triggerKeyEvent,
  visit,
  waitUntil,
} from "@ember/test-helpers";
import { test } from "qunit";
import pretender, {
  pretenderHelpers,
} from "discourse/tests/helpers/create-pretender";
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
      can_bookmark: false,
      can_flag: false,
      can_reply: false,
      share_url: `/t/video-${id}/${id}/1`,
    },
    media: media || {
      kind: "upload_mp4",
      identity: `v1:upload:${id}:video-${id}`,
      url: `/uploads/default/original/1X/video-${id}.mp4`,
      required_origins: [],
      policy_revision: null,
      fallback_reason: null,
    },
  };
}

function hlsItem() {
  return feedItem(9, "HLS stream", {
    kind: "external_hls",
    identity: "v1:external:hls-stream-example-video",
    url: "https://stream.example.com/video.m3u8",
    required_origins: ["https://stream.example.com"],
    policy_revision: 7,
    fallback_reason: null,
  });
}
function feedResponse(helper, payload) {
  const { scan_limit_reached, ...feed } = payload;

  return helper.response({
    schema_version: 1,
    feed_revision: "fixture-feed-revision",
    ...feed,
    scan: {
      candidates_scanned: feed.items?.length || 0,
      scan_limit_reached: Boolean(scan_limit_reached),
      end_reached: feed.next_cursor === null,
    },
  });
}

const DISABLED_POLICY = {
  revision: 0,
  external_media_enabled: false,
  origins: [],
  generated_at: "2026-06-07T00:00:00.000Z",
};

const HLS_POLICY = {
  revision: 7,
  external_media_enabled: true,
  origins: ["https://stream.example.com"],
  generated_at: "2026-06-07T00:00:00.000Z",
};

let policySnapshot = DISABLED_POLICY;

function installVideoShortsContractHandlers(needs) {
  needs.pretender((server, helper) => {
    server.get("/videos/policy.json", () => helper.response(policySnapshot));
    server.get("/videos/posts/:post_id/comments.json", (request) =>
      helper.response({
        comments: [],
        has_more: false,
        next_cursor: null,
        visible_reply_count: 0,
        change_cursor: null,
        source_post_id: Number(request.params.post_id),
      }),
    );
    server.get("/videos/posts/:post_id/comments/delta.json", () =>
      helper.response({
        changes: [],
        has_more: false,
        next_change_cursor: null,
        visible_reply_count: 0,
      }),
    );
    server.post("/videos/authorization-leases.json", () =>
      helper.response({ leases: [] }),
    );
    server.get("/permalink-check.json", () =>
      helper.response({
        found: false,
        html: "<div class='page-not-found'>not found</div>",
      }),
    );
  });
}

acceptance("Video Shorts route", function (needs) {
  needs.settings({ video_shorts_enabled: true });
  installVideoShortsContractHandlers(needs);

  test("loads feed items from /videos.json", async function (assert) {
    ((server, helper) => {
      server.get("/videos.json", () =>
        feedResponse(helper, {
          items: [feedItem(1, "Native clip")],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );
    })(pretender, pretenderHelpers());

    await visit("/videos");

    assert.strictEqual(currentURL(), "/videos");
    assert.dom(".video-shorts-feed").exists();
    assert.dom(".video-shorts-feed__viewport").exists();
    assert.dom(".video-shorts-item").exists({ count: 1 });
    assert.dom(".video-shorts-item-title").hasText("Native clip");
    assert.dom(".topic-post").doesNotExist();
    assert.dom(".cooked").doesNotExist();
  });

  test("surfaces policy startup failures instead of silently continuing", async function (assert) {
    const server = pretender;
    const helper = pretenderHelpers();

    server.get("/videos/policy.json", () =>
      helper.response(500, { errors: ["Policy unavailable"] })
    );
    server.get("/videos.json", () =>
      feedResponse(helper, {
        items: [feedItem(1, "Native clip")],
        next_cursor: null,
        scan_limit_reached: false,
      })
    );

    await visit("/videos");
    await waitUntil(() => document.querySelector(".video-shorts-error"));

    assert
      .dom(".video-shorts-error")
      .includesText("Videos could not be loaded.");
    server.get("/videos/policy.json", () => helper.response(policySnapshot));
  });

  test("freezes playback and surfaces policy revalidation failures", async function (assert) {
    const server = pretender;
    const helper = pretenderHelpers();

    server.get("/videos.json", () =>
      feedResponse(helper, {
        items: [feedItem(1, "Policy-protected clip")],
        next_cursor: null,
        scan_limit_reached: false,
      }),
    );

    await visit("/videos");
    assert
      .dom(".video-shorts-native-player__video")
      .hasAttribute("src", "/uploads/default/original/1X/video-1.mp4");
    const policy = this.owner.lookup("service:video-shorts-policy");
    await waitUntil(() => policy.revisionListeners.size > 0);

    server.get("/videos/policy.json", () =>
      helper.response(500, { errors: ["Policy unavailable"] }),
    );
    await policy.revalidate().catch(() => {});

    await waitUntil(() => document.querySelector(".video-shorts-error"));
    await waitUntil(
      () =>
        !document
          .querySelector(".video-shorts-native-player__video")
          ?.getAttribute("src"),
      { timeoutMessage: "policy failure did not unload existing media" },
    );
    assert.true(policy.frozen, "failed revalidation freezes new media requests");
    assert
      .dom(".video-shorts-native-player__video")
      .doesNotExist("route teardown removes existing media");

    server.get("/videos/policy.json", () => helper.response(policySnapshot));
  });

  test("replaces the route session after the current user changes", async function (assert) {
    const server = pretender;
    const helper = pretenderHelpers();

    server.get("/videos.json", () =>
      feedResponse(helper, {
        items: [feedItem(1, "Session-bound clip")],
        next_cursor: null,
        scan_limit_reached: false,
      }),
    );

    await visit("/videos");
    const controller = this.owner.lookup("controller:videos");
    const previousSession = controller.routeSession;
    await waitUntil(() => previousSession?.cleanup.length > 0);

    previousSession.getSessionIdentity = () => "changed-user";
    window.dispatchEvent(new Event("focus"));

    await waitUntil(
      () =>
        controller.routeSession !== previousSession &&
        controller.routeSession?.isCurrent,
      { timeoutMessage: "the destroyed route session was not replaced" },
    );

    assert.false(previousSession.isCurrent);
    assert.strictEqual(controller.routeSession.sessionIdentity, null);
    assert.dom(".video-shorts-item").exists({ count: 1 });
  });

  test("keeps visible items when automatic pagination fails", async function (assert) {
    let requests = 0;

    ((server, helper) => {
      server.get("/videos.json", (request) => {
        requests += 1;

        if (!request.queryParams.cursor) {
          return feedResponse(helper, {
            items: [feedItem(1, "Visible clip")],
            next_cursor: "cursor-1",
            scan_limit_reached: false,
          });
        }

        if (requests === 2) {
          return helper.response(500, { errors: ["Server error"] });
        }

        return feedResponse(helper, {
          items: [feedItem(2, "Recovered clip")],
          next_cursor: null,
          scan_limit_reached: false,
        });
      });
    })(pretender, pretenderHelpers());

    await visit("/videos");

    assert.dom(".video-shorts-item-title").hasText("Visible clip");
    assert.dom(".video-shorts-error").exists();
    assert.dom(".video-shorts-load-more").doesNotExist();
  });

  test("auto-continues partial pages and appends without duplicate posts", async function (assert) {
    let requests = 0;

    ((server, helper) => {
      server.get("/videos.json", (request) => {
        requests += 1;

        if (!request.queryParams.cursor) {
          return feedResponse(helper, {
            items: [feedItem(1, "First clip")],
            next_cursor: "cursor-1",
            scan_limit_reached: true,
          });
        }

        if (request.queryParams.cursor === "cursor-1") {
          return feedResponse(helper, {
            items: [feedItem(1, "Duplicate clip"), feedItem(2, "Second clip")],
            next_cursor: "cursor-2",
            scan_limit_reached: true,
          });
        }

        return feedResponse(helper, {
          items: [feedItem(3, "Third clip")],
          next_cursor: null,
          scan_limit_reached: false,
        });
      });
    })(pretender, pretenderHelpers());

    await visit("/videos");

    assert.strictEqual(requests, 3);
    assert.dom(".video-shorts-item").exists({ count: 3 });
    assert.dom("[data-post-id='1']").exists({ count: 1 });
    assert.dom("[data-post-id='2']").exists();
    assert.dom("[data-post-id='3']").exists();
  });

  test("stops when a continuation cursor does not advance", async function (assert) {
    let requests = 0;

    ((server, helper) => {
      server.get("/videos.json", () => {
        requests += 1;
        return feedResponse(helper, {
          items: [],
          next_cursor: "repeated-cursor",
          scan_limit_reached: true,
        });
      });
    })(pretender, pretenderHelpers());

    await visit("/videos");

    assert.strictEqual(requests, 2, "the repeated cursor is never requested twice");
    assert.dom(".video-shorts-error").exists();
    assert.dom(".video-shorts-load-more").doesNotExist();
  });
  test("surfaces a protocol error when continuation exceeds the fixed request bound", async function (assert) {
    let requests = 0;

    ((server, helper) => {
      server.get("/videos.json", () => {
        requests += 1;

        return feedResponse(helper, {
          items: [],
          next_cursor: `cursor-${requests}`,
          scan_limit_reached: true,
        });
      });
    })(pretender, pretenderHelpers());

    await visit("/videos");

    assert.strictEqual(requests, 22);
    assert.dom(".video-shorts-load-more").doesNotExist();
    assert.dom(".video-shorts-error").exists();
  });

  test("renders fallback-only descriptors without iframes", async function (assert) {
    ((server, helper) => {
      server.get("/videos.json", () =>
        feedResponse(helper, {
          items: [
            feedItem(1, "Bilibili fallback", {
              kind: "fallback",
              identity: "v1:external:bilibili-unverified",
              required_origins: [],
              policy_revision: null,
              fallback_reason: "invalid_bilibili_url",
            }),
          ],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );
    })(pretender, pretenderHelpers());

    await visit("/videos");

    assert.dom(".video-shorts-embed-player iframe").doesNotExist();
    assert.dom(".video-shorts-embed-player__fallback").hasText("Open topic");
  });

  test("renders media only for the active native item", async function (assert) {
    ((server, helper) => {
      server.get("/videos.json", () =>
        feedResponse(helper, {
          items: [1, 2, 3, 4, 5].map((id) => feedItem(id, `Clip ${id}`)),
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );
    })(pretender, pretenderHelpers());

    await visit("/videos");

    assert.dom(".video-shorts-native-player__video").exists({ count: 2 });
    assert.dom(".video-shorts-item__media-placeholder").exists({ count: 3 });
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

    ((server, helper) => {
      server.get("/videos.json", () =>
        feedResponse(helper, {
          items: [hlsItem()],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );
    })(pretender, pretenderHelpers());

    policySnapshot = HLS_POLICY;
    this.owner.lookup("service:video-shorts-policy").reset();
    await visit("/videos");
    await waitUntil(
      () => this.owner.lookup("service:video-shorts-policy").revision === 7,
    );
    assert.dom(".video-shorts-hls-player").exists({ count: 1 });
    await waitUntil(
      () =>
        loadedSource === "https://stream.example.com/video.m3u8" ||
        document.querySelector(".video-shorts-hls-player__fallback"),
    );

    assert.dom(".video-shorts-hls-player").exists({ count: 1 });
    assert.strictEqual(loadedSource, "https://stream.example.com/video.m3u8");
    assert.dom(".video-shorts-embed-player iframe").doesNotExist();
    assert.dom(".video-shorts-embed-player__fallback").doesNotExist();

    window.Hls = previousHls;
    policySnapshot = DISABLED_POLICY;
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
        setTimeout(() => element.dispatchEvent(new Event("load")), 0);
        return element;
      }

      return previousAppendChild.call(this, element);
    };

    ((server, helper) => {
      server.get("/videos.json", () =>
        feedResponse(helper, {
          items: [hlsItem()],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );
    })(pretender, pretenderHelpers());

    policySnapshot = HLS_POLICY;
    this.owner.lookup("service:video-shorts-policy").reset();
    await visit("/videos");
    await waitUntil(
      () => this.owner.lookup("service:video-shorts-policy").revision === 7,
    );
    assert.dom(".video-shorts-hls-player").exists({ count: 1 });
    await waitUntil(
      () =>
        hlsScriptSrc ||
        document.querySelector(".video-shorts-hls-player__fallback"),
    );

    assert.strictEqual(
      new URL(hlsScriptSrc).pathname,
      "/plugins/discourse-video-shorts/javascripts/hls.min.js",
      "HLS fallback script is served by the plugin, not a third-party CDN",
    );

    document.head.appendChild = previousAppendChild;
    HTMLMediaElement.prototype.canPlayType = previousCanPlayType;
    window.Hls = previousHls;
    policySnapshot = DISABLED_POLICY;
    document.getElementById("video-shorts-hls-js")?.remove();
  });

  test("trusted media descriptors require safe iframe attributes", async function (assert) {
    ((server, helper) => {
      server.get("/videos.json", () =>
        feedResponse(helper, {
          items: [
            feedItem(1, "YouTube iframe", {
              kind: "youtube",
              identity: "v1:youtube:dQw4w9WgXcQ",
              url: "https://www.youtube.com/embed/dQw4w9WgXcQ",
              required_origins: [],
              policy_revision: null,
              fallback_reason: null,
            }),
            feedItem(3, "Bilibili iframe", {
              kind: "bilibili",
              identity: "v1:bilibili:BV1Q541167Qg",
              url: "https://player.bilibili.com/player.html?bvid=BV1Q541167Qg&page=1",
              required_origins: [],
              policy_revision: null,
              fallback_reason: null,
            }),
            feedItem(2, "Unsafe iframe", {
              kind: "bilibili",
              identity: "v1:bilibili:BV1Q541167Qg",
              url: "http://player.bilibili.com/player.html?bvid=BV1Q541167Qg&page=1",
              required_origins: [],
              policy_revision: null,
              fallback_reason: null,
            }),
            feedItem(4, "Unsafe Bilibili path", {
              kind: "bilibili",
              identity: "v1:bilibili:BV1Q541167Qg",
              url: "https://player.bilibili.com/not-player.html?bvid=BV1Q541167Qg",
              required_origins: [],
              policy_revision: null,
              fallback_reason: null,
            }),
          ],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );
    })(pretender, pretenderHelpers());

    await visit("/videos");

    assert.dom(".video-shorts-embed-player iframe").exists({ count: 1 });
    assert
      .dom(
        '.video-shorts-embed-player iframe[src="https://www.youtube.com/embed/dQw4w9WgXcQ"]',
      )
      .hasAttribute("title", "youtube video embed");
    assert
      .dom(
        '.video-shorts-embed-player iframe[src="https://www.youtube.com/embed/dQw4w9WgXcQ"]',
      )
      .hasAttribute(
        "sandbox",
        "allow-scripts allow-same-origin allow-presentation",
      );
    assert
      .dom(
        '.video-shorts-embed-player iframe[src="https://www.youtube.com/embed/dQw4w9WgXcQ"]',
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
        '.video-shorts-embed-player iframe[src="https://www.youtube.com/embed/dQw4w9WgXcQ"]',
      )
      .doesNotExist();
    assert
      .dom('.video-shorts-embed-player iframe[src*="player.bilibili.com"]')
      .hasAttribute("title", "bilibili video embed");
    assert.dom(".video-shorts-embed-player__fallback").doesNotExist();
    assert.dom(".video-shorts-item__media-placeholder").exists({ count: 3 });
  });

  test("unsafe active media descriptors render fallback links", async function (assert) {
    ((server, helper) => {
      server.get("/videos.json", () =>
        feedResponse(helper, {
          items: [
            feedItem(1, "Unsafe iframe", {
              kind: "bilibili",
              identity: "v1:bilibili:BV1Q541167Qg",
              url: "http://player.bilibili.com/player.html?bvid=BV1Q541167Qg&page=1",
              required_origins: [],
              policy_revision: null,
              fallback_reason: null,
            }),
          ],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );
    })(pretender, pretenderHelpers());

    await visit("/videos");

    assert.dom(".video-shorts-embed-player iframe").doesNotExist();
    assert.dom(".video-shorts-embed-player__fallback").hasText("Open topic");
  });

  test("renders trusted YouTube descriptors as embedded players", async function (assert) {
    ((server, helper) => {
      server.get("/videos.json", () =>
        feedResponse(helper, {
          items: [
            feedItem(1, "YouTube iframe", {
              kind: "youtube",
              identity: "v1:youtube:dQw4w9WgXcQ",
              url: "https://www.youtube.com/embed/dQw4w9WgXcQ",
              required_origins: [],
              policy_revision: null,
              fallback_reason: null,
            }),
          ],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );
    })(pretender, pretenderHelpers());

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
  installVideoShortsContractHandlers(needs);
  needs.user();

  test("like and bookmark use native Discourse endpoints", async function (assert) {
    const actions = {
      liked: false,
      can_like: true,
      bookmarked: false,
      can_bookmark: true,
      can_flag: true,
      can_reply: true,
      share_url: "/t/video-1/1/1",
    };

    ((server, helper) => {
      server.get("/videos.json", () =>
        feedResponse(helper, {
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

      server.put("/posts/:post_id/bookmark", (request) => {
        const body = new URLSearchParams(request.requestBody);

        assert.strictEqual(request.params.post_id, "1");
        assert.strictEqual(body.get("bookmarked"), "true");

        return helper.response({});
      });
      server.delete("/posts/:post_id/bookmark", (request) => {
        assert.strictEqual(request.params.post_id, "1");

        return helper.response({});
      });
    })(pretender, pretenderHelpers());

    await visit("/videos");
    await click("[data-action='like']");
    await click("[data-action='bookmark']");
    await click("[data-action='bookmark']");
  });
});

acceptance("Video Shorts anonymous actions", function (needs) {
  needs.settings({ video_shorts_enabled: true });
  installVideoShortsContractHandlers(needs);

  test("restricted actions open the native login route", async function (assert) {
    ((server, helper) => {
      server.get("/videos.json", () =>
        feedResponse(helper, {
          items: [feedItem(1, "Anonymous action clip")],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );
    })(pretender, pretenderHelpers());

    await visit("/videos");
    await click("[data-action='like']");

    assert.strictEqual(currentURL(), "/login");
  });
});

acceptance("Video Shorts route disabled", function (needs) {
  needs.settings({ video_shorts_enabled: false });
  installVideoShortsContractHandlers(needs);

  test("shows native unknown route without mounting the feed", async function (assert) {
    await visit("/videos");

    assert.strictEqual(currentURL(), "/videos");
    assert.dom(".page-not-found").exists();
    assert.dom(".video-shorts-feed").doesNotExist();
  });
});
