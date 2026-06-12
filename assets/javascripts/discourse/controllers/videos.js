import { tracked } from "@glimmer/tracking";
import Controller from "@ember/controller";
import { action } from "@ember/object";
import { service } from "@ember/service";
import {
  fetchVideoShortsPage,
  loadInitialVideoShortsFeed,
  mergeVideoShortsItems,
} from "discourse/plugins/discourse-video-shorts/discourse/lib/video-shorts-feed";

export default class VideosController extends Controller {
  @service currentUser;
  @service historyStore;
  @service router;

  @tracked items = [];
  @tracked nextCursor = null;
  @tracked scanLimitReached = false;
  @tracked autoContinuationCapped = false;
  @tracked loadingMore = false;
  @tracked error = null;
  @tracked failedCursor = null;
  @tracked initialActivePostId = null;

  replaceModel(model) {
    this.items = model.items || [];
    this.nextCursor = model.nextCursor || null;
    this.scanLimitReached = Boolean(model.scanLimitReached);
    this.autoContinuationCapped = Boolean(model.autoContinuationCapped);
    this.error = model.error || null;
    this.failedCursor = model.failedCursor || null;
    this.initialActivePostId = model.initialActivePostId || null;

    if (model.requestedPostId && !model.initialActivePostId) {
      this.replaceActivePostId(null);
    }
  }

  get hasItems() {
    return this.items.length > 0;
  }

  get isEmpty() {
    return !this.hasItems && !this.error;
  }

  get canLoadMore() {
    return Boolean(this.nextCursor && !this.loadingMore);
  }

  get emptyMessage() {
    if (this.currentUser?.staff) {
      return "No videos found. Check the Video Shorts source category and tag settings.";
    }

    return "No videos are available yet.";
  }

  async loadCursor(cursor) {
    if (!cursor || this.loadingMore) {
      return;
    }

    try {
      this.loadingMore = true;
      this.error = null;

      const response = await fetchVideoShortsPage({ cursor });
      this.items = mergeVideoShortsItems(this.items, response.items);
      this.nextCursor = response.next_cursor;
      this.scanLimitReached = Boolean(response.scan_limit_reached);
      this.autoContinuationCapped = false;
      this.failedCursor = null;
    } catch (error) {
      this.error = error;
      this.failedCursor = cursor;
    } finally {
      this.loadingMore = false;
    }
  }

  @action
  replaceActivePostId(postId) {
    if (!window.location.pathname.startsWith("/videos")) {
      return;
    }

    const url = new URL(window.location.href);
    const nextPostId = postId ? String(postId) : null;

    if (nextPostId) {
      url.searchParams.set("post_id", nextPostId);
    } else {
      url.searchParams.delete("post_id");
    }

    const nextUrl = `${url.pathname}${url.search}${url.hash}`;

    if (nextUrl === `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      return;
    }

    window.history.replaceState(window.history.state, "", nextUrl);
  }

  @action
  loadMore() {
    return this.loadCursor(this.nextCursor);
  }

  @action
  async retry() {
    if (this.failedCursor) {
      return await this.loadCursor(this.failedCursor);
    }

    const model = await loadInitialVideoShortsFeed();
    this.replaceModel(model);
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
