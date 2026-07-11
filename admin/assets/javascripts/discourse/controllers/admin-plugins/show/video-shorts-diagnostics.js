import { tracked } from "@glimmer/tracking";
import Controller from "@ember/controller";
import { action } from "@ember/object";
import { ajax } from "discourse/lib/ajax";
import { popupAjaxError } from "discourse/lib/ajax-error";
import { i18n } from "discourse-i18n";

const SOURCE_WARNING_LABELS = {
  inaccessible_category_ids:
    "video_shorts.admin.diagnostics.warnings.inaccessible_category_ids",
  invalid_category_ids:
    "video_shorts.admin.diagnostics.warnings.invalid_category_ids",
  invalid_tag_names:
    "video_shorts.admin.diagnostics.warnings.invalid_tag_names",
  no_effective_sources:
    "video_shorts.admin.diagnostics.warnings.no_effective_sources",
  no_source_settings:
    "video_shorts.admin.diagnostics.warnings.no_source_settings",
  tagging_disabled: "video_shorts.admin.diagnostics.warnings.tagging_disabled",
};

const MEDIA_KIND_LABELS = {
  bilibili: "video_shorts.admin.diagnostics.providers_labels.bilibili",
  external_hls: "video_shorts.admin.diagnostics.renderability_labels.native",
  external_mp4: "video_shorts.admin.diagnostics.renderability_labels.native",
  fallback: "video_shorts.admin.diagnostics.providers_labels.fallback",
  upload_mp4: "video_shorts.admin.diagnostics.providers_labels.native",
  youtube: "video_shorts.admin.diagnostics.providers_labels.youtube",
};

const FAILURE_REASON_LABELS = {
  external_media_unavailable:
    "video_shorts.admin.diagnostics.failure_reasons.external_media_unavailable",
  https_required:
    "video_shorts.admin.diagnostics.failure_reasons.https_required",
  invalid_bilibili_url:
    "video_shorts.admin.diagnostics.failure_reasons.invalid_bilibili_url",
  invalid_media_url:
    "video_shorts.admin.diagnostics.failure_reasons.invalid_media_url",
  invalid_youtube_url:
    "video_shorts.admin.diagnostics.failure_reasons.invalid_youtube_url",
  unapproved_origin:
    "video_shorts.admin.diagnostics.failure_reasons.unapproved_origin",
  unsupported_media_format:
    "video_shorts.admin.diagnostics.failure_reasons.unsupported_media_format",
  unsupported_provider:
    "video_shorts.admin.diagnostics.failure_reasons.unsupported_provider",
};

function normalizedOrigin(origin) {
  try {
    const parsed = new URL(origin);

    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash ||
      origin.includes("*")
    ) {
      return null;
    }

    return parsed.origin;
  } catch {
    return null;
  }
}

export default class VideoShortsDiagnosticsController extends Controller {
  @tracked diagnostics = null;
  @tracked error = false;
  @tracked loading = false;
  @tracked externalMediaEnabled = false;
  @tracked originLines = "";
  @tracked policyRevision = null;
  @tracked policyLoadError = false;
  @tracked policyErrors = [];
  @tracked policySaved = false;
  @tracked savingPolicy = false;

  get model() {
    return this.diagnostics;
  }

  set model(value) {
    this.diagnostics = value?.diagnostics ?? value;

    if (value?.originPolicy) {
      this.setOriginPolicy(value.originPolicy);
    }

    this.policyLoadError = Boolean(value?.originPolicyError);
  }

  get hasError() {
    return this.error || this.diagnostics?.error === true;
  }

  get hasDiagnostics() {
    return Boolean(
      this.diagnostics?.feed &&
      this.diagnostics?.sources &&
      this.diagnostics?.media &&
      Array.isArray(this.diagnostics?.media?.kinds) &&
      Array.isArray(this.diagnostics?.media?.failed_reasons) &&
      Array.isArray(this.diagnostics?.samples),
    );
  }

  get sourceWarnings() {
    return (
      this.diagnostics?.sources?.warnings?.map((warning) => {
        const code = warning.code?.toString() || "unknown";
        const labelKey =
          SOURCE_WARNING_LABELS[code] ||
          "video_shorts.admin.diagnostics.warnings.unknown";

        return { code, label: i18n(labelKey) };
      }) || []
    );
  }

  get normalizedOrigins() {
    return [
      ...new Set(
        this.originLines
          .split(/\r?\n/)
          .map((origin) => origin.trim())
          .filter(Boolean)
          .map(normalizedOrigin),
      ),
    ]
      .filter(Boolean)
      .sort();
  }

  get originValidationErrors() {
    const invalid = this.originLines
      .split(/\r?\n/)
      .map((origin) => origin.trim())
      .filter(Boolean)
      .some((origin) => !normalizedOrigin(origin));

    return invalid
      ? [i18n("video_shorts.admin.diagnostics.policy.invalid_origins")]
      : [];
  }

  get policyHealthLabel() {
    return this.externalMediaEnabled
      ? "video_shorts.admin.diagnostics.policy.health_enabled"
      : "video_shorts.admin.diagnostics.policy.health_disabled";
  }

  mediaKindLabel(value) {
    return i18n(
      MEDIA_KIND_LABELS[value] ||
        "video_shorts.admin.diagnostics.providers_labels.unknown",
    );
  }

  failureReasonLabel(value) {
    return i18n(
      FAILURE_REASON_LABELS[value] ||
        "video_shorts.admin.diagnostics.failure_reasons.unknown",
    );
  }

  safeTopicPath(sample) {
    const topicId = Number(sample?.topic_id);
    return Number.isSafeInteger(topicId) && topicId > 0
      ? `/t/${topicId}`
      : null;
  }

  setOriginPolicy(policy) {
    this.policyRevision = policy.revision;
    this.externalMediaEnabled = policy.external_media_enabled === true;
    this.originLines = Array.isArray(policy.origins)
      ? policy.origins.join("\n")
      : "";
    this.policyErrors = [];
    this.policySaved = false;
  }

  requestError(error) {
    const status = error?.jqXHR?.status || error?.status;

    if (status === 403) {
      return [i18n("video_shorts.admin.diagnostics.policy.forbidden")];
    }

    if (status === 422) {
      return [i18n("video_shorts.admin.diagnostics.policy.invalid_origins")];
    }

    if (status) {
      return [i18n("video_shorts.admin.diagnostics.policy.save_failed")];
    }

    return [i18n("video_shorts.admin.diagnostics.policy.network_error")];
  }

  @action
  updateOrigins(event) {
    this.originLines = event.target.value;
    this.policyErrors = [];
    this.policySaved = false;
  }

  @action
  updateExternalMediaEnabled(event) {
    this.externalMediaEnabled = event.target.checked;
    this.policyErrors = [];
    this.policySaved = false;
  }

  @action
  async savePolicy() {
    const validationErrors = this.originValidationErrors;

    if (validationErrors.length) {
      this.policyErrors = validationErrors;
      return;
    }

    this.savingPolicy = true;
    this.policyErrors = [];
    this.policySaved = false;

    try {
      const policy = await ajax(
        "/admin/plugins/discourse-video-shorts/origins.json",
        {
          type: "PATCH",
          data: {
            origins: this.normalizedOrigins,
            external_media_enabled: this.externalMediaEnabled,
          },
        },
      );

      this.setOriginPolicy(policy);
      this.policySaved = true;
    } catch (error) {
      this.policyErrors = this.requestError(error);
    } finally {
      this.savingPolicy = false;
    }
  }

  @action
  async refresh() {
    this.loading = true;
    this.error = false;
    this.policyLoadError = false;

    const [diagnostics, originPolicy] = await Promise.allSettled([
      ajax("/admin/plugins/discourse-video-shorts/diagnostics.json"),
      ajax("/admin/plugins/discourse-video-shorts/origins.json"),
    ]);

    if (diagnostics.status === "fulfilled") {
      this.diagnostics = diagnostics.value;
    } else {
      this.error = true;
      popupAjaxError(diagnostics.reason);
    }

    if (originPolicy.status === "fulfilled") {
      this.setOriginPolicy(originPolicy.value);
    } else {
      this.policyLoadError = true;
    }

    this.loading = false;
  }
}
