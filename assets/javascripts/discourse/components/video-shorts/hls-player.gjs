import Component from "@glimmer/component";
import { tracked } from "@glimmer/tracking";
import { on } from "@ember/modifier";
import { action } from "@ember/object";
import didInsert from "@ember/render-modifiers/modifiers/did-insert";
import didUpdate from "@ember/render-modifiers/modifiers/did-update";
import willDestroy from "@ember/render-modifiers/modifiers/will-destroy";

const HLS_SCRIPT_ID = "video-shorts-hls-js";
const HLS_SCRIPT_SRC = "/plugins/discourse-video-shorts/javascripts/hls.min.js";
const HLS_MIME_TYPE = "application/vnd.apple.mpegurl";

let hlsScriptPromise = null;

function loadHlsScript() {
  if (window.Hls) {
    return Promise.resolve(window.Hls);
  }

  if (hlsScriptPromise) {
    return hlsScriptPromise;
  }

  hlsScriptPromise = new Promise((resolve, reject) => {
    let existingScript = document.getElementById(HLS_SCRIPT_ID);

    if (existingScript) {
      existingScript.addEventListener("load", () => resolve(window.Hls), { once: true });
      existingScript.addEventListener("error", reject, { once: true });
      return;
    }

    let script = document.createElement("script");
    script.id = HLS_SCRIPT_ID;
    script.src = HLS_SCRIPT_SRC;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = "true";
      resolve(window.Hls);
    };
    script.onerror = (error) => {
      hlsScriptPromise = null;
      script.remove();
      reject(error);
    };
    document.head.appendChild(script);
  });

  return hlsScriptPromise;
}

export default class VideoShortsHlsPlayer extends Component {
  @tracked playBlocked = false;
  @tracked loadError = false;

  hls = null;
  loadToken = 0;
  video = null;
  videoErrorHandler = null;

  get hlsUrl() {
    return this.args.item?.media?.hls_url;
  }

  @action
  syncPlayback(video) {
    this.video = video;
    video.muted = true;

    if (!this.args.isActive) {
      this.pause();
      return;
    }

    this.attachHls(video);
  }

  @action
  async attachHls(video) {
    let hlsUrl = this.hlsUrl;
    let loadToken = (this.loadToken += 1);
    let nativeHlsSupported = Boolean(video.canPlayType(HLS_MIME_TYPE));

    this.destroyHls();
    this.clearVideoErrorHandler();
    this.loadError = false;

    if (!hlsUrl) {
      this.loadError = true;
      return;
    }

    try {
      let Hls = await loadHlsScript();

      if (loadToken !== this.loadToken || !video.isConnected) {
        return;
      }

      if (Hls?.isSupported?.()) {
        this.attachHlsJs(Hls, video, hlsUrl, loadToken);
        return;
      }
    } catch {
      // Fall through to native playback when the local hls.js asset is unavailable.
    }

    if (nativeHlsSupported) {
      this.attachNativeHls(video, hlsUrl, loadToken);
      return;
    }

    if (loadToken === this.loadToken) {
      this.loadError = true;
    }
  }

  attachHlsJs(Hls, video, hlsUrl, loadToken) {
    let hls = new Hls({ debug: false, maxBufferHole: 0.5 });
    let manifestParsedEvent = Hls.Events?.MANIFEST_PARSED || "hlsManifestParsed";
    let errorEvent = Hls.Events?.ERROR || "hlsError";

    this.hls = hls;
    this.attachVideoErrorHandler(video, loadToken);

    hls.on?.(manifestParsedEvent, () => {
      if (loadToken === this.loadToken && this.hls === hls) {
        this.play();
      }
    });

    hls.on?.(errorEvent, (_event, data) => {
      if (loadToken !== this.loadToken || this.hls !== hls || !data?.fatal) {
        return;
      }

      this.loadError = true;
      this.playBlocked = false;
      this.destroyHls();
    });

    hls.loadSource(hlsUrl);
    hls.attachMedia(video);

    if (typeof hls.on !== "function") {
      this.play();
    }
  }

  attachNativeHls(video, hlsUrl, loadToken) {
    this.attachVideoErrorHandler(video, loadToken);
    video.src = hlsUrl;
    this.play();
  }

  @action
  play() {
    this.video?.play()?.then(() => {
      this.playBlocked = false;
    }).catch(() => {
      this.playBlocked = true;
    });
  }

  @action
  pause() {
    this.video?.pause();
    this.playBlocked = false;
  }

  @action
  teardown() {
    this.loadToken += 1;
    this.destroyHls();
    this.clearVideoErrorHandler();
    this.pause();
    this.video = null;
  }

  destroyHls() {
    this.hls?.destroy?.();
    this.hls = null;
  }

  attachVideoErrorHandler(video, loadToken) {
    this.clearVideoErrorHandler();

    this.videoErrorHandler = () => {
      if (loadToken !== this.loadToken) {
        return;
      }

      this.loadError = true;
      this.playBlocked = false;
    };

    video.addEventListener("error", this.videoErrorHandler, { once: true });
  }

  clearVideoErrorHandler() {
    if (this.video && this.videoErrorHandler) {
      this.video.removeEventListener("error", this.videoErrorHandler);
    }

    this.videoErrorHandler = null;
  }

  <template>
    <div class="video-shorts-hls-player" {{willDestroy this.teardown}}>
      <video
        class="video-shorts-hls-player__video"
        data-hls-url={{this.hlsUrl}}
        preload={{if @shouldPreload "metadata" "none"}}
        muted
        playsinline
        loop
        controls
        {{didInsert this.syncPlayback}}
        {{didUpdate this.syncPlayback @isActive}}
      ></video>

      {{#if this.loadError}}
        <a class="video-shorts-hls-player__fallback" href={{@item.post_url}}>
          Open topic
        </a>
      {{else if this.playBlocked}}
        <button
          type="button"
          class="video-shorts-hls-player__play"
          {{on "click" this.play}}
        >
          Play
        </button>
      {{/if}}
    </div>
  </template>
}
