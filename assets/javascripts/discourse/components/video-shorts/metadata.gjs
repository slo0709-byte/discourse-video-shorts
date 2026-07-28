import Component from "@glimmer/component";
import { tracked } from "@glimmer/tracking";
import { on } from "@ember/modifier";
import { action } from "@ember/object";
import { service } from "@ember/service";
import { userPath } from "discourse/lib/url";
import { i18n } from "discourse-i18n";

const DEFAULT_EXCERPT_CHARACTER_LIMIT = 120;
const MIN_PROTECTED_TAIL_CHARACTERS = 6;
const MAX_PROTECTED_TAIL_CHARACTERS = 12;
const FALLBACK_PROTECTED_TAIL_CHARACTERS = 7;
const HAN_CHARACTER_PATTERN = /[\u3400-\u9fff\uf900-\ufaff]/;
const CHINESE_WORD_SEGMENTER =
  typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter("zh-CN", { granularity: "word" })
    : null;

function unprotectedExcerpt(value) {
  return { body: value, tail: "" };
}

function splitProtectedExcerptTail(value) {
  const characters = Array.from(value);

  if (
    characters.length <= MIN_PROTECTED_TAIL_CHARACTERS ||
    !HAN_CHARACTER_PATTERN.test(value)
  ) {
    return unprotectedExcerpt(value);
  }

  let body;
  let tail;

  if (CHINESE_WORD_SEGMENTER) {
    const segments = Array.from(
      CHINESE_WORD_SEGMENTER.segment(value),
      ({ segment }) => segment,
    );
    let tailIndex = segments.length;
    let tailCharacterCount = 0;

    while (
      tailIndex > 0 &&
      tailCharacterCount < MIN_PROTECTED_TAIL_CHARACTERS
    ) {
      tailIndex -= 1;
      tailCharacterCount += Array.from(segments[tailIndex]).length;
    }

    if (tailCharacterCount > MAX_PROTECTED_TAIL_CHARACTERS) {
      return unprotectedExcerpt(value);
    }

    body = segments.slice(0, tailIndex).join("");
    tail = segments.slice(tailIndex).join("");
  } else {
    const tailLength = Math.min(
      FALLBACK_PROTECTED_TAIL_CHARACTERS,
      characters.length - 1,
    );

    body = characters.slice(0, -tailLength).join("");
    tail = characters.slice(-tailLength).join("");
  }

  if (!body || !tail || !HAN_CHARACTER_PATTERN.test(tail)) {
    return unprotectedExcerpt(value);
  }

  return { body, tail };
}

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

  get visibleExcerptParts() {
    return splitProtectedExcerptTail(this.visibleExcerpt);
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
          {{#let this.visibleExcerptParts as |excerptParts|}}
            <span class="video-shorts-metadata__excerpt-text">
              {{excerptParts.body}}{{#if excerptParts.tail}}<span
                  class="video-shorts-metadata__excerpt-tail"
                >{{excerptParts.tail}}</span>{{/if}}
            </span>
          {{/let}}

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
