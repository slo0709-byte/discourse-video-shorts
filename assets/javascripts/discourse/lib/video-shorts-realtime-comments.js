const EVENT_TYPES = new Set([
  "created",
  "revised",
  "deleted",
  "destroyed",
  "recovered",
]);
const TOMBSTONE_TYPES = new Set(["deleted", "destroyed"]);
const RESURRECTION_TYPES = new Set(["created", "recovered"]);

function positivePostId(value) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }

  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    return null;
  }

  const normalized = Number(value);

  return Number.isSafeInteger(normalized) ? normalized : null;
}

function result(ledger, { accepted = false, reason, event = null } = {}) {
  return Object.freeze({ accepted, reason, event, ledger });
}

export function createVideoShortsRealtimeCommentsLedger() {
  return Object.freeze({ posts: Object.freeze({}) });
}

export function gateVideoShortsRealtimeComment(
  ledger,
  data,
  globalId,
  messageId
) {
  const postId = positivePostId(data?.id);

  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    !EVENT_TYPES.has(data.type) ||
    postId === null
  ) {
    return result(ledger, { reason: "malformed-event" });
  }

  if (!Number.isSafeInteger(messageId) || messageId <= 0) {
    return result(ledger, { reason: "malformed-message-id" });
  }

  const previous = ledger.posts[postId];

  if (previous && messageId <= previous.lastMessageId) {
    return result(ledger, {
      reason: messageId === previous.lastMessageId ? "duplicate" : "older",
    });
  }

  const wasTombstoned = previous?.tombstone === true;
  const tombstone = TOMBSTONE_TYPES.has(data.type)
    ? true
    : RESURRECTION_TYPES.has(data.type)
      ? false
      : wasTombstoned;
  const postState = Object.freeze({ lastMessageId: messageId, tombstone });
  const nextLedger = Object.freeze({
    posts: Object.freeze({ ...ledger.posts, [postId]: postState }),
  });

  if (wasTombstoned && data.type === "revised") {
    return result(nextLedger, { reason: "tombstoned" });
  }

  const event = Object.freeze({
    type: data.type,
    postId,
    data,
    globalId,
    messageId,
    tombstone,
  });

  return result(nextLedger, { accepted: true, reason: null, event });
}
