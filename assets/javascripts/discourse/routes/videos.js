import { service } from "@ember/service";
import DiscourseRoute from "discourse/routes/discourse";
import { loadInitialVideoShortsFeed } from "discourse/plugins/discourse-video-shorts/discourse/lib/video-shorts-feed";

const VIDEO_SHORTS_BODY_CLASS = "video-shorts-route";
const VIDEO_SHORTS_LIGHTWEIGHT_COMPOSER_CLASS =
  "video-shorts-lightweight-composer-open";
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

  keyboardRouteHeightLock = null;
  keyboardRouteWidthLock = null;

  queryParams = {
    post_id: { refreshModel: true },
  };

  syncMobileRouteHeight = () => {
    const height = Math.round(window.innerHeight);
    const width = Math.round(window.innerWidth);

    if (height <= 0) {
      return;
    }

    if (
      document.body.classList.contains(
        VIDEO_SHORTS_LIGHTWEIGHT_COMPOSER_CLASS
      )
    ) {
      if (this.keyboardRouteHeightLock === null) {
        const currentRouteHeight = Number.parseFloat(
          document.body.style.getPropertyValue(
            VIDEO_SHORTS_MOBILE_ROUTE_HEIGHT
          )
        );

        this.keyboardRouteHeightLock =
          currentRouteHeight > 0 ? currentRouteHeight : height;
        this.keyboardRouteWidthLock = width;
      }

      if (
        Math.abs(width - this.keyboardRouteWidthLock) > 1 ||
        height >= this.keyboardRouteHeightLock
      ) {
        this.keyboardRouteHeightLock = null;
        this.keyboardRouteWidthLock = null;
      }

      return;
    }

    if (this.keyboardRouteHeightLock !== null) {
      const widthChanged =
        Math.abs(width - this.keyboardRouteWidthLock) > 1;

      if (!widthChanged && height < this.keyboardRouteHeightLock) {
        return;
      }

      this.keyboardRouteHeightLock = null;
      this.keyboardRouteWidthLock = null;
    }

    if (document.activeElement?.matches?.(TEXT_INPUT_SELECTOR)) {
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
    this.keyboardRouteHeightLock = null;
    this.keyboardRouteWidthLock = null;
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
