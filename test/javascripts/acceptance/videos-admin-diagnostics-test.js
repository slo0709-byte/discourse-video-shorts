import { click, currentURL, fillIn, visit } from "@ember/test-helpers";
import { test } from "qunit";
import pretender, {
  pretenderHelpers,
} from "discourse/tests/helpers/create-pretender";
import {
  acceptance,
  updateCurrentUser,
} from "discourse/tests/helpers/qunit-helpers";
import { i18n } from "discourse-i18n";

function pluginPayload() {
  return {
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
  };
}

function originPolicyPayload({
  revision = 7,
  externalMediaEnabled = true,
  origins = ["https://media.example"],
} = {}) {
  return {
    revision,
    external_media_enabled: externalMediaEnabled,
    origins,
    updated_at: "2026-07-10T00:00:00Z",
  };
}

function diagnosticsPayload(
  sampleTitle = "External HLS sample",
  samples = null,
) {
  return {
    enabled: true,
    kill_switch: { active: false, reason: null },
    canary: { enabled: false, group_ids: [], audience: "all_members" },
    policy: originPolicyPayload(),
    settings_summary: {
      page_size: 10,
      candidate_scan_limit: 100,
      configured_page_size: 20,
      configured_candidate_scan_limit: 500,
      debug_mode: false,
    },
    delivery: {
      native_uploads: {
        object_storage_enabled: false,
        s3_cdn_url: null,
        s3_cdn_for_all_uploads: false,
        site_cdn_url: null,
        recommendation: "Use object storage and a CDN.",
      },
      hls: { requires_https: true, recommendation: "Use an HTTPS CDN." },
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
      candidates_scanned: 1,
      scan_limit_reached: false,
      end_reached: true,
      sql: {
        strategy: "bounded_candidate_scan",
        candidate_scan_limit: 100,
        measured_query_count: null,
      },
    },
    media: {
      kinds: [
        { name: "external_hls", count: 1 },
        { name: "upload_mp4", count: 0 },
      ],
      failed_reasons: [],
    },
    runtime: {
      heartbeat: { observable: false, reason: "client_session_metric" },
      delta: { observable: false, reason: "client_session_metric" },
      authorization_lease: {
        observable: false,
        reason: "client_session_metric",
      },
      resources: { observable: false, reason: "client_session_metric" },
    },
    samples: samples ?? [
      {
        topic_id: 10,
        post_id: 11,
        post_number: 1,
        title: sampleTitle,
        username: "video-author",
        category: { id: 1, name: "Video clips", slug: "video-clips" },
        tags: [{ name: "video" }, { name: "shorts" }],
        media: {
          kind: "external_hls",
          required_origins: ["https://media.example"],
          policy_revision: 7,
          fallback_reason: null,
        },
      },
    ],
  };
}

function stubAdminPage(
  server,
  helper,
  {
    diagnosticsResponse = () => helper.response(diagnosticsPayload()),
    policyPatchResponse = () => helper.response(originPolicyPayload()),
  } = {},
) {
  server.get("/admin/plugins/discourse-video-shorts.json", () =>
    helper.response(pluginPayload()),
  );
  server.get("/admin/plugins/discourse-video-shorts/origins.json", () =>
    helper.response(originPolicyPayload()),
  );
  server.get(
    "/admin/plugins/discourse-video-shorts/diagnostics.json",
    diagnosticsResponse,
  );
  server.patch(
    "/admin/plugins/discourse-video-shorts/origins.json",
    policyPatchResponse,
  );
}

acceptance("Video Shorts admin diagnostics", function (needs) {
  needs.user();
  needs.settings({ video_shorts_enabled: true });

  test("renders diagnostics with descriptor kinds and privacy-safe samples", async function (assert) {
    updateCurrentUser({ admin: true });
    let requests = 0;

    const helper = pretenderHelpers();
    stubAdminPage(pretender, helper, {
      diagnosticsResponse: () => {
        requests += 1;
        return helper.response(
          diagnosticsPayload(`External HLS sample ${requests}`),
        );
      },
    });

    await visit("/admin/plugins/discourse-video-shorts/diagnostics");

    assert.strictEqual(
      currentURL(),
      "/admin/plugins/discourse-video-shorts/diagnostics",
    );
    const navItems = [
      ...document.querySelectorAll(".admin-plugin-config-page__top-nav-item"),
    ];
    assert.true(
      navItems.some((item) =>
        item.textContent.includes(i18n("admin.plugins.change_settings_short")),
      ),
      "Settings navigation is present",
    );
    assert.true(
      navItems.some((item) =>
        item.textContent.includes(i18n("video_shorts.admin.diagnostics.title")),
      ),
      "Diagnostics navigation is present",
    );
    assert.dom(".video-shorts-admin-diagnostics").exists();
    assert
      .dom(".video-shorts-admin-diagnostics")
      .includesText(
        i18n("video_shorts.admin.diagnostics.warnings.invalid_category_ids"),
      );
    assert.dom(".video-shorts-admin-diagnostics").includesText("Video clips");
    assert
      .dom(".video-shorts-admin-diagnostics")
      .includesText("External HLS sample 1");
    assert
      .dom('.video-shorts-admin-diagnostics a[href="/t/10"]')
      .hasText("External HLS sample 1");
    assert
      .dom('.video-shorts-admin-diagnostics a[href="/u/video-author"]')
      .hasText("video-author");

    await click(".video-shorts-admin-diagnostics .btn-default");

    assert.strictEqual(requests, 2);
    assert
      .dom(".video-shorts-admin-diagnostics")
      .includesText("External HLS sample 2");
    assert.strictEqual(
      currentURL(),
      "/admin/plugins/discourse-video-shorts/diagnostics",
    );
  });

  test("loads and saves the origin policy editor with its returned revision", async function (assert) {
    updateCurrentUser({ admin: true });
    let patches = 0;

    const helper = pretenderHelpers();
    stubAdminPage(pretender, helper, {
      policyPatchResponse: () => {
        patches += 1;
        return helper.response(
          originPolicyPayload({
            revision: 8,
            origins: ["https://cdn.example", "https://media.example"],
          }),
        );
      },
    });

    await visit("/admin/plugins/discourse-video-shorts/diagnostics");

    assert
      .dom("#video-shorts-policy-origins")
      .hasValue("https://media.example");
    assert.dom(".video-shorts-admin-diagnostics__summary").includesText("7");

    await fillIn(
      "#video-shorts-policy-origins",
      "https://media.example\nhttps://cdn.example",
    );
    await click(".video-shorts-admin-diagnostics .btn-primary");

    assert.strictEqual(patches, 1);
    assert
      .dom("#video-shorts-policy-origins")
      .hasValue("https://cdn.example\nhttps://media.example");
    assert.dom(".video-shorts-admin-diagnostics__summary").includesText("8");
    assert
      .dom(".video-shorts-admin-diagnostics [role=status]")
      .includesText(i18n("video_shorts.admin.diagnostics.policy.saved"));
  });

  test("shows policy validation and server save errors", async function (assert) {
    updateCurrentUser({ admin: true });
    let patches = 0;

    const helper = pretenderHelpers();
    stubAdminPage(pretender, helper, {
      policyPatchResponse: () => {
        patches += 1;
        return patches === 1
          ? helper.response(422, { errors: ["origins are invalid"] })
          : helper.response(500, { errors: ["unavailable"] });
      },
    });

    await visit("/admin/plugins/discourse-video-shorts/diagnostics");
    await click(".video-shorts-admin-diagnostics .btn-primary");
    assert
      .dom(".video-shorts-admin-diagnostics__warnings")
      .includesText(
        i18n("video_shorts.admin.diagnostics.policy.invalid_origins"),
      );

    await click(".video-shorts-admin-diagnostics .btn-primary");
    assert.strictEqual(patches, 2);
    assert
      .dom(".video-shorts-admin-diagnostics__warnings")
      .includesText(i18n("video_shorts.admin.diagnostics.policy.save_failed"));
  });

  test("renders warning and empty states", async function (assert) {
    updateCurrentUser({ admin: true });

    const helper = pretenderHelpers();
    stubAdminPage(pretender, helper, {
      diagnosticsResponse: () =>
        helper.response({
          ...diagnosticsPayload("No samples", []),
          media: { kinds: [], failed_reasons: [] },
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
      .includesText(i18n("video_shorts.admin.diagnostics.no_samples"));
  });

  test("shows a visible diagnostics refresh error without navigating", async function (assert) {
    updateCurrentUser({ admin: true });
    let requests = 0;

    const helper = pretenderHelpers();
    stubAdminPage(pretender, helper, {
      diagnosticsResponse: () => {
        requests += 1;
        return requests === 1
          ? helper.response(diagnosticsPayload())
          : helper.response(500, { errors: ["failed"] });
      },
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
});
