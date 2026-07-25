import { service } from "@ember/service";
import DiscourseRoute from "discourse/routes/discourse";
import { loadInitialVideoShortsFeed } from "discourse/plugins/discourse-video-shorts/discourse/lib/video-shorts-feed";

const VIDEO_SHORTS_BODY_CLASS = "video-shorts-route";
const VIDEO_SHORTS_MOBILE_ROUTE_HEIGHT = "--video-shorts-mobile-route-height";
const TEXT_INPUT_SELECTOR = "input, textarea, select, [contenteditable='true']";

function validPostId(value) {
  const postId = value === null || value === undefined ? null : String(value);

  return /^\d+$/.test(postId || "") ? postId : null;
}

function postIdFromLocation() {
  return validPostId(
    new URLSearchParams(window.location.search).get("post_id")
  );
}

export default class VideosRoute extends DiscourseRoute {
  @service router;
  @service siteSettings;

  syncMobileRouteHeight = () => {
    if (document.activeElement?.matches?.(TEXT_INPUT_SELECTOR)) {
      return;
    }

    const height = Math.round(window.innerHeight);

    if (height <= 0) {
      return;
    }

    document.body.style.setProperty(
      VIDEO_SHORTS_MOBILE_ROUTE_HEIGHT,
      `${height}px`,
    );
  };

  activate() {
    super.activate(...arguments);
    document.body.classList.add(VIDEO_SHORTS_BODY_CLASS);
    this.syncMobileRouteHeight();
    window.addEventListener("resize", this.syncMobileRouteHeight);
    window.visualViewport?.addEventListener(
      "resize",
      this.syncMobileRouteHeight,
    );
  }

  deactivate() {
    window.removeEventListener("resize", this.syncMobileRouteHeight);
    window.visualViewport?.removeEventListener(
      "resize",
      this.syncMobileRouteHeight,
    );
    document.body.style.removeProperty(VIDEO_SHORTS_MOBILE_ROUTE_HEIGHT);
    document.body.classList.remove(VIDEO_SHORTS_BODY_CLASS);
    super.deactivate(...arguments);
  }

  beforeModel() {
    if (!this.siteSettings.video_shorts_enabled) {
      return this.router.replaceWith("unknown", "videos");
    }
  }

  async model(_params, transition) {
    const transitionPostId = validPostId(
      transition?.to?.queryParams?.post_id
    );

    return await loadInitialVideoShortsFeed({
      restorePostId: transitionPostId || postIdFromLocation(),
    });
  }

  setupController(controller, model) {
    super.setupController(controller, model);
    controller.replaceModel(model);
  }
}
