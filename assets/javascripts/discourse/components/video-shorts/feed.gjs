import Component from "@glimmer/component";
import { tracked } from "@glimmer/tracking";
import { warn } from "@ember/debug";
import { isDestroyed, isDestroying } from "@ember/destroyable";
import { on } from "@ember/modifier";
import { action } from "@ember/object";
import { scheduleOnce } from "@ember/runloop";
import { service } from "@ember/service";
import { modifier } from "ember-modifier";
import { ajax } from "discourse/lib/ajax";
import { eq, not } from "discourse/truth-helpers";
import dIcon from "discourse/ui-kit/helpers/d-icon";
import { i18n } from "discourse-i18n";
import {
  createVideoShortsCommentCountFetcher,
  createVideoShortsCommentCountSync,
} from "discourse/plugins/discourse-video-shorts/discourse/lib/video-shorts-comment-count";
import {
  videoShortsFeedKeyAction,
  videoShortsItemIsMounted,
} from "discourse/plugins/discourse-video-shorts/discourse/lib/video-shorts-feed-window";
import {
  createVideoShortsRealtimeCommentsLedger,
  gateVideoShortsRealtimeComment,
} from "discourse/plugins/discourse-video-shorts/discourse/lib/video-shorts-realtime-comments";
import { videoShortsAccentStyle } from "discourse/plugins/discourse-video-shorts/discourse/lib/video-shorts-visual-accent";
import VideoShortsItem from "./item";

const NEAR_END_THRESHOLD = 5;
const SCROLL_SETTLE_DELAY = 120;

export default class VideoShortsFeed extends Component {
  @service composer;
  @service messageBus;
  @service modal;

  @tracked activeIndex = 0;
  @tracked playbackIndex = 0;
  @tracked commentsOpen = false;
  @tracked selectedCommentsItem = null;
  @tracked isDesktopLayout = false;
  @tracked mediaMuted = true;
  @tracked replyCountOverrides = {};
  @tracked CommentsSurfaceComponent = null;
  lastAppliedInitialActivePostId = null;
  restoringInitialActivePostId = false;
  commentCountSync = null;
  pendingActiveIndex = null;
  scrollSettleTimer = null;
  visibleItemRatios = new Map();
  lastNearEndIndex = null;
  feedItemsElement = null;
  centerFrame = null;
  focusFrame = null;
  visibilityObserver = null;
  observedVisibilityItems = new Map();
  commentsTriggerElement = null;
  commentsSurfaceRequest = null;
  commentsSheetRequest = null;
  commentsOpenRequestId = 0;

  loadCommentsSurface = () => {
    this.commentsSurfaceRequest ??= import(
      "discourse/plugins/discourse-video-shorts/discourse/components/video-shorts/comments-surface"
    )
      .then(({ default: CommentsSurfaceComponent }) => {
        if (!isDestroying(this) && !isDestroyed(this)) {
          this.CommentsSurfaceComponent = CommentsSurfaceComponent;
        }

        return CommentsSurfaceComponent;
      })
      .catch((error) => {
        this.commentsSurfaceRequest = null;
        throw error;
      });

    return this.commentsSurfaceRequest;
  };

  loadCommentsSheet = () => {
    this.commentsSheetRequest ??= import(
      "discourse/plugins/discourse-video-shorts/discourse/components/modal/video-shorts-comments-sheet"
    )
      .then(({ default: CommentsSheetComponent }) => CommentsSheetComponent)
      .catch((error) => {
        this.commentsSheetRequest = null;
        throw error;
      });

    return this.commentsSheetRequest;
  };

  trackLayoutMode = modifier(() => {
    const query = window.matchMedia("(min-width: 1024px)");
    const update = () => {
      this.isDesktopLayout = query.matches;
    };

    update();
    query.addEventListener("change", update);

    return () => query.removeEventListener("change", update);
  });

  trackCommentsPanelRect = modifier((element) => {
    const body = document.body;
    let frame = null;
    let settleFrame = null;

    const update = () => {
      frame = null;
      const rect = element.getBoundingClientRect();

      body.style.setProperty(
        "--video-shorts-comments-panel-left",
        `${Math.round(rect.left)}px`
      );
      body.style.setProperty(
        "--video-shorts-comments-panel-top",
        `${Math.round(rect.top)}px`
      );
      body.style.setProperty(
        "--video-shorts-comments-panel-width",
        `${Math.round(rect.width)}px`
      );
      body.style.setProperty(
        "--video-shorts-comments-panel-height",
        `${Math.round(rect.height)}px`
      );
    };
    const scheduleUpdate = () => {
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }

      frame = requestAnimationFrame(update);
    };
    const observer = new ResizeObserver(scheduleUpdate);
    const composer = document.querySelector("#reply-control");
    const scheduleSettledUpdates = () => {
      if (settleFrame !== null) {
        cancelAnimationFrame(settleFrame);
      }

      let remainingFrames = 4;
      const settle = () => {
        update();
        remainingFrames -= 1;
        settleFrame =
          remainingFrames > 0 ? requestAnimationFrame(settle) : null;
      };

      settleFrame = requestAnimationFrame(settle);
    };
    const composerObserver = new MutationObserver(scheduleSettledUpdates);

    body.classList.add("video-shorts-comments-panel-open");
    observer.observe(element);

    if (composer) {
      composerObserver.observe(composer, {
        attributeFilter: ["class"],
        attributes: true,
      });
    }

    window.addEventListener("resize", scheduleUpdate);
    update();

    return () => {
      observer.disconnect();
      composerObserver.disconnect();
      window.removeEventListener("resize", scheduleUpdate);

      if (frame !== null) {
        cancelAnimationFrame(frame);
      }

      if (settleFrame !== null) {
        cancelAnimationFrame(settleFrame);
      }

      body.classList.remove("video-shorts-comments-panel-open");
      for (const property of [
        "--video-shorts-comments-panel-left",
        "--video-shorts-comments-panel-top",
        "--video-shorts-comments-panel-width",
        "--video-shorts-comments-panel-height",
      ]) {
        body.style.removeProperty(property);
      }
    };
  });

  manageDocumentKeyboard = modifier(() => {
    const handleDocumentKeydown = (event) => {
      if (!event.defaultPrevented) {
        this.handleKeydown(event);
      }
    };

    document.addEventListener("keydown", handleDocumentKeydown);

    return () => {
      document.removeEventListener("keydown", handleDocumentKeydown);
    };
  });

  manageMobileComposerEscape = modifier(() => {
    const closeComposerBeforeSheet = (event) => {
      if (
        event.key !== "Escape" ||
        !event.target?.closest?.("#reply-control.open") ||
        !document.querySelector(".video-shorts-comments-sheet")
      ) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();
      this.composer.close();
    };

    document.addEventListener("keydown", closeComposerBeforeSheet, true);

    return () => {
      document.removeEventListener("keydown", closeComposerBeforeSheet, true);
    };
  });

  applyInitialActivePostId = modifier((_element, [postId]) => {
    const postIdKey = postId ? String(postId) : "";

    if (postIdKey === this.lastAppliedInitialActivePostId) {
      return;
    }

    this.lastAppliedInitialActivePostId = postIdKey;
    scheduleOnce("afterRender", this, this.applyRequestedActivePostId, postId);
  });

  trackRealtimeCommentCount = modifier(
    (_element, [topicId, postId, lastMessageId]) => {
      this.commentCountSync ??= createVideoShortsCommentCountSync({
        subscribe: (channel, callback, cursor) =>
          this.messageBus.subscribe(channel, callback, cursor),
        unsubscribe: (channel, callback) =>
          this.messageBus.unsubscribe(channel, callback),
        fetchCount: createVideoShortsCommentCountFetcher(ajax),
        createLedger: createVideoShortsRealtimeCommentsLedger,
        gateEvent: gateVideoShortsRealtimeComment,
        onCount: (sourcePostId, count) => {
          this.replyCountOverrides = {
            ...this.replyCountOverrides,
            [sourcePostId]: count,
          };
        },
      });
      this.commentCountSync.activate({ topicId, postId, lastMessageId });

      return () => this.commentCountSync.deactivate();
    }
  );

  refreshCommentCountOnReconnect = modifier(() => {
    const refresh = () => this.commentCountSync?.refresh();

    window.addEventListener("online", refresh);

    return () => window.removeEventListener("online", refresh);
  });

  trackItemVisibility = modifier((element, [index]) => {
    if (!("IntersectionObserver" in window)) {
      return () => {};
    }

    if (!this.visibilityObserver) {
      const root = element.closest(".video-shorts-feed__items");
      this.visibilityObserver = new IntersectionObserver(
        this.handleVisibilityEntries,
        { root, threshold: [0.6] }
      );
    }

    this.observedVisibilityItems.set(element, index);
    this.visibilityObserver.observe(element);

    return () => {
      this.visibilityObserver?.unobserve?.(element);
      this.observedVisibilityItems.delete(element);
      this.visibleItemRatios.delete(index);

      if (this.observedVisibilityItems.size === 0) {
        this.visibilityObserver?.disconnect();
        this.visibilityObserver = null;
      }
    };
  });

  trackScrollSettling = modifier((element) => {
    const commit = () => this.commitPendingActiveIndex();
    const schedule = () => this.schedulePendingActiveCommit();

    element.addEventListener("scroll", schedule, { passive: true });
    element.addEventListener("scrollend", commit);

    return () => {
      element.removeEventListener("scroll", schedule);
      element.removeEventListener("scrollend", commit);
      this.clearScrollSettleTimer();
      this.visibleItemRatios.clear();
      this.pendingActiveIndex = null;
    };
  });

  centerOnInsert = modifier((element) => {
    this.feedItemsElement = element;
    this.centerActiveItem();

    return () => {
      this.clearCenterFrame();
      this.clearFocusFrame();

      if (this.feedItemsElement === element) {
        this.feedItemsElement = null;
      }
    };
  });

  isWithinPreloadWindow = (index) => {
    return (
      index === this.playbackIndex ||
      (this.allowsAdjacentPreload &&
        Math.abs(index - this.playbackIndex) <= 1)
    );
  };

  isItemMounted = (index) => {
    return videoShortsItemIsMounted(index, this.activeIndex);
  };

  isItemInert = (index) => {
    return !this.isItemMounted(index);
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

  commentsRequestIsCurrent = (requestId, item) => {
    return (
      requestId === this.commentsOpenRequestId &&
      this.commentsOpen &&
      String(item?.post_id) === String(this.selectedCommentsItem?.post_id) &&
      !isDestroying(this) &&
      !isDestroyed(this)
    );
  };

  handleVisibilityEntries = (entries) => {
    for (const entry of entries) {
      const index = this.observedVisibilityItems.get(entry.target);

      if (
        index === undefined ||
        (this.restoringInitialActivePostId && index !== this.activeIndex)
      ) {
        continue;
      }

      if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
        this.visibleItemRatios.set(index, entry.intersectionRatio);
      } else {
        this.visibleItemRatios.delete(index);
      }
    }

    this.pendingActiveIndex = this.mostVisibleItemIndex();
    if (this.pendingActiveIndex !== null) {
      this.setPlaybackIndex(this.pendingActiveIndex);
    }
    this.schedulePendingActiveCommit();
  };

  constructor(owner, args) {
    super(owner, args);
    this.activeIndex = this.indexForPostId(args.initialActivePostId);
    this.playbackIndex = this.activeIndex;
    this.restoringInitialActivePostId = Boolean(args.initialActivePostId);
  }

  get allowsAdjacentPreload() {
    const connection = navigator.connection;

    return (
      !connection?.saveData &&
      connection?.effectiveType !== "slow-2g" &&
      connection?.effectiveType !== "2g"
    );
  }

  applyRequestedActivePostId(postId) {
    const postIdKey = postId ? String(postId) : "";

    if (
      isDestroying(this) ||
      isDestroyed(this) ||
      postIdKey !== this.lastAppliedInitialActivePostId
    ) {
      return;
    }

    const nextIndex = this.indexForPostId(postId);
    this.restoringInitialActivePostId = Boolean(postId);
    this.clearScrollSettleTimer();
    this.visibleItemRatios.clear();
    this.pendingActiveIndex = null;
    this.setActiveIndex(nextIndex, {
      center: true,
      syncUrl: true,
    });
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

  mostVisibleItemIndex() {
    let mostVisibleIndex = null;
    let highestRatio = 0;

    for (const [index, ratio] of this.visibleItemRatios) {
      if (ratio > highestRatio) {
        mostVisibleIndex = index;
        highestRatio = ratio;
      }
    }

    return mostVisibleIndex;
  }

  clearScrollSettleTimer() {
    if (this.scrollSettleTimer !== null) {
      clearTimeout(this.scrollSettleTimer);
      this.scrollSettleTimer = null;
    }
  }

  clearCenterFrame() {
    if (this.centerFrame !== null) {
      cancelAnimationFrame(this.centerFrame);
      this.centerFrame = null;
    }
  }

  clearFocusFrame() {
    if (this.focusFrame !== null) {
      cancelAnimationFrame(this.focusFrame);
      this.focusFrame = null;
    }
  }

  schedulePendingActiveCommit() {
    if (this.pendingActiveIndex === null) {
      return;
    }

    this.clearScrollSettleTimer();
    this.scrollSettleTimer = setTimeout(
      () => this.commitPendingActiveIndex(),
      SCROLL_SETTLE_DELAY
    );
  }

  commitPendingActiveIndex() {
    if (this.pendingActiveIndex === null) {
      return;
    }

    const nextIndex = this.pendingActiveIndex;

    this.pendingActiveIndex = null;
    this.clearScrollSettleTimer();
    this.setActiveIndex(nextIndex);
    this.restoringInitialActivePostId = false;
  }

  requestNextPageNearEnd(index) {
    const itemCount = this.args.items?.length || 0;
    const remainingItems = itemCount - index - 1;

    if (
      index === 0 ||
      remainingItems > NEAR_END_THRESHOLD ||
      this.lastNearEndIndex === index
    ) {
      return;
    }

    this.lastNearEndIndex = index;
    this.args.onNearEnd?.();
  }

  setPlaybackIndex(index) {
    const itemCount = this.args.items?.length || 0;

    if (itemCount === 0) {
      return;
    }

    this.playbackIndex = Math.max(0, Math.min(itemCount - 1, index));
  }

  setActiveIndex(index, { center = false, syncUrl = true } = {}) {
    const itemCount = this.args.items?.length || 0;

    if (itemCount === 0) {
      return;
    }

    const nextIndex = Math.max(0, Math.min(itemCount - 1, index));
    const activeIndexChanged = nextIndex !== this.activeIndex;

    this.setPlaybackIndex(nextIndex);

    if (activeIndexChanged) {
      this.activeIndex = nextIndex;
    }

    if (syncUrl && activeIndexChanged) {
      this.notifyActivePostId();
    }

    if (activeIndexChanged) {
      this.requestNextPageNearEnd(nextIndex);
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

  get playbackItemSelector() {
    return `[data-video-shorts-index="${this.playbackIndex}"]`;
  }

  get playbackItem() {
    return this.args.items?.[this.playbackIndex] || null;
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
        "input, textarea, select, button, a[href], [role='button'], [role='link'], [contenteditable]:not([contenteditable='false']), [role='dialog'], [role='menu'], .modal, .composer-popup, #reply-control"
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
    return this.feedItemsElement?.querySelector(
      `${this.playbackItemSelector} video`
    );
  }

  @action
  centerActiveItem() {
    this.clearCenterFrame();
    this.centerFrame = requestAnimationFrame(() => {
      this.centerFrame = null;

      if (isDestroying(this) || isDestroyed(this)) {
        return;
      }

      const scroller = this.feedItemsElement;
      const activeItem = scroller?.querySelector(this.activeItemSelector);

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

  get hasPreviousItem() {
    return this.activeIndex > 0;
  }

  get hasNextItem() {
    return this.activeIndex < (this.args.items?.length || 1) - 1;
  }

  @action
  showPreviousItem() {
    this.moveActiveIndex(-1);
  }

  @action
  showNextItem() {
    this.moveActiveIndex(1);
  }

  moveActiveIndex(direction) {
    this.restoringInitialActivePostId = false;
    const navigationIndex = this.pendingActiveIndex ?? this.activeIndex;
    const nextIndex = Math.max(
      0,
      Math.min((this.args.items?.length || 1) - 1, navigationIndex + direction)
    );

    if (nextIndex === navigationIndex) {
      return;
    }

    this.pendingActiveIndex = nextIndex;
    this.setPlaybackIndex(nextIndex);
    this.feedItemsElement
      ?.querySelector(`[data-video-shorts-index="${nextIndex}"]`)
      ?.scrollIntoView({ block: "center" });
    this.schedulePendingActiveCommit();
  }

  @action
  async openComments({ item }) {
    const requestId = ++this.commentsOpenRequestId;

    this.clearFocusFrame();
    const itemIndex = this.indexForPostId(item?.post_id);
    const focusedTrigger = document.activeElement?.closest?.(
      '[data-action="open-comments"]'
    );
    this.commentsTriggerElement =
      focusedTrigger ??
      this.feedItemsElement
        ?.querySelector(`[data-video-shorts-index="${itemIndex}"]`)
        ?.querySelector('[data-action="open-comments"]') ??
      null;

    if (
      this.isDesktopLayout &&
      item?.post_id &&
      String(item.post_id) !== String(this.activeItem?.post_id)
    ) {
      this.setActiveIndex(itemIndex, { syncUrl: true });
    }

    this.commentsOpen = true;
    this.selectedCommentsItem = item;

    try {
      if (this.isDesktopLayout) {
        await this.loadCommentsSurface();

        if (!this.commentsRequestIsCurrent(requestId, item)) {
          return;
        }

        this.clearFocusFrame();
        this.focusFrame = requestAnimationFrame(() => {
          this.focusFrame = null;

          if (this.commentsRequestIsCurrent(requestId, item)) {
            document
              .querySelector(
                "#video-shorts-comments-panel .video-shorts-comments-panel__body"
              )
              ?.focus({ preventScroll: true });
          }
        });
        return;
      }

      const CommentsSheetComponent = await this.loadCommentsSheet();

      if (!this.commentsRequestIsCurrent(requestId, item)) {
        return;
      }

      this.modal.show(CommentsSheetComponent, {
        model: {
          item,
          replyCount: () => this.replyCountFor(item),
          onCommentMutation: (mutation) =>
            this.handleCommentMutation(item, mutation),
          onClose: this.closeComments,
        },
      });
    } catch (error) {
      if (this.commentsRequestIsCurrent(requestId, item)) {
        this.commentsOpen = false;
        this.selectedCommentsItem = null;
        warn(`Video Shorts comments failed to load: ${error}`, false, {
          id: "discourse-video-shorts.comments-load-failed",
        });
      }

      return;
    }
  }

  @action
  closeComments(options = {}) {
    this.commentsOpenRequestId += 1;
    const restoreTrigger = options?.restoreTrigger ?? this.isDesktopLayout;
    const focusTarget = restoreTrigger
      ? (this.feedItemsElement?.querySelector(
          `${this.activeItemSelector} [data-action="open-comments"]`
        ) ?? this.commentsTriggerElement)
      : this.feedItemsElement;

    this.commentsOpen = false;
    this.selectedCommentsItem = null;
    this.commentsTriggerElement = null;

    this.clearFocusFrame();
    this.focusFrame = requestAnimationFrame(() => {
      this.focusFrame = null;

      if (
        !this.commentsOpen &&
        !isDestroying(this) &&
        !isDestroyed(this) &&
        focusTarget?.isConnected
      ) {
        focusTarget.focus({ preventScroll: true });
      }
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
    const reconciliation = this.commentCountSync?.reconcileMutation({
      sourcePostId: postId,
      currentCount: current,
      mutation,
    });
    const nextCount =
      reconciliation?.count ??
      (hasReplyCountValue
        ? mutation.replyCountValue
        : Math.max(current + countDelta, 0));

    this.replyCountOverrides = {
      ...this.replyCountOverrides,
      [postId]: nextCount,
    };

    return mutation;
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

  @action
  toggleMute() {
    this.mediaMuted = !this.mediaMuted;
    const video = this.activeVideo();

    if (video) {
      video.muted = this.mediaMuted;
    }
  }

  @action
  handleKeydown(event) {
    if (
      event.defaultPrevented ||
      this.focusIsInsideIgnoredSurface(event.target)
    ) {
      return;
    }

    const keyAction = videoShortsFeedKeyAction(event.key);

    if (keyAction === "toggle-playback") {
      event.preventDefault();
      this.togglePlayback();
      return;
    }

    if (keyAction === "toggle-mute") {
      event.preventDefault();
      this.toggleMute();
      return;
    }

    if (keyAction === "next") {
      event.preventDefault();
      this.moveActiveIndex(1);
      return;
    }

    if (keyAction === "previous") {
      event.preventDefault();
      this.moveActiveIndex(-1);
      return;
    }

    if (keyAction === "escape" && this.showDesktopCommentsPanel) {
      event.preventDefault();
      this.closeComments({ restoreTrigger: true });
    }
  }

  <template>
    <div
      class="video-shorts-feed__viewport"
      data-active-post-id={{this.activeItem.post_id}}
      data-playback-post-id={{this.playbackItem.post_id}}
      data-comments-open-post-id={{this.commentsSurfaceItem.post_id}}
      data-comments-open={{if this.commentsOpen "true" "false"}}
      data-comments-layout={{if this.isDesktopLayout "desktop" "mobile"}}
      {{this.trackLayoutMode}}
      {{this.trackRealtimeCommentCount
        this.activeItem.topic_id
        this.activeItem.post_id
        this.activeItem.message_bus_last_id
      }}
      {{this.refreshCommentCountOnReconnect}}
      {{this.manageMobileComposerEscape}}
      {{this.manageDocumentKeyboard}}
    >
      <ol
        class="video-shorts-feed__items"
        tabindex="0"
        {{this.applyInitialActivePostId @initialActivePostId}}
        {{this.centerOnInsert}}
        {{this.trackScrollSettling}}
        {{on "keydown" this.handleKeydown}}
      >
        {{#each @items as |item index|}}
          <li
            class="video-shorts-feed__item"
            data-video-shorts-index={{index}}
            data-post-id={{item.post_id}}
            aria-current={{if (eq index this.activeIndex) "true"}}
            aria-hidden={{if (this.isItemInert index) "true"}}
            aria-label={{this.itemAriaLabel item index}}
            inert={{this.isItemInert index}}
            {{this.trackItemVisibility index}}
          >
            {{#if (this.isItemMounted index)}}
              <VideoShortsItem
                @item={{item}}
                @isActive={{eq index this.playbackIndex}}
                @isMuted={{this.mediaMuted}}
                 @shouldPreload={{this.isWithinPreloadWindow index}}
                 @replyCount={{this.replyCountFor item}}
                 @commentsOpen={{eq
                   item.post_id
                   this.commentsSurfaceItem.post_id
                 }}
                 @commentsPanelId={{if
                   this.isDesktopLayout
                   "video-shorts-comments-panel"
                 }}
                 @onOpenComments={{this.openComments}}
                @onToggleMute={{this.toggleMute}}
              />
            {{else}}
              <div
                class="video-shorts-feed__item-placeholder"
                aria-hidden="true"
                inert
              ></div>
            {{/if}}
          </li>
        {{/each}}
      </ol>

      <nav
        class="video-shorts-feed__navigation"
        aria-label={{i18n "video_shorts.feed.navigation"}}
      >
        <button
          type="button"
          class="video-shorts-feed__navigation-button"
          data-action="previous-video"
          aria-label={{i18n "video_shorts.feed.previous"}}
          disabled={{not this.hasPreviousItem}}
          {{on "click" this.showPreviousItem}}
        >
          {{dIcon "chevron-up"}}
        </button>
        <button
          type="button"
          class="video-shorts-feed__navigation-button"
          data-action="next-video"
          aria-label={{i18n "video_shorts.feed.next"}}
          disabled={{not this.hasNextItem}}
          {{on "click" this.showNextItem}}
        >
          {{dIcon "chevron-down"}}
        </button>
      </nav>

      {{#if this.showDesktopCommentsPanel}}
        <aside
          id="video-shorts-comments-panel"
          class="video-shorts-comments-panel"
          style={{this.commentsAccentStyle}}
          data-comments-post-id={{this.commentsSurfaceItem.post_id}}
          aria-label={{this.commentsPanelLabel}}
          {{this.trackCommentsPanelRect}}
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
            {{#if this.CommentsSurfaceComponent}}
              <this.CommentsSurfaceComponent
                @item={{this.commentsSurfaceItem}}
                @replyCount={{this.replyCountFor this.commentsSurfaceItem}}
                @onCommentMutation={{this.handleActiveCommentMutation}}
              />
            {{else}}
              <div
                class="video-shorts-comments-surface__status"
                role="status"
              >
                {{i18n "video_shorts.comments.loading"}}
              </div>
            {{/if}}
          </div>

        </aside>
      {{/if}}
    </div>
  </template>
}
