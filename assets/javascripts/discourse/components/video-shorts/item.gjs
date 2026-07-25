import Component from "@glimmer/component";
import VideoShortsActionRail from "./action-rail";
import VideoShortsEmbedPlayer from "./embed-player";
import VideoShortsHlsPlayer from "./hls-player";
import VideoShortsMetadata from "./metadata";
import VideoShortsNativePlayer from "./native-player";

export default class VideoShortsItem extends Component {
  get hasNativeVideo() {
    return Boolean(this.args.item?.media?.video_url);
  }

  get hasProviderIframe() {
    return this.args.item?.media?.renderability === "iframe_candidate";
  }

  get hasHlsVideo() {
    return (
      this.args.item?.media?.provider === "hls" &&
      this.args.item?.media?.renderability === "hls" &&
      Boolean(this.args.item?.media?.hls_url)
    );
  }

  get shouldRenderMedia() {
    return this.args.isActive;
  }

  <template>
    <article class="video-shorts-item">
      <div class="video-shorts-item__info">
        <VideoShortsMetadata @item={{@item}} />
      </div>

      <div class="video-shorts-item__player">
        <div class="video-shorts-item__stage">
          {{#if this.shouldRenderMedia}}
            {{#if this.hasNativeVideo}}
              <VideoShortsNativePlayer
                @item={{@item}}
                @isActive={{@isActive}}
                @isMuted={{@isMuted}}
                @onToggleMute={{@onToggleMute}}
                @shouldPreload={{@shouldPreload}}
              />
            {{else if this.hasHlsVideo}}
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
