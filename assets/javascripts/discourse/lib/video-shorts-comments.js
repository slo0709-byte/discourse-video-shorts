import { ajax } from "discourse/lib/ajax";

export const VIDEO_SHORTS_COMMENTS_PAGE_SIZE = 20;
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

function cloneObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return { ...value };
}

function cloneObjectArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .map((item) => ({ ...item }));
}

export function canFlagPost(post) {
  if (post.can_flag) {
    return true;
  }

  return actionsSummary(post).some((action) => {
    return FLAG_POST_ACTION_IDS.has(action.id) && action.can_act;
  });
}

export function commentLikeCount(post) {
  if (Number.isFinite(post?.like_count)) {
    return post.like_count;
  }

  const likeAction = actionsSummary(post).find((action) => {
    return action.id === LIKE_POST_ACTION_ID;
  });

  return Number(likeAction?.count || 0);
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
    posts_count: Number.isSafeInteger(post.posts_count)
      ? post.posts_count
      : null,
    quote_count: Number.isSafeInteger(post.quote_count)
      ? post.quote_count
      : 0,
    incoming_link_count: Number.isSafeInteger(post.incoming_link_count)
      ? post.incoming_link_count
      : 0,
    reads: Number.isSafeInteger(post.reads) ? post.reads : 0,
    readers_count: Number.isSafeInteger(post.readers_count)
      ? post.readers_count
      : 0,
    score: Number.isFinite(post.score) ? post.score : 0,
    reply_count: post.reply_count || 0,
    like_count: commentLikeCount(post),
    raw: post.raw || "",
    can_edit: Boolean(post.can_edit),
    can_delete: Boolean(post.can_delete),
    can_recover: Boolean(post.can_recover),
    can_flag: canFlagPost(post),
    can_permanently_delete: Boolean(post.can_permanently_delete),
    can_see_hidden_post: Boolean(post.can_see_hidden_post),
    can_view_edit_history: Boolean(post.can_view_edit_history),
    can_wiki: Boolean(post.can_wiki),
    yours: Boolean(post.yours),
    actions_summary: cloneObjectArray(post.actions_summary),
    link_counts: cloneObjectArray(post.link_counts),
    reply_to_post_number: post.reply_to_post_number || null,
    reply_to_user: cloneObject(post.reply_to_user),
    reply_to_username: replyToUsername(post),
    bookmarked: Boolean(post.bookmarked),
    bookmark_id: post.bookmark_id ?? null,
    bookmark_name:
      typeof post.bookmark_name === "string" ? post.bookmark_name : null,
    bookmark_reminder_at:
      typeof post.bookmark_reminder_at === "string"
        ? post.bookmark_reminder_at
        : null,
    bookmark_auto_delete_preference:
      post.bookmark_auto_delete_preference ?? null,
    cooked_hidden: Boolean(post.cooked_hidden),
    deleted_at:
      typeof post.deleted_at === "string" ? post.deleted_at : null,
    deleted_by: cloneObject(post.deleted_by),
    edit_reason:
      typeof post.edit_reason === "string" ? post.edit_reason : null,
    hidden: Boolean(post.hidden),
    hidden_reason_id: post.hidden_reason_id ?? null,
    user_deleted: Boolean(post.user_deleted),
    moderator: Boolean(post.moderator),
    admin: Boolean(post.admin),
    staff: Boolean(post.staff),
    group_moderator: Boolean(post.group_moderator),
    read: Boolean(post.read),
    trust_level: Number.isSafeInteger(post.trust_level)
      ? post.trust_level
      : null,
    wiki: Boolean(post.wiki),
    locked: Boolean(post.locked),
    notice: cloneObject(post.notice),
    notice_created_by_user: cloneObject(post.notice_created_by_user),
    last_wiki_edit:
      typeof post.last_wiki_edit === "string" ? post.last_wiki_edit : null,
    user_suspended: Boolean(post.user_suspended),
    user_status: cloneObject(post.user_status),
    badges_granted: cloneObjectArray(post.badges_granted),
    user_custom_fields: cloneObject(post.user_custom_fields),
    mentioned_users: cloneObjectArray(post.mentioned_users),
    primary_group_name:
      typeof post.primary_group_name === "string"
        ? post.primary_group_name
        : null,
    user_title: typeof post.user_title === "string" ? post.user_title : null,
    title_is_group: Boolean(post.title_is_group),
    flair_name: typeof post.flair_name === "string" ? post.flair_name : null,
    flair_url: typeof post.flair_url === "string" ? post.flair_url : null,
    flair_bg_color:
      typeof post.flair_bg_color === "string" ? post.flair_bg_color : null,
    flair_color:
      typeof post.flair_color === "string" ? post.flair_color : null,
    flair_group_id: Number.isSafeInteger(post.flair_group_id)
      ? post.flair_group_id
      : null,
    excerpt: typeof post.excerpt === "string" ? post.excerpt : null,
    static_doc: Boolean(post.static_doc),
    via_email: Boolean(post.via_email),
    is_auto_generated: Boolean(post.is_auto_generated),
    action_code:
      typeof post.action_code === "string" ? post.action_code : null,
    action_code_who:
      typeof post.action_code_who === "string" ? post.action_code_who : null,
    action_code_path:
      typeof post.action_code_path === "string" ? post.action_code_path : null,
    reviewable_id: Number.isSafeInteger(post.reviewable_id)
      ? post.reviewable_id
      : null,
    reviewable_score_count: Number.isSafeInteger(post.reviewable_score_count)
      ? post.reviewable_score_count
      : 0,
    reviewable_score_pending_count: Number.isSafeInteger(
      post.reviewable_score_pending_count
    )
      ? post.reviewable_score_pending_count
      : 0,
    post_localizations: cloneObjectArray(post.post_localizations),
    post_localizations_count: Number.isSafeInteger(
      post.post_localizations_count
    )
      ? post.post_localizations_count
      : 0,
    can_localize_post: Boolean(post.can_localize_post),
    locale: typeof post.locale === "string" ? post.locale : null,
    is_localized: Boolean(post.is_localized),
    language: typeof post.language === "string" ? post.language : null,
    localization_outdated: Boolean(post.localization_outdated),
    deleted_post_placeholder: Boolean(post.deleted_post_placeholder),
    replies: Array.isArray(post.replies)
      ? post.replies.map((reply) => normalizeComment(reply))
      : [],
  };
}

export function normalizeDirectReplies(response) {
  if (response && typeof response === "object" && !Array.isArray(response)) {
    return normalizeReplyBranch(response);
  }

  if (!Array.isArray(response)) {
    throw new TypeError("Discourse replies response must be an array");
  }

  const posts = response;
  const comments = posts.map((post) => normalizeComment(post));
  const lastComment = comments[comments.length - 1];

  return {
    comments,
    hasMore: posts.length === VIDEO_SHORTS_COMMENTS_PAGE_SIZE,
    nextAfter: lastComment?.post_number || null,
  };
}

export function normalizeReplyBranch(response) {
  if (
    !response ||
    typeof response !== "object" ||
    Array.isArray(response) ||
    !Array.isArray(response.posts) ||
    typeof response.has_more !== "boolean"
  ) {
    throw new TypeError("Video shorts reply branch payload is malformed");
  }

  const nextAfter = response.next_after;

  if (
    nextAfter !== null &&
    nextAfter !== undefined &&
    (!Number.isSafeInteger(nextAfter) || nextAfter <= 0)
  ) {
    throw new TypeError("Video shorts reply branch cursor is malformed");
  }

  if (response.has_more && !nextAfter) {
    throw new TypeError("Video shorts paginated reply branch needs a cursor");
  }

  return {
    comments: response.posts.map((post) => normalizeComment(post)),
    hasMore: response.has_more,
    nextAfter: nextAfter || null,
  };
}

export async function fetchVideoShortsComments({
  postId,
  after = null,
  endpoint = null,
}) {
  const data = {};
  const requestUrl = endpoint || `/posts/${postId}/replies.json`;

  if (endpoint) {
    data.post_id = postId;
  }

  if (after) {
    data.after = after;
  }

  const response = await ajax(requestUrl, { data });

  return normalizeDirectReplies(response);
}

export async function fetchVideoShortsReplyBranch({
  postId,
  after = null,
}) {
  const data = { post_id: postId };

  if (after) {
    data.after = after;
  }

  const response = await ajax("/video-shorts/comments/replies.json", {
    data,
  });

  return normalizeReplyBranch(response);
}
