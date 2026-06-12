import { ajax } from "discourse/lib/ajax";
import { popupAjaxError } from "discourse/lib/ajax-error";
import DiscourseRoute from "discourse/routes/discourse";

export default class VideoShortsDiagnosticsRoute extends DiscourseRoute {
  async model() {
    try {
      return await ajax(
        "/admin/plugins/discourse-video-shorts/diagnostics.json",
      );
    } catch (error) {
      popupAjaxError(error);

      return { error: true };
    }
  }
}
