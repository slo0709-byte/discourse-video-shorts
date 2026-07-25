import Component from "@glimmer/component";
import { tracked } from "@glimmer/tracking";
import { on } from "@ember/modifier";
import { action } from "@ember/object";
import didInsert from "@ember/render-modifiers/modifiers/did-insert";
import didUpdate from "@ember/render-modifiers/modifiers/did-update";
import dIcon from "discourse/ui-kit/helpers/d-icon";
import { i18n } from "discourse-i18n";

export default class VideoShortsNativePlayer extends Component {
  @tracked playBlocked = false;
  video = null;

  @action
  syncPlayback(video) {
    this.video = video;
    video.muted = this.args.isMuted;

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
        muted={{@isMuted}}
        playsinline
        loop
        controls
        {{didInsert this.syncPlayback}}
        {{didUpdate this.syncPlayback @isActive}}
      ></video>

      <button
        type="button"
        class="video-shorts-player__sound"
        data-action="sound"
        aria-label={{
          if
            @isMuted
            (i18n "video_shorts.player.unmute")
            (i18n "video_shorts.player.mute")
        }}
        aria-pressed={{if @isMuted "false" "true"}}
        {{on "click" @onToggleMute}}
      >
        {{dIcon (if @isMuted "volume-xmark" "volume-high")}}
      </button>

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
