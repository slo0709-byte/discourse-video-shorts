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

const HLS_SCRIPT_ID = "video-shorts-hls-js";
const HLS_SCRIPT_SRC = "/plugins/discourse-video-shorts/javascripts/hls.min.js";
let hlsScriptPromise;

function loadHlsScript() {
  if (window.Hls) {
    return Promise.resolve(window.Hls);
  }

  hlsScriptPromise ||= new Promise((resolve, reject) => {
    let script = document.getElementById(HLS_SCRIPT_ID);
    if (script) {
      script.remove();
      script = null;
    }
    let created = false;

    if (!script) {
      script = document.createElement("script");
      script.id = HLS_SCRIPT_ID;
      script.src = HLS_SCRIPT_SRC;
      script.async = true;
      created = true;
    }

    script.addEventListener(
      "load",
      () => {
        if (window.Hls) {
          resolve(window.Hls);
        } else {
          reject(new Error("video_shorts_hls_unavailable"));
        }
      },
      { once: true }
    );
    script.addEventListener(
      "error",
      () => reject(new Error("video_shorts_hls_unavailable")),
      { once: true }
    );

    if (created) {
      document.head.appendChild(script);
    }
  }).catch((error) => {
    hlsScriptPromise = null;
    throw error;
  });
  return hlsScriptPromise;
}

export default class VideoShortsHlsPlayer extends Component {
  @service("video-shorts-policy") policy;

  @tracked playBlocked = false;
  @tracked loadError = false;

  hls = null;
  video = null;
  mediaLoader = null;
  releaseResource = null;
  unregisterPolicy = null;
  unregisterPlayback = null;
  playbackRegistered = false;
  loadToken = 0;
  playbackOwner = {
    pause: () => this.pause(),
    suspend: () => this.suspend(),
    resume: () => this.resume(),
    destroy: () => this.teardown(),
  };

  get hlsUrl() {
    return this.args.item?.media?.url;
  }

  get policyRevision() {
    return this.args.item?.media?.policy_revision;
  }

  get routeSessionOwner() {
    return this.args.routeSessionOwner;
  }

  @action
  async syncPlayback(video) {
    this.video = video;
    video.muted = true;

    if (!this.hls && !this.loadError && (this.args.isActive || this.args.shouldPreload)) {
      await this.attachHls();
    }

    if (this.args.isActive) {
      this.play();
    } else {
      this.pause();
    }
  }

  @action
  async attachHls() {
    let token = ++this.loadToken;
    this.destroyMedia();
    this.loadError = false;

    if (!this.hlsUrl || !Number.isInteger(this.policyRevision)) {
      this.loadError = true;
      return;
    }
    this.registerPlayback();

    try {
      let snapshot = await this.policy.revalidate();
      if (token !== this.loadToken) {
        return;
      }
      if (
        snapshot.revision !== this.policyRevision ||
        !this.policy.authorize(this.hlsUrl, snapshot.revision)
      ) {
        this.failLoad();
        return;
      }

      this.releaseResource = this.routeSessionOwner?.retainExternalResource?.() || this.policy.retainExternalResource();
      this.mediaLoader = new VideoShortsMediaLoader({
        policy: this.policy,
        revision: snapshot.revision,
      });
      this.unregisterPolicy = this.policy.onRevisionChange(() => this.invalidatePolicy());

      let Hls = await loadHlsScript();
      if (token !== this.loadToken) {
        return;
      }
      if (!this.video?.isConnected || !Hls?.isSupported?.()) {
        this.failLoad();
        return;
      }

      this.hls = new Hls({
        debug: false,
        maxBufferHole: 0.5,
        loader: this.mediaLoader.createHlsLoader(),
      });
      this.hls.on?.(Hls.Events?.MANIFEST_PARSED, () => {
        if (token === this.loadToken && this.args.isActive) {
          this.play();
        }
      });
      this.hls.on?.(Hls.Events?.ERROR, (_event, data) => {
        if (token === this.loadToken && data?.fatal) {
          this.failLoad();
        }
      });
      this.hls.loadSource(this.hlsUrl);
      this.hls.attachMedia(this.video);
    } catch {
      if (token === this.loadToken) {
        this.failLoad();
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
      this.routeSessionOwner?.registerPlayback?.(this.playbackOwner) || null;
    this.playbackRegistered = true;
  }

  suspend() {
    this.loadToken += 1;
    this.destroyMedia();
    this.pause();
    if (this.video) {
      this.video.removeAttribute("src");
      this.video.load();
    }
  }

  resume() {
    if (!this.loadError && (this.args.isActive || this.args.shouldPreload)) {
      this.attachHls();
    }
  }

  failLoad() {
    this.playbackOwner.destroy();
    this.loadError = true;
  }

  invalidatePolicy() {
    this.loadError = true;
    this.destroy();
  }

  destroyMedia() {
    this.hls?.destroy?.();
    this.hls = null;
    this.mediaLoader?.destroy();
    this.mediaLoader = null;
    this.unregisterPolicy?.();
    this.unregisterPolicy = null;
    this.releaseResource?.();
    this.releaseResource = null;
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
    <div class="video-shorts-hls-player" {{willDestroy this.destroy}}>
      <video class="video-shorts-hls-player__video" preload={{if @shouldPreload "metadata" "none"}} muted playsinline loop controls {{didInsert this.syncPlayback}} {{didUpdate this.syncPlayback @isActive @shouldPreload}}></video>
      {{#if this.loadError}}
        <a class="video-shorts-hls-player__fallback" href={{@item.post_url}}>{{i18n "video_shorts.actions.open_topic"}}</a>
      {{else if this.playBlocked}}
        <button type="button" class="video-shorts-hls-player__play" {{on "click" this.play}}>{{i18n "video_shorts.actions.play"}}</button>
      {{/if}}
    </div>
  </template>
}
