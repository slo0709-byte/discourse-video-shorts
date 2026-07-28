import Component from "@glimmer/component";
import { tracked } from "@glimmer/tracking";
import { modifier } from "ember-modifier";
import VideoShortsActionRail from "./action-rail";
import VideoShortsEmbedPlayer from "./embed-player";
import VideoShortsHlsPlayer from "./hls-player";
import VideoShortsMetadata from "./metadata";
import VideoShortsNativePlayer from "./native-player";

export default class VideoShortsItem extends Component {
  @tracked chromeRevealed = false;

  revealChrome = modifier(() => {
    if (!this.args.isActive || this.chromeRevealed) {
      return;
    }

    let secondFrame = null;
    let firstFrame = requestAnimationFrame(() => {
      firstFrame = null;
      secondFrame = requestAnimationFrame(() => {
        secondFrame = null;

        if (this.args.isActive) {
          this.chromeRevealed = true;
        }
      });
    });

    return () => {
      if (firstFrame !== null) {
        cancelAnimationFrame(firstFrame);
      }

      if (secondFrame !== null) {
        cancelAnimationFrame(secondFrame);
      }
    };
  });

  get chromeState() {
    return this.chromeRevealed ? "revealed" : "pending";
  }

  get hasNativeVideo() {
    return Boolean(this.args.item?.media?.video_url);
  }

  get hasProviderIframe() {
    return this.args.item?.media?.renderability === "iframe_candidate";
  }

  get iframeProvider() {
    return this.hasProviderIframe ? this.args.item?.media?.provider : null;
  }

  get hasHlsVideo() {
    return (
      this.args.item?.media?.provider === "hls" &&
      this.args.item?.media?.renderability === "hls" &&
      Boolean(this.args.item?.media?.hls_url)
    );
  }

  get shouldRenderNativeVideo() {
    return (
      this.hasNativeVideo && (this.args.isActive || this.args.shouldPreload)
    );
  }

  <template>
    <article
      class="video-shorts-item"
      data-video-shorts-chrome={{this.chromeState}}
      data-video-shorts-provider={{this.iframeProvider}}
      {{this.revealChrome}}
    >
      <div class="video-shorts-item__info">
        <VideoShortsMetadata @item={{@item}} />
      </div>

      <div class="video-shorts-item__player">
        <div class="video-shorts-item__stage">
          {{#if this.shouldRenderNativeVideo}}
            <VideoShortsNativePlayer
              @item={{@item}}
              @isActive={{@isActive}}
              @isMuted={{@isMuted}}
              @onToggleMute={{@onToggleMute}}
              @shouldPreload={{@shouldPreload}}
            />
          {{else if @isActive}}
            {{#if this.hasHlsVideo}}
              <VideoShortsHlsPlayer
                @item={{@item}}
                @isActive={{@isActive}}
                @isMuted={{@isMuted}}
                @onToggleMute={{@onToggleMute}}
                @shouldPreload={{@shouldPreload}}
              />
            {{else}}
              <VideoShortsEmbedPlayer @item={{@item}} />
            {{/if}}
          {{else}}
            <div class="video-shorts-item__media-placeholder"></div>
          {{/if}}
        </div>

        <VideoShortsActionRail
          @item={{@item}}
          @replyCount={{@replyCount}}
          @onOpenComments={{@onOpenComments}}
        />
      </div>
    </article>
  </template>
}
