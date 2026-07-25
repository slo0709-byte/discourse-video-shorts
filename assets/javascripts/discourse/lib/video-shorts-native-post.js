import Post from "discourse/models/post";

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer`);
  }

  return value;
}

function stringOrNull(value) {
  return typeof value === "string" ? value : null;
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

function commentId(comment) {
  const hasPostId = comment.post_id !== undefined;
  const hasId = comment.id !== undefined;
  const postId = hasPostId
    ? positiveInteger(comment.post_id, "comment id")
    : null;
  const id = hasId ? positiveInteger(comment.id, "comment id") : null;

  if (postId && id && postId !== id) {
    throw new TypeError("comment id fields must match");
  }

  return positiveInteger(postId || id, "comment id");
}

function topicIdFor(comment, item, topic) {
  const itemTopicId = positiveInteger(
    item?.topic_id,
    "feed item topic_id"
  );
  const topicId = positiveInteger(topic?.id, "Topic id");

  if (itemTopicId !== topicId) {
    throw new TypeError("feed item topic_id must match Topic id");
  }

  if (comment.topic_id !== undefined && comment.topic_id !== null) {
    const commentTopicId = positiveInteger(
      comment.topic_id,
      "comment topic_id"
    );

    if (commentTopicId !== itemTopicId) {
      throw new TypeError("comment topic_id must match feed item topic_id");
    }
  }

  return topicId;
}

export function videoShortsNativePost({
  comment,
  item,
  topic,
  store,
  records = null,
}) {
  if (!comment || typeof comment !== "object" || Array.isArray(comment)) {
    throw new TypeError("comment must be an object");
  }

  if (!store || typeof store.createRecord !== "function") {
    throw new TypeError("store is required");
  }

  const id = commentId(comment);
  const postNumber = positiveInteger(
    comment.post_number,
    "comment post_number"
  );
  const topicId = topicIdFor(comment, item, topic);

  const attributes = {
    id,
    post_number: postNumber,
    topic_id: topicId,
    topic,
    user_id: Number.isSafeInteger(comment.user_id) ? comment.user_id : null,
    username: stringOrNull(comment.username),
    name: stringOrNull(comment.name),
    avatar_template: stringOrNull(comment.avatar_template),
    cooked: typeof comment.cooked === "string" ? comment.cooked : "",
    raw: typeof comment.raw === "string" ? comment.raw : "",
    created_at: stringOrNull(comment.created_at),
    updated_at: stringOrNull(comment.updated_at),
    version:
      Number.isSafeInteger(comment.version) && comment.version > 0
        ? comment.version
        : 1,
    post_type: Number.isSafeInteger(comment.post_type)
      ? comment.post_type
      : null,
    post_url: stringOrNull(comment.post_url),
    posts_count: Number.isSafeInteger(comment.posts_count)
      ? comment.posts_count
      : null,
    quote_count: Number.isSafeInteger(comment.quote_count)
      ? comment.quote_count
      : 0,
    incoming_link_count: Number.isSafeInteger(comment.incoming_link_count)
      ? comment.incoming_link_count
      : 0,
    reads: Number.isSafeInteger(comment.reads) ? comment.reads : 0,
    readers_count: Number.isSafeInteger(comment.readers_count)
      ? comment.readers_count
      : 0,
    score: Number.isFinite(comment.score) ? comment.score : 0,
    reply_count:
      Number.isSafeInteger(comment.reply_count) && comment.reply_count >= 0
        ? comment.reply_count
        : 0,
    reply_to_post_number:
      Number.isSafeInteger(comment.reply_to_post_number) &&
      comment.reply_to_post_number > 0
        ? comment.reply_to_post_number
        : null,
    reply_to_user: cloneObject(comment.reply_to_user),
    link_counts: cloneObjectArray(comment.link_counts),
    actions_summary: cloneObjectArray(comment.actions_summary),
    can_edit: comment.can_edit === true,
    can_delete: comment.can_delete === true,
    can_recover: comment.can_recover === true,
    can_flag: comment.can_flag === true,
    can_permanently_delete: comment.can_permanently_delete === true,
    can_see_hidden_post: comment.can_see_hidden_post === true,
    can_view_edit_history: comment.can_view_edit_history === true,
    can_wiki: comment.can_wiki === true,
    hidden: comment.hidden === true,
    hidden_reason_id: Number.isSafeInteger(comment.hidden_reason_id)
      ? comment.hidden_reason_id
      : null,
    yours: comment.yours === true,
    bookmarked: comment.bookmarked === true,
    bookmark_id: Number.isSafeInteger(comment.bookmark_id)
      ? comment.bookmark_id
      : null,
    bookmark_name: stringOrNull(comment.bookmark_name),
    bookmark_reminder_at: stringOrNull(comment.bookmark_reminder_at),
    bookmark_auto_delete_preference:
      comment.bookmark_auto_delete_preference ?? null,
    cooked_hidden: comment.cooked_hidden === true,
    user_deleted: comment.user_deleted === true,
    moderator: comment.moderator === true,
    admin: comment.admin === true,
    staff: comment.staff === true,
    group_moderator: comment.group_moderator === true,
    read: comment.read === true,
    trust_level: Number.isSafeInteger(comment.trust_level)
      ? comment.trust_level
      : null,
    wiki: comment.wiki === true,
    locked: comment.locked === true,
    notice: cloneObject(comment.notice),
    notice_created_by_user: cloneObject(comment.notice_created_by_user),
    last_wiki_edit: stringOrNull(comment.last_wiki_edit),
    edit_reason: stringOrNull(comment.edit_reason),
    user_suspended: comment.user_suspended === true,
    user_status: cloneObject(comment.user_status),
    badges_granted: cloneObjectArray(comment.badges_granted),
    user_custom_fields: cloneObject(comment.user_custom_fields),
    mentioned_users: cloneObjectArray(comment.mentioned_users),
    primary_group_name: stringOrNull(comment.primary_group_name),
    user_title: stringOrNull(comment.user_title),
    title_is_group: comment.title_is_group === true,
    flair_name: stringOrNull(comment.flair_name),
    flair_url: stringOrNull(comment.flair_url),
    flair_bg_color: stringOrNull(comment.flair_bg_color),
    flair_color: stringOrNull(comment.flair_color),
    flair_group_id: Number.isSafeInteger(comment.flair_group_id)
      ? comment.flair_group_id
      : null,
    excerpt: stringOrNull(comment.excerpt),
    static_doc: comment.static_doc === true,
    via_email: comment.via_email === true,
    is_auto_generated: comment.is_auto_generated === true,
    action_code: stringOrNull(comment.action_code),
    action_code_who: stringOrNull(comment.action_code_who),
    action_code_path: stringOrNull(comment.action_code_path),
    reviewable_id: Number.isSafeInteger(comment.reviewable_id)
      ? comment.reviewable_id
      : null,
    reviewable_score_count: Number.isSafeInteger(
      comment.reviewable_score_count
    )
      ? comment.reviewable_score_count
      : 0,
    reviewable_score_pending_count: Number.isSafeInteger(
      comment.reviewable_score_pending_count
    )
      ? comment.reviewable_score_pending_count
      : 0,
    post_localizations: cloneObjectArray(comment.post_localizations),
    post_localizations_count: Number.isSafeInteger(
      comment.post_localizations_count
    )
      ? comment.post_localizations_count
      : 0,
    can_localize_post: comment.can_localize_post === true,
    locale: stringOrNull(comment.locale),
    is_localized: comment.is_localized === true,
    language: stringOrNull(comment.language),
    localization_outdated: comment.localization_outdated === true,
    deleted_at: stringOrNull(comment.deleted_at),
    deleted_by: cloneObject(comment.deleted_by),
    deleted_post_placeholder:
      comment.deleted_post_placeholder === true ||
      comment.video_shorts_deleted_placeholder === true,
  };
  const existing = records?.get(id);

  if (existing) {
    existing.setProperties(Post.munge({ ...attributes }));
    return existing;
  }

  const post = Post.create({
    ...attributes,
    store,
    __type: "post",
    __state: "created",
  });

  records?.set(id, post);
  return post;
}
