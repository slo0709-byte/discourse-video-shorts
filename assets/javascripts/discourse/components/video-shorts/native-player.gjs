import Component from "@glimmer/component";
import { tracked } from "@glimmer/tracking";
import { on } from "@ember/modifier";
import { action } from "@ember/object";
import didInsert from "@ember/render-modifiers/modifiers/did-insert";
import didUpdate from "@ember/render-modifiers/modifiers/did-update";
import willDestroy from "@ember/render-modifiers/modifiers/will-destroy";
import dIcon from "discourse/ui-kit/helpers/d-icon";
import { i18n } from "discourse-i18n";

export default class VideoShortsNativePlayer extends Component {
  @tracked playBlocked = false;
  video = null;
  playRequest = 0;

  get preload() {
    if (this.args.isActive) {
      return "auto";
    }

    return this.args.shouldPreload ? "metadata" : "none";
  }

  attemptPlay(video) {
    const request = ++this.playRequest;
    let playPromise;

    try {
      playPromise = video.play();
    } catch {
      if (request === this.playRequest && this.args.isActive) {
        this.playBlocked = true;
      }
      return;
    }

    if (!playPromise?.then) {
      this.playBlocked = false;
      return;
    }

    playPromise
      .then(() => {
        if (
          request === this.playRequest &&
          this.video === video &&
          this.args.isActive
        ) {
          this.playBlocked = false;
        }
      })
      .catch(() => {
        if (
          request === this.playRequest &&
          this.video === video &&
          this.args.isActive
        ) {
          this.playBlocked = true;
        }
      });
  }

  @action
  syncPlayback(video) {
    this.video = video;
    video.muted = this.args.isMuted;

    if (!this.args.isActive) {
      this.playRequest += 1;
      video.pause();
      this.playBlocked = false;
      return;
    }

    this.attemptPlay(video);
  }

  @action
  play() {
    if (this.video && this.args.isActive) {
      this.attemptPlay(this.video);
    }
  }

  @action
  teardown() {
    this.playRequest += 1;

    if (!this.video) {
      return;
    }

    this.video.pause();
    this.video.removeAttribute("src");
    this.video.load();
    this.video = null;
  }

  <template>
    <div
      class="video-shorts-native-player"
      data-prewarm={{if @isActive "false" "true"}}
      {{willDestroy this.teardown}}
    >
      <video
        class="video-shorts-native-player__video"
        src={{@item.media.video_url}}
        preload={{this.preload}}
        muted={{@isMuted}}
        controls={{@isActive}}
        tabindex={{if @isActive "0" "-1"}}
        aria-hidden={{if @isActive "false" "true"}}
        playsinline
        loop
        {{didInsert this.syncPlayback}}
        {{didUpdate this.syncPlayback @isActive @isMuted}}
      ></video>

      {{#if @isActive}}
        <button
          type="button"
          class="video-shorts-player__sound"
          data-action="sound"
          aria-label={{if
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
      {{/if}}
    </div>
  </template>
}
