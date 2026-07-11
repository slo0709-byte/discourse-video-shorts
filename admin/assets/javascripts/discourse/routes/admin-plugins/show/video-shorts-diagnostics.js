import { ajax } from "discourse/lib/ajax";
import { popupAjaxError } from "discourse/lib/ajax-error";
import DiscourseRoute from "discourse/routes/discourse";

export default class VideoShortsDiagnosticsRoute extends DiscourseRoute {
  async model() {
    const [diagnostics, originPolicy] = await Promise.allSettled([
      ajax("/admin/plugins/discourse-video-shorts/diagnostics.json"),
      ajax("/admin/plugins/discourse-video-shorts/origins.json"),
    ]);

    if (diagnostics.status === "rejected") {
      popupAjaxError(diagnostics.reason);
    }

    return {
      diagnostics:
        diagnostics.status === "fulfilled"
          ? diagnostics.value
          : { error: true },
      originPolicy:
        originPolicy.status === "fulfilled" ? originPolicy.value : null,
      originPolicyError: originPolicy.status === "rejected",
    };
  }
}
