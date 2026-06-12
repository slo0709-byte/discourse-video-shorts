import { ajax } from "discourse/lib/ajax";

export const VIDEO_SHORTS_COMMENTS_PAGE_SIZE = 20;
const FLAG_POST_ACTION_IDS = new Set([3, 4, 7, 8, 10]);

function replyToUsername(post) {
  return (
    post.reply_to_user?.username ||
    post.reply_to_username ||
    post.reply_to_user_username ||
    null
  );
}

export function canFlagPost(post) {
  if (post.can_flag) {
    return true;
  }

  const actionsSummary = Array.isArray(post.actions_summary)
    ? post.actions_summary
    : [];

  return actionsSummary.some((action) => {
    return FLAG_POST_ACTION_IDS.has(action.id) && action.can_act;
  });
}

export function normalizeComment(post) {
  return {
    id: post.id,
    post_id: post.id,
    post_number: post.post_number,
    user_id: post.user_id,
    username: post.username,
    name: post.name,
    avatar_template: post.avatar_template,
    cooked: post.cooked,
    created_at: post.created_at,
    updated_at: post.updated_at,
    version: post.version,
    post_type: post.post_type,
    post_url: post.post_url,
    reply_count: post.reply_count || 0,
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
    replies: Array.isArray(post.replies)
      ? post.replies.map((reply) => normalizeComment(reply))
      : [],
  };
}

export function normalizeDirectReplies(response) {
  const posts = Array.isArray(response) ? response : [];
  const comments = posts.map((post) => normalizeComment(post));
  const lastComment = comments[comments.length - 1];

  return {
    comments,
    hasMore: posts.length === VIDEO_SHORTS_COMMENTS_PAGE_SIZE,
    nextAfter: lastComment?.post_number || null,
  };
}

export async function fetchVideoShortsComments({ postId, after = null }) {
  const data = {};

  if (after) {
    data.after = after;
  }

  const response = await ajax(`/posts/${postId}/replies.json`, { data });

  return normalizeDirectReplies(response);
}
