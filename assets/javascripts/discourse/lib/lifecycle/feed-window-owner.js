const MAX_WINDOW_ITEMS = 60;

export default class VideoShortsFeedWindowOwner {
  constructor({
    parent,
    fetchPage,
    onChange,
    maxItems = MAX_WINDOW_ITEMS,
  } = {}) {
    this.parent = parent;
    this.fetchPage = fetchPage;
    this.onChange = onChange;
    this.maxItems = maxItems;
    this.generation = 0;
    this.controller = null;
    this.destroyed = false;
    this.loading = false;
    this.items = [];
    this.seenPostIds = new Set();
    this.postIds = new Set();
    this.nextCursor = null;
    this.seenCursors = new Set();
    this.endReached = false;
    this.protocolError = null;
    this.error = null;
    this.failedCursor = null;
  }

  get isCurrent() {
    return !this.destroyed && this.parent?.isCurrent !== false;
  }

  seed({
    items = [],
    nextCursor = null,
    endReached = false,
    protocolError = null,
    error = null,
    failedCursor = null,
  } = {}) {
    if (!this.isCurrent) {
      return;
    }

    this.items = [];
    this.seenPostIds.clear();
    this.postIds.clear();
    this.seenCursors.clear();
    this.addItems(items);
    this.nextCursor = nextCursor;
    this.endReached = Boolean(endReached || !nextCursor);
    this.protocolError = protocolError;
    this.error = error;
    this.failedCursor = failedCursor;
    this.publish();
  }

  addItems(items) {
    for (const item of items || []) {
      const postId = String(item?.post_id || "");
      if (!postId || this.seenPostIds.has(postId)) {
        continue;
      }
      this.postIds.add(postId);
      this.seenPostIds.add(postId);
      this.items.push(item);
    }

    while (this.items.length > this.maxItems) {
      const evicted = this.items.shift();
      this.postIds.delete(String(evicted.post_id));
    }
  }

  async loadNext() {
    if (
      !this.isCurrent ||
      this.loading ||
      this.endReached ||
      !this.nextCursor
    ) {
      return;
    }

    const cursor = this.nextCursor;
    if (this.seenCursors.has(cursor)) {
      this.failProtocol("repeated_cursor");
      return;
    }

    const generation = this.generation;
    this.seenCursors.add(cursor);
    const parentGeneration = this.parent?.generation;
    this.loading = true;
    this.error = null;
    this.failedCursor = null;
    this.controller = new AbortController();
    this.publish();

    try {
      const response = await this.fetchPage({
        cursor,
        signal: this.controller.signal,
      });
      if (!this.isGenerationCurrent(generation, parentGeneration)) {
        return;
      }

      const nextCursor = response.next_cursor || null;
      if (nextCursor && nextCursor === cursor) {
        this.failProtocol("cursor_did_not_advance");
        return;
      }

      this.addItems(response.items);
      this.nextCursor = nextCursor;
      this.endReached = Boolean(response.scan?.end_reached || !nextCursor);
    } catch (error) {
      if (
        this.isGenerationCurrent(generation, parentGeneration) &&
        error?.name !== "AbortError"
      ) {
        this.error = error;
        this.failedCursor = cursor;
      }
    } finally {
      if (this.isGenerationCurrent(generation, parentGeneration)) {
        this.loading = false;
        this.controller = null;
        this.publish();
      }
    }
  }

  async retry(cursor = this.failedCursor) {
    if (
      !this.isCurrent ||
      this.loading ||
      !cursor ||
      String(cursor) !== String(this.failedCursor)
    ) {
      return;
    }

    this.seenCursors.delete(cursor);
    this.nextCursor = cursor;
    this.endReached = false;
    this.error = null;
    this.failedCursor = null;
    return await this.loadNext();
  }

  isGenerationCurrent(generation, parentGeneration) {
    return (
      this.isCurrent &&
      generation === this.generation &&
      parentGeneration === this.parent?.generation
    );
  }

  failProtocol(reason) {
    this.protocolError = reason;
    this.endReached = true;
    this.nextCursor = null;
    this.publish();
  }

  publish() {
    if (!this.isCurrent) {
      return;
    }
    this.onChange?.({
      items: [...this.items],
      nextCursor: this.nextCursor,
      endReached: this.endReached,
      loading: this.loading,
      protocolError: this.protocolError,
      error: this.error,
      failedCursor: this.failedCursor,
    });
  }

  destroy() {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.generation += 1;
    this.controller?.abort();
    this.controller = null;
    this.items = [];
    this.postIds.clear();
    this.seenPostIds.clear();
    this.seenCursors.clear();
  }
}

export { MAX_WINDOW_ITEMS };
