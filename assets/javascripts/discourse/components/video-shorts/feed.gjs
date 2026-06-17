import Component from "@glimmer/component";
import { tracked } from "@glimmer/tracking";
import { on } from "@ember/modifier";
import { action } from "@ember/object";
import { service } from "@ember/service";
import { modifier } from "ember-modifier";
import { eq } from "discourse/truth-helpers";
import dIcon from "discourse/ui-kit/helpers/d-icon";
import { i18n } from "discourse-i18n";
import VideoShortsCommentsSheet from "discourse/plugins/discourse-video-shorts/discourse/components/modal/video-shorts-comments-sheet";
import VideoShortsCommentsSurface from "discourse/plugins/discourse-video-shorts/discourse/components/video-shorts/comments-surface";
import { videoShortsAccentStyle } from "discourse/plugins/discourse-video-shorts/discourse/lib/video-shorts-visual-accent";
import VideoShortsItem from "./item";

export default class VideoShortsFeed extends Component {
  @service modal;

  @tracked activeIndex = 0;
  @tracked commentsOpen = false;
  @tracked selectedCommentsItem = null;
  @tracked isDesktopLayout = false;
  @tracked replyCountOverrides = {};
  commentsOpener = null;
  initialActivePostIdApplied = false;
  restoringInitialActivePostId = false;

  trackLayoutMode = modifier(() => {
    const query = window.matchMedia("(min-width: 1024px)");
    const update = () => {
      this.isDesktopLayout = query.matches;
    };

    update();
    query.addEventListener("change", update);

    return () => query.removeEventListener("change", update);
  });

  applyInitialActivePostId = modifier(() => {
    if (this.initialActivePostIdApplied) {
      return;
    }

    this.initialActivePostIdApplied = true;
    this.setActiveIndex(this.indexForPostId(this.args.initialActivePostId), {
      center: true,
      syncUrl: true,
    });
  });

  trackItemVisibility = modifier((element, [index]) => {
    if (!("IntersectionObserver" in window)) {
      return () => {};
    }

    const root = element.closest(".video-shorts-feed__items");
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
          if (this.restoringInitialActivePostId && index !== this.activeIndex) {
            return;
          }

          this.restoringInitialActivePostId = false;
          this.setActiveIndex(index);
        }
      },
      { root, threshold: [0.6] }
    );

    observer.observe(element);

    return () => observer.disconnect();
  });

  centerOnInsert = modifier(() => {
    requestAnimationFrame(() => this.centerActiveItem());
  });

  isWithinPreloadWindow = (index) => {
    return Math.abs(index - this.activeIndex) <= 1;
  };

  replyCountFor = (item) => {
    if (!item) {
      return 0;
    }

    return (
      this.replyCountOverrides[item.post_id] ?? item.counts?.reply_count ?? 0
    );
  };

  itemPosition = (index) => {
    return index + 1;
  };

  itemAriaLabel = (item, index) => {
    return i18n("video_shorts.feed.item_aria", {
      title: item.title,
      username: item.username,
      position: this.itemPosition(index),
      total: this.args.items?.length || 0,
    });
  };

  constructor(owner, args) {
    super(owner, args);
    this.activeIndex = this.indexForPostId(args.initialActivePostId);
    this.restoringInitialActivePostId =
      Boolean(args.initialActivePostId) && this.activeIndex > 0;
  }

  indexForPostId(postId) {
    const targetPostId = postId ? String(postId) : null;

    if (!targetPostId) {
      return 0;
    }

    const index = this.args.items?.findIndex(
      (item) => String(item.post_id) === targetPostId
    );

    return index >= 0 ? index : 0;
  }

  notifyActivePostId() {
    const postId = this.activeItem?.post_id;

    if (postId) {
      this.args.onActivePostIdChange?.(postId);
    }
  }

  setActiveIndex(index, { center = false, syncUrl = true } = {}) {
    const itemCount = this.args.items?.length || 0;

    if (itemCount === 0) {
      return;
    }

    const nextIndex = Math.max(0, Math.min(itemCount - 1, index));

    this.activeIndex = nextIndex;

    if (syncUrl) {
      this.notifyActivePostId();
    }

    if (center) {
      this.centerActiveItem();
    }
  }

  

  

  

  

  

  

  

  get activeItemSelector() {
    return `[data-video-shorts-index="${this.activeIndex}"]`;
  }

  get activeItem() {
    return this.args.items?.[this.activeIndex] || null;
  }

  get commentsSurfaceItem() {
    if (!this.commentsOpen) {
      return null;
    }

    return this.isDesktopLayout ? this.activeItem : this.selectedCommentsItem;
  }

  get showDesktopCommentsPanel() {
    return this.isDesktopLayout && Boolean(this.commentsSurfaceItem);
  }

  get commentsCountLabel() {
    const count = this.replyCountFor(this.commentsSurfaceItem);

    return i18n(
      count === 1
        ? "video_shorts.comments.count.one"
        : "video_shorts.comments.count.other",
      { count }
    );
  }

  get commentsPanelLabel() {
    return i18n("video_shorts.comments.panel_label", {
      title: this.commentsSurfaceItem.title,
    });
  }

  get commentsAccentStyle() {
    return videoShortsAccentStyle(this.commentsSurfaceItem);
  }

  focusIsInsideIgnoredSurface(target) {
    return Boolean(
      target?.closest(
        "input, textarea, select, [contenteditable='true'], [role='dialog'], [role='menu'], .modal, .composer-popup, #reply-control"
      )
    );
  }

  @action
  handleCommentsPanelWheel(event) {
    if (
      event.target?.closest(
        "input, textarea, select, [contenteditable='true'], [role='dialog'], [role='menu'], .modal, .composer-popup, #reply-control"
      )
    ) {
      return;
    }

    const list = event.currentTarget.querySelector(
      "[data-video-shorts-youtube-thread-list]"
    );

    if (!list || !Number.isFinite(event.deltaY)) {
      return;
    }

    event.stopPropagation();

    const maxScrollTop = Math.max(0, list.scrollHeight - list.clientHeight);

    if (maxScrollTop === 0) {
      return;
    }

    const nextScrollTop = Math.max(
      0,
      Math.min(maxScrollTop, list.scrollTop + event.deltaY)
    );

    if (nextScrollTop !== list.scrollTop) {
      event.preventDefault();
      list.scrollTop = nextScrollTop;
      return;
    }

    event.preventDefault();
  }

  activeVideo() {
    return document.querySelector(`${this.activeItemSelector} video`);
  }

  @action
  centerActiveItem() {
    requestAnimationFrame(() => {
      const activeItem = document.querySelector(this.activeItemSelector);
      const scroller = activeItem?.closest(".video-shorts-feed__items");

      if (activeItem && scroller) {
        scroller.scrollTo({
          top:
            activeItem.offsetTop -
            (scroller.clientHeight - activeItem.clientHeight) / 2,
        });
        return;
      }

      activeItem?.scrollIntoView({ block: "center" });

      const itemRect = activeItem?.getBoundingClientRect();
      if (itemRect) {
        window.scrollBy({
          top: itemRect.top + itemRect.height / 2 - window.innerHeight / 2,
        });
      }
    });
  }

  moveActiveIndex(direction) {
    const nextIndex = Math.max(
      0,
      Math.min((this.args.items?.length || 1) - 1, this.activeIndex + direction)
    );

    this.setActiveIndex(nextIndex, { syncUrl: true });
    document
      .querySelector(`[data-video-shorts-index="${nextIndex}"]`)
      ?.scrollIntoView({ block: "center" });
  }

  @action
  openComments({ item, opener, onReply }) {
    const itemIndex = this.indexForPostId(item?.post_id);

    if (
      this.isDesktopLayout &&
      item?.post_id &&
      String(item.post_id) !== String(this.activeItem?.post_id)
    ) {
      this.setActiveIndex(itemIndex, { syncUrl: true });
    }

    this.commentsOpen = true;
    this.selectedCommentsItem = item;
    this.commentsOpener = opener || null;

    if (this.isDesktopLayout) {
      return;
    }

    this.modal.show(VideoShortsCommentsSheet, {
      model: {
        item,
        opener,
        onReply,
        onReplyPublished: (result) => this.handleReplyPublished(item, result),
        onCommentDeleted: (deletedPost) =>
          this.handleCommentDeleted(item, deletedPost),
        onCommentMutation: (mutation) => this.handleCommentMutation(item, mutation),
        onClose: this.closeComments,
      },
    });
  }

  @action
  closeComments() {
    this.commentsOpen = false;
    this.selectedCommentsItem = null;
    this.commentsOpener = null;

    requestAnimationFrame(() => {
      document
        .querySelector(".video-shorts-feed__items")
        ?.focus({ preventScroll: true });
    });
  }

  @action
  handleReplyPublished(item, createdPost) {
    return this.handleCommentMutation(item, {
      type: "create",
      post: createdPost,
      countDelta: 1,
    });
  }

  @action
  handleCommentDeleted(item, deletedPost) {
    return this.handleCommentMutation(item, {
      type: "delete",
      post: deletedPost,
      countDelta: -1,
    });
  }

  @action
  handleCommentMutation(item, mutation) {
    const postId = item?.post_id || mutation?.sourcePostId;
    const countDelta = mutation?.countDelta || 0;
    const hasReplyCountValue = Number.isFinite(mutation?.replyCountValue);

    if (!postId || (countDelta === 0 && !hasReplyCountValue)) {
      return mutation;
    }

    const current = this.replyCountFor(item);
    const nextCount = hasReplyCountValue
      ? mutation.replyCountValue
      : Math.max(current + countDelta, 0);

    this.replyCountOverrides = {
      ...this.replyCountOverrides,
      [postId]: nextCount,
    };

    return mutation;
  }

  @action
  handleActiveReplyPublished(createdPost, submittedItem) {
    return this.handleReplyPublished(
      submittedItem || this.commentsSurfaceItem,
      createdPost
    );
  }

  @action
  handleActiveCommentDeleted(deletedPost) {
    return this.handleCommentDeleted(this.commentsSurfaceItem, deletedPost);
  }

  @action
  handleActiveCommentMutation(mutation) {
    return this.handleCommentMutation(this.commentsSurfaceItem, mutation);
  }

  togglePlayback() {
    const video = this.activeVideo();

    if (!video) {
      return;
    }

    if (video.paused) {
      video.play()?.catch?.(() => {});
    } else {
      video.pause();
    }
  }

  toggleMute() {
    const video = this.activeVideo();

    if (video) {
      video.muted = !video.muted;
    }
  }

  @action
  handleKeydown(event) {
    if (this.focusIsInsideIgnoredSurface(event.target)) {
      return;
    }

    if (event.key === " " || event.key === "Spacebar") {
      event.preventDefault();
      this.togglePlayback();
      return;
    }

    if (event.key === "m" || event.key === "M") {
      event.preventDefault();
      this.toggleMute();
      return;
    }

    if (event.key === "ArrowDown" || event.key === "j" || event.key === "J") {
      event.preventDefault();
      this.moveActiveIndex(1);
      return;
    }

    if (event.key === "ArrowUp" || event.key === "k" || event.key === "K") {
      event.preventDefault();
      this.moveActiveIndex(-1);
    }
  }

  <template>
    <div
      class="video-shorts-feed__viewport"
      data-active-post-id={{this.activeItem.post_id}}
      data-comments-open-post-id={{this.commentsSurfaceItem.post_id}}
      data-comments-open={{if this.commentsOpen "true" "false"}}
      data-comments-layout={{if this.isDesktopLayout "desktop" "mobile"}}
      {{this.trackLayoutMode}}
    >
      <ol
        class="video-shorts-feed__items"
        tabindex="0"
        {{this.applyInitialActivePostId}}
        {{this.centerOnInsert}}
        {{on "keydown" this.handleKeydown}}
      >
        {{#each @items as |item index|}}
          <li
            class="video-shorts-feed__item"
            data-video-shorts-index={{index}}
            data-post-id={{item.post_id}}
            aria-current={{if (eq index this.activeIndex) "true"}}
            aria-label={{this.itemAriaLabel item index}}
            {{this.trackItemVisibility index}}
          >
            <VideoShortsItem
              @item={{item}}
              @isActive={{eq index this.activeIndex}}
              @shouldPreload={{this.isWithinPreloadWindow index}}
              @replyCount={{this.replyCountFor item}}
              @onOpenComments={{this.openComments}}
            />
          </li>
        {{/each}}
      </ol>

      {{#if this.showDesktopCommentsPanel}}
        <aside
          class="video-shorts-comments-panel"
          style={{this.commentsAccentStyle}}
          data-comments-post-id={{this.commentsSurfaceItem.post_id}}
          aria-label={{this.commentsPanelLabel}}
        >
          <div class="video-shorts-comments-panel__header">
            <div>
              <h2 class="video-shorts-comments-panel__title">
                {{i18n "video_shorts.comments.title"}}
              </h2>
              <p class="video-shorts-comments-panel__count">
                {{this.commentsCountLabel}}
              </p>
            </div>
            <button
              type="button"
              class="btn-flat video-shorts-comments-panel__close"
              data-action="close-comments"
              aria-label={{i18n "video_shorts.comments.close"}}
              {{on "click" this.closeComments}}
            >
              {{dIcon "xmark"}}
            </button>
          </div>

          <div
            class="video-shorts-comments-panel__body"
            tabindex="0"
            {{on "wheel" this.handleCommentsPanelWheel}}
          >
            <VideoShortsCommentsSurface
              @item={{this.commentsSurfaceItem}}
              @replyCount={{this.replyCountFor this.commentsSurfaceItem}}
              @onReplyPublished={{this.handleActiveReplyPublished}}
              @onCommentDeleted={{this.handleActiveCommentDeleted}}
              @onCommentMutation={{this.handleActiveCommentMutation}}
            />
          </div>

        </aside>
      {{/if}}
    </div>
  </template>
}
