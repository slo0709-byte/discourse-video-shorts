import Component from "@glimmer/component";
import { tracked } from "@glimmer/tracking";
import { on } from "@ember/modifier";
import { action } from "@ember/object";
import { service } from "@ember/service";
import { userPath } from "discourse/lib/url";
import { i18n } from "discourse-i18n";

const DEFAULT_EXCERPT_CHARACTER_LIMIT = 120;

export default class VideoShortsMetadata extends Component {
  @service siteSettings;

  @tracked excerptExpanded = false;

  get excerpt() {
    return this.args.item?.excerpt?.toString() || "";
  }

  get excerptCharacterLimit() {
    const configuredLimit = Number(
      this.siteSettings.video_shorts_excerpt_character_limit
    );

    if (!Number.isFinite(configuredLimit) || configuredLimit < 1) {
      return DEFAULT_EXCERPT_CHARACTER_LIMIT;
    }

    return Math.floor(configuredLimit);
  }

  get hasExpandableExcerpt() {
    return this.excerpt.length > this.excerptCharacterLimit;
  }

  get isExcerptTruncated() {
    return this.hasExpandableExcerpt && !this.excerptExpanded;
  }

  get excerptToggleLabel() {
    return this.excerptExpanded
      ? i18n("video_shorts.metadata.collapse_excerpt")
      : i18n("video_shorts.metadata.expand_excerpt");
  }

  get visibleExcerpt() {
    if (!this.isExcerptTruncated) {
      return this.excerpt;
    }

    return `${this.excerpt.slice(0, this.excerptCharacterLimit).trimEnd()}...`;
  }

  get excerptClass() {
    if (this.excerptExpanded) {
      return "video-shorts-metadata__excerpt video-shorts-metadata__excerpt--expanded";
    }

    return "video-shorts-metadata__excerpt";
  }

  @action
  toggleExcerpt(event) {
    event?.preventDefault();
    event?.stopPropagation();
    this.excerptExpanded = !this.excerptExpanded;
  }

  <template>
    <div class="video-shorts-metadata">
      {{#if @item.username}}
        <p class="video-shorts-metadata__publisher">
          <a
            class="video-shorts-metadata__publisher-link"
            href={{userPath @item.username}}
            data-user-card={{@item.username}}
          >
            @{{@item.username}}
          </a>
        </p>
      {{/if}}

      <h2 class="video-shorts-item-title video-shorts-metadata__title">
        {{@item.title}}
      </h2>

      {{#if this.excerpt}}
        <p class={{this.excerptClass}}>
          <span class="video-shorts-metadata__excerpt-text">
            {{this.visibleExcerpt}}
          </span>

          {{#if this.hasExpandableExcerpt}}
            <button
              type="button"
              class="btn-flat video-shorts-metadata__excerpt-expand"
              {{on "click" this.toggleExcerpt}}
            >
              {{this.excerptToggleLabel}}
            </button>
          {{/if}}
        </p>
      {{/if}}
    </div>
  </template>
}
