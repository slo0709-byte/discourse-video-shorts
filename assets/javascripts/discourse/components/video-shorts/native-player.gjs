import Component from "@glimmer/component";
import { tracked } from "@glimmer/tracking";
import { on } from "@ember/modifier";
import { action } from "@ember/object";
import didInsert from "@ember/render-modifiers/modifiers/did-insert";
import didUpdate from "@ember/render-modifiers/modifiers/did-update";

export default class VideoShortsNativePlayer extends Component {
  @tracked playBlocked = false;
  video = null;

  @action
  syncPlayback(video) {
    this.video = video;
    video.muted = true;

    if (!this.args.isActive) {
      video.pause();
      return;
    }

    const playPromise = video.play();

    if (playPromise?.catch) {
      playPromise
        .then(() => {
          this.playBlocked = false;
        })
        .catch(() => {
          this.playBlocked = true;
        });
    }
  }

  @action
  play() {
    this.video?.play()?.then(() => {
      this.playBlocked = false;
    });
  }

  <template>
    <div class="video-shorts-native-player">
      <video
        class="video-shorts-native-player__video"
        src={{@item.media.video_url}}
        preload={{if @shouldPreload "metadata" "none"}}
        muted
        playsinline
        loop
        controls
        {{didInsert this.syncPlayback}}
        {{didUpdate this.syncPlayback @isActive}}
      ></video>

      {{#if this.playBlocked}}
        <button
          type="button"
          class="video-shorts-native-player__play"
          {{on "click" this.play}}
        >
          Play
        </button>
      {{/if}}
    </div>
  </template>
}
