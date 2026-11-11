import {
  click,
  currentURL,
  settled,
  triggerKeyEvent,
  visit,
  waitUntil,
} from "@ember/test-helpers";
import { test } from "qunit";
import pretender, {
  pretenderHelpers,
} from "discourse/tests/helpers/create-pretender";
import { acceptance } from "discourse/tests/helpers/qunit-helpers";

function setupPretender(callback) {
  callback(pretender, pretenderHelpers());
}

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
    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [feedItem(1, "Native clip")],
          next_cursor: null,
          scan_limit_reached: false,
        })
      );
    });

    await visit("/videos");

    assert.strictEqual(currentURL(), "/videos");
    assert.dom(".video-shorts-feed").exists();
    assert.dom(".video-shorts-feed__viewport").exists();
    assert.dom(".video-shorts-item").exists({ count: 1 });
    assert.dom(".video-shorts-item-title").hasText("Native clip");
    assert.true(
      document.querySelector(".video-shorts-native-player__video").muted,
      "native video starts muted for autoplay"
    );
    assert
      .dom(".video-shorts-native-player .video-shorts-player__sound")
      .hasAttribute("aria-label", "Turn sound on");

    await click(".video-shorts-native-player .video-shorts-player__sound");

    assert.false(
      document.querySelector(".video-shorts-native-player__video").muted,
      "the visible sound control unmutes native video"
    );
    assert
      .dom(".video-shorts-native-player .video-shorts-player__sound")
      .hasAttribute("aria-label", "Mute");
    assert.dom(".topic-post").doesNotExist();
    assert.dom(".cooked").doesNotExist();
  });

  test("does not shrink the full-screen route during a blurred keyboard-close frame", async function (assert) {
    const originalInnerHeight = Object.getOwnPropertyDescriptor(
      window,
      "innerHeight"
    );

    try {
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: 812,
      });

      setupPretender((server, helper) => {
        server.get("/videos.json", () =>
          helper.response({
            items: [feedItem(1, "Keyboard-close route clip")],
            next_cursor: null,
            scan_limit_reached: false,
          })
        );
      });

      await visit("/videos");

      assert.strictEqual(
        document.body.style.getPropertyValue(
          "--video-shorts-mobile-route-height"
        ),
        "812px",
        "the route captures the full-height viewport before the keyboard opens"
      );

      document.body.classList.add(
        "video-shorts-lightweight-composer-open"
      );
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: 520,
      });
      window.dispatchEvent(new Event("resize"));

      assert.strictEqual(
        document.body.style.getPropertyValue(
          "--video-shorts-mobile-route-height"
        ),
        "812px",
        "a keyboard-close blur cannot shrink the full-screen route for one frame"
      );

      document.body.classList.remove(
        "video-shorts-lightweight-composer-open"
      );
      window.dispatchEvent(new Event("resize"));

      assert.strictEqual(
        document.body.style.getPropertyValue(
          "--video-shorts-mobile-route-height"
        ),
        "812px",
        "removing the editor cannot release the route lock before the keyboard viewport restores"
      );

      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: 812,
      });
      window.dispatchEvent(new Event("resize"));

      assert.strictEqual(
        document.body.style.getPropertyValue(
          "--video-shorts-mobile-route-height"
        ),
        "812px",
        "the route lock releases only after the full-height viewport returns"
      );

      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: 700,
      });
      window.dispatchEvent(new Event("resize"));

      assert.strictEqual(
        document.body.style.getPropertyValue(
          "--video-shorts-mobile-route-height"
        ),
        "700px",
        "normal viewport resizes resume after keyboard restoration"
      );
    } finally {
      document.body.classList.remove(
        "video-shorts-lightweight-composer-open"
      );

      if (originalInnerHeight) {
        Object.defineProperty(window, "innerHeight", originalInnerHeight);
      } else {
        delete window.innerHeight;
      }
    }
  });

  test("reveals video chrome only after the active media has painted and never repeats it", async function (assert) {
    const previousIntersectionObserver = window.IntersectionObserver;
    const previousRequestAnimationFrame = window.requestAnimationFrame;
    const previousCancelAnimationFrame = window.cancelAnimationFrame;
    const observers = [];
    const queuedFrames = new Map();
    let nextFrameId = 1;

    window.IntersectionObserver = class TestIntersectionObserver {
      constructor(callback) {
        this.callback = callback;
        observers.push(this);
      }

      observe(element) {
        this.elements ??= [];
        this.elements.push(element);
      }

      disconnect() {}
    };
    window.requestAnimationFrame = (callback) => {
      const frameId = nextFrameId++;
      queuedFrames.set(frameId, callback);
      return frameId;
    };
    window.cancelAnimationFrame = (frameId) => {
      queuedFrames.delete(frameId);
    };

    const flushFrame = () => {
      const callbacks = [...queuedFrames.values()];
      queuedFrames.clear();

      for (const callback of callbacks) {
        callback(performance.now());
      }
    };
    const activateItem = (index) => {
      const observer = observers[0];
      const activeElement = observer.elements.find(
        (element) => element.dataset.videoShortsIndex === String(index)
      );

      observer.callback(
        observer.elements.map((element) => ({
          isIntersecting: element === activeElement,
          intersectionRatio: element === activeElement ? 0.8 : 0,
          target: element,
        }))
      );
    };

    try {
      setupPretender((server, helper) => {
        server.get("/videos.json", () =>
          helper.response({
            items: [1, 2].map((id) => feedItem(id, `Clip ${id}`)),
            next_cursor: null,
            scan_limit_reached: false,
          })
        );
      });

      await visit("/videos");

      assert
        .dom("[data-post-id='1'] .video-shorts-native-player__video")
        .exists("the active video is mounted before its chrome is revealed");
      assert
        .dom("[data-post-id='1'] .video-shorts-item")
        .hasAttribute(
          "data-video-shorts-chrome",
          "pending",
          "metadata and actions start in the reserved pending state"
        );
      assert
        .dom("[data-post-id='1'] .video-shorts-item__info")
        .exists("metadata keeps its DOM and layout slot while pending");
      assert
        .dom("[data-post-id='1'] .video-shorts-action-rail")
        .exists("actions keep their DOM and layout slot while pending");

      flushFrame();
      await settled();

      assert
        .dom("[data-post-id='1'] .video-shorts-item")
        .hasAttribute(
          "data-video-shorts-chrome",
          "pending",
          "one complete media-only frame is reserved before chrome reveal"
        );

      flushFrame();
      await settled();

      assert
        .dom("[data-post-id='1'] .video-shorts-item")
        .hasAttribute("data-video-shorts-chrome", "revealed");

      activateItem(1);
      await settled();

      assert
        .dom(".video-shorts-feed__viewport")
        .hasAttribute(
          "data-playback-post-id",
          "2",
          "the second intersection immediately becomes the playback item"
        );
      assert
        .dom("[data-post-id='2'] .video-shorts-item")
        .hasAttribute(
          "data-video-shorts-chrome",
          "pending",
          "a newly active item starts with media-only chrome"
        );

      flushFrame();
      await settled();

      assert
        .dom("[data-post-id='2'] .video-shorts-item")
        .hasAttribute(
          "data-video-shorts-chrome",
          "pending",
          "the second item also preserves one complete media-only frame"
        );

      flushFrame();
      await settled();

      assert
        .dom("[data-post-id='2'] .video-shorts-item")
        .hasAttribute("data-video-shorts-chrome", "revealed");

      activateItem(0);
      await settled();

      assert
        .dom(".video-shorts-feed__viewport")
        .hasAttribute(
          "data-playback-post-id",
          "1",
          "the first item really receives playback again"
        );
      assert
        .dom("[data-post-id='1'] .video-shorts-item")
        .hasAttribute(
          "data-video-shorts-chrome",
          "revealed",
          "returning to a revealed item never restarts the entrance"
        );
    } finally {
      window.requestAnimationFrame = previousRequestAnimationFrame;
      window.cancelAnimationFrame = previousCancelAnimationFrame;

      if (previousIntersectionObserver) {
        window.IntersectionObserver = previousIntersectionObserver;
      } else {
        delete window.IntersectionObserver;
      }
    }
  });

  test("keeps visible items when pagination fails and retries the cursor", async function (assert) {
    let requests = 0;

    setupPretender((server, helper) => {
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
    assert
      .dom("[data-post-id='1'] .video-shorts-item-title")
      .includesText("Visible clip");
    assert
      .dom("[data-post-id='2'] .video-shorts-item-title")
      .includesText("Recovered clip");
  });

  test("auto-continues partial pages and appends without duplicate posts", async function (assert) {
    let requests = 0;

    setupPretender((server, helper) => {
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

    setupPretender((server, helper) => {
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
    setupPretender((server, helper) => {
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
        })
      );
    });

    await visit("/videos");

    assert.dom(".video-shorts-embed-player iframe").doesNotExist();
    assert.dom(".video-shorts-embed-player__fallback").hasText("Open topic");
  });

  test("prewarms only adjacent native media", async function (assert) {
    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [1, 2, 3, 4, 5].map((id) => feedItem(id, `Clip ${id}`)),
          next_cursor: null,
          scan_limit_reached: false,
        })
      );
    });

    await visit("/videos");

    assert
      .dom(".video-shorts-native-player__video")
      .exists({ count: 2 }, "the active item and next native item are mounted");
    assert.dom("[data-post-id='1'] video").exists();
    assert.dom("[data-post-id='2'] video").exists();
    assert.dom("[data-post-id='3'] video").doesNotExist();
    assert.dom("[data-post-id='2'] video").hasAttribute("preload", "metadata");
    assert
      .dom(".video-shorts-feed__item")
      .exists({ count: 5 }, "all scroll-snap slots remain in the DOM");
    assert
      .dom(".video-shorts-item")
      .exists({ count: 3 }, "only the active item and two neighbors mount fully");
    assert
      .dom(".video-shorts-feed__item[inert][aria-hidden='true']")
      .exists({ count: 2 }, "off-window slots are inert and hidden");
    assert
      .dom(
        ".video-shorts-feed__item-placeholder button, .video-shorts-feed__item-placeholder a"
      )
      .doesNotExist("off-window placeholders have no focusable controls");
    assert.dom(".video-shorts-item__media-placeholder").exists({ count: 1 });

    await triggerKeyEvent(".video-shorts-feed__items", "keydown", "ArrowDown");
    await waitUntil(
      () =>
        document
          .querySelector("[data-post-id='2']")
          ?.getAttribute("aria-current") === "true"
    );
    await triggerKeyEvent(".video-shorts-feed__items", "keydown", "ArrowDown");
    await waitUntil(
      () =>
        document
          .querySelector("[data-post-id='3']")
          ?.getAttribute("aria-current") === "true"
    );

    assert
      .dom(".video-shorts-native-player__video")
      .exists({ count: 3 }, "only the active native preload window is mounted");
    assert.dom("[data-post-id='1'] video").doesNotExist();
    assert.dom("[data-post-id='2'] video").exists();
    assert.dom("[data-post-id='3'] video").hasAttribute("preload", "auto");
    assert.dom("[data-post-id='4'] video").exists();
    assert.dom("[data-post-id='5'] video").doesNotExist();
  });

  test("does not prewarm adjacent media in data saver mode", async function (assert) {
    const connectionDescriptor = Object.getOwnPropertyDescriptor(
      navigator,
      "connection"
    );

    Object.defineProperty(navigator, "connection", {
      configurable: true,
      value: { effectiveType: "4g", saveData: true },
    });

    try {
      setupPretender((server, helper) => {
        server.get("/videos.json", () =>
          helper.response({
            items: [1, 2, 3].map((id) => feedItem(id, `Clip ${id}`)),
            next_cursor: null,
            scan_limit_reached: false,
          })
        );
      });

      await visit("/videos");

      assert
        .dom(".video-shorts-native-player__video")
        .exists({ count: 1 }, "only the active native item is mounted");
      assert.dom("[data-post-id='1'] video").hasAttribute("preload", "auto");
      assert.dom("[data-post-id='2'] video").doesNotExist();
    } finally {
      if (connectionDescriptor) {
        Object.defineProperty(navigator, "connection", connectionDescriptor);
      } else {
        delete navigator.connection;
      }
    }
  });

  test("hands playback to the dominant item before navigation state settles", async function (assert) {
    const previousIntersectionObserver = window.IntersectionObserver;
    const previousPause = window.HTMLMediaElement.prototype.pause;
    const pauseCounts = new WeakMap();
    const observers = [];

    window.HTMLMediaElement.prototype.pause = function () {
      pauseCounts.set(this, (pauseCounts.get(this) ?? 0) + 1);
      return previousPause.call(this);
    };

    window.IntersectionObserver = class TestIntersectionObserver {
      constructor(callback) {
        this.callback = callback;
        observers.push(this);
      }

      observe(element) {
        this.elements ??= [];
        this.elements.push(element);
      }

      disconnect() {}
    };

    try {
      setupPretender((server, helper) => {
        server.get("/videos.json", () =>
          helper.response({
            items: [1, 2, 3].map((id) => feedItem(id, `Clip ${id}`)),
            next_cursor: null,
            scan_limit_reached: false,
          })
        );
      });

      await visit("/videos");

      const previousVideo = document.querySelector(
        "[data-post-id='1'] .video-shorts-native-player__video"
      );
      const previousPauseCount = pauseCounts.get(previousVideo) ?? 0;
      const observer = observers[0];
      const secondItem = observer.elements.find(
        (element) => element.dataset.videoShortsIndex === "1"
      );

      observer.callback([
        {
          isIntersecting: true,
          intersectionRatio: 0.7,
          target: secondItem,
        },
      ]);

      await waitUntil(
        () =>
          document
            .querySelector(".video-shorts-feed__viewport")
            ?.getAttribute("data-playback-post-id") === "2"
      );

      assert
        .dom(".video-shorts-feed__viewport")
        .hasAttribute(
          "data-active-post-id",
          "1",
          "navigation state remains on the previous item during a swipe"
        );
      assert
        .dom("[data-post-id='1']")
        .hasAttribute(
          "aria-current",
          "true",
          "accessibility navigation remains on the previous item before scrollend"
        );
      assert.strictEqual(
        currentURL(),
        "/videos",
        "the URL remains unsettled while playback ownership changes"
      );
      assert.true(
        (pauseCounts.get(previousVideo) ?? 0) > previousPauseCount,
        "the previous native media element receives pause before navigation settles"
      );
      assert.true(
        previousVideo.paused,
        "the previous native media element is paused before navigation settles"
      );
      assert
        .dom("[data-post-id='1'] .video-shorts-native-player")
        .hasAttribute(
          "data-prewarm",
          "true",
          "the previous native player returns to its prewarm state"
        );
      assert
        .dom("[data-post-id='2'] .video-shorts-native-player")
        .hasAttribute(
          "data-prewarm",
          "false",
          "the dominant native item owns playback before scrollend"
        );

      document
        .querySelector(".video-shorts-feed__items")
        .dispatchEvent(new Event("scrollend"));

      await waitUntil(
        () =>
          document
            .querySelector(".video-shorts-feed__viewport")
            ?.getAttribute("data-active-post-id") === "2"
      );

      assert.dom("[data-post-id='2']").hasAttribute("aria-current", "true");
    } finally {
      if (previousIntersectionObserver) {
        window.IntersectionObserver = previousIntersectionObserver;
      } else {
        delete window.IntersectionObserver;
      }

      window.HTMLMediaElement.prototype.pause = previousPause;
    }
  });

  test("ignores stale visibility while restoring a requested item", async function (assert) {
    const previousIntersectionObserver = window.IntersectionObserver;
    const observers = [];

    window.IntersectionObserver = class TestIntersectionObserver {
      constructor(callback) {
        this.callback = callback;
        observers.push(this);
      }

      observe(element) {
        this.elements ??= [];
        this.elements.push(element);
      }

      disconnect() {}
    };

    const notifyVisibility = (index, intersectionRatio) => {
      const observer = observers[0];
      const element = observer.elements.find(
        (candidate) => candidate.dataset.videoShortsIndex === String(index)
      );

      observer.callback([
        {
          isIntersecting: intersectionRatio >= 0.6,
          intersectionRatio,
          target: element,
        },
      ]);
    };

    try {
      setupPretender((server, helper) => {
        server.get("/videos.json", () =>
          helper.response({
            items: [1, 2, 3].map((id) => feedItem(id, `Clip ${id}`)),
            next_cursor: null,
            scan_limit_reached: false,
          })
        );
      });

      await visit("/videos?post_id=2");

      notifyVisibility(0, 1);
      notifyVisibility(1, 0.7);
      notifyVisibility(0, 1);

      assert
        .dom(".video-shorts-feed__viewport")
        .hasAttribute(
          "data-playback-post-id",
          "2",
          "a delayed observer entry cannot reclaim playback during restoration"
        );

      document
        .querySelector(".video-shorts-feed__items")
        .dispatchEvent(new Event("scrollend"));

      notifyVisibility(0, 0.8);

      await waitUntil(
        () =>
          document
            .querySelector(".video-shorts-feed__viewport")
            ?.getAttribute("data-playback-post-id") === "1"
      );

      assert
        .dom(".video-shorts-feed__viewport")
        .hasAttribute(
          "data-active-post-id",
          "2",
          "normal playback handoff resumes after restoration settles"
        );
    } finally {
      if (previousIntersectionObserver) {
        window.IntersectionObserver = previousIntersectionObserver;
      } else {
        delete window.IntersectionObserver;
      }
    }
  });

  test("handles route shortcuts without pre-focusing the feed", async function (assert) {
    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [1, 2, 3, 4].map((id) => feedItem(id, `Clip ${id}`)),
          next_cursor: null,
          scan_limit_reached: false,
        })
      );
    });

    await visit("/videos");

    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "ArrowDown",
      })
    );
    document
      .querySelector(".video-shorts-feed__items")
      .dispatchEvent(new Event("scrollend"));
    await settled();

    assert
      .dom(".video-shorts-feed__viewport")
      .hasAttribute(
        "data-active-post-id",
        "2",
        "document navigation works without focusing the feed"
      );

    const input = document.createElement("input");
    document.body.append(input);

    try {
      input.focus();
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "ArrowDown",
        })
      );
      document
        .querySelector(".video-shorts-feed__items")
        .dispatchEvent(new Event("scrollend"));
      await settled();

      assert
        .dom(".video-shorts-feed__viewport")
        .hasAttribute(
          "data-active-post-id",
          "2",
          "editable controls are ignored"
        );
    } finally {
      input.remove();
    }

    document.querySelector(".video-shorts-feed__items").dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "ArrowDown",
      })
    );
    document
      .querySelector(".video-shorts-feed__items")
      .dispatchEvent(new Event("scrollend"));
    await settled();

    assert
      .dom(".video-shorts-feed__viewport")
      .hasAttribute(
        "data-active-post-id",
        "3",
        "the focused-feed and document handlers do not navigate twice"
      );
  });

  test("queues rapid keyboard navigation before scrolling settles", async function (assert) {
    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [1, 2, 3, 4].map((id) => feedItem(id, `Clip ${id}`)),
          next_cursor: null,
          scan_limit_reached: false,
        })
      );
    });

    await visit("/videos");

    const feed = document.querySelector(".video-shorts-feed__items");

    feed.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "ArrowDown",
      })
    );
    feed.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "ArrowDown",
      })
    );

    assert
      .dom(".video-shorts-feed__viewport")
      .hasAttribute(
        "data-active-post-id",
        "1",
        "playback stays committed while the scroll is moving"
      );

    feed.dispatchEvent(new Event("scrollend"));

    await waitUntil(
      () =>
        document
          .querySelector("[data-post-id='3']")
          ?.getAttribute("aria-current") === "true"
    );

    assert
      .dom("[data-post-id='3']")
      .hasAttribute(
        "aria-current",
        "true",
        "two rapid navigation commands advance two items"
      );
  });

  test("auto-loads near the end without starting duplicate cursor requests", async function (assert) {
    let cursorRequests = 0;
    let resolveCursorRequest;

    setupPretender((server, helper) => {
      server.get("/videos.json", (request) => {
        if (!request.queryParams.cursor) {
          return helper.response({
            items: [1, 2, 3, 4, 5, 6, 7].map((id) =>
              feedItem(id, `Clip ${id}`)
            ),
            next_cursor: "cursor-1",
            scan_limit_reached: false,
          });
        }

        cursorRequests += 1;

        return new Promise((resolve) => {
          resolveCursorRequest = () =>
            resolve(
              helper.response({
                items: [feedItem(8, "Clip 8")],
                next_cursor: null,
                scan_limit_reached: false,
              })
            );
        });
      });
    });

    await visit("/videos");

    assert
      .dom(".video-shorts-load-more")
      .exists("the manual pagination fallback remains available");

    const firstNavigation = triggerKeyEvent(
      ".video-shorts-feed__items",
      "keydown",
      "ArrowDown"
    );

    await waitUntil(() => cursorRequests === 1);

    document.querySelector(".video-shorts-feed__items").dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "ArrowDown",
      })
    );

    await waitUntil(
      () =>
        document
          .querySelector("[data-post-id='3']")
          ?.getAttribute("aria-current") === "true"
    );

    assert.strictEqual(
      cursorRequests,
      1,
      "near-end navigation remains single-flight while a page is loading"
    );

    resolveCursorRequest();
    await firstNavigation;
    await waitUntil(
      () => document.querySelectorAll(".video-shorts-feed__item").length === 8
    );

    assert.dom(".video-shorts-item").exists({ count: 5 });
    assert.dom("[data-post-id='8']").exists();
  });

  test("keeps background pagination failures out of the playback surface", async function (assert) {
    let cursorRequests = 0;

    setupPretender((server, helper) => {
      server.get("/videos.json", (request) => {
        if (!request.queryParams.cursor) {
          return helper.response({
            items: [1, 2, 3, 4, 5, 6, 7].map((id) =>
              feedItem(id, `Clip ${id}`)
            ),
            next_cursor: "cursor-1",
            scan_limit_reached: false,
          });
        }

        cursorRequests += 1;

        if (cursorRequests === 1) {
          return helper.response(500, { errors: ["Server error"] });
        }

        return helper.response({
          items: [feedItem(8, "Recovered clip")],
          next_cursor: null,
          scan_limit_reached: false,
        });
      });
    });

    await visit("/videos");
    await triggerKeyEvent(".video-shorts-feed__items", "keydown", "ArrowDown");
    await waitUntil(() => cursorRequests === 1);

    assert.dom(".video-shorts-feed__item").exists({ count: 7 });
    assert.dom(".video-shorts-item").exists({ count: 4 });
    assert
      .dom(".video-shorts-error")
      .doesNotExist("automatic continuation does not interrupt playback");
    assert
      .dom(".video-shorts-load-more")
      .exists("manual pagination remains available after a background failure");

    await click(".video-shorts-load-more");

    assert.dom("[data-post-id='8']").exists();
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

    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [hlsItem()],
          next_cursor: null,
          scan_limit_reached: false,
        })
      );
    });

    await visit("/videos");
    await waitUntil(
      () => loadedSource === "https://stream.example.com/video.m3u8"
    );

    assert.dom(".video-shorts-hls-player").exists({ count: 1 });
    assert
      .dom(".video-shorts-hls-player__video")
      .hasAttribute("data-hls-url", "https://stream.example.com/video.m3u8");
    assert.true(
      document.querySelector(".video-shorts-hls-player__video").muted,
      "HLS video starts muted for autoplay"
    );
    assert
      .dom(".video-shorts-hls-player .video-shorts-player__sound")
      .hasAttribute("aria-label", "Turn sound on");

    await click(".video-shorts-hls-player .video-shorts-player__sound");

    assert.false(
      document.querySelector(".video-shorts-hls-player__video").muted,
      "the visible sound control unmutes HLS video"
    );
    assert
      .dom(".video-shorts-hls-player .video-shorts-player__sound")
      .hasAttribute("aria-label", "Mute");
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

    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [hlsItem()],
          next_cursor: null,
          scan_limit_reached: false,
        })
      );
    });

    await visit("/videos");
    await waitUntil(() => hlsScriptSrc);

    assert.strictEqual(
      new URL(hlsScriptSrc).pathname,
      "/plugins/discourse-video-shorts/javascripts/hls.min.js",
      "HLS fallback script is served by the plugin, not a third-party CDN"
    );

    document.head.appendChild = previousAppendChild;
    HTMLMediaElement.prototype.canPlayType = previousCanPlayType;
    window.Hls = previousHls;
    document.getElementById("video-shorts-hls-js")?.remove();
  });

  test("iframe candidates require trusted provider and safe attributes", async function (assert) {
    setupPretender((server, helper) => {
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
        })
      );
    });

    await visit("/videos");

    assert.dom(".video-shorts-embed-player iframe").exists({ count: 1 });
    assert
      .dom(
        '.video-shorts-embed-player iframe[src="https://player.vimeo.com/video/123"]'
      )
      .hasAttribute("title", "vimeo video embed");
    assert
      .dom(
        '.video-shorts-embed-player iframe[src="https://player.vimeo.com/video/123"]'
      )
      .hasAttribute(
        "sandbox",
        "allow-scripts allow-same-origin allow-presentation"
      );
    assert
      .dom(
        '.video-shorts-embed-player iframe[src="https://player.vimeo.com/video/123"]'
      )
      .hasAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    assert
      .dom('.video-shorts-embed-player iframe[src*="player.bilibili.com"]')
      .doesNotExist();
    assert.dom(".video-shorts-embed-player__fallback").doesNotExist();
    assert.dom(".video-shorts-item__media-placeholder").exists({ count: 2 });
    assert.dom(".video-shorts-feed__item-placeholder").exists({ count: 1 });

    await triggerKeyEvent(".video-shorts-feed__items", "keydown", "ArrowDown");
    await waitUntil(
      () =>
        document
          .querySelector('[data-post-id="3"]')
          ?.getAttribute("aria-current") === "true"
    );

    assert
      .dom(
        '.video-shorts-embed-player iframe[src="https://player.vimeo.com/video/123"]'
      )
      .doesNotExist();
    assert
      .dom('.video-shorts-embed-player iframe[src*="player.bilibili.com"]')
      .hasAttribute("title", "bilibili video embed");
    assert.dom(".video-shorts-embed-player__fallback").doesNotExist();
    assert.dom(".video-shorts-item__media-placeholder").exists({ count: 3 });
  });

  test("unsafe active iframe candidates render fallback links", async function (assert) {
    setupPretender((server, helper) => {
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
        })
      );
    });

    await visit("/videos");

    assert.dom(".video-shorts-embed-player iframe").doesNotExist();
    assert.dom(".video-shorts-embed-player__fallback").hasText("Open topic");
  });

  test("renders trusted YouTube iframe candidates as embedded players", async function (assert) {
    setupPretender((server, helper) => {
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
        })
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

  test("Bilibili exposes the complete native Discourse action rail", async function (assert) {
    const actions = {
      liked: false,
      can_like: true,
      bookmarked: false,
      bookmark_id: null,
      can_bookmark: true,
      can_flag: true,
      can_reply: true,
      share_url: "/t/bilibili-video/1/1",
    };

    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [
            feedItem(
              1,
              "Bilibili action clip",
              {
                provider: "bilibili",
                renderability: "iframe_candidate",
                embed_url:
                  "https://player.bilibili.com/player.html?bvid=BV1Q541167Qg&page=1",
                dedupe_key: "bilibili:BV1Q541167Qg:page:1",
              },
              actions
            ),
          ],
          next_cursor: null,
          scan_limit_reached: false,
        })
      );
    });

    await visit("/videos");

    for (const action of [
      "like",
      "bookmark",
      "open-comments",
      "share",
      "flag",
      "open-topic",
    ]) {
      assert
        .dom(`.video-shorts-action-rail [data-action="${action}"]`)
        .isVisible(`${action} uses the native Discourse action surface`);
    }
  });

  test("ignores legacy publisher channel fields", async function (assert) {
    const item = feedItem(1, "Legacy channel field");
    item.publisher_channel_url =
      "https://www.youtube.com/@video.publisher";

    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [item],
          next_cursor: null,
          scan_limit_reached: false,
        })
      );
    });

    await visit("/videos");

    assert
      .dom('.video-shorts-action-rail [data-action="open-channel"]')
      .doesNotExist();
    assert
      .dom('.video-shorts-action-rail [data-action="open-topic"]')
      .isVisible("topic navigation remains available");
  });

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

    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [feedItem(1, "Action clip", null, actions)],
          next_cursor: null,
          scan_limit_reached: false,
        })
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

    assert.dom("[data-action='like']").hasAttribute("aria-pressed", "false");
    assert
      .dom("[data-action='bookmark']")
      .hasAttribute("aria-pressed", "false");

    await click("[data-action='like']");
    await click("[data-action='bookmark']");

    assert.dom("[data-action='like']").hasAttribute("aria-pressed", "true");
    assert.dom("[data-action='bookmark']").hasAttribute("aria-pressed", "true");
  });

  test("like and bookmark update optimistically and lock duplicate requests", async function (assert) {
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
    let likeRequests = 0;
    let bookmarkRequests = 0;
    let resolveLike;
    let resolveBookmark;

    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [feedItem(1, "Optimistic action clip", null, actions)],
          next_cursor: null,
          scan_limit_reached: false,
        })
      );

      server.post("/post_actions", () => {
        likeRequests += 1;

        return new Promise((resolve) => {
          resolveLike = () => resolve(helper.response({ result: {} }));
        });
      });

      server.post("/bookmarks.json", () => {
        bookmarkRequests += 1;

        return new Promise((resolve) => {
          resolveBookmark = () => resolve(helper.response({ id: 99 }));
        });
      });
    });

    await visit("/videos");

    const likeClick = click("[data-action='like']");

    await waitUntil(
      () =>
        document
          .querySelector("[data-action='like']")
          ?.getAttribute("aria-busy") === "true"
    );

    assert.dom("[data-action='like']").hasAttribute("aria-pressed", "true");
    assert
      .dom("[data-action='like'] .video-shorts-action-rail__count")
      .hasText("1");
    assert.dom("[data-action='like']").hasAttribute("disabled");

    await waitUntil(
      () => likeRequests === 1 && typeof resolveLike === "function"
    );

    try {
      document.querySelector("[data-action='like']").click();
      assert.strictEqual(likeRequests, 1, "a pending like is single-flight");
    } finally {
      resolveLike?.();
    }
    await likeClick;

    assert.dom("[data-action='like']").hasAttribute("aria-busy", "false");

    const bookmarkClick = click("[data-action='bookmark']");

    await waitUntil(
      () =>
        document
          .querySelector("[data-action='bookmark']")
          ?.getAttribute("aria-busy") === "true"
    );

    assert.dom("[data-action='bookmark']").hasAttribute("aria-pressed", "true");
    assert
      .dom("[data-action='bookmark'] .video-shorts-action-rail__count")
      .hasText("1");
    assert.dom("[data-action='bookmark']").hasAttribute("disabled");

    await waitUntil(
      () => bookmarkRequests === 1 && typeof resolveBookmark === "function"
    );

    try {
      document.querySelector("[data-action='bookmark']").click();
      assert.strictEqual(
        bookmarkRequests,
        1,
        "a pending bookmark is single-flight"
      );
    } finally {
      resolveBookmark?.();
    }
    await bookmarkClick;

    assert.dom("[data-action='bookmark']").hasAttribute("aria-busy", "false");
  });

  test("liked posts can be unliked and liked again without refreshing", async function (assert) {
    const actions = {
      liked: true,
      can_like: false,
      bookmarked: false,
      bookmark_id: null,
      can_bookmark: true,
      can_flag: true,
      can_reply: true,
      share_url: "/t/video-1/1/1",
    };
    let likeRequests = 0;
    let unlikeRequests = 0;

    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [
            {
              ...feedItem(1, "Re-toggle like clip", null, actions),
              native_action_summary: [
                { id: 2, acted: true, can_act: false, can_undo: true },
              ],
            },
          ],
          next_cursor: null,
          scan_limit_reached: false,
        })
      );

      server.delete("/post_actions/1", (request) => {
        const body = new URLSearchParams(request.requestBody);

        unlikeRequests += 1;
        assert.notStrictEqual(body.get("post_action_type_id"), null);

        return helper.response({ result: {} });
      });

      server.post("/post_actions", (request) => {
        const body = new URLSearchParams(request.requestBody);

        likeRequests += 1;
        assert.strictEqual(body.get("id"), "1");
        assert.notStrictEqual(body.get("post_action_type_id"), null);

        return helper.response({ result: {} });
      });
    });

    await visit("/videos");

    assert.dom("[data-action='like']").hasAttribute("aria-pressed", "true");
    assert
      .dom("[data-action='like']")
      .doesNotHaveAttribute("disabled", "liked posts can be unliked");

    await click("[data-action='like']");

    assert.strictEqual(unlikeRequests, 1);
    assert.dom("[data-action='like']").hasAttribute("aria-pressed", "false");
    assert
      .dom("[data-action='like']")
      .doesNotHaveAttribute("disabled", "unliked posts remain likeable");

    await click("[data-action='like']");

    assert.strictEqual(likeRequests, 1);
    assert.dom("[data-action='like']").hasAttribute("aria-pressed", "true");
  });

  test("rolls back an optimistic like when Discourse rejects it", async function (assert) {
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
    let rejectLike;

    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [feedItem(1, "Rejected like clip", null, actions)],
          next_cursor: null,
          scan_limit_reached: false,
        })
      );

      server.post(
        "/post_actions",
        () =>
          new Promise((resolve) => {
            rejectLike = () =>
              resolve(helper.response(500, { errors: ["Rejected"] }));
          })
      );
    });

    await visit("/videos");

    const likeClick = click("[data-action='like']");

    await waitUntil(
      () =>
        document
          .querySelector("[data-action='like']")
          ?.getAttribute("aria-pressed") === "true"
    );
    assert
      .dom("[data-action='like'] .video-shorts-action-rail__count")
      .hasText("1");

    await waitUntil(() => typeof rejectLike === "function");

    rejectLike();
    await likeClick;

    assert.dom("[data-action='like']").hasAttribute("aria-pressed", "false");
    assert.dom("[data-action='like']").hasAttribute("aria-busy", "false");
    assert
      .dom("[data-action='like'] .video-shorts-action-rail__count")
      .hasText("0");
  });

  test("rolls back an optimistic bookmark when Discourse rejects it", async function (assert) {
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
    let rejectBookmark;

    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [feedItem(1, "Rejected bookmark clip", null, actions)],
          next_cursor: null,
          scan_limit_reached: false,
        })
      );

      server.post(
        "/bookmarks.json",
        () =>
          new Promise((resolve) => {
            rejectBookmark = () =>
              resolve(helper.response(500, { errors: ["Rejected"] }));
          })
      );
    });

    await visit("/videos");

    const bookmarkClick = click("[data-action='bookmark']");

    await waitUntil(
      () =>
        document
          .querySelector("[data-action='bookmark']")
          ?.getAttribute("aria-pressed") === "true"
    );
    assert
      .dom("[data-action='bookmark'] .video-shorts-action-rail__count")
      .hasText("1");

    await waitUntil(() => typeof rejectBookmark === "function");

    rejectBookmark();
    await bookmarkClick;

    assert
      .dom("[data-action='bookmark']")
      .hasAttribute("aria-pressed", "false");
    assert.dom("[data-action='bookmark']").hasAttribute("aria-busy", "false");
    assert
      .dom("[data-action='bookmark'] .video-shorts-action-rail__count")
      .hasText("0");
  });
});

acceptance("Video Shorts anonymous actions", function (needs) {
  needs.settings({ video_shorts_enabled: true });

  test("restricted actions open the native login route", async function (assert) {
    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [feedItem(1, "Anonymous action clip")],
          next_cursor: null,
          scan_limit_reached: false,
        })
      );
    });

    await visit("/videos");
    await click("[data-action='like']");

    assert.strictEqual(currentURL(), "/login");
  });
});

acceptance("Video Shorts route disabled", function (needs) {
  needs.settings({ video_shorts_enabled: false });

  test("shows native unknown route without mounting the feed", async function (assert) {
    setupPretender((server, helper) => {
      server.get("/permalink-check.json", () =>
        helper.response({
          found: false,
          html: "<div class='page-not-found'>not found</div>",
        })
      );
    });

    await visit("/videos");

    assert.strictEqual(currentURL(), "/videos");
    assert.dom(".page-not-found").exists();
    assert.dom(".video-shorts-feed").doesNotExist();
  });
});
