import { ajax } from "discourse/lib/ajax";

export const VIDEO_SHORTS_PAGE_SIZE = 20;
export const VIDEO_SHORTS_INITIAL_PRELOAD_ITEMS = 3;
export const VIDEO_SHORTS_AUTO_CONTINUATION_LIMIT = 3;
export const VIDEO_SHORTS_AUTO_CONTINUATION_MS = 1500;
export const VIDEO_SHORTS_RESTORE_CONTINUATION_LIMIT = 5;
export const VIDEO_SHORTS_RESTORE_CONTINUATION_MS = 2500;

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
} = {}) {
  const data = { page_size: pageSize };

  if (cursor) {
    data.cursor = cursor;
  }

  return await ajax("/videos.json", { data });
}

export async function loadInitialVideoShortsFeed({
  pageSize = VIDEO_SHORTS_PAGE_SIZE,
  preloadItems = VIDEO_SHORTS_INITIAL_PRELOAD_ITEMS,
  restorePostId = null,
} = {}) {
  let items = [];
  let nextCursor = null;
  let scanLimitReached = false;
  let continuationRequests = 0;
  const requestedPostId = restorePostId ? String(restorePostId) : null;
  const startedAt = Date.now();

  try {
    let response = await fetchVideoShortsPage({ pageSize });

    while (true) {
      items = mergeVideoShortsItems(items, response.items);
      nextCursor = response.next_cursor;
      scanLimitReached = Boolean(response.scan_limit_reached);

      const needsContinuation =
        items.length < preloadItems && scanLimitReached && nextCursor;
      const restoreTargetFound =
        requestedPostId &&
        items.some((item) => String(item.post_id) === requestedPostId);
      const needsRestoreContinuation =
        requestedPostId && !restoreTargetFound && nextCursor;
      const underRequestCap =
        continuationRequests <
        Math.max(
          VIDEO_SHORTS_AUTO_CONTINUATION_LIMIT,
          VIDEO_SHORTS_RESTORE_CONTINUATION_LIMIT
        );
      const underTimeCap =
        Date.now() - startedAt <
        Math.max(
          VIDEO_SHORTS_AUTO_CONTINUATION_MS,
          VIDEO_SHORTS_RESTORE_CONTINUATION_MS
        );
      const preloadCanContinue =
        needsContinuation &&
        continuationRequests < VIDEO_SHORTS_AUTO_CONTINUATION_LIMIT;
      const restoreCanContinue =
        needsRestoreContinuation &&
        continuationRequests < VIDEO_SHORTS_RESTORE_CONTINUATION_LIMIT;

      if (
        (!preloadCanContinue && !restoreCanContinue) ||
        !underRequestCap ||
        !underTimeCap
      ) {
        break;
      }

      continuationRequests += 1;
      response = await fetchVideoShortsPage({ cursor: nextCursor, pageSize });
    }

    return {
      items,
      nextCursor,
      scanLimitReached,
      autoContinuationCapped: Boolean(
        items.length < preloadItems && scanLimitReached && nextCursor
      ),
      error: null,
      failedCursor: null,
      requestedPostId,
      initialActivePostId: items.some(
        (item) => String(item.post_id) === requestedPostId
      )
        ? requestedPostId
        : null,
    };
  } catch (error) {
    return {
      items,
      nextCursor,
      scanLimitReached,
      autoContinuationCapped: false,
      error,
      failedCursor: nextCursor,
      requestedPostId,
      initialActivePostId: null,
    };
  }
}
