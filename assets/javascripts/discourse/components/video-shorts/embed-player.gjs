import Component from "@glimmer/component";
import { tracked } from "@glimmer/tracking";
import { action } from "@ember/object";
import didInsert from "@ember/render-modifiers/modifiers/did-insert";
import willDestroy from "@ember/render-modifiers/modifiers/will-destroy";
import { i18n } from "discourse-i18n";
import { trustedVideoShortsIframe } from "discourse/plugins/discourse-video-shorts/discourse/lib/video-shorts-embed-policy";

export default class VideoShortsEmbedPlayer extends Component {

  @tracked ready = false;
  @tracked unavailable = false;
  unregisterPlayback = null;
  playbackRegistered = false;
  playbackOwner = {
    pause() {},
    suspend: () => this.suspend(),
    resume: () => this.resume(),
    destroy: () => this.teardown(),
  };

  get iframe() {
    return trustedVideoShortsIframe(this.args.item?.media);
  }

  @action
  prepare() {
    this.unavailable = false;

    if (!this.iframe) {
      this.unavailable = true;
      return;
    }

    this.unregisterPlayback =
      this.args.routeSessionOwner?.registerPlayback?.(this.playbackOwner) || null;
    this.playbackRegistered = true;
    this.ready = true;
  }

  suspend() {
    this.ready = false;
  }

  resume() {
    if (this.playbackRegistered && this.iframe) {
      this.ready = true;
    }
  }

  teardown() {
    this.suspend();
    this.unregisterPlayback?.();
    this.unregisterPlayback = null;
    this.playbackRegistered = false;
  }

  @action
  destroy() {
    this.playbackOwner.destroy();
  }

  <template>
    <div class="video-shorts-embed-player" {{didInsert this.prepare}} {{willDestroy this.destroy}}>
      {{#if this.ready}}
        <iframe class="video-shorts-embed-player__iframe" src={{this.iframe.src}} title={{this.iframe.title}} loading="lazy" allow={{this.iframe.allow}} sandbox={{this.iframe.sandbox}} referrerpolicy={{this.iframe.referrerPolicy}}></iframe>
      {{else if this.unavailable}}
        <a class="video-shorts-embed-player__fallback" href={{@item.post_url}}>{{i18n "video_shorts.actions.open_topic"}}</a>
      {{/if}}
    </div>
  </template>
}
