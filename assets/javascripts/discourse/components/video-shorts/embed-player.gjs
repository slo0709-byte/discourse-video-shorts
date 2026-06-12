import Component from "@glimmer/component";
import { trustedVideoShortsIframe } from "discourse/plugins/discourse-video-shorts/discourse/lib/video-shorts-embed-policy";

export default class VideoShortsEmbedPlayer extends Component {
  get iframe() {
    return trustedVideoShortsIframe(this.args.item?.media);
  }

  <template>
    <div class="video-shorts-embed-player">
      {{#if this.iframe}}
        <iframe
          class="video-shorts-embed-player__iframe"
          src={{this.iframe.src}}
          title={{this.iframe.title}}
          loading="lazy"
          allow={{this.iframe.allow}}
          sandbox={{this.iframe.sandbox}}
          referrerpolicy={{this.iframe.referrerPolicy}}
        ></iframe>
      {{else}}
        <a class="video-shorts-embed-player__fallback" href={{@item.post_url}}>
          Open topic
        </a>
      {{/if}}
    </div>
  </template>
}
