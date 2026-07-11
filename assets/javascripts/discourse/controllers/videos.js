import { tracked } from "@glimmer/tracking";
import Controller from "@ember/controller";
import { action } from "@ember/object";
import { next } from "@ember/runloop";
import { service } from "@ember/service";
import { i18n } from "discourse-i18n";
import VideoShortsFeedWindowOwner from "discourse/plugins/discourse-video-shorts/discourse/lib/lifecycle/feed-window-owner";
import VideoShortsRouteSessionOwner from "discourse/plugins/discourse-video-shorts/discourse/lib/lifecycle/route-session-owner";
import {
  fetchVideoShortsPage,
  loadInitialVideoShortsFeed,
} from "discourse/plugins/discourse-video-shorts/discourse/lib/video-shorts-feed";

export default class VideosController extends Controller {
  @service currentUser;
  @service historyStore;
  @service router;
  @service videoShortsPolicy;
  @service videoShortsRealtime;
  @service videoShortsAuthorizationLease;

  @tracked post_id = null;
  @tracked items = [];
  @tracked nextCursor = null;
  @tracked scanLimitReached = false;
  @tracked loadingMore = false;
  @tracked error = null;
  @tracked failedCursor = null;
  @tracked initialActivePostId = null;
  @tracked requestedPostId = null;
  queryParams = ["post_id"];

  routeSession = null;
  feedWindow = null;

  handleFeedChange = (feedWindow, state) => {
    next(() => {
      if (
        this.isDestroying ||
        this.isDestroyed ||
        this.feedWindow !== feedWindow ||
        !feedWindow.isCurrent
      ) {
        return;
      }

      this.items = state.items;
      this.nextCursor = state.nextCursor;
      this.loadingMore = state.loading;
      this.error = state.protocolError
        ? new Error(`video_shorts_protocol_error:${state.protocolError}`)
        : state.error;
      this.failedCursor = state.failedCursor;
    });
  };

  constructor(...args) {
    super(...args);
    this.handleLoadNext = this.handleLoadNext.bind(this);
    window.addEventListener("video-shorts:load-next", this.handleLoadNext);
  }

  willDestroy() {
    window.removeEventListener("video-shorts:load-next", this.handleLoadNext);
    this.destroyRouteOwners();
    super.willDestroy(...arguments);
  }

  handleLoadNext() {
    this.feedWindow?.loadNext();
  }

  ensureRouteSession() {
    if (this.routeSession?.isCurrent) {
      return this.routeSession;
    }

    this.feedWindow?.destroy();
    this.feedWindow = null;
    this.routeSession = null;

    const routeSession = new VideoShortsRouteSessionOwner({
      policy: this.videoShortsPolicy,
      realtime: this.videoShortsRealtime,
      leases: this.videoShortsAuthorizationLease,
      sessionIdentity: this.currentUser?.id ?? null,
      getSessionIdentity: () => this.currentUser?.id ?? null,
      onSessionChange: () => this.reloadForPolicyRevision(),
      onRevisionChange: () => this.reloadForPolicyRevision(),
    });
    this.routeSession = routeSession;
    routeSession.start().catch(() => {
      if (this.routeSession === routeSession && routeSession.isCurrent) {
        this.failClosedForPolicy();
      }
    });
    return routeSession;
  }

  destroyRouteOwners() {
    this.feedWindow?.destroy();
    this.feedWindow = null;
    this.routeSession?.destroy();
    this.routeSession = null;
  }

  failClosedForPolicy() {
    this.feedWindow?.destroy();
    this.feedWindow = null;
    this.items = [];
    this.nextCursor = null;
    this.failedCursor = null;
    this.initialActivePostId = null;
    this.requestedPostId = null;
    this.error = new Error("video_shorts_policy_unavailable");
  }

  async reloadForPolicyRevision() {
    try {
      await this.videoShortsPolicy.revalidate();
      this.replaceModel(await loadInitialVideoShortsFeed());
    } catch {
      this.failClosedForPolicy();
    }
  }

  replaceModel(model) {
    const session = this.ensureRouteSession();
    this.items = model.items || [];
    this.nextCursor = model.nextCursor || null;
    this.scanLimitReached = Boolean(model.scanLimitReached);
    this.error = model.error || null;
    this.failedCursor = model.failedCursor || null;
    this.initialActivePostId = model.initialActivePostId || null;
    this.requestedPostId = model.requestedPostId || null;
    this.feedWindow?.destroy();
    const feedWindow = new VideoShortsFeedWindowOwner({
      parent: session,
      fetchPage: fetchVideoShortsPage,
      onChange: (state) => this.handleFeedChange(feedWindow, state),
    });
    this.feedWindow = session.attachFeedWindow(feedWindow);
    const protocolError =
      model.error?.name === "VideoShortsFeedProtocolError"
        ? model.error.reason
        : null;
    this.feedWindow.seed({
      items: this.items,
      nextCursor: this.nextCursor,
      endReached: !this.nextCursor,
      protocolError,
      error: protocolError ? null : model.error || null,
      failedCursor: this.failedCursor,
    });
  }

  get hasItems() {
    return this.items.length > 0;
  }

  get isEmpty() {
    return !this.hasItems && !this.error;
  }

  get canLoadMore() {
    return false;
  }

  get emptyMessage() {
    return this.currentUser?.staff
      ? i18n("video_shorts.feed.empty_staff")
      : i18n("video_shorts.feed.empty");
  }

  async loadCursor(cursor = null) {
    if (cursor) {
      return await this.feedWindow?.retry(cursor);
    }

    return await this.feedWindow?.loadNext();
  }

  @action
  loadMore() {
    return this.loadCursor();
  }

  @action
  async retry() {
    if (this.failedCursor) {
      return await this.loadCursor(this.failedCursor);
    }

    try {
      if (this.videoShortsPolicy.frozen) {
        await this.videoShortsPolicy.revalidate();
      }
      const model = await loadInitialVideoShortsFeed();
      this.replaceModel(model);
    } catch {
      this.failClosedForPolicy();
    }
  }

  @action
  goBack(event) {
    event?.preventDefault?.();

    if (this.historyStore?.hasPastEntries || document.referrer) {
      window.history.back();
      return;
    }

    this.router.transitionTo("discovery.latest");
  }
}
