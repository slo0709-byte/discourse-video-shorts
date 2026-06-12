import { click, currentURL, visit } from "@ember/test-helpers";
import { test } from "qunit";
import {
  acceptance,
  updateCurrentUser,
} from "discourse/tests/helpers/qunit-helpers";
import { i18n } from "discourse-i18n";

function diagnosticsPayload(sampleTitle = "YouTube sample", samples = null) {
  return {
    enabled: true,
    settings_summary: {
      page_size: 10,
      candidate_scan_limit: 100,
      configured_page_size: 20,
      configured_candidate_scan_limit: 500,
      debug_mode: false,
    },
    sources: {
      configured: {
        category_ids: [1, 999999],
        categories: [{ id: 1, name: "Video clips", slug: "video-clips" }],
        tag_names: ["video"],
        tags: [{ name: "video" }],
      },
      effective: {
        category_ids: [1],
        categories: [{ id: 1, name: "Video clips", slug: "video-clips" }],
        tag_names: ["video"],
        tags: [{ name: "video" }],
      },
      warnings: [{ code: "invalid_category_ids", ids: [999999] }],
    },
    feed: {
      sample_size: 1,
      requested_sample_size: 10,
      scan_limit: 100,
      scan_limit_reached: false,
    },
    providers: {
      counts: [{ name: "youtube", count: 1 }],
    },
    renderability: {
      counts: [{ name: "iframe_candidate", count: 1 }],
    },
    samples: samples ?? [
      {
        topic_id: 10,
        post_id: 11,
        post_number: 1,
        title: sampleTitle,
        username: "video-author",
        category: {
          id: 1,
          name: "Video clips",
          slug: "video-clips",
        },
        tags: [{ name: "video" }, { name: "shorts" }],
        topic_url: "/t/youtube-sample/10",
        post_url: "/t/youtube-sample/10/1",
        media: {
          provider: "youtube",
          renderability: "iframe_candidate",
          embed_url: "https://www.youtube.com/embed/dQw4w9WgXcQ",
        },
      },
    ],
  };
}

acceptance("Video Shorts admin diagnostics", function (needs) {
  needs.user();
  needs.settings({ video_shorts_enabled: true });

  test("renders the diagnostics tab and keeps the native settings tab", async function (assert) {
    updateCurrentUser({ admin: true });
    let requests = 0;

    needs.pretender((server, helper) => {
      server.get("/admin/plugins/discourse-video-shorts.json", () =>
        helper.response({
          id: "discourse-video-shorts",
          name: "discourse-video-shorts",
          enabled: true,
          has_settings: true,
          humanized_name: "Video Shorts",
          about:
            "Adds a Shorts-style video feed page backed by Discourse posts.",
          admin_route: {
            label: "video_shorts.admin.title",
            location: "discourse-video-shorts",
            use_new_show_route: true,
          },
        }),
      );

      server.get(
        "/admin/plugins/discourse-video-shorts/diagnostics.json",
        () => {
          requests += 1;
          return helper.response(
            diagnosticsPayload(`YouTube sample ${requests}`),
          );
        },
      );
    });

    await visit("/admin/plugins/discourse-video-shorts/diagnostics");

    assert.strictEqual(
      currentURL(),
      "/admin/plugins/discourse-video-shorts/diagnostics",
    );
    assert
      .dom(".admin-plugin-config-page__top-nav-item")
      .includesText(i18n("admin.plugins.change_settings_short"));
    assert
      .dom(".admin-plugin-config-page__top-nav-item")
      .includesText(i18n("video_shorts.admin.diagnostics.title"));
    assert.dom(".video-shorts-admin-diagnostics").exists();
    assert
      .dom(".video-shorts-admin-diagnostics")
      .includesText(
        i18n("video_shorts.admin.diagnostics.warnings.invalid_category_ids"),
      );
    assert
      .dom(".video-shorts-admin-diagnostics")
      .includesText("iframe_candidate");
    assert.dom(".video-shorts-admin-diagnostics").includesText("Video clips");
    assert.dom(".video-shorts-admin-diagnostics").includesText("video");
    assert.dom(".video-shorts-admin-diagnostics").includesText("shorts");
    assert
      .dom(".video-shorts-admin-diagnostics")
      .includesText("YouTube sample 1");
    assert
      .dom('.video-shorts-admin-diagnostics a[href="/t/youtube-sample/10"]')
      .hasText("YouTube sample 1");
    assert
      .dom('.video-shorts-admin-diagnostics a[href="/u/video-author"]')
      .hasText("video-author");
    assert
      .dom('.video-shorts-admin-diagnostics a[href="/t/youtube-sample/10/1"]')
      .hasText(i18n("video_shorts.admin.diagnostics.open_post"));

    await click(".video-shorts-admin-diagnostics .btn-default");

    assert.strictEqual(requests, 2);
    assert
      .dom(".video-shorts-admin-diagnostics")
      .includesText("YouTube sample 2");
    assert.strictEqual(
      currentURL(),
      "/admin/plugins/discourse-video-shorts/diagnostics",
    );
  });

  test("renders warning and empty states", async function (assert) {
    updateCurrentUser({ admin: true });

    needs.pretender((server, helper) => {
      server.get("/admin/plugins/discourse-video-shorts.json", () =>
        helper.response({
          id: "discourse-video-shorts",
          name: "discourse-video-shorts",
          enabled: true,
          has_settings: true,
          humanized_name: "Video Shorts",
          admin_route: {
            label: "video_shorts.admin.title",
            location: "discourse-video-shorts",
            use_new_show_route: true,
          },
        }),
      );

      server.get("/admin/plugins/discourse-video-shorts/diagnostics.json", () =>
        helper.response({
          ...diagnosticsPayload("No samples", []),
          providers: { counts: [] },
          renderability: { counts: [] },
          sources: {
            configured: {
              category_ids: [999999],
              categories: [],
              tag_names: [],
              tags: [],
            },
            effective: {
              category_ids: [],
              categories: [],
              tag_names: [],
              tags: [],
            },
            warnings: [
              { code: "inaccessible_category_ids", ids: [999999] },
              { code: "no_effective_sources" },
              { code: "no_source_settings" },
            ],
          },
        }),
      );
    });

    await visit("/admin/plugins/discourse-video-shorts/diagnostics");

    assert
      .dom(".video-shorts-admin-diagnostics")
      .includesText(
        i18n(
          "video_shorts.admin.diagnostics.warnings.inaccessible_category_ids",
        ),
      );
    assert
      .dom(".video-shorts-admin-diagnostics")
      .includesText(
        i18n("video_shorts.admin.diagnostics.warnings.no_effective_sources"),
      );
    assert
      .dom(".video-shorts-admin-diagnostics")
      .includesText(
        i18n("video_shorts.admin.diagnostics.warnings.no_source_settings"),
      );
    assert
      .dom(".video-shorts-admin-diagnostics")
      .includesText(i18n("video_shorts.admin.diagnostics.no_provider_counts"));
    assert
      .dom(".video-shorts-admin-diagnostics")
      .includesText(
        i18n("video_shorts.admin.diagnostics.no_renderability_counts"),
      );
    assert
      .dom(".video-shorts-admin-diagnostics")
      .includesText(i18n("video_shorts.admin.diagnostics.no_samples"));
  });

  test("shows a visible refresh error without navigating", async function (assert) {
    updateCurrentUser({ admin: true });
    let requests = 0;

    needs.pretender((server, helper) => {
      server.get("/admin/plugins/discourse-video-shorts.json", () =>
        helper.response({
          id: "discourse-video-shorts",
          name: "discourse-video-shorts",
          enabled: true,
          has_settings: true,
          humanized_name: "Video Shorts",
          admin_route: {
            label: "video_shorts.admin.title",
            location: "discourse-video-shorts",
            use_new_show_route: true,
          },
        }),
      );

      server.get(
        "/admin/plugins/discourse-video-shorts/diagnostics.json",
        () => {
          requests += 1;

          if (requests === 1) {
            return helper.response(diagnosticsPayload());
          }

          return helper.response(500, { errors: ["failed"] });
        },
      );
    });

    await visit("/admin/plugins/discourse-video-shorts/diagnostics");
    await click(".video-shorts-admin-diagnostics .btn-default");

    assert.strictEqual(
      currentURL(),
      "/admin/plugins/discourse-video-shorts/diagnostics",
    );
    assert
      .dom(".video-shorts-admin-diagnostics__error")
      .includesText(i18n("video_shorts.admin.diagnostics.load_error"));
  });

  test("renders a top-level empty state for malformed diagnostics payloads", async function (assert) {
    updateCurrentUser({ admin: true });

    needs.pretender((server, helper) => {
      server.get("/admin/plugins/discourse-video-shorts.json", () =>
        helper.response({
          id: "discourse-video-shorts",
          name: "discourse-video-shorts",
          enabled: true,
          has_settings: true,
          humanized_name: "Video Shorts",
          admin_route: {
            label: "video_shorts.admin.title",
            location: "discourse-video-shorts",
            use_new_show_route: true,
          },
        }),
      );

      server.get("/admin/plugins/discourse-video-shorts/diagnostics.json", () =>
        helper.response({}),
      );
    });

    await visit("/admin/plugins/discourse-video-shorts/diagnostics");

    assert
      .dom(".video-shorts-admin-diagnostics__empty")
      .includesText(i18n("video_shorts.admin.diagnostics.empty"));
  });
});
