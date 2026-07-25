import { withPluginApi } from "discourse/lib/plugin-api";
import { EDIT } from "discourse/models/composer";

const PLUGIN_ID = "discourse-video-shorts";
export const VIDEO_SHORTS_POST_EDITED_EVENT =
  "video-shorts:native-post-edited";

export function shouldForceVideoShortsComposerSave(service, force) {
  const routeName = service?.router?.currentRouteName;
  const model = service?.model;
  const topicModelMissing =
    service?.topicModel === null || service?.topicModel === undefined;

  return (
    force === false &&
    routeName === "videos" &&
    service?.skipJumpOnSave === true &&
    model?.replyingToTopic === true &&
    model?.action !== EDIT &&
    topicModelMissing
  );
}

export function extendVideoShortsComposerService(Superclass) {
  return class VideoShortsComposerService extends Superclass {
    save(force, options = {}) {
      const editingVideoPost =
        this.router?.currentRouteName === "videos" &&
        this.model?.action === EDIT
          ? this.model.post
          : null;
      const result = super.save(
        shouldForceVideoShortsComposerSave(this, force) ? true : force,
        options
      );

      if (!editingVideoPost || typeof result?.then !== "function") {
        return result;
      }

      return result.then((saveResult) => {
        const editedPost = saveResult?.responseJson?.post || editingVideoPost;

        if (editedPost?.id === editingVideoPost.id) {
          this.appEvents?.trigger(
            VIDEO_SHORTS_POST_EDITED_EVENT,
            editedPost
          );
        }

        return saveResult;
      });
    }
  };
}

export default {
  name: "video-shorts-composer-no-jump",
  before: "inject-discourse-objects",

  initialize() {
    withPluginApi((api) => {
      api.modifyClass(
        "service:composer",
        extendVideoShortsComposerService,
        { pluginId: PLUGIN_ID }
      );
    });
  },
};
