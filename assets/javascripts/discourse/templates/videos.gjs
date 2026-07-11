import { on } from "@ember/modifier";
import dIcon from "discourse/ui-kit/helpers/d-icon";
import { i18n } from "discourse-i18n";
import VideoShortsFeed from "discourse/plugins/discourse-video-shorts/discourse/components/video-shorts/feed";

export default <template>
  <section class="video-shorts-feed">
    <button
      type="button"
      class="btn-flat video-shorts-mobile-back"
      aria-label={{i18n "video_shorts.back"}}
      title={{i18n "video_shorts.back"}}
      {{on "click" @controller.goBack}}
    >
      {{dIcon "bars"}}
    </button>

    {{#if @controller.error}}
      <div class="video-shorts-error" role="alert">
        <span>{{i18n "video_shorts.feed.load_error"}}</span>
        <button
          type="button"
          class="btn btn-primary video-shorts-retry"
          {{on "click" @controller.retry}}
        >
          {{i18n "video_shorts.feed.retry"}}
        </button>
      </div>
    {{/if}}

    {{#if @controller.isEmpty}}
      <div class="video-shorts-empty">
        {{@controller.emptyMessage}}
      </div>
    {{/if}}

    {{#if @controller.hasItems}}
      <VideoShortsFeed
        @items={{@controller.items}}
        @initialActivePostId={{@controller.initialActivePostId}}
        @requestedPostId={{@controller.requestedPostId}}
        @routeSessionOwner={{@controller.routeSession}}
      />
    {{/if}}

  </section>
</template>
