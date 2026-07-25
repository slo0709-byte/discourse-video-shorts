import { click, currentURL, triggerKeyEvent, visit } from "@ember/test-helpers";
import { test } from "qunit";
import pretender, {
  pretenderHelpers,
} from "discourse/tests/helpers/create-pretender";
import { acceptance } from "discourse/tests/helpers/qunit-helpers";

function setupPretender(callback) {
  const helpers = pretenderHelpers();
  const repliesByPostId = new Map();
  const server = new Proxy(pretender, {
    get(target, property) {
      if (property === "get") {
        return (path, handler, ...args) => {
          const match = path.match(/^\/posts\/(\d+)\/replies\.json$/);

          if (match) {
            repliesByPostId.set(match[1], handler);
          }

          return target.get(path, handler, ...args);
        };
      }

      const value = Reflect.get(target, property);

      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  callback(server, helpers);
  pretender.get("/video-shorts/comments/replies.json", (request) => {
    const handler = repliesByPostId.get(request.queryParams.post_id);

    if (!handler) {
      return helpers.response(404, { error: "not_found" });
    }

    const normalizeResponse = (response) => {
      const [status, headers, posts] = response;

      return status === 200 && Array.isArray(posts)
        ? [
            status,
            headers,
            {
              posts,
              has_more: posts.length === 20,
              next_after: posts.at(-1)?.post_number || null,
            },
          ]
        : response;
    };
    const response = handler(request);

    return typeof response?.then === "function"
      ? response.then(normalizeResponse)
      : normalizeResponse(response);
  });
}

function feedItem(id, title, attrs = {}) {
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
      reply_count: 2,
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
      share_url: `/t/video-${id}/${id}/1`,
    },
    native_action_summary: [
      {
        id: 2,
        can_act: true,
      },
    ],
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

function computedThemeColor(variableName) {
  const probe = document.createElement("div");
  probe.style.color = `var(${variableName})`;
  document.body.append(probe);
  const color = getComputedStyle(probe).color;

  probe.remove();

  return color;
}

function isIdentityTransform(transform) {
  return transform === "none" || transform === "matrix(1, 0, 0, 1, 0, 0)";
}

function appendDesktopSidebarFixture() {
  const sidebar = document.createElement("aside");
  sidebar.className = "sidebar-wrapper video-shorts-test-sidebar";
  sidebar.setAttribute("aria-label", "Primary navigation");
  sidebar.style.cssText = [
    "position: fixed",
    "inset: var(--header-offset, 4em) auto 0 0",
    "display: block",
    "width: 248px",
    "visibility: visible",
    "background: var(--secondary)",
  ].join(";");

  const navigation = document.createElement("nav");
  navigation.className = "sidebar-container";
  navigation.textContent = "Videos navigation";
  sidebar.append(navigation);

  document.body.append(sidebar);

  return sidebar;
}

function cssPixelValue(value) {
  const parsedValue = Number.parseFloat(value);

  return Number.isFinite(parsedValue) ? parsedValue : 0;
}

function isTransparentColor(color) {
  return (
    !color ||
    color === "transparent" ||
    color === "rgba(0, 0, 0, 0)" ||
    /,\s*0\)$/.test(color)
  );
}

function hasPaintedBackground(style) {
  return (
    style.backgroundImage !== "none" ||
    !isTransparentColor(style.backgroundColor)
  );
}

function mobileRuleTextsFor(selectorMatcher) {
  return [...document.styleSheets].flatMap((sheet) => {
    try {
      return [...sheet.cssRules].flatMap((rule) => {
        if (!rule.conditionText?.includes("width < 1024px")) {
          return [];
        }

        return [...rule.cssRules]
          .filter((nestedRule) =>
            selectorMatcher(nestedRule.selectorText || ""),
          )
          .map((nestedRule) => nestedRule.cssText);
      });
    } catch {
      return [];
    }
  });
}

function desktopRuleTextsFor(selectorMatcher) {
  return [...document.styleSheets].flatMap((sheet) => {
    try {
      return [...sheet.cssRules].flatMap((rule) => {
        if (!rule.conditionText?.includes("width >= 1024px")) {
          return [];
        }

        return [...rule.cssRules]
          .filter((nestedRule) =>
            selectorMatcher(nestedRule.selectorText || ""),
          )
          .map((nestedRule) => nestedRule.cssText);
      });
    } catch {
      return [];
    }
  });
}

function ruleTextsFor(selectorMatcher) {
  return [...document.styleSheets].flatMap((sheet) => {
    try {
      return [...sheet.cssRules]
        .filter((rule) => !rule.conditionText)
        .filter((rule) => selectorMatcher(rule.selectorText || ""))
        .map((rule) => rule.cssText);
    } catch {
      return [];
    }
  });
}

function nativePostSelector(postId) {
  return `[data-video-shorts-native-comment][data-post-id="${postId}"]`;
}

function nativePostActionSelector(postId, action) {
  return `${nativePostSelector(postId)} .post-action-menu__${action}, [data-content] .post-action-menu__${action}`;
}

async function revealNativePostActions(postId) {
  const moreActions = document.querySelector(
    `${nativePostSelector(postId)} .show-more-actions`,
  );

  if (moreActions) {
    await click(moreActions);
  }
}

acceptance("Video Shorts refined layout contract", function (needs) {
  needs.settings({ video_shorts_enabled: true });
  needs.user();

  test("desktop uses explicit comments opener and right comments panel", async function (assert) {
    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [feedItem(301, "Desktop comments panel clip")],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );

      server.get("/posts/301/replies.json", () =>
        helper.response([
          {
            id: 401,
            username: "reply-author",
            cooked: "<p>Panel reply</p>",
            reply_count: 1,
            post_number: 2,
          },
        ]),
      );
    });

    await visit("/videos");

    assert
      .dom('[data-action="open-comments"]')
      .exists("rail exposes a dedicated comments opener");
    assert
      .dom('[data-action="reply"]')
      .doesNotExist("rail no longer uses reply as the comments opener");
    assert
      .dom(".video-shorts-item__stage .video-shorts-action-rail")
      .doesNotExist("desktop action rail is outside the video stage");
    assert.dom(".video-shorts-action-rail").exists();
    const closedStageRect = document
      .querySelector(".video-shorts-item__stage")
      .getBoundingClientRect();
    const closedStageAfterStyle = getComputedStyle(
      document.querySelector(".video-shorts-item__stage"),
      "::after",
    );
    const closedMetadata = document.querySelector(".video-shorts-metadata");
    const closedMetadataRect = closedMetadata.getBoundingClientRect();
    const closedMetadataStyle = getComputedStyle(closedMetadata);
    const closedInfoRect = document
      .querySelector(".video-shorts-item__info")
      .getBoundingClientRect();
    const closedRailRect = document
      .querySelector(".video-shorts-action-rail")
      .getBoundingClientRect();
    const closedViewportRect = document
      .querySelector(".video-shorts-feed__viewport")
      .getBoundingClientRect();
    const closedRailIsSized =
      closedRailRect.width > 0 && closedRailRect.height > 0;

    assert.true(
      closedRailIsSized,
      "desktop closed action rail is visibly sized",
    );
    assert.true(
      closedRailRect.right <= window.innerWidth,
      "desktop closed action rail remains inside the viewport",
    );
    assert.strictEqual(
      getComputedStyle(
        document.querySelector(
          ".video-shorts-action-rail [data-action='open-comments']",
        ),
      ).color,
      computedThemeColor("--primary"),
      "desktop closed action rail stays readable on the Discourse page background",
    );
    assert.true(
      closedInfoRect.bottom >= closedStageRect.top,
      "desktop closed metadata is bottom-aligned near the video stage",
    );
    assert.true(
      closedStageRect.bottom - closedInfoRect.bottom <= 80,
      "desktop closed metadata leaves only the playback area at the bottom",
    );
    assert.true(
      closedStageRect.height <= closedViewportRect.height,
      "desktop video stage fits inside the route viewport height",
    );
    assert.true(
      Math.abs(closedStageRect.height / closedStageRect.width - 16 / 9) <= 0.02,
      "desktop video stage preserves a 9:16 display ratio",
    );
    const closedStageScrimHeight = cssPixelValue(closedStageAfterStyle.height);
    const hasBoundedStageScrim =
      closedStageAfterStyle.content !== "none" &&
      closedStageScrimHeight >= closedMetadataRect.height &&
      closedStageScrimHeight <= closedStageRect.height * 0.45 &&
      hasPaintedBackground(closedStageAfterStyle);
    const hasMetadataBacking =
      closedMetadataStyle.textShadow !== "none" ||
      hasPaintedBackground(closedMetadataStyle);
    const hasReadableMetadataBacking =
      hasBoundedStageScrim || hasMetadataBacking;
    const hasFullStageDarkVeil =
      closedStageAfterStyle.content !== "none" &&
      closedStageScrimHeight >= closedStageRect.height * 0.9;

    assert.true(
      hasReadableMetadataBacking,
      "desktop metadata has a readable local backing over the video",
    );
    assert.false(
      hasFullStageDarkVeil,
      "desktop metadata readability does not depend on a full-stage dark veil",
    );

    await click('[data-action="open-comments"]');

    assert.strictEqual(currentURL(), "/videos");
    assert
      .dom(".video-shorts-comments-panel")
      .exists("desktop opens an in-layout comments panel");
    assert.dom(".video-shorts-comments-panel").includesText("reply-author");
    assert
      .dom(".video-shorts-comments-sheet")
      .doesNotExist("desktop does not use the mobile comments sheet");
    const playerTransitionRules = desktopRuleTextsFor((selectorText) =>
      selectorText
        .split(",")
        .map((selector) => selector.trim())
        .includes("body.video-shorts-route .video-shorts-item__player"),
    );
    const panelTransitionRules = desktopRuleTextsFor((selectorText) =>
      selectorText
        .split(",")
        .map((selector) => selector.trim())
        .includes("body.video-shorts-route .video-shorts-comments-panel"),
    );
    const commentsPanelRect = document
      .querySelector(".video-shorts-comments-panel")
      .getBoundingClientRect();
    const commentsOpenViewportRules = desktopRuleTextsFor((selectorText) =>
      selectorText.includes(
        '.video-shorts-feed__viewport[data-comments-open="true"]',
      ),
    );
    const openViewportRect = document
      .querySelector(".video-shorts-feed__viewport")
      .getBoundingClientRect();
    const openStageRect = document
      .querySelector(".video-shorts-item__stage")
      .getBoundingClientRect();
    const openInfoRect = document
      .querySelector(".video-shorts-item__info")
      .getBoundingClientRect();
    const openRailRect = document
      .querySelector(".video-shorts-action-rail")
      .getBoundingClientRect();
    const publisherLinkStyle = getComputedStyle(
      document.querySelector(".video-shorts-metadata__publisher-link"),
    );

    assert.true(
      playerTransitionRules.some((cssText) =>
        cssText.includes("transition: transform"),
      ),
      "desktop player exposes a transform transition for comments-open motion",
    );
    assert.true(
      panelTransitionRules.some(
        (cssText) =>
          cssText.includes("transition:") &&
          cssText.includes("opacity") &&
          cssText.includes("transform"),
      ),
      "desktop comments panel exposes an entrance transition",
    );
    assert.true(
      commentsPanelRect.width > 0,
      "desktop comments panel remains visibly sized",
    );
    assert.true(
      commentsOpenViewportRules.some(
        (cssText) =>
          cssText.includes("minmax(360px, 420px)") ||
          cssText.includes("max-width: 420px"),
      ),
      "desktop comments panel keeps the route's 360px to 420px responsive width contract",
    );
    assert.true(
      commentsPanelRect.right <= window.innerWidth,
      "desktop comments panel remains fully visible inside the viewport",
    );
    assert.true(
      openRailRect.right <= commentsPanelRect.left,
      "desktop action rail remains visible and separate from the comments panel",
    );
    assert.strictEqual(
      getComputedStyle(
        document.querySelector(
          ".video-shorts-action-rail [data-action='open-comments']",
        ),
      ).color,
      computedThemeColor("--primary"),
      "desktop action rail stays readable on the Discourse page background",
    );
    assert.true(
      openStageRect.height <= openViewportRect.height,
      "desktop comments-open stage fits inside the route viewport height",
    );
    assert.true(
      openInfoRect.bottom <= openStageRect.bottom,
      "desktop comments-open metadata does not escape below the video stage",
    );
    assert.true(
      openInfoRect.bottom >= openStageRect.top,
      "desktop comments-open metadata remains inside the video stage",
    );
    assert.strictEqual(
      publisherLinkStyle.pointerEvents,
      "auto",
      "desktop comments-open publisher link remains clickable",
    );
    assert.true(
      document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
      "desktop comments-open layout does not create horizontal overflow",
    );
  });

  test("desktop player keeps 9:16 bounds with comments open and closed", async function (assert) {
    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [feedItem(302, "Desktop bounded player clip")],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );

      server.get("/posts/302/replies.json", () =>
        helper.response([
          directReply(402, "reply-author", "<p>Layout reply</p>"),
        ]),
      );
    });

    await visit("/videos");

    const assertLayout = (stateLabel, { metadataInsideStage = false } = {}) => {
      const stage = document.querySelector(".video-shorts-item__stage");
      const stageRect = document
        .querySelector(".video-shorts-item__stage")
        .getBoundingClientRect();
      const viewportRect = document
        .querySelector(".video-shorts-feed__viewport")
        .getBoundingClientRect();
      const railRect = document
        .querySelector(".video-shorts-action-rail")
        .getBoundingClientRect();
      const railIsSized = railRect.width > 0 && railRect.height > 0;
      const infoRect = document
        .querySelector(".video-shorts-item__info")
        .getBoundingClientRect();
      const metadataInsideBounds = metadataInsideStage
        ? infoRect.left >= stageRect.left && infoRect.right <= stageRect.right
        : infoRect.right <= viewportRect.right;

      assert.strictEqual(
        getComputedStyle(stage).aspectRatio,
        "9 / 16",
        `${stateLabel}: stage remains close to 9:16`,
      );
      assert.true(
        stageRect.left >= viewportRect.left,
        `${stateLabel}: stage left edge stays inside viewport`,
      );
      assert.true(
        stageRect.right <= viewportRect.right,
        `${stateLabel}: stage right edge stays inside viewport`,
      );
      assert.true(
        railRect.left >= stageRect.right,
        `${stateLabel}: action rail stays outside the video stage`,
      );
      assert.true(
        railIsSized,
        `${stateLabel}: action rail remains visibly sized`,
      );
      assert.true(
        railRect.right <= window.innerWidth,
        `${stateLabel}: action rail remains inside the viewport`,
      );
      assert.true(
        stageRect.bottom - infoRect.bottom <= 80,
        `${stateLabel}: metadata reserves only the playback control area`,
      );
      assert.true(
        metadataInsideBounds,
        `${stateLabel}: metadata stays inside its layout bounds`,
      );
      assert.true(
        document.documentElement.scrollWidth <=
          document.documentElement.clientWidth + 1,
        `${stateLabel}: layout does not create horizontal overflow`,
      );
    };

    assertLayout("comments closed");

    await click('[data-action="open-comments"]');

    assert.dom(".video-shorts-comments-panel").exists();
    assertLayout("comments open", { metadataInsideStage: true });

    const commentsPanelRect = document
      .querySelector(".video-shorts-comments-panel")
      .getBoundingClientRect();
    const railRect = document
      .querySelector(".video-shorts-action-rail")
      .getBoundingClientRect();

    assert.true(
      railRect.right <= commentsPanelRect.left,
      "comments-open rail does not overlap the comments panel",
    );
  });

  test("desktop sidebar route shell does not push the videos viewport offscreen", async function (assert) {
    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [feedItem(305, "Sidebar page clip")],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );
    });

    const sidebar = appendDesktopSidebarFixture();
    document.body.classList.add("has-sidebar-page");

    try {
      await visit("/videos");

      assert
        .dom(".video-shorts-left-nav")
        .doesNotExist(
          "video route does not render a custom YouTube-style left nav",
        );

      const sidebarStyle = getComputedStyle(sidebar);
      const sidebarRect = sidebar.getBoundingClientRect();
      const viewportRect = document
        .querySelector(".video-shorts-feed__viewport")
        .getBoundingClientRect();
      const viewportStyle = getComputedStyle(
        document.querySelector(".video-shorts-feed__viewport"),
      );
      assert.notStrictEqual(
        sidebarStyle.display,
        "none",
        "desktop video route keeps the left navigation sidebar rendered",
      );
      assert.notStrictEqual(
        sidebarStyle.visibility,
        "hidden",
        "desktop video route keeps the left navigation sidebar visible",
      );
      assert.true(
        sidebarRect.width >= 200,
        "desktop video route preserves a usable left navigation width",
      );
      assert.true(
        viewportRect.left >= 0,
        "sidebar page shell does not translate the videos viewport past the left edge",
      );
      assert.true(
        isIdentityTransform(viewportStyle.transform),
        "sidebar page shell centers the videos viewport without transform offsets",
      );
      assert.true(
        viewportRect.right <= window.innerWidth,
        "sidebar page shell keeps the videos viewport inside the right edge",
      );
      assert.true(
        document.documentElement.scrollWidth <=
          document.documentElement.clientWidth + 1,
        "sidebar page shell does not create horizontal overflow",
      );
    } finally {
      document.body.classList.remove("has-sidebar-page");
      sidebar.remove();
    }
  });

  test("mobile video route exposes top hamburger control instead of bottom tabs", async function (assert) {
    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [feedItem(303, "Mobile back control clip")],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );
    });

    await visit("/");
    await visit("/videos");

    assert
      .dom(".video-shorts-mobile-back")
      .exists("video route has its own top back control");
    assert.dom(".video-shorts-mobile-back").hasAttribute("aria-label", "Back");
    const mobileBackRules = mobileRuleTextsFor((selectorText) =>
      selectorText
        .split(",")
        .map((selector) => selector.trim())
        .includes("body.video-shorts-route .video-shorts-mobile-back"),
    );
    assert.true(
      mobileBackRules.some(
        (cssText) =>
          cssText.includes(
            "min-height: var(--video-shorts-control-size, 44px)",
          ) &&
          cssText.includes(
            "min-width: var(--video-shorts-control-size, 44px)",
          ),
      ),
      "video route back control keeps a hit-testable touch target",
    );
    assert
      .dom(".video-shorts-mobile-back .d-icon-bars")
      .exists("top route control uses a hamburger icon");
    assert
      .dom("body.video-shorts-route .x-bottom-tabs")
      .doesNotExist(
        "video route does not render mobile bottom navigation tabs",
      );

    await click(".video-shorts-mobile-back");

    assert.notStrictEqual(
      currentURL(),
      "/videos",
      "mobile back control leaves the dedicated video route",
    );
  });

  test("item metadata and action rail keep a stable mobile overlay structure", async function (assert) {
    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [feedItem(302, "Mobile overlay clip")],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );
    });

    await visit("/videos");

    const item = document.querySelector(".video-shorts-item");
    const itemChildren = [...item.children].map((element) => element.className);
    const playerChildren = [
      ...item.querySelector(".video-shorts-item__player").children,
    ].map((element) => element.className);
    const itemStyle = getComputedStyle(item);
    const infoStyle = getComputedStyle(
      item.querySelector(".video-shorts-item__info"),
    );
    const mobileInfoRules = mobileRuleTextsFor((selectorText) =>
      selectorText
        .split(",")
        .map((selector) => selector.trim())
        .includes(".video-shorts-item__info"),
    );
    const rail = item.querySelector(".video-shorts-action-rail");
    const railStyle = getComputedStyle(rail);
    const railButton = rail.querySelector('[data-action="open-comments"]');
    const railButtonStyle = getComputedStyle(railButton);
    const railButtonRules = ruleTextsFor((selectorText) =>
      selectorText
        .split(",")
        .map((selector) => selector.trim())
        .includes(".video-shorts-action-rail__button"),
    );

    assert.deepEqual(
      itemChildren,
      ["video-shorts-item__info", "video-shorts-item__player"],
      "metadata is a stable item-level surface that can be repositioned on mobile",
    );
    assert.deepEqual(
      playerChildren,
      ["video-shorts-item__stage", "video-shorts-action-rail"],
      "the action rail remains a sibling of the stage so it stays clickable",
    );
    assert
      .dom(".video-shorts-item__info .video-shorts-metadata")
      .includesText("@video-author");
    assert
      .dom(".video-shorts-item__info .video-shorts-metadata")
      .includesText("Mobile overlay clip");
    assert
      .dom(".video-shorts-item__stage .video-shorts-metadata")
      .doesNotExist();
    assert.strictEqual(
      itemStyle.backgroundColor,
      computedThemeColor("--secondary"),
      "video route shell follows the Discourse theme background",
    );
    assert.strictEqual(
      infoStyle.gridColumnStart,
      "1",
      "desktop metadata overlays the video column",
    );
    assert.strictEqual(
      infoStyle.pointerEvents,
      "none",
      "metadata overlay does not block the mobile rail hit targets",
    );
    assert.true(
      mobileInfoRules.some((cssText) =>
        cssText.includes("--video-shorts-mobile-playbar-reserve"),
      ),
      "mobile metadata reserve is named as the bottom playback control area",
    );
    assert.deepEqual(
      mobileInfoRules.filter((cssText) => cssText.includes("7.5rem")),
      [],
      "mobile metadata no longer reserves a large vertical gap above the playbar",
    );
    assert.true(
      railStyle.zIndex > infoStyle.zIndex,
      "mobile rail is layered above metadata",
    );
    assert.true(
      railButtonRules.some(
        (cssText) =>
          cssText.includes("width: var(--video-shorts-control-size)") &&
          cssText.includes("min-width: var(--video-shorts-control-size)"),
      ),
      "comments rail button keeps a 44px minimum hit target",
    );
    assert.true(
      railButtonRules.some((cssText) =>
        cssText.includes("min-height: var(--video-shorts-control-size)"),
      ),
      "comments rail button keeps a 44px minimum hit target height",
    );
    assert.strictEqual(
      railButtonStyle.backgroundColor,
      "rgba(0, 0, 0, 0)",
      "comments rail button keeps a lightweight transparent visual background",
    );
    assert.strictEqual(
      railButtonStyle.boxShadow,
      "none",
      "comments rail button does not draw a square/card shadow",
    );
    assert.false(
      mobileRuleTextsFor((selector) =>
        selector.includes("video-shorts-comments-surface__child-list"),
      ).some((text) => text.includes("calc(-1")),
      "mobile comments sheet does not use negative margins for nested replies",
    );
  });

  test("desktop closing comments after moving active video does not refocus the old opener", async function (assert) {
    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [
            feedItem(401, "First scroll close clip"),
            feedItem(402, "Second scroll close clip"),
          ],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );

      server.get("/posts/401/replies.json", () => helper.response([]));
      server.get("/posts/402/replies.json", () => helper.response([]));
    });

    await visit("/videos");

    const firstOpener = document.querySelector(
      '[data-post-id="401"] [data-action="open-comments"]',
    );
    let oldOpenerFocusCount = 0;
    firstOpener.focus = () => {
      oldOpenerFocusCount += 1;
    };

    await click(firstOpener);
    const focusCountAfterOpen = oldOpenerFocusCount;
    assert
      .dom(".video-shorts-comments-panel")
      .hasAttribute("data-comments-post-id", "401");

    await triggerKeyEvent(".video-shorts-feed__items", "keydown", "ArrowDown");

    assert
      .dom(".video-shorts-feed__viewport")
      .hasAttribute("data-active-post-id", "402");
    assert
      .dom(".video-shorts-comments-panel")
      .hasAttribute(
        "data-comments-post-id",
        "402",
        "desktop comments follow the active video while the panel remains open",
      );

    await click('[data-action="close-comments"]');

    assert.strictEqual(
      oldOpenerFocusCount,
      focusCountAfterOpen,
      "closing the panel does not restore focus to an opener from a stale video",
    );
    assert
      .dom(".video-shorts-feed__viewport")
      .hasAttribute(
        "data-active-post-id",
        "402",
        "active video remains the one the user scrolled to",
      );
  });

  test("closing comments restores feed controls and does not jump active video", async function (assert) {
    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [
            feedItem(601, "Close recovery first clip"),
            feedItem(602, "Close recovery second clip"),
            feedItem(603, "Close recovery third clip"),
          ],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );

      server.get("/posts/601/replies.json", () =>
        helper.response([directReply(701, "first-author", "<p>First</p>")]),
      );
      server.get("/posts/602/replies.json", () =>
        helper.response([directReply(702, "second-author", "<p>Second</p>")]),
      );
      server.get("/posts/603/replies.json", () =>
        helper.response([directReply(703, "third-author", "<p>Third</p>")]),
      );
    });

    await visit("/videos");
    await click('[data-post-id="601"] [data-action="open-comments"]');

    assert
      .dom(".video-shorts-feed__viewport")
      .hasAttribute("data-active-post-id", "601");
    assert.dom(".video-shorts-comments-panel").exists();

    document.querySelector(".video-shorts-comments-panel__body").focus();
    await triggerKeyEvent(
      ".video-shorts-comments-panel__body",
      "keydown",
      "ArrowDown",
    );

    assert
      .dom(".video-shorts-feed__viewport")
      .hasAttribute(
        "data-active-post-id",
        "601",
        "feed shortcuts are ignored while focus is inside comments",
      );

    await click('[data-action="close-comments"]');

    assert.dom(".video-shorts-comments-panel").doesNotExist();
    assert
      .dom(".video-shorts-feed__viewport")
      .hasAttribute("data-comments-open", "false");
    assert
      .dom(".video-shorts-feed__viewport")
      .hasAttribute(
        "data-active-post-id",
        "601",
        "closing comments does not reset to another video",
      );
    assert.strictEqual(
      document.activeElement,
      document.querySelector(".video-shorts-feed__items"),
      "feed item container receives focus after close",
    );

    await triggerKeyEvent(".video-shorts-feed__items", "keydown", "ArrowDown");

    assert
      .dom(".video-shorts-feed__viewport")
      .hasAttribute(
        "data-active-post-id",
        "602",
        "feed keyboard controls work after close",
      );

    await click('[data-post-id="602"] [data-action="share"]');

    assert.dom(".d-modal").exists("share modal opens after comment close");
  });

  test("desktop opening comments from another visible item makes that item active", async function (assert) {
    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [
            feedItem(501, "Initially active clip"),
            feedItem(502, "Clicked comments clip"),
          ],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );

      server.get("/posts/501/replies.json", () => helper.response([]));
      server.get("/posts/502/replies.json", () => helper.response([]));
    });

    await visit("/videos");

    assert
      .dom(".video-shorts-feed__viewport")
      .hasAttribute("data-active-post-id", "501");

    await click('[data-post-id="502"] [data-action="open-comments"]');

    assert
      .dom(".video-shorts-feed__viewport")
      .hasAttribute(
        "data-active-post-id",
        "502",
        "clicked comments item becomes the active desktop item",
      );
    assert
      .dom(".video-shorts-comments-panel")
      .hasAttribute(
        "data-comments-post-id",
        "502",
        "desktop panel opens for the clicked item instead of stale active state",
      );
  });

  test("desktop deleting a comment updates panel and rail counts immediately", async function (assert) {
    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [feedItem(503, "Desktop delete count clip")],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );

      server.get("/posts/503/replies.json", () =>
        helper.response([
          directReply(603, "admin_user", "<p>Desktop comment to delete</p>", {
            can_delete: true,
            post_url: "/t/desktop-delete-count/503/2",
          }),
          directReply(604, "reply-author", "<p>Desktop comment to keep</p>", {
            post_url: "/t/desktop-delete-count/503/3",
          }),
        ]),
      );

      server.delete("/posts/603.json", () => helper.response({}));
    });

    await visit("/videos");

    assert
      .dom(
        '[data-post-id="503"] [data-action="open-comments"] .video-shorts-action-rail__count',
      )
      .hasText("2");

    await click('[data-post-id="503"] [data-action="open-comments"]');

    assert.dom(".video-shorts-comments-panel__count").hasText("2 replies");

    await revealNativePostActions(603);
    await click(nativePostActionSelector(603, "delete"));
    await click(".dialog-footer .btn-primary");

    assert
      .dom('.video-shorts-comments-surface__comment[data-post-id="603"]')
      .doesNotExist("deleted comment is removed from the open panel");
    assert.dom(".video-shorts-comments-panel__count").hasText("1 reply");
    assert
      .dom(
        '[data-post-id="503"] [data-action="open-comments"] .video-shorts-action-rail__count',
      )
      .hasText("1", "desktop rail count updates immediately after delete");
  });

  test("desktop deleting a parent with children keeps child context and decrements counts once", async function (assert) {
    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [
            feedItem(504, "Desktop parent delete count clip", {
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

      server.get("/posts/504/replies.json", () =>
        helper.response([
          directReply(605, "admin_user", "<p>Parent comment to delete</p>", {
            can_delete: true,
            post_url: "/t/desktop-parent-delete-count/504/2",
            post_number: 2,
            reply_count: 1,
          }),
          directReply(607, "second-author", "<p>Second top-level comment</p>", {
            post_url: "/t/desktop-parent-delete-count/504/4",
            post_number: 4,
          }),
        ]),
      );
      server.get("/posts/605/replies.json", () =>
        helper.response([
          directReply(606, "child-author", "<p>Child reply remains</p>", {
            can_delete: true,
            post_url: "/t/desktop-parent-delete-count/504/3",
            post_number: 3,
            reply_to_post_number: 2,
            reply_to_username: "admin_user",
          }),
        ]),
      );

      server.delete("/posts/605.json", () => helper.response({}));
    });

    await visit("/videos");
    await click('[data-post-id="504"] [data-action="open-comments"]');

    assert.dom(".video-shorts-comments-panel__count").hasText("3 replies");
    assert
      .dom(
        '[data-post-id="504"] [data-action="open-comments"] .video-shorts-action-rail__count',
      )
      .hasText("3");

    await revealNativePostActions(605);
    await click(nativePostActionSelector(605, "delete"));
    await click(".dialog-footer .btn-primary");

    assert
      .dom('.video-shorts-comments-surface__comment[data-post-id="605"]')
      .includesText("Deleted comment");
    assert
      .dom(
        '[data-video-shorts-native-comment][data-depth="1"][data-post-id="606"]',
      )
      .includesText("Child reply remains");
    assert.dom(".video-shorts-comments-panel__count").hasText("2 replies");
    assert
      .dom(
        '[data-post-id="504"] [data-action="open-comments"] .video-shorts-action-rail__count',
      )
      .hasText("2", "parent deletion decrements global count exactly once");
  });

  test("desktop deleting a child reply updates parent, panel, and rail counts immediately", async function (assert) {
    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [
            feedItem(505, "Desktop child delete count clip", {
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

      server.get("/posts/505/replies.json", () =>
        helper.response([
          directReply(608, "parent-author", "<p>Desktop parent comment</p>", {
            post_number: 2,
            reply_count: 1,
            post_url: "/t/desktop-child-delete-count/505/2",
          }),
          directReply(610, "second-author", "<p>Desktop second comment</p>", {
            post_number: 4,
            post_url: "/t/desktop-child-delete-count/505/4",
          }),
        ]),
      );
      server.get("/posts/608/replies.json", () =>
        helper.response([
          directReply(
            609,
            "admin_user",
            "<p>Desktop child reply to delete</p>",
            {
              can_delete: true,
              post_number: 3,
              reply_to_post_number: 2,
              reply_to_username: "parent-author",
              post_url: "/t/desktop-child-delete-count/505/3",
            },
          ),
        ]),
      );

      server.delete("/posts/609.json", () => helper.response({}));
    });

    await visit("/videos");
    await click('[data-post-id="505"] [data-action="open-comments"]');

    assert.dom(".video-shorts-comments-panel__count").hasText("3 replies");
    assert
      .dom(
        '[data-post-id="505"] [data-action="open-comments"] .video-shorts-action-rail__count',
      )
      .hasText("3");
    await click('[data-post-id="608"] [data-video-shorts-view-replies]');

    assert
      .dom(
        '[data-video-shorts-native-comment][data-depth="1"][data-post-id="609"]',
      )
      .includesText("Desktop child reply to delete");

    await revealNativePostActions(609);
    await click(nativePostActionSelector(609, "delete"));
    await click(".dialog-footer .btn-primary");

    assert
      .dom(
        '[data-video-shorts-native-comment][data-depth="1"][data-post-id="609"]',
      )
      .doesNotExist("deleted child reply is removed from the desktop panel");
    assert
      .dom(nativePostSelector(608))
      .doesNotIncludeText("1 reply");
    assert.dom(".video-shorts-comments-panel__count").hasText("2 replies");
    assert
      .dom(
        '[data-post-id="505"] [data-action="open-comments"] .video-shorts-action-rail__count',
      )
      .hasText("2", "desktop rail count updates after child deletion");
  });

  test("desktop video viewport does not reserve a right gutter on sidebar pages", async function (assert) {
    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [feedItem(403, "Sidebar centered clip")],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );

      server.get("/posts/403/replies.json", () => helper.response([]));
    });

    document.body.classList.add("has-sidebar-page");

    try {
      await visit("/videos");

      const closedViewport = document.querySelector(
        ".video-shorts-feed__viewport",
      );
      const closedStyle = getComputedStyle(closedViewport);

      assert.strictEqual(
        closedStyle.transform,
        "none",
        "closed sidebar layout does not shift the shorts viewport left",
      );

      await click('[data-action="open-comments"]');

      const openViewport = document.querySelector(
        ".video-shorts-feed__viewport",
      );
      const openStyle = getComputedStyle(openViewport);
      const openRect = openViewport.getBoundingClientRect();

      assert.strictEqual(
        openStyle.transform,
        "none",
        "comments-open sidebar layout also avoids fixed left translation",
      );
      assert.true(
        document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
        "sidebar layout does not create horizontal overflow",
      );
      assert.true(openRect.left >= 0, "sidebar layout stays inside the left edge");
      assert.true(
        openRect.right <= document.documentElement.clientWidth,
        "sidebar layout stays inside the right edge",
      );
    } finally {
      document.body.classList.remove("has-sidebar-page");
    }
  });

  test("desktop video route removes notification vertical offsets from the shorts stage", function (assert) {
    const desktopMainOutletRules = desktopRuleTextsFor((selectorText) =>
      selectorText
        .split(",")
        .map((selector) => selector.trim())
        .includes("body.video-shorts-route #main-outlet"),
    );
    const desktopAlertRules = desktopRuleTextsFor((selectorText) =>
      selectorText
        .split(",")
        .map((selector) => selector.trim())
        .includes("body.video-shorts-route .alert-emails-disabled"),
    );
    const desktopFeedRules = desktopRuleTextsFor((selectorText) =>
      selectorText
        .split(",")
        .map((selector) => selector.trim())
        .includes("body.video-shorts-route .video-shorts-feed"),
    );

    assert.true(
      desktopMainOutletRules.some((cssText) =>
        cssText.includes("padding-top: 0"),
      ),
      "desktop shorts route removes Discourse main outlet top padding",
    );
    assert.true(
      desktopAlertRules.some((cssText) => cssText.includes("display: none")),
      "desktop shorts route hides email warning alert so it does not push the video down",
    );
    assert.deepEqual(
      desktopFeedRules.filter((cssText) =>
        cssText.includes("alert-emails-disabled"),
      ),
      [],
      "desktop feed height no longer subtracts a stale email alert offset",
    );
  });
});

acceptance("Video Shorts refined mobile route shell", function (needs) {
  needs.settings({ video_shorts_enabled: true });
  needs.user();

  test("mobile video route defines a scoped F NAV hide rule for logged-in theme tabs", async function (assert) {
    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [feedItem(304, "Mobile F NAV clip")],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );
    });

    await visit("/videos");

    const hasScopedFNavHideRule = [...document.styleSheets].some((sheet) => {
        try {
          return [...sheet.cssRules].some((rule) => {
            if (!rule.conditionText?.includes("width < 1024px")) {
              return false;
            }

            return [...rule.cssRules].some((nestedRule) =>
              nestedRule.selectorText
                ?.split(",")
                .map((selector) => selector.trim())
                .includes("body.video-shorts-route .f-nav"),
            );
          });
        } catch {
          return false;
        }
      });
    const hasScopedDataTabsHideRule = [...document.styleSheets].some(
        (sheet) => {
          try {
            return [...sheet.cssRules].some((rule) => {
              if (!rule.conditionText?.includes("width < 1024px")) {
                return false;
              }

              return [...rule.cssRules].some((nestedRule) =>
                nestedRule.selectorText
                  ?.split(",")
                  .map((selector) => selector.trim())
                  .includes(
                    "body.video-shorts-route [data-mobile-navigation-tabs]",
                  ),
              );
            });
          } catch {
            return false;
          }
        },
      );

    assert.true(
      hasScopedFNavHideRule,
      "video route CSS includes a mobile-only hide rule for F NAV",
    );
    assert.true(
      hasScopedDataTabsHideRule,
      "video route CSS includes a mobile-only hide rule for data mobile tabs",
    );
    assert.dom(".video-shorts-feed").exists("video route still renders");
  });

  test("mobile route shell avoids html-level overflow locks that can leak to adjacent topic lists", function (assert) {
    const htmlVideoShortsRouteOverflowLocks = [...document.styleSheets].flatMap(
      (sheet) => {
        try {
          return [...sheet.cssRules].flatMap((rule) => {
            if (!rule.conditionText?.includes("width < 1024px")) {
              return [];
            }

            return [...rule.cssRules]
              .filter((nestedRule) =>
                nestedRule.selectorText
                  ?.split(",")
                  .map((selector) => selector.trim())
                  .some((selector) =>
                    selector.includes("html:has(body.video-shorts-route)"),
                  ),
              )
              .filter((nestedRule) => {
                const overflowLock = [
                  "overflow",
                  "overflow-x",
                  "overflow-y",
                ].some((property) => {
                  const value = nestedRule.style
                    ?.getPropertyValue(property)
                    .trim();

                  return value && !["initial", "unset", "visible"].includes(value);
                });
                const position = nestedRule.style
                  ?.getPropertyValue("position")
                  .trim();

                return overflowLock || ["fixed", "sticky"].includes(position);
              })
              .map((nestedRule) => nestedRule.cssText);
          });
        } catch {
          return [];
        }
      },
    );

    assert.deepEqual(
      htmlVideoShortsRouteOverflowLocks,
      [],
      "mobile route overflow locks are scoped to body.video-shorts-route instead of html",
    );
  });

  test("mobile video route sizes the player shell with stable viewport height", function (assert) {
    const routeBodyRules = mobileRuleTextsFor((selectorText) =>
      selectorText
        .split(",")
        .map((selector) => selector.trim())
        .includes("body.video-shorts-route"),
    );
    const routeMainRules = mobileRuleTextsFor((selectorText) =>
      selectorText
        .split(",")
        .map((selector) => selector.trim())
        .some((selector) =>
          [
            "body.video-shorts-route #main",
            "body.video-shorts-route .discourse-root",
            "body.video-shorts-route #main-outlet-wrapper",
            "body.video-shorts-route #main-outlet",
          ].includes(selector),
        ),
    );
    const routeFeedRules = mobileRuleTextsFor((selectorText) =>
      selectorText
        .split(",")
        .map((selector) => selector.trim())
        .includes("body.video-shorts-route .video-shorts-feed"),
    );
    const mobileFeedRules = mobileRuleTextsFor((selectorText) =>
      selectorText
        .split(",")
        .map((selector) => selector.trim())
        .includes(".video-shorts-feed"),
    );
    const playerShellRules = [
      ...routeBodyRules,
      ...routeMainRules,
      ...routeFeedRules,
      ...mobileFeedRules,
    ];

    assert.true(
      routeBodyRules.some(
        (cssText) =>
          cssText.includes("--video-shorts-mobile-route-height: 100svh") &&
          cssText.includes("height: var(--video-shorts-mobile-route-height)"),
      ),
      "mobile video route defines a stable viewport height custom property",
    );
    assert.true(
      routeMainRules.some((cssText) =>
        cssText.includes("height: var(--video-shorts-mobile-route-height)"),
      ),
      "mobile Discourse route containers use the dynamic route height",
    );
    assert.true(
      routeFeedRules.some(
        (cssText) =>
          cssText.includes(
            "--video-shorts-feed-height: var(--video-shorts-mobile-route-height)",
          ) &&
          cssText.includes("height: var(--video-shorts-mobile-route-height)"),
      ),
      "mobile feed height follows the dynamic route height",
    );
    assert.true(
      mobileFeedRules.some((cssText) =>
        cssText.includes(
          "--video-shorts-feed-height: var(--video-shorts-mobile-route-height, 100svh)",
        ),
      ),
      "mobile feed fallback uses stable viewport height",
    );
    assert.deepEqual(
      playerShellRules.filter((cssText) => cssText.includes("100lvh")),
      [],
      "mobile player shell rules do not hard-code largest viewport height",
    );
    assert.deepEqual(
      playerShellRules.filter((cssText) => cssText.includes("100dvh")),
      [],
      "mobile player shell rules do not follow keyboard-shrinking dynamic viewport height",
    );
  });

  test("mobile video route paints the root background through reserved browser gutters", function (assert) {
    const htmlVideoShortsRouteBackgroundRules = [
      ...document.styleSheets,
    ].flatMap((sheet) => {
      try {
        return [...sheet.cssRules].flatMap((rule) => {
          if (!rule.conditionText?.includes("width < 1024px")) {
            return [];
          }

          return [...rule.cssRules]
            .filter((nestedRule) =>
              nestedRule.selectorText
                ?.split(",")
                .map((selector) => selector.trim())
                .includes("html:has(body.video-shorts-route)"),
            )
            .map((nestedRule) => nestedRule.cssText)
            .filter((cssText) =>
              cssText.includes("background: var(--secondary)"),
            );
        });
      } catch {
        return [];
      }
    });

    assert.true(
      htmlVideoShortsRouteBackgroundRules.length > 0,
      "mobile video route paints the html background with the active Discourse theme instead of a black overlay",
    );
  });

  test("mobile readability does not use a full-page or stage scrim overlay", function (assert) {
    const playerRules = mobileRuleTextsFor((selectorText) =>
      selectorText
        .split(",")
        .map((selector) => selector.trim())
        .includes(".video-shorts-item__player"),
    );
    const infoRules = mobileRuleTextsFor((selectorText) =>
      selectorText
        .split(",")
        .map((selector) => selector.trim())
        .includes(".video-shorts-item__info"),
    );
    const stageScrimRules = mobileRuleTextsFor((selectorText) =>
      selectorText
        .split(",")
        .map((selector) => selector.trim())
        .includes(".video-shorts-item__stage::after"),
    );
    const routePlayerRules = mobileRuleTextsFor((selectorText) =>
      selectorText
        .split(",")
        .map((selector) => selector.trim())
        .includes("body.video-shorts-route .video-shorts-item__player"),
    );
    const routeStageRules = mobileRuleTextsFor((selectorText) =>
      selectorText
        .split(",")
        .map((selector) => selector.trim())
        .includes("body.video-shorts-route .video-shorts-item__stage"),
    );
    const routeNativePlayRules = mobileRuleTextsFor((selectorText) =>
      selectorText
        .split(",")
        .map((selector) => selector.trim())
        .includes("body.video-shorts-route .video-shorts-native-player__play"),
    );
    const fullPageFixedOverlays = mobileRuleTextsFor((selectorText) =>
      selectorText
        .split(",")
        .map((selector) => selector.trim())
        .some((selector) =>
          [
            "html:has(body.video-shorts-route)::before",
            "html:has(body.video-shorts-route)::after",
            "body.video-shorts-route::before",
            "body.video-shorts-route::after",
            "body.video-shorts-route .video-shorts-feed::before",
            "body.video-shorts-route .video-shorts-feed::after",
          ].includes(selector),
        ),
    ).filter((cssText) => cssText.includes("position: fixed"));

    assert.true(
      playerRules.some(
        (cssText) =>
          cssText.includes("grid-area: 1 / 1") &&
          cssText.includes("width: var(--video-shorts-stage-width)"),
      ),
      "mobile player is aligned to the same grid area and width as the video stage",
    );
    assert.true(
      infoRules.some(
        (cssText) =>
          cssText.includes("grid-area: 1 / 1") &&
          !cssText.includes("position: absolute"),
      ),
      "mobile metadata is stage-aligned instead of positioned against the full viewport",
    );
    assert.strictEqual(
      stageScrimRules.length,
      0,
      "mobile readability avoids a stage scrim so controls and text are not darkened",
    );
    assert.true(
      routePlayerRules.some((cssText) => cssText.includes("height: 100%")),
      "mobile video route makes the player, not the page, fill the viewport height",
    );
    assert.true(
      routeStageRules.some(
        (cssText) =>
          cssText.includes("height: 100%") &&
          cssText.includes("aspect-ratio: auto"),
      ),
      "mobile video route uses a full-height stage instead of a smaller viewport overlay",
    );
    assert.true(
      routeNativePlayRules.some(
        (cssText) =>
          cssText.includes("inset: 50% auto auto 50%") &&
          cssText.includes("translate(-50%, -50%)"),
      ),
      "mobile native playback fallback is centered so it does not cover metadata",
    );
    assert.deepEqual(
      fullPageFixedOverlays,
      [],
      "mobile route does not create html/body/feed fixed full-page overlays",
    );
  });

  test("mobile comments sheet keeps one scroll surface and nested replies in flow", function (assert) {
    const baseSheetBodyRules = ruleTextsFor((selectorText) =>
      selectorText
        .split(",")
        .map((selector) => selector.trim())
        .includes(".video-shorts-comments-sheet__body"),
    );
    const sheetShellRules = mobileRuleTextsFor((selectorText) =>
      selectorText
        .split(",")
        .map((selector) => selector.trim())
        .includes(".video-shorts-comments-sheet"),
    );
    const sheetContainerRules = mobileRuleTextsFor((selectorText) =>
      selectorText
        .split(",")
        .map((selector) => selector.trim())
        .includes(
          "body.video-shorts-route .video-shorts-comments-sheet .d-modal__container",
        ),
    );
    const sheetModalBodyRules = mobileRuleTextsFor((selectorText) =>
      selectorText
        .split(",")
        .map((selector) => selector.trim())
        .includes(
          "body.video-shorts-route .video-shorts-comments-sheet .d-modal__body",
        ),
    );
    const sheetBodyRules = mobileRuleTextsFor((selectorText) =>
      selectorText
        .split(",")
        .map((selector) => selector.trim())
        .includes(".video-shorts-comments-sheet__body"),
    );
    const sheetListRules = mobileRuleTextsFor((selectorText) =>
      selectorText
        .split(",")
        .map((selector) => selector.trim())
        .includes(
          ".video-shorts-comments-sheet .video-shorts-comments-surface__list",
        ),
    );
    const customReplyDialogRules = ruleTextsFor((selectorText) =>
      selectorText
        .split(",")
        .map((selector) => selector.trim())
        .includes(".video-shorts-comments-surface__reply-dialog"),
    );
    const nestedSheetIndentRules = mobileRuleTextsFor((selectorText) =>
      selectorText
        .split(",")
        .map((selector) => selector.trim())
        .some((selector) =>
          [
            ".video-shorts-comments-sheet .video-shorts-comments-surface__child-comment .video-shorts-comments-surface__child-list",
            ".video-shorts-comments-sheet .video-shorts-comments-surface__child-list--deep",
          ].includes(selector),
        ),
    );
    const nativePostRowRules = ruleTextsFor((selectorText) =>
      selectorText
        .split(",")
        .map((selector) => selector.trim())
        .some((selector) =>
          selector.endsWith(".video-shorts-native-comment .post__row.row"),
        ),
    ).filter((cssText) => cssText.includes("grid-template-columns"));
    const nativeDepthRules = ruleTextsFor((selectorText) =>
      selectorText
        .split(",")
        .map((selector) => selector.trim())
        .some((selector) =>
          selector.endsWith(
            '.video-shorts-native-comment[data-depth="1"]',
          ),
        ),
    );

    assert.deepEqual(
      sheetContainerRules.filter((cssText) =>
        /(?:bottom|inset|height|max-height):[^;]*--video-shorts-keyboard-offset/.test(
          cssText,
        ),
      ),
      [],
      "mobile sheet container position and height do not follow the visual viewport keyboard offset",
    );
    assert.deepEqual(
      [...baseSheetBodyRules, ...sheetContainerRules, ...sheetBodyRules].filter(
        (cssText) => /\bdvh\b/.test(cssText),
      ),
      [],
      "mobile comments sheet sizing does not use dynamic viewport height units that shrink under the keyboard",
    );
    assert.deepEqual(
      [...baseSheetBodyRules, ...sheetContainerRules, ...sheetBodyRules].filter(
        (cssText) => /\blvh\b/.test(cssText),
      ),
      [],
      "mobile comments sheet sizing does not use largest viewport height units that can exceed the visible phone viewport",
    );
    assert.true(
      sheetContainerRules.some((cssText) =>
        cssText.includes(
          "top: var(--video-shorts-comments-sheet-stable-top, auto)",
        ),
      ),
      "mobile sheet container can lock its opening top edge against keyboard viewport shrink",
    );
    assert.true(
      sheetContainerRules.some((cssText) =>
        cssText.includes("--video-shorts-comments-sheet-stable-height"),
      ),
      "mobile sheet container can lock its opening height against keyboard viewport shrink",
    );
    assert.true(
      sheetContainerRules.some((cssText) =>
        cssText.includes("--video-shorts-comments-sheet-body-max-height"),
      ),
      "mobile sheet container bounds its height below the reserved header/logo area",
    );
    assert.true(
      sheetShellRules.some((cssText) =>
        cssText.includes("--video-shorts-mobile-route-height"),
      ),
      "mobile sheet fallback height follows the route height locked before keyboard focus",
    );
    assert.true(
      sheetModalBodyRules.some((cssText) =>
        cssText.includes("overflow: hidden"),
      ),
      "mobile modal body does not become a second scroll container",
    );
    assert.true(
      sheetBodyRules.some((cssText) => cssText.includes("overflow: hidden")),
      "mobile comments sheet body delegates scrolling to the comments list",
    );
    assert.true(
      sheetListRules.some((cssText) => cssText.includes("overflow-y: auto")),
      "mobile comments list is the single active scroll surface",
    );
    assert.deepEqual(
      customReplyDialogRules,
      [],
      "mobile nested replies do not retain custom dialog positioning",
    );
    assert.deepEqual(
      nestedSheetIndentRules,
      [],
      "mobile sheet no longer defines third-level reply indentation rules",
    );
    assert.true(
      nativePostRowRules.length >= 1,
      "native Discourse post row rules are loaded inside video comments",
    );
    assert.true(
      nativePostRowRules.every((cssText) =>
        /grid-template-columns:\s*(?:2\.25rem|36px)\s+minmax\((?:0|0px),\s*1fr\)/.test(
          cssText,
        ),
      ),
      "native post rows reserve a stable avatar track without squeezing content",
    );
    assert.true(
      nativeDepthRules.some((cssText) =>
        cssText.includes("border-inline-start"),
      ),
      "second-level native replies retain a scoped visual branch marker",
    );
  });

  test("desktop comments panel routes wheel scrolling to the comments list", function (assert) {
    const panelBodyRules = ruleTextsFor((selectorText) =>
      selectorText
        .split(",")
        .map((selector) => selector.trim())
        .includes(".video-shorts-comments-panel__body"),
    );
    const panelSurfaceRules = ruleTextsFor((selectorText) =>
      selectorText
        .split(",")
        .map((selector) => selector.trim())
        .includes(
          ".video-shorts-comments-panel .video-shorts-comments-surface",
        ),
    );
    const panelListRules = ruleTextsFor((selectorText) =>
      selectorText
        .split(",")
        .map((selector) => selector.trim())
        .includes(
          ".video-shorts-comments-panel .video-shorts-comments-surface__list",
        ),
    );

    assert.true(
      panelBodyRules.some((cssText) => cssText.includes("overflow: hidden")),
      "desktop comments panel body is not a competing wheel scroll container",
    );
    assert.true(
      panelSurfaceRules.some((cssText) => cssText.includes("height: 100%")),
      "desktop comments surface fills the panel body",
    );
    assert.true(
      panelListRules.some((cssText) => cssText.includes("overflow-y: auto")),
      "desktop comments list owns the scrollable wheel surface",
    );
    assert.true(
      panelListRules.some((cssText) =>
        cssText.includes("overscroll-behavior: contain"),
      ),
      "desktop comments list contains wheel chaining before it reaches the feed",
    );
  });

  test("desktop video viewport avoids dynamic viewport width units that include Brave scrollbar gutters", function (assert) {
    const desktopViewportWidthRules = [...document.styleSheets].flatMap(
      (sheet) => {
        try {
          return [...sheet.cssRules].flatMap((rule) => {
            if (!rule.conditionText?.includes("width >= 1024px")) {
              return [];
            }

            return [...rule.cssRules]
              .filter((nestedRule) =>
                nestedRule.selectorText
                  ?.split(",")
                  .map((selector) => selector.trim())
                  .some((selector) =>
                    selector.includes(".video-shorts-feed__viewport"),
                  ),
              )
              .map((nestedRule) => nestedRule.cssText);
          });
        } catch {
          return [];
        }
      },
    );

    assert.true(
      desktopViewportWidthRules.length > 0,
      "desktop viewport sizing rules are loaded for the video route",
    );
    assert.deepEqual(
      desktopViewportWidthRules.filter((cssText) => cssText.includes("100dvw")),
      [],
      "desktop video viewport widths use container percentages instead of 100dvw",
    );
  });

  test("mobile video route keeps every rendered element inside the right viewport edge", async function (assert) {
    setupPretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [
            feedItem(
              306,
              "Mobile overflow guard clip with a very long title that should wrap without creating a right gutter",
            ),
          ],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );
    });

    await visit("/videos");

    const overflowingElements = [...document.body.querySelectorAll("*")]
      .map((element) => {
        return {
          element,
          rect: element.getBoundingClientRect(),
        };
      })
      .filter(({ rect }) => {
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          rect.right > window.innerWidth + 1
        );
      })
      .map(({ element, rect }) => {
        return {
          selector: element.id || element.className || element.tagName,
          right: Math.round(rect.right),
        };
      });

    assert.true(
      document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
      "mobile route does not create document-level horizontal overflow",
    );
    assert.deepEqual(
      overflowingElements,
      [],
      "no rendered video-route element extends past the right viewport edge",
    );
  });
});
