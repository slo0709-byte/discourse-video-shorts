function positiveId(value) {
  const normalized = typeof value === "string" ? Number(value) : value;

  return Number.isSafeInteger(normalized) && normalized > 0 ? normalized : null;
}

function localMutationKey(mutation) {
  if (mutation?.type !== "delete") {
    return null;
  }

  const postId = positiveId(mutation.post?.id || mutation.postId);

  return postId === null ? null : `delete:${postId}`;
}

function authoritativeMutationKey(event) {
  const postId = positiveId(event?.postId);

  if (
    postId === null ||
    (event.type !== "deleted" && event.type !== "destroyed")
  ) {
    return null;
  }

  return `delete:${postId}`;
}

function restoredMutationKey(event) {
  const postId = positiveId(event?.postId);

  if (
    postId === null ||
    (event.type !== "created" && event.type !== "recovered")
  ) {
    return null;
  }

  return `delete:${postId}`;
}

function mutationCount(currentCount, mutation) {
  if (Number.isFinite(mutation?.replyCountValue)) {
    return Math.max(mutation.replyCountValue, 0);
  }

  const countDelta = Number.isFinite(mutation?.countDelta)
    ? mutation.countDelta
    : 0;

  return Math.max(currentCount + countDelta, 0);
}

export function createVideoShortsCommentCountFetcher(request) {
  return async (postId) => {
    const normalizedPostId = positiveId(postId);

    if (normalizedPostId === null) {
      throw new TypeError("A positive source post id is required");
    }

    const response = await request(
      `/video-shorts/comments/count.json?post_id=${normalizedPostId}`
    );

    if (
      !response ||
      typeof response !== "object" ||
      Array.isArray(response) ||
      !Number.isSafeInteger(response.count) ||
      response.count < 0
    ) {
      throw new TypeError("Invalid authoritative comment count response");
    }

    return response.count;
  };
}

export function createVideoShortsCommentCountSync({
  subscribe,
  unsubscribe,
  fetchCount,
  createLedger,
  gateEvent,
  onCount,
}) {
  let active = null;
  let generation = 0;
  let requestToken = 0;
  const authorityBySourcePost = new Map();

  function authorityState(sourcePostId) {
    let state = authorityBySourcePost.get(sourcePostId);

    if (!state) {
      state = {
        version: 0,
        count: null,
        authoritativeMutations: new Map(),
        localMutations: new Map(),
      };
      authorityBySourcePost.set(sourcePostId, state);
    }

    return state;
  }

  function recordAuthoritativeCount(sourcePostId, count, event) {
    const state = authorityState(sourcePostId);
    const version = state.version + 1;
    const restoredKey = restoredMutationKey(event);
    const mutationKey = authoritativeMutationKey(event);

    state.version = version;
    state.count = count;

    if (restoredKey) {
      state.authoritativeMutations.delete(restoredKey);
      state.localMutations.delete(restoredKey);
    }

    if (!mutationKey) {
      return;
    }

    state.authoritativeMutations.set(mutationKey, { count, version });

    const localReceipt = state.localMutations.get(mutationKey);

    if (localReceipt) {
      state.localMutations.set(mutationKey, {
        ...localReceipt,
        authoritative: true,
        count,
        version,
      });
    }
  }

  function reconcileMutation({ sourcePostId, currentCount, mutation }) {
    const normalizedSourcePostId = positiveId(sourcePostId);
    const normalizedCurrentCount = Number.isFinite(currentCount)
      ? Math.max(currentCount, 0)
      : 0;
    const count = mutationCount(normalizedCurrentCount, mutation);

    if (normalizedSourcePostId === null) {
      return { applied: true, count, reason: "local-mutation" };
    }

    const mutationKey = localMutationKey(mutation);

    if (!mutationKey) {
      return { applied: true, count, reason: "local-mutation" };
    }

    const state = authorityState(normalizedSourcePostId);
    const localReceipt = state.localMutations.get(mutationKey);

    if (localReceipt) {
      return {
        applied: false,
        count: localReceipt.count,
        reason: "duplicate-local-mutation",
      };
    }

    const authoritativeReceipt =
      state.authoritativeMutations.get(mutationKey);

    if (authoritativeReceipt) {
      state.localMutations.set(mutationKey, {
        authoritative: true,
        count: authoritativeReceipt.count,
        version: authoritativeReceipt.version,
      });

      return {
        applied: false,
        count: authoritativeReceipt.count,
        reason: "already-authoritative",
      };
    }

    state.localMutations.set(mutationKey, {
      authoritative: false,
      count,
      version: state.version,
    });

    return { applied: true, count, reason: "local-mutation" };
  }

  function deactivate() {
    generation += 1;
    requestToken += 1;

    if (active) {
      unsubscribe(active.channel, active.callback);
      active = null;
    }
  }

  function activate({ topicId, postId, lastMessageId }) {
    const normalizedTopicId = positiveId(topicId);
    const normalizedPostId = positiveId(postId);

    deactivate();

    if (normalizedTopicId === null || normalizedPostId === null) {
      return;
    }

    const channel = `/topic/${normalizedTopicId}`;
    const activeGeneration = generation;
    let ledger = createLedger();
    const refreshActiveCount = async (event = null) => {
      const activeRequestToken = ++requestToken;

      try {
        const count = await fetchCount(normalizedPostId);

        if (
          active?.callback === callback &&
          generation === activeGeneration &&
          requestToken === activeRequestToken
        ) {
          recordAuthoritativeCount(normalizedPostId, count, event);
          onCount(normalizedPostId, count);
        }
      } catch {}
    };
    const callback = async (data, globalId, messageId) => {
      const result = gateEvent(ledger, data, globalId, messageId);
      ledger = result.ledger;

      if (!result.accepted || result.event.type === "revised") {
        return;
      }

      await refreshActiveCount(result.event);
    };

    active = { channel, callback, refresh: refreshActiveCount };
    subscribe(channel, callback, lastMessageId);
  }

  function refresh() {
    return active?.refresh();
  }

  return Object.freeze({
    activate,
    deactivate,
    reconcileMutation,
    refresh,
  });
}
