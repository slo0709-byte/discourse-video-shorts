import { ajax } from "discourse/lib/ajax";

export const VIDEO_SHORTS_PAGE_SIZE = 20;
export const VIDEO_SHORTS_INITIAL_PRELOAD_ITEMS = 3;
export const VIDEO_SHORTS_AUTO_CONTINUATION_LIMIT = 3;
export const VIDEO_SHORTS_AUTO_CONTINUATION_MS = 1500;
export const VIDEO_SHORTS_RESTORE_CONTINUATION_LIMIT = 5;
export const VIDEO_SHORTS_RESTORE_CONTINUATION_MS = 2500;
export const VIDEO_SHORTS_PROTOCOL_MAX_REQUESTS = 22;

export class VideoShortsFeedProtocolError extends Error {
  constructor(reason) {
    super(`video_shorts_protocol_error:${reason}`);
    this.name = "VideoShortsFeedProtocolError";
    this.reason = reason;
  }
}

export function mergeVideoShortsItems(existingItems, incomingItems) {
  const seenPostIds = new Set(existingItems.map((item) => item.post_id));
  const merged = [...existingItems];

  for (const item of incomingItems || []) {
    if (seenPostIds.has(item.post_id)) {
      continue;
    }

    seenPostIds.add(item.post_id);
    merged.push(item);
  }

  return merged;
}

export async function fetchVideoShortsPage({
  cursor = null,
  pageSize = VIDEO_SHORTS_PAGE_SIZE,
  signal,
} = {}) {
  const data = { page_size: pageSize };

  if (cursor) {
    data.cursor = cursor;
  }

  const request = ajax("/videos.json", { data });

  if (!signal) {
    return await request;
  }

  const abortRequest = () => request.abort?.();
  if (signal.aborted) {
    abortRequest();
  } else {
    signal.addEventListener("abort", abortRequest, { once: true });
  }

  try {
    return await request;
  } finally {
    signal.removeEventListener("abort", abortRequest);
  }
}

export async function loadInitialVideoShortsFeed({
  pageSize = VIDEO_SHORTS_PAGE_SIZE,
  preloadItems = VIDEO_SHORTS_INITIAL_PRELOAD_ITEMS,
  restorePostId = null,
} = {}) {
  let items = [];
  let nextCursor = null;
  let scanLimitReached = false;
  let requestCount = 0;
  const requestedPostId = restorePostId ? String(restorePostId) : null;
  const seenCursors = new Set();

  try {
    let response = await fetchVideoShortsPage({ pageSize });
    requestCount += 1;

    while (true) {
      items = mergeVideoShortsItems(items, response.items);
      nextCursor = response.next_cursor;
      scanLimitReached = Boolean(response.scan?.scan_limit_reached);

      const needsContinuation =
        items.length < preloadItems && scanLimitReached && nextCursor;
      const restoreTargetFound =
        requestedPostId &&
        items.some((item) => String(item.post_id) === requestedPostId);
      const needsRestoreContinuation =
        requestedPostId && !restoreTargetFound && nextCursor;
      if (!needsContinuation && !needsRestoreContinuation) {
        break;
      }

      if (requestCount >= VIDEO_SHORTS_PROTOCOL_MAX_REQUESTS) {
        throw new VideoShortsFeedProtocolError("request_bound_exceeded");
      }

      const cursor = String(nextCursor);
      if (seenCursors.has(cursor)) {
        throw new VideoShortsFeedProtocolError("cursor_did_not_advance");
      }
      seenCursors.add(cursor);

      response = await fetchVideoShortsPage({ cursor: nextCursor, pageSize });
      requestCount += 1;
    }

    return {
      items,
      nextCursor,
      scanLimitReached,
      error: null,
      failedCursor: null,
      requestedPostId,
      initialActivePostId: items.some(
        (item) => String(item.post_id) === requestedPostId,
      )
        ? requestedPostId
        : null,
    };
  } catch (error) {
    return {
      items,
      nextCursor,
      scanLimitReached,
      error,
      failedCursor: nextCursor,
      requestedPostId: null,
      initialActivePostId: null,
    };
  }
}
