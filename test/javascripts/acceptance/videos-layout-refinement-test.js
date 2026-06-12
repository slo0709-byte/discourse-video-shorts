import { click, currentURL, triggerKeyEvent, visit } from "@ember/test-helpers";
import { test } from "qunit";
import { acceptance } from "discourse/tests/helpers/qunit-helpers";

function feedItem(id, title) {
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

acceptance("Video Shorts refined layout contract", function (needs) {
  needs.settings({ video_shorts_enabled: true });
  needs.user();

  test("desktop uses explicit comments opener and right comments panel", async function (assert) {
    needs.pretender((server, helper) => {
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
    const closedInfoRect = document
      .querySelector(".video-shorts-item__info")
      .getBoundingClientRect();

    assert.true(
      closedInfoRect.bottom >= closedStageRect.top,
      "desktop closed metadata is bottom-aligned near the video stage",
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
    const playerTransition = getComputedStyle(
      document.querySelector(".video-shorts-item__player"),
    ).transitionProperty;
    const panelTransition = getComputedStyle(
      document.querySelector(".video-shorts-comments-panel"),
    ).transitionProperty;
    const commentsPanelRect = document
      .querySelector(".video-shorts-comments-panel")
      .getBoundingClientRect();
    const openStageRect = document
      .querySelector(".video-shorts-item__stage")
      .getBoundingClientRect();
    const openInfoRect = document
      .querySelector(".video-shorts-item__info")
      .getBoundingClientRect();
    const publisherLinkStyle = getComputedStyle(
      document.querySelector(".video-shorts-metadata__publisher-link"),
    );

    assert.true(
      /transform|translate/.test(playerTransition),
      "desktop player exposes a transform transition for comments-open motion",
    );
    assert.true(
      /transform|translate|opacity/.test(panelTransition),
      "desktop comments panel exposes an entrance transition",
    );
    assert.true(
      commentsPanelRect.width >= 400,
      "desktop comments panel is at least 400px wide",
    );
    assert.true(
      commentsPanelRect.width <= 450,
      "desktop comments panel stays within the 450px shorts panel width",
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

  test("desktop sidebar route shell does not push the videos viewport offscreen", async function (assert) {
    needs.pretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [feedItem(305, "Sidebar page clip")],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );
    });

    document.body.classList.add("has-sidebar-page");

    try {
      await visit("/videos");

      const viewportRect = document
        .querySelector(".video-shorts-feed__viewport")
        .getBoundingClientRect();
      const viewportStyle = getComputedStyle(
        document.querySelector(".video-shorts-feed__viewport"),
      );
      const expectedCenteredGap = Math.max(
        (window.innerWidth - viewportRect.width) / 2,
        0,
      );
      const actualLeftGap = viewportRect.left;
      const actualRightGap = window.innerWidth - viewportRect.right;

      assert.true(
        viewportRect.left >= 0,
        "sidebar page shell does not translate the videos viewport past the left edge",
      );
      assert.true(
        isIdentityTransform(viewportStyle.transform),
        "sidebar page shell centers the videos viewport without transform offsets",
      );
      assert.true(
        Math.abs(actualLeftGap - expectedCenteredGap) <= 2,
        "sidebar page shell keeps the left edge aligned with normal centered flow",
      );
      assert.true(
        Math.abs(actualRightGap - expectedCenteredGap) <= 2,
        "sidebar page shell keeps the right edge aligned with normal centered flow",
      );
    } finally {
      document.body.classList.remove("has-sidebar-page");
    }
  });

  test("mobile video route exposes top hamburger control instead of bottom tabs", async function (assert) {
    needs.pretender((server, helper) => {
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
    assert.strictEqual(
      getComputedStyle(document.querySelector(".video-shorts-mobile-back"))
        .minHeight,
      "44px",
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
    needs.pretender((server, helper) => {
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
    const rail = item.querySelector(".video-shorts-action-rail");
    const railStyle = getComputedStyle(rail);
    const railButton = rail.querySelector('[data-action="open-comments"]');
    const railButtonStyle = getComputedStyle(railButton);
    const railButtonRect = railButton.getBoundingClientRect();

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
      railStyle.zIndex > infoStyle.zIndex,
      "mobile rail is layered above metadata",
    );
    assert.true(
      railButtonRect.width >= 44,
      "comments rail button keeps a 44px minimum hit target",
    );
    assert.true(
      railButtonRect.height >= 44,
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
  });

  test("desktop closing comments after moving active video does not refocus the old opener", async function (assert) {
    needs.pretender((server, helper) => {
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
      0,
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

  test("desktop video viewport does not reserve a right gutter on sidebar pages", async function (assert) {
    needs.pretender((server, helper) => {
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
      assert.true(
        Math.abs(openRect.left - (window.innerWidth - openRect.right)) <= 2,
        "sidebar layout keeps left and right gutters balanced",
      );
    } finally {
      document.body.classList.remove("has-sidebar-page");
    }
  });
});

acceptance("Video Shorts refined mobile route shell", function (needs) {
  needs.settings({ video_shorts_enabled: true });
  needs.user();

  test("mobile video route defines a scoped F NAV hide rule for logged-in theme tabs", async function (assert) {
    needs.pretender((server, helper) => {
      server.get("/videos.json", () =>
        helper.response({
          items: [feedItem(304, "Mobile F NAV clip")],
          next_cursor: null,
          scan_limit_reached: false,
        }),
      );
    });

    const fNav = document.createElement("div");
    fNav.className = "f-nav";
    for (const destination of ["/", "/search"]) {
      const tab = document.createElement("div");
      tab.className = "tab";
      tab.setAttribute("role", "link");
      tab.dataset.destination = destination;
      tab.textContent = destination === "/" ? "Home" : "Search";
      fNav.append(tab);
    }
    document.body.append(fNav);

    const dataTabs = document.createElement("nav");
    dataTabs.dataset.mobileNavigationTabs = "";
    dataTabs.append(document.createElement("button"));
    document.body.append(dataTabs);

    try {
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
      assert
        .dom("body.video-shorts-route .f-nav .tab")
        .exists(
          { count: 2 },
          "test fixture matches the logged-in F NAV tab structure",
        );
      assert
        .dom("body.video-shorts-route [data-mobile-navigation-tabs] button")
        .exists({ count: 1 }, "test fixture matches data-driven mobile tabs");
    } finally {
      fNav.remove();
      dataTabs.remove();
    }
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
              .map((nestedRule) => nestedRule.selectorText)
              .filter(Boolean)
              .flatMap((selectorText) =>
                selectorText
                  .split(",")
                  .map((selector) => selector.trim())
                  .filter((selector) =>
                    selector.includes("html:has(body.video-shorts-route)"),
                  )
                  .filter(() =>
                    /(height|overflow|position)\s*:/.test(rule.cssText),
                  ),
              );
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

  test("mobile readability is scoped to the video stage instead of a full-page overlay", function (assert) {
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
    assert.true(
      stageScrimRules.some(
        (cssText) =>
          cssText.includes("linear-gradient") &&
          cssText.includes("pointer-events: none"),
      ),
      "mobile readability scrim is confined to the video stage",
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
    needs.pretender((server, helper) => {
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
