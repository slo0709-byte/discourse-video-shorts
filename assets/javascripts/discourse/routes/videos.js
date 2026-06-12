import { service } from "@ember/service";
import DiscourseRoute from "discourse/routes/discourse";
import { loadInitialVideoShortsFeed } from "discourse/plugins/discourse-video-shorts/discourse/lib/video-shorts-feed";

const VIDEO_SHORTS_BODY_CLASS = "video-shorts-route";

function postIdFromLocation() {
  const postId = new URLSearchParams(window.location.search).get("post_id");

  return /^\d+$/.test(postId || "") ? postId : null;
}

export default class VideosRoute extends DiscourseRoute {
  @service router;
  @service siteSettings;

  activate() {
    super.activate(...arguments);
    document.body.classList.add(VIDEO_SHORTS_BODY_CLASS);
  }

  deactivate() {
    document.body.classList.remove(VIDEO_SHORTS_BODY_CLASS);
    super.deactivate(...arguments);
  }

  beforeModel() {
    if (!this.siteSettings.video_shorts_enabled) {
      return this.router.replaceWith("unknown", "videos");
    }
  }

  async model() {
    return await loadInitialVideoShortsFeed({
      restorePostId: postIdFromLocation(),
    });
  }

  setupController(controller, model) {
    super.setupController(controller, model);
    controller.replaceModel(model);
  }
}
