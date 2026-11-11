import Component from "@glimmer/component";
import { tracked } from "@glimmer/tracking";
import { isDestroyed, isDestroying } from "@ember/destroyable";
import { on } from "@ember/modifier";
import { action } from "@ember/object";
import { eq } from "discourse/truth-helpers";
import { i18n } from "discourse-i18n";
import {
  trustedVideoShortsIframe,
  videoShortsNeedsHostLoadingOverlay,
} from "discourse/plugins/discourse-video-shorts/discourse/lib/video-shorts-embed-policy";

export default class VideoShortsEmbedPlayer extends Component {
  @tracked loadState = "loading";
  @tracked showFrame = true;

  get iframe() {
    return trustedVideoShortsIframe(this.args.item?.media);
  }

  get showLoadingOverlay() {
    return videoShortsNeedsHostLoadingOverlay(this.iframe, this.loadState);
  }

  @action
  markLoaded() {
    this.loadState = "loaded";
  }

  @action
  markFailed() {
    this.loadState = "error";
  }

  @action
  retry() {
    this.loadState = "loading";
    this.showFrame = false;

    requestAnimationFrame(() => {
      if (!isDestroying(this) && !isDestroyed(this)) {
        this.showFrame = true;
      }
    });
  }

  <template>
    {{#let this.iframe as |embedInfo|}}
      <div
        class="video-shorts-embed-player"
        data-video-shorts-provider={{embedInfo.provider}}
        data-video-shorts-state={{if embedInfo this.loadState "unavailable"}}
        data-video-shorts-host-chrome={{if
          embedInfo.capabilities.hostChrome
          "true"
          "false"
        }}
        aria-busy={{if
          embedInfo
          (if (eq this.loadState "loading") "true" "false")
          "false"
        }}
      >
        {{#if embedInfo}}
          {{#if this.showFrame}}
            <iframe
              class="video-shorts-embed-player__iframe"
              data-video-shorts-provider={{embedInfo.provider}}
              src={{embedInfo.src}}
              title={{embedInfo.title}}
              allow={{embedInfo.allow}}
              sandbox={{embedInfo.sandbox}}
              referrerpolicy={{embedInfo.referrerPolicy}}
              hidden={{eq this.loadState "error"}}
              {{on "load" this.markLoaded}}
              {{on "error" this.markFailed}}
            ></iframe>
          {{/if}}

          {{#if this.showLoadingOverlay}}
            <div
              class="video-shorts-embed-player__loading video-shorts-embed-player__fallback"
              role="status"
            >
              {{i18n "video_shorts.player.loading"}}
            </div>
          {{else if (eq this.loadState "error")}}
            <div class="video-shorts-embed-player__error" role="alert">
              <p>{{i18n "video_shorts.player.load_error"}}</p>
              <button
                type="button"
                class="video-shorts-embed-player__retry"
                {{on "click" this.retry}}
              >
                {{i18n "video_shorts.player.retry"}}
              </button>
              <a
                class="video-shorts-embed-player__fallback"
                href={{@item.post_url}}
              >
                {{i18n "video_shorts.actions.open_topic"}}
              </a>
            </div>
          {{/if}}
        {{else}}
          <a
            class="video-shorts-embed-player__fallback"
            href={{@item.post_url}}
          >
            {{i18n "video_shorts.actions.open_topic"}}
          </a>
        {{/if}}
      </div>
    {{/let}}
  </template>
}
