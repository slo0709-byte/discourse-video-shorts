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

export default class VideoShortsDiagnosticsController extends Controller {
  @tracked diagnostics = null;
  @tracked error = false;
  @tracked loading = false;

  get model() {
    return this.diagnostics;
  }

  set model(value) {
    this.diagnostics = value;
  }

  get hasError() {
    return this.error || this.diagnostics?.error === true;
  }

  get hasDiagnostics() {
    return Boolean(
      this.diagnostics?.feed &&
      this.diagnostics?.sources &&
      this.diagnostics?.providers &&
      this.diagnostics?.renderability &&
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

        return {
          code,
          label: i18n(labelKey, { code }),
        };
      }) || []
    );
  }

  @action
  async refresh() {
    this.loading = true;
    this.error = false;

    try {
      this.diagnostics = await ajax(
        "/admin/plugins/discourse-video-shorts/diagnostics.json",
      );
    } catch (error) {
      this.error = true;
      popupAjaxError(error);
    } finally {
      this.loading = false;
    }
  }
}
