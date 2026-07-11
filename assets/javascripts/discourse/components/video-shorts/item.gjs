import Component from "@glimmer/component";
import { i18n } from "discourse-i18n";
import VideoShortsActionRail from "./action-rail";
import VideoShortsEmbedPlayer from "./embed-player";
import VideoShortsHlsPlayer from "./hls-player";
import VideoShortsMetadata from "./metadata";
import VideoShortsNativePlayer from "./native-player";

export default class VideoShortsItem extends Component {
  get mediaKind() {
    return this.args.item?.media?.kind;
  }

  get hasNativeVideo() {
    return ["upload_mp4", "external_mp4"].includes(this.mediaKind);
  }

  get hasEmbed() {
    return ["bilibili", "youtube"].includes(this.mediaKind);
  }

  get hasHlsVideo() {
    return this.mediaKind === "external_hls";
  }

  get shouldRenderMedia() {
    return (
      this.mediaKind === "fallback" ||
      this.args.isActive ||
      (this.args.shouldPreload && (this.hasNativeVideo || this.hasHlsVideo))
    );
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
                @shouldPreload={{@shouldPreload}}
                @routeSessionOwner={{@routeSessionOwner}}
              />
            {{else if this.hasHlsVideo}}
              <VideoShortsHlsPlayer
                @item={{@item}}
                @isActive={{@isActive}}
                @shouldPreload={{@shouldPreload}}
                @routeSessionOwner={{@routeSessionOwner}}
              />
            {{else if this.hasEmbed}}
              <VideoShortsEmbedPlayer
                @item={{@item}}
                @routeSessionOwner={{@routeSessionOwner}}
              />
            {{else}}
              <a class="video-shorts-embed-player__fallback" href={{@item.post_url}}>{{i18n "video_shorts.actions.open_topic"}}</a>
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
