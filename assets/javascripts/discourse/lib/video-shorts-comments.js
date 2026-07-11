import { ajax } from "discourse/lib/ajax";

export const VIDEO_SHORTS_COMMENTS_PAGE_SIZE = 50;
export const VIDEO_SHORTS_COMMENTS_DELTA_SIZE = 100;
const FLAG_POST_ACTION_IDS = new Set([3, 4, 7, 8, 10]);
const LIKE_POST_ACTION_ID = 2;

function actionsSummary(post) {
  return Array.isArray(post?.actions_summary) ? post.actions_summary : [];
}

function replyToUsername(post) {
  return (
    post.reply_to_user?.username ||
    post.reply_to_username ||
    post.reply_to_user_username ||
    null
  );
}

export function canFlagPost(post) {
  return (
    Boolean(post?.can_flag) ||
    actionsSummary(post).some(
      (action) => FLAG_POST_ACTION_IDS.has(action.id) && action.can_act,
    )
  );
}

export function commentLikeCount(post) {
  if (Number.isFinite(post?.like_count)) {
    return post.like_count;
  }

  return Number(
    actionsSummary(post).find((action) => action.id === LIKE_POST_ACTION_ID)
      ?.count || 0,
  );
}

export function normalizeComment(post) {
  return {
    ...post,
    id: post.id || post.post_id,
    post_id: post.post_id || post.id,
    reply_count: post.reply_count || 0,
    like_count: commentLikeCount(post),
    raw: post.raw || "",
    can_edit: Boolean(post.can_edit),
    can_delete: Boolean(post.can_delete),
    can_recover: Boolean(post.can_recover),
    can_flag: canFlagPost(post),
    yours: Boolean(post.yours),
    actions_summary: post.actions_summary || [],
    link_counts: post.link_counts || [],
    reply_to_post_number: post.reply_to_post_number || null,
    reply_to_user: post.reply_to_user || null,
    reply_to_username: replyToUsername(post),
    replies: [],
  };
}

function snapshotUrl(postId) {
  return `/videos/posts/${postId}/comments.json`;
}

function deltaUrl(postId) {
  return `/videos/posts/${postId}/comments/delta.json`;
}

export async function fetchVideoShortsComments({
  postId,
  cursor = null,
  limit = VIDEO_SHORTS_COMMENTS_PAGE_SIZE,
}) {
  let data = { limit };
  if (cursor) {
    data.cursor = cursor;
  }

  let response = await ajax(snapshotUrl(postId), { data });
  return {
    comments: (response.comments || []).map(normalizeComment),
    hasMore: Boolean(response.has_more),
    nextCursor: response.next_cursor || null,
    visibleReplyCount: Number(response.visible_reply_count),
    changeCursor: response.change_cursor || null,
    authorizationLease: response.authorization_lease || null,
    sourcePostId: response.source_post_id || postId,
  };
}

export async function fetchVideoShortsCommentDelta({
  postId,
  since,
  limit = VIDEO_SHORTS_COMMENTS_DELTA_SIZE,
}) {
  let response = await ajax(deltaUrl(postId), { data: { since, limit } });
  return {
    changes: (response.changes || []).map((change) =>
      change.deleted || change.tombstone
        ? { ...change, post_id: change.post_id || change.id }
        : normalizeComment(change),
    ),
    hasMore: Boolean(response.has_more),
    nextChangeCursor: response.next_change_cursor || null,
    visibleReplyCount: Number(response.visible_reply_count),
  };
}

export function isDeltaExpired(error) {
  return error?.jqXHR?.status === 409 || error?.status === 409;
}
