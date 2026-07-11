import Component from "@glimmer/component";
import { tracked } from "@glimmer/tracking";
import { on } from "@ember/modifier";
import { action } from "@ember/object";
import didInsert from "@ember/render-modifiers/modifiers/did-insert";
import didUpdate from "@ember/render-modifiers/modifiers/did-update";
import willDestroy from "@ember/render-modifiers/modifiers/will-destroy";
import { service } from "@ember/service";
import { i18n } from "discourse-i18n";
import { VideoShortsMediaLoader } from "discourse/plugins/discourse-video-shorts/discourse/lib/video-shorts-media-loader";

export default class VideoShortsNativePlayer extends Component {
  @service("video-shorts-policy") policy;

  @tracked playBlocked = false;
  @tracked loadError = false;
  @tracked sourceUrl = null;

  video = null;
  mediaLoader = null;
  releaseResource = null;
  unregisterPolicy = null;
  unregisterPlayback = null;
  playbackRegistered = false;
  objectUrl = null;
  loadToken = 0;
  playbackOwner = {
    pause: () => this.pause(),
    suspend: () => this.suspend(),
    resume: () => this.resume(),
    destroy: () => this.teardown(),
  };

  get media() {
    return this.args.item?.media || {};
  }

  get videoUrl() {
    return this.media.url;
  }

  get isExternal() {
    return this.media.kind === "external_mp4";
  }

  @action
  async syncPlayback(video) {
    this.video = video;
    video.muted = true;

    if (!this.sourceUrl && !this.loadError && (this.args.isActive || this.args.shouldPreload)) {
      await this.prepareSource();
    }

    if (this.args.isActive) {
      this.play();
    } else {
      this.pause();
    }
  }

  @action
  async prepareSource() {
    let token = ++this.loadToken;
    this.clearSource();
    this.loadError = false;

    if (!this.videoUrl) {
      this.loadError = true;
      return;
    }

    this.registerPlayback();
    if (!this.isExternal) {
      this.sourceUrl = this.videoUrl;
      return;
    }

    if (!Number.isInteger(this.media.policy_revision)) {
      this.mediaError();
      return;
    }

    try {
      let snapshot = await this.policy.revalidate();
      if (token !== this.loadToken) {
        return;
      }
      if (
        snapshot.revision !== this.media.policy_revision ||
        !this.policy.authorize(this.videoUrl, snapshot.revision)
      ) {
        this.mediaError();
        return;
      }

      this.releaseResource = this.args.routeSessionOwner?.retainExternalResource?.() || this.policy.retainExternalResource();
      this.mediaLoader = new VideoShortsMediaLoader({ policy: this.policy, revision: snapshot.revision });
      this.unregisterPolicy = this.policy.onRevisionChange(() => this.invalidatePolicy());
      let blob = await this.mediaLoader.requestBlob(this.videoUrl);
      if (token !== this.loadToken) {
        return;
      }

      this.objectUrl = URL.createObjectURL(blob);
      this.sourceUrl = this.objectUrl;
    } catch {
      if (token === this.loadToken) {
        this.clearSource();
        this.loadError = true;
      }
    }
  }

  @action
  play() {
    this.video?.play()?.then(() => (this.playBlocked = false)).catch(() => (this.playBlocked = true));
  }

  @action
  pause() {
    this.video?.pause();
    this.playBlocked = false;
  }

  registerPlayback() {
    if (this.playbackRegistered) {
      return;
    }
    this.unregisterPlayback =
      this.args.routeSessionOwner?.registerPlayback?.(this.playbackOwner) || null;
    this.playbackRegistered = true;
  }

  suspend() {
    this.loadToken += 1;
    this.clearSource();
    this.pause();
    if (this.video) {
      this.video.removeAttribute("src");
      this.video.load();
    }
  }

  resume() {
    if (!this.loadError && (this.args.isActive || this.args.shouldPreload)) {
      this.prepareSource();
    }
  }

  @action
  mediaError() {
    this.playbackOwner.destroy();
    this.loadError = true;
  }

  invalidatePolicy() {
    this.loadError = true;
    this.destroy();
  }

  clearSource() {
    this.mediaLoader?.destroy();
    this.mediaLoader = null;
    this.unregisterPolicy?.();
    this.unregisterPolicy = null;
    this.releaseResource?.();
    this.releaseResource = null;
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    this.sourceUrl = null;
  }

  @action
  destroy() {
    this.playbackOwner.destroy();
  }

  teardown() {
    this.suspend();
    this.unregisterPlayback?.();
    this.unregisterPlayback = null;
    this.playbackRegistered = false;
    this.video = null;
  }

  <template>
    <div class="video-shorts-native-player" {{willDestroy this.destroy}}>
      {{#if this.sourceUrl}}
        <video class="video-shorts-native-player__video" src={{this.sourceUrl}} preload={{if @shouldPreload "metadata" "none"}} muted playsinline loop controls {{on "error" this.mediaError}} {{didInsert this.syncPlayback}} {{didUpdate this.syncPlayback @isActive @shouldPreload}}></video>
      {{else if this.loadError}}
        <a class="video-shorts-native-player__fallback" href={{@item.post_url}}>{{i18n "video_shorts.actions.open_topic"}}</a>
      {{else}}
        <video class="video-shorts-native-player__video" preload="none" muted playsinline controls {{on "error" this.mediaError}} {{didInsert this.syncPlayback}} {{didUpdate this.syncPlayback @isActive @shouldPreload}}></video>
      {{/if}}
      {{#if this.playBlocked}}
        <button type="button" class="video-shorts-native-player__play" {{on "click" this.play}}>{{i18n "video_shorts.actions.play"}}</button>
      {{/if}}
    </div>
  </template>
}
