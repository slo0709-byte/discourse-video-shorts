import Component from "@glimmer/component";
import { trustedVideoShortsIframe } from "discourse/plugins/discourse-video-shorts/discourse/lib/video-shorts-embed-policy";

export default class VideoShortsEmbedPlayer extends Component {
  get iframe() {
    return trustedVideoShortsIframe(this.args.item?.media);
  }

  <template>
    {{#let this.iframe as |embedInfo|}}
      <div
        class="video-shorts-embed-player"
        data-video-shorts-provider={{embedInfo.provider}}
      >
        {{#if embedInfo}}
          <iframe
            class="video-shorts-embed-player__iframe"
            data-video-shorts-provider={{embedInfo.provider}}
            src={{embedInfo.src}}
            title={{embedInfo.title}}
            loading="lazy"
            allow={{embedInfo.allow}}
            sandbox={{embedInfo.sandbox}}
            referrerpolicy={{embedInfo.referrerPolicy}}
          ></iframe>
        {{else}}
          <a class="video-shorts-embed-player__fallback" href={{@item.post_url}}>
            Open topic
          </a>
        {{/if}}
      </div>
    {{/let}}
  </template>
}
