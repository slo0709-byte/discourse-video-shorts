import Component from "@glimmer/component";
import { tracked } from "@glimmer/tracking";
import { isDestroyed, isDestroying } from "@ember/destroyable";
import { fn } from "@ember/helper";
import { on } from "@ember/modifier";
import { action } from "@ember/object";
import { getOwner } from "@ember/owner";
import { service } from "@ember/service";
import { trustHTML } from "@ember/template";
import { modifier } from "ember-modifier";
import FlagModal from "discourse/components/modal/flag";
import { popupAjaxError } from "discourse/lib/ajax-error";
import PostFlag from "discourse/lib/flag-targets/post-flag";
import { getAbsoluteURL } from "discourse/lib/get-url";
import { userPath } from "discourse/lib/url";
import { clipboardCopy } from "discourse/lib/utilities";
import { eq } from "discourse/truth-helpers";
import dFormatDate from "discourse/ui-kit/helpers/d-format-date";
import dIcon from "discourse/ui-kit/helpers/d-icon";
import { i18n } from "discourse-i18n";
import {
  deleteVideoShortsComment,
  fetchVideoShortsComment,
  updateVideoShortsComment,
} from "discourse/plugins/discourse-video-shorts/discourse/lib/video-shorts-comment-actions";
import {
  fetchVideoShortsComments,
  fetchVideoShortsTopicReplies,
} from "discourse/plugins/discourse-video-shorts/discourse/lib/video-shorts-comments";
import {
  createVideoShortsReply,
  videoShortsReplyErrorMessage,
} from "discourse/plugins/discourse-video-shorts/discourse/lib/video-shorts-reply";
import { videoShortsAccentStyle } from "discourse/plugins/discourse-video-shorts/discourse/lib/video-shorts-visual-accent";

function postKey(post) {
  return String(post?.post_id || post?.id || "");
}

function normalizeUsername(post) {
  return post?.username || post?.name || "";
}

function isDeletedPlaceholder(post) {
  return Boolean(
    post?.video_shorts_deleted_placeholder ||
      post?.cooked?.includes(i18n("video_shorts.comments.deleted_placeholder"))
  );
}

export default class VideoShortsCommentsSurface extends Component {
  @service currentUser;
  @service dialog;
  @service modal;
  @service store;

  @tracked comments = [];
  @tracked loading = true;
  @tracked loadingMore = false;
  @tracked error = null;
  @tracked hasMore = false;
  @tracked nextAfter = null;

  @tracked replyText = "";
  @tracked replyError = null;
  @tracked replyNotice = null;
  @tracked replySubmitting = false;

  @tracked commentReplyPostId = null;
  @tracked commentReplyText = "";
  @tracked commentReplyError = null;
  @tracked commentReplyNotice = null;
  @tracked commentReplySubmitting = false;
  @tracked commentReplyMentionRequired = false;

  @tracked editingPostId = null;
  @tracked editingText = "";
  @tracked editingError = null;
  @tracked editingSubmitting = false;

  @tracked deletingPostId = null;
  @tracked openToolsPostId = null;
  @tracked highlightedPostId = null;
  @tracked childRepliesByPostId = {};
  @tracked localReplyCount = null;
  @tracked hasDeletedPlaceholderContext = false;

  activePostId = null;
  loadToken = 0;

  loadForItem = modifier((element, [item]) => {
    if (!item || item.post_id === this.activePostId) {
      return;
    }

    this.activePostId = item.post_id;
    this.comments = [];
    this.childRepliesByPostId = {};
    this.localReplyCount = null;
    this.hasDeletedPlaceholderContext = false;
    this.hasMore = false;
    this.nextAfter = null;
    this.resetReplyState();
    this.resetCommentReplyState();
    this.resetEditingState();
    this.loadComments({ item });
  });

  focusInput = modifier((element) => {
    queueMicrotask(() => {
      if (!isDestroying(this) && !isDestroyed(this)) {
        element.focus();
      }
    });
  });

  closeToolsOnOutsideInteraction = modifier((element) => {
    const closeOnOutsidePointer = (event) => {
      if (!this.openToolsPostId) {
        return;
      }

      if (
        element.contains(event.target) &&
        event.target.closest(".video-shorts-comments-surface__tools")
      ) {
        return;
      }

      this.closeTools();
    };

    const closeOnEscape = (event) => {
      if (event.key === "Escape") {
        this.closeTools();
      }
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    document.addEventListener("keydown", closeOnEscape, true);

    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  });

  childRepliesFor = (comment) => {
    return (
      this.childRepliesByPostId[postKey(comment)] ||
      comment.replies ||
      []
    );
  };

  hasChildReplies = (comment) => {
    return this.childRepliesFor(comment).length > 0;
  };

  deepRepliesFor = (comment) => {
    return this.flattenChildReplies(comment);
  };

  userPathFor = (post) => {
    return userPath(normalizeUsername(post));
  };

  avatarUrl = (post, size = 48) => {
    return (post?.avatar_template || "").replace("{size}", size);
  };

  displayName = (post) => {
    return normalizeUsername(post);
  };

  cookedHtml = (post) => {
    return trustHTML(post?.cooked || "");
  };

  canEditComment = (post) => {
    return Boolean(post?.can_edit);
  };

  canDeleteComment = (post) => {
    return Boolean(post?.can_delete);
  };

  canFlagComment = (post) => {
    return Boolean(post?.can_flag);
  };

  flattenChildReplies(comment) {
    return this.childRepliesFor(comment).flatMap((reply) => {
      return [
        reply,
        ...this.flattenChildReplies(reply),
      ];
    });
  }

  commentTreeCount(comments = this.comments) {
    return comments.reduce((count, comment) => {
      return count + 1 + this.commentTreeCount(this.childRepliesFor(comment));
    }, 0);
  }

  syncLoadedReplyCount() {
    const loadedCount = this.commentTreeCount();
    const existingCount = Number(this.args.replyCount);
    const replyCountValue = Number.isFinite(existingCount)
      ? Math.max(existingCount, loadedCount)
      : loadedCount;

    this.localReplyCount = replyCountValue;
    this.emitCommentMutation({
      type: "sync-count",
      countDelta: 0,
      replyCountValue,
    });
  }

  get item() {
    return this.args.item;
  }

  get commentsAccentStyle() {
    return videoShortsAccentStyle(this.item);
  }

  get topicRecord() {
    return this.store.createRecord("topic", {
      id: this.item.topic_id,
      title: this.item.title,
      fancy_title: this.item.title,
      draft_key: `topic_${this.item.topic_id}`,
      draft_sequence: 0,
      details: {
        can_create_post: this.canCreatePost,
      },
    });
  }

  commentPostRecord(comment) {
    return this.store.createRecord("post", {
      id: comment.post_id,
      post_number: comment.post_number,
      username: normalizeUsername(comment),
      user_id: comment.user_id,
      topic_id: this.item.topic_id,
      topic_slug: this.item.topic_url?.split("/")[2],
      topic: this.topicRecord,
      raw: comment.raw,
      cooked: comment.cooked,
      created_at: comment.created_at,
      reply_count: comment.reply_count || 0,
      reply_to_post_number: comment.reply_to_post_number,
      post_url: comment.post_url,
      actions_summary: comment.actions_summary || [],
      can_delete: Boolean(comment.can_delete),
      can_edit: Boolean(comment.can_edit),
      can_flag: this.canFlagComment(comment),
      hidden: Boolean(comment.hidden),
      yours: Boolean(comment.yours),
    });
  }

  get canCreatePost() {
    return Boolean(this.currentUser && this.item?.actions?.can_reply);
  }

  get trimmedReply() {
    return this.replyText.trim();
  }

  get trimmedCommentReply() {
    return this.commentReplyText.trim();
  }

  get trimmedEdit() {
    return this.editingText.trim();
  }

  get replyCountLabel() {
    const count = this.comments.length;

    return i18n("video_shorts.comments.count", { count });
  }

  get selectedReplyTarget() {
    return this.findCommentByPostId(this.commentReplyPostId);
  }

  get selectedReplyUsername() {
    return normalizeUsername(this.selectedReplyTarget);
  }

  get selectedReplyTargetUsesMentionLabel() {
    return Boolean(this.selectedReplyTarget && this.commentReplyMentionRequired);
  }

  get selectedReplyUsernameLabel() {
    const username = this.selectedReplyUsername;

    if (!username) {
      return "";
    }

    if (!this.selectedReplyTargetUsesMentionLabel || username.startsWith("@")) {
      return username;
    }

    return `@${username}`;
  }

  get commentReplyStatus() {
    if (!this.selectedReplyUsernameLabel) {
      return null;
    }

    return i18n("video_shorts.comments.replying_to", {
      username: this.selectedReplyUsernameLabel,
    });
  }

  get currentUserAvatarUrl() {
    return (this.currentUser?.avatar_template || "").replace("{size}", 40);
  }

  async loadComments({ append = false, item = this.item } = {}) {
    const token = ++this.loadToken;

    try {
      this.error = null;
      this.loading = !append;
      this.loadingMore = append;

      const response = await fetchVideoShortsComments({
        postId: item.post_id,
        after: append ? this.nextAfter : null,
      });

      if (this.isStale(token)) {
        return;
      }

      const comments = await this.withLoadedChildren(response.comments, token);

      if (this.isStale(token)) {
        return;
      }

      const existingIds = append
        ? new Set(this.comments.map((comment) => comment.id))
        : null;
      const deduped = append
        ? comments.filter((comment) => !existingIds.has(comment.id))
        : comments;

      if (!append) {
        this.childRepliesByPostId = {};
      }

      this.comments = append ? [...this.comments, ...deduped] : deduped;
      this.hasDeletedPlaceholderContext =
        this.hasDeletedPlaceholderContext || this.comments.some(isDeletedPlaceholder);
      this.hasMore = response.hasMore;
      this.nextAfter = response.nextAfter;
      this.syncLoadedReplyCount();
    } catch (error) {
      if (!this.isStale(token)) {
        this.error = error;
      }
    } finally {
      if (!this.isStale(token)) {
        this.loading = false;
        this.loadingMore = false;
      }
    }
  }

  async withLoadedChildren(comments, token) {
    const loaded = await Promise.all(
      comments.map(async (comment) => {
        if (comment.replies?.length) {
          const replies = await this.withLoadedChildren(comment.replies, token);

          return this.isStale(token) ? comment : { ...comment, replies };
        }

        if (!comment.reply_count) {
          return { ...comment, replies: [] };
        }

        const response = await fetchVideoShortsComments({
          postId: comment.post_id,
        });

        if (this.isStale(token)) {
          return comment;
        }

        const replies = await this.withLoadedChildren(response.comments, token);

        return this.isStale(token) ? comment : { ...comment, replies };
      })
    );

    return loaded;
  }

  isStale(token) {
    return isDestroying(this) || isDestroyed(this) || token !== this.loadToken;
  }

  async refreshCommentsAfterMutation({ highlightedPostId = null } = {}) {
    const deletedPlaceholders = this.deletedPlaceholdersForRefresh();

    await this.loadComments({ item: this.item });
    this.restoreDeletedPlaceholders(deletedPlaceholders);

    this.highlightedPostId = highlightedPostId || this.highlightedPostId;
  }

  deletedPlaceholdersForRefresh() {
    return this.comments.filter(isDeletedPlaceholder).map((comment) => {
      return {
        ...comment,
        replies: this.childRepliesFor(comment),
      };
    });
  }

  restoreDeletedPlaceholders(placeholders) {
    if (!placeholders.length) {
      return;
    }

    const childKeys = new Set(
      placeholders.flatMap((placeholder) => {
        return this.childRepliesFor(placeholder).map((child) => postKey(child));
      })
    );
    const existingKeys = new Set(this.comments.map((comment) => postKey(comment)));
    const nextChildRepliesByPostId = { ...this.childRepliesByPostId };
    const comments = this.comments.filter((comment) => {
      return !childKeys.has(postKey(comment));
    });

    for (const placeholder of placeholders) {
      const key = postKey(placeholder);

      if (!key || existingKeys.has(key)) {
        continue;
      }

      comments.push(placeholder);
      nextChildRepliesByPostId[key] = placeholder.replies || [];
    }

    this.comments = comments;
    this.childRepliesByPostId = nextChildRepliesByPostId;
    this.hasDeletedPlaceholderContext = true;
    this.syncLoadedReplyCount();
  }

  hasRenderablePostData(post) {
    return Boolean(
      post?.post_id &&
        post?.post_number &&
        normalizeUsername(post) &&
        typeof post?.cooked === "string"
    );
  }

  loadedFlatChildrenFor(comment) {
    const parentPostNumber = Number(comment?.post_number || 0);

    if (!parentPostNumber) {
      return [];
    }

    return this.comments.filter((candidate) => {
      return (
        postKey(candidate) !== postKey(comment) &&
        Number(candidate?.reply_to_post_number || 0) === parentPostNumber
      );
    });
  }

  uniqueReplies(replies) {
    const seen = new Set();

    return replies.filter((reply) => {
      const key = postKey(reply);

      if (!key || seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
  }

  async childrenSnapshotForDelete(comment) {
    const currentChildren = this.uniqueReplies([
      ...this.childRepliesFor(comment),
      ...this.loadedFlatChildrenFor(comment),
    ]);

    if (currentChildren.length) {
      return currentChildren;
    }

    try {
      const response = await fetchVideoShortsComments({
        postId: comment.post_id,
      });
      const topicReplies = await fetchVideoShortsTopicReplies({
        topicUrl: this.item.topic_url,
        replyToPostNumber: comment.post_number,
      });

      return this.uniqueReplies([
        ...currentChildren,
        ...response.comments,
        ...topicReplies,
        ...this.loadedFlatChildrenFor(comment),
      ]);
    } catch {
      return currentChildren;
    }
  }

  emitCommentMutation(mutation) {
    const mutationWithSource = {
      ...mutation,
      sourcePostId: mutation.sourcePostId || this.item?.post_id,
    };

    if (this.args.onCommentMutation) {
      this.args.onCommentMutation(mutationWithSource);
      return;
    }

    if (mutation.type === "create") {
      this.args.onReplyPublished?.(mutationWithSource.post);
      return;
    }

    if (mutation.type === "delete") {
      this.args.onCommentDeleted?.(mutationWithSource.post);
    }
  }

  replyCountValueAfterDelta(countDelta) {
    const baseCount = Number.isFinite(this.localReplyCount)
      ? this.localReplyCount
      : Number(this.args.replyCount);

    if (!Number.isFinite(baseCount) || countDelta === 0) {
      return null;
    }

    this.localReplyCount = Math.max(baseCount + countDelta, 0);

    return this.localReplyCount;
  }

  replaceComment(updatedComment) {
    const updatedKey = postKey(updatedComment);
    const nextChildRepliesByPostId = { ...this.childRepliesByPostId };
    let replaced = false;

    const replaceInTree = (comments) => {
      return comments.map((comment) => {
        let nextComment = comment;
        const currentChildren = this.childRepliesFor(comment);

        if (postKey(comment) === updatedKey) {
          nextComment = { ...comment, ...updatedComment };
          replaced = true;
        }

        if (!currentChildren.length) {
          return nextComment;
        }

        const children = replaceInTree(currentChildren);
        const nextKey = postKey(nextComment);

        if (nextKey) {
          nextChildRepliesByPostId[nextKey] = children;
        }

        return { ...nextComment, replies: children };
      });
    };

    this.comments = replaceInTree(this.comments);

    if (replaced) {
      this.childRepliesByPostId = nextChildRepliesByPostId;
    }

    return replaced;
  }

  removeComment(post, options = {}) {
    const targetKey = postKey(post);
    const nextChildRepliesByPostId = { ...this.childRepliesByPostId };
    const childrenSnapshot = options.childrenSnapshot || null;
    const targetChildKeys = new Set(
      (childrenSnapshot || []).map((child) => postKey(child))
    );
    let countDelta = 0;
    let parentPostId = null;
    let keptPlaceholder = false;

    const removeFromTree = (comments, parentKey = null) => {
      let removed = false;
      const nextComments = [];

      for (const comment of comments) {
        const key = postKey(comment);

        if (key !== targetKey && targetChildKeys.has(key)) {
          removed = true;
          continue;
        }

        if (postKey(comment) === targetKey) {
          const children = childrenSnapshot || this.childRepliesFor(comment);

          countDelta = -1;
          parentPostId = parentKey;
          removed = true;

          if (!children.length) {
            delete nextChildRepliesByPostId[targetKey];
            continue;
          }

          nextChildRepliesByPostId[targetKey] = children;
          keptPlaceholder = true;

          nextComments.push({
            ...comment,
            cooked: `<p>${i18n("video_shorts.comments.deleted_placeholder")}</p>`,
            raw: "",
            video_shorts_deleted_placeholder: true,
            can_edit: false,
            can_delete: false,
            can_flag: false,
            reply_count: children.length,
            replies: children,
          });
          continue;
        }

        const currentChildren = this.childRepliesFor(comment);

        if (!currentChildren.length) {
          nextComments.push(comment);
          continue;
        }

        const childResult = removeFromTree(currentChildren, key);

        if (childResult.removed) {
          removed = true;

          if (childResult.comments.length) {
            nextChildRepliesByPostId[key] = childResult.comments;
          } else {
            delete nextChildRepliesByPostId[key];
          }

          nextComments.push({
            ...comment,
            reply_count: childResult.comments.length,
            replies: childResult.comments,
          });
          continue;
        }

        nextComments.push(comment);
      }

      return { comments: nextComments, removed };
    };

    const result = removeFromTree(this.comments);

    this.comments = result.comments;

    this.childRepliesByPostId = nextChildRepliesByPostId;

    if (keptPlaceholder) {
      this.hasDeletedPlaceholderContext = true;
    }

    if (countDelta === 0) {
      countDelta = -1;
    }

    return {
      type: "delete",
      post,
      countDelta,
      replyCountValue: this.replyCountValueAfterDelta(countDelta),
      parentPostId,
      keptPlaceholder,
    };
  }

  findCommentInTree(comments, postId) {
    const targetKey = String(postId || "");

    for (const comment of comments) {
      if (postKey(comment) === targetKey) {
        return comment;
      }

      const child = this.findCommentInTree(this.childRepliesFor(comment), postId);

      if (child) {
        return child;
      }
    }

    return null;
  }

  findCommentByPostId(postId) {
    return this.findCommentInTree(this.comments, postId);
  }

  appendChildReply(parentComment, childReply) {
    const parentKey = postKey(parentComment);
    const nextChildRepliesByPostId = { ...this.childRepliesByPostId };
    let appended = false;

    const appendToTarget = (comment) => {
      if (postKey(comment) === parentKey) {
        const currentChildren = this.childRepliesFor(comment);

        if (
          currentChildren.some((reply) => postKey(reply) === postKey(childReply))
        ) {
          return comment;
        }

        const children = [...currentChildren, childReply];
        nextChildRepliesByPostId[parentKey] = children;
        appended = true;

        return {
          ...comment,
          reply_count: (comment.reply_count || 0) + 1,
          replies: children,
        };
      }

      const currentChildren = this.childRepliesFor(comment);

      if (!currentChildren.length) {
        return comment;
      }

      return {
        ...comment,
        replies: currentChildren.map((child) => appendToTarget(child)),
      };
    };

    this.comments = this.comments.map((comment) => appendToTarget(comment));

    if (appended) {
      this.childRepliesByPostId = nextChildRepliesByPostId;
    }
  }

  prependComment(comment) {
    if (this.comments.some((existing) => postKey(existing) === postKey(comment))) {
      return;
    }

    this.comments = [comment, ...this.comments];
  }

  emitCreatedComment(post) {
    const replyCountValue = this.replyCountValueAfterDelta(1);

    this.emitCommentMutation({
      type: "create",
      post,
      countDelta: 1,
      replyCountValue,
    });
  }

  resetReplyState() {
    this.replyText = "";
    this.replyError = null;
    this.replyNotice = null;
    this.replySubmitting = false;
  }

  resetCommentReplyState() {
    this.commentReplyPostId = null;
    this.commentReplyText = "";
    this.commentReplyError = null;
    this.commentReplyNotice = null;
    this.commentReplySubmitting = false;
    this.commentReplyMentionRequired = false;
  }

  resetEditingState() {
    this.editingPostId = null;
    this.editingText = "";
    this.editingError = null;
    this.editingSubmitting = false;
  }

  @action
  showLogin() {
    return getOwner(this).lookup("route:application").send("showLogin");
  }

  @action
  loadMore() {
    if (this.hasMore && !this.loadingMore) {
      return this.loadComments({ append: true });
    }
  }

  @action
  openReply() {
    if (!this.currentUser) {
      return this.showLogin();
    }

    if (!this.canCreatePost) {
      return;
    }

    this.resetCommentReplyState();
    this.openToolsPostId = null;
  }

  @action
  openCommentReply(comment, mentionRequired = false) {
    if (!this.currentUser) {
      return this.showLogin();
    }

    if (!this.canCreatePost) {
      return;
    }

    const target = this.findCommentByPostId(postKey(comment));

    if (!target) {
      this.commentReplyError = i18n("video_shorts.comments.reply_target_missing");
      return;
    }

    this.commentReplyPostId = postKey(comment);
    this.commentReplyText = "";
    this.commentReplyError = null;
    this.commentReplyNotice = null;
    this.commentReplyMentionRequired = Boolean(mentionRequired);
    this.openToolsPostId = null;
    this.resetEditingState();
  }

  @action
  updateReplyText(event) {
    this.replyText = event.target.value;
  }

  @action
  updateCommentReplyText(event) {
    this.commentReplyText = event.target.value;
  }

  @action
  cancelCommentReply() {
    this.resetCommentReplyState();
  }

  @action
  publishActiveReply(event) {
    if (this.commentReplyPostId) {
      return this.publishCommentReply(this.selectedReplyTarget, event);
    }

    return this.publishReply(event);
  }

  @action
  async publishReply(event) {
    event?.preventDefault();

    if (!this.currentUser) {
      return this.showLogin();
    }

    if (!this.canCreatePost) {
      return;
    }

    if (!this.trimmedReply) {
      this.replyError = i18n("video_shorts.comments.reply_empty");
      return;
    }

    this.replySubmitting = true;
    this.replyError = null;
    this.replyNotice = null;

    try {
      const result = await createVideoShortsReply({
        item: this.item,
        raw: this.trimmedReply,
        replyToPostNumber: this.item.post_number,
      });

      if (result.action === "enqueued") {
        this.replyNotice = i18n("video_shorts.comments.reply_pending");
        this.replyText = "";
        return;
      }

      if (this.hasRenderablePostData(result.post)) {
        this.prependComment(result.post);
        this.highlightedPostId = postKey(result.post);
        this.emitCreatedComment(result.post);
      } else {
        await this.refreshCommentsAfterMutation();
      }

      this.resetReplyState();
    } catch (error) {
      this.replyError = videoShortsReplyErrorMessage(error);
    } finally {
      this.replySubmitting = false;
    }
  }

  @action
  async publishCommentReply(comment, event) {
    event?.preventDefault();

    if (!this.currentUser) {
      return this.showLogin();
    }

    if (!this.canCreatePost) {
      return;
    }

    const target = this.findCommentByPostId(postKey(comment));

    if (!target) {
      this.commentReplyError = i18n("video_shorts.comments.reply_target_missing");
      return;
    }

    if (!this.trimmedCommentReply) {
      this.commentReplyError = i18n("video_shorts.comments.reply_empty");
      return;
    }

    this.commentReplySubmitting = true;
    this.commentReplyError = null;
    this.commentReplyNotice = null;

    try {
      const result = await createVideoShortsReply({
        item: this.item,
        raw: this.trimmedCommentReply,
        replyToPostNumber: target.post_number,
      });

      if (result.action === "enqueued") {
        this.commentReplyNotice = i18n("video_shorts.comments.reply_pending");
        this.commentReplyText = "";
        return;
      }

      if (this.hasRenderablePostData(result.post)) {
        this.appendChildReply(target, result.post);
        this.highlightedPostId = postKey(result.post);
        this.emitCreatedComment(result.post);
      } else {
        await this.refreshCommentsAfterMutation();
      }

      this.resetCommentReplyState();
    } catch (error) {
      this.commentReplyError = videoShortsReplyErrorMessage(error);
    } finally {
      this.commentReplySubmitting = false;
    }
  }

  @action
  async openEdit(comment) {
    if (!this.currentUser) {
      return this.showLogin();
    }

    this.openToolsPostId = null;
    this.editingPostId = postKey(comment);
    this.editingError = null;

    try {
      const loadedComment = await fetchVideoShortsComment(comment.post_id);
      this.editingText = loadedComment.raw || "";
    } catch (error) {
      this.editingText = comment.raw || "";
      this.editingError = videoShortsReplyErrorMessage(error);
    }
  }

  @action
  updateEditingText(event) {
    this.editingText = event.target.value;
  }

  @action
  cancelEdit() {
    this.resetEditingState();
  }

  @action
  async saveEdit(comment, event) {
    event?.preventDefault();

    if (!this.trimmedEdit) {
      this.editingError = i18n("video_shorts.comments.reply_empty");
      return;
    }

    this.editingSubmitting = true;
    this.editingError = null;

    try {
      const updatedComment = await updateVideoShortsComment({
        postId: comment.post_id,
        raw: this.trimmedEdit,
      });

      if (
        !this.hasRenderablePostData(updatedComment) ||
        !this.replaceComment(updatedComment)
      ) {
        await this.refreshCommentsAfterMutation({
          highlightedPostId: postKey(updatedComment),
        });
      }

      this.resetEditingState();
    } catch (error) {
      this.editingError = videoShortsReplyErrorMessage(error);
    } finally {
      this.editingSubmitting = false;
    }
  }

  @action
  toggleTools(comment, event) {
    event?.stopPropagation();
    const key = postKey(comment);

    this.openToolsPostId = this.openToolsPostId === key ? null : key;
  }

  @action
  closeTools() {
    this.openToolsPostId = null;
  }

  @action
  stopPropagation(event) {
    event.stopPropagation();
  }

  @action
  async copyCommentLink(comment) {
    this.openToolsPostId = null;

    if (comment.post_url) {
      await clipboardCopy(getAbsoluteURL(comment.post_url)).catch(popupAjaxError);
    }
  }

  @action
  openCommentTopic(comment) {
    this.openToolsPostId = null;

    if (comment.post_url) {
      window.open(comment.post_url, "_blank", "noopener,noreferrer");
    }
  }

  @action
  flagComment(comment) {
    if (!this.currentUser) {
      return this.showLogin();
    }

    if (!this.canFlagComment(comment)) {
      return;
    }

    this.openToolsPostId = null;
    const post = this.commentPostRecord(comment);

    this.modal.show(FlagModal, {
      model: {
        flagTarget: new PostFlag(),
        flagModel: post,
        setHidden: () => post.set("hidden", true),
      },
    });
  }

  @action
  deleteComment(comment) {
    if (!this.canDeleteComment(comment)) {
      return;
    }

    this.openToolsPostId = null;
    this.dialog.yesNoConfirm({
      message: i18n("video_shorts.comments.delete_confirm"),
      didConfirm: async () => {
        this.deletingPostId = postKey(comment);
        const sourcePostNumber = Number(this.item?.post_number || 0);
        const replyToPostNumber = Number(comment?.reply_to_post_number || 0);
        const isNestedReply =
          Boolean(sourcePostNumber) &&
          Boolean(replyToPostNumber) &&
          replyToPostNumber !== sourcePostNumber;
        const hasDeletedPlaceholders =
          this.hasDeletedPlaceholderContext ||
          this.deletedPlaceholdersForRefresh().length > 0;

        try {
          const childrenSnapshot = await this.childrenSnapshotForDelete(comment);
          if (childrenSnapshot.length) {
            this.hasDeletedPlaceholderContext = true;
          }
          await deleteVideoShortsComment(comment.post_id);
          const mutation = this.removeComment(comment, { childrenSnapshot });
          this.emitCommentMutation(mutation);
          if (
            !mutation.keptPlaceholder &&
            !hasDeletedPlaceholders &&
            !isNestedReply
          ) {
            await this.refreshCommentsAfterMutation();
          }
        } catch (error) {
          popupAjaxError(error);
        } finally {
          this.deletingPostId = null;
        }
      },
    });
  }

  <template>
    <div
      class="video-shorts-comments-surface"
      style={{this.commentsAccentStyle}}
      data-comments-post-id={{@item.post_id}}
      data-video-shorts-youtube-comments
      {{this.loadForItem @item}}
      {{this.closeToolsOnOutsideInteraction}}
    >
      {{#if this.loading}}
        <div class="video-shorts-comments-surface__state">
          {{i18n "video_shorts.comments.loading"}}
        </div>
      {{else if this.error}}
        <div class="video-shorts-comments-surface__state" role="alert">
          {{i18n "video_shorts.comments.load_error"}}
        </div>
      {{else}}
        <ol
          class="video-shorts-comments-surface__list"
          data-video-shorts-youtube-thread-list
        >
          {{#each this.comments as |comment|}}
            <li
              class="video-shorts-comments-surface__comment"
              data-post-id={{comment.post_id}}
              data-post-number={{comment.post_number}}
              data-highlighted={{if
                (eq this.highlightedPostId (postKey comment))
                "true"
                "false"
              }}
            >
              <article class="video-shorts-comments-surface__comment-card">
                <a
                  class="video-shorts-comments-surface__avatar-link"
                  href={{this.userPathFor comment}}
                  data-user-card={{this.displayName comment}}
                >
                  <img
                    class="video-shorts-comments-surface__avatar"
                    src={{this.avatarUrl comment 48}}
                    alt=""
                    loading="lazy"
                  />
                </a>

                <div class="video-shorts-comments-surface__comment-main">
                  <div class="video-shorts-comments-surface__comment-header">
                    <a
                      class="video-shorts-comments-surface__username"
                      href={{this.userPathFor comment}}
                      data-user-card={{this.displayName comment}}
                    >
                      @{{this.displayName comment}}
                    </a>

                    {{#if comment.created_at}}
                      <time
                        class="video-shorts-comments-surface__time"
                        datetime={{comment.created_at}}
                      >
                        {{dFormatDate comment.created_at leaveAgo="true"}}
                      </time>
                    {{/if}}
                  </div>

                  {{#if (eq this.editingPostId (postKey comment))}}
                    <form
                      class="video-shorts-comments-surface__edit-input"
                      {{on "submit" (fn this.saveEdit comment)}}
                    >
                      <textarea
                        data-video-shorts-edit-input
                        value={{this.editingText}}
                        disabled={{this.editingSubmitting}}
                        {{this.focusInput}}
                        {{on "input" this.updateEditingText}}
                      ></textarea>

                      {{#if this.editingError}}
                        <p class="video-shorts-comments-surface__reply-error" role="alert">
                          {{this.editingError}}
                        </p>
                      {{/if}}

                      <div class="video-shorts-comments-surface__form-actions">
                        <button
                          type="button"
                          class="btn-flat"
                          data-action="cancel-edit"
                          {{on "click" this.cancelEdit}}
                        >
                          {{i18n "video_shorts.comments.cancel"}}
                        </button>
                        <button
                          type="submit"
                          class="btn btn-primary"
                          data-action="save-edit"
                          disabled={{this.editingSubmitting}}
                        >
                          {{if
                            this.editingSubmitting
                            (i18n "video_shorts.comments.saving")
                            (i18n "video_shorts.comments.save")
                          }}
                        </button>
                      </div>
                    </form>
                  {{else}}
                    <div class="video-shorts-comments-surface__cooked">
                      {{trustHTML comment.cooked}}
                    </div>
                  {{/if}}

                  <div class="video-shorts-comments-surface__comment-actions">
                    <button
                      type="button"
                      class="video-shorts-comments-surface__text-action"
                      data-action="reply-to-comment"
                      data-post-id={{comment.post_id}}
                      {{on "click" (fn this.openCommentReply comment false)}}
                    >
                      {{i18n "video_shorts.comments.reply"}}
                    </button>

                    <div class="video-shorts-comments-surface__tools">
                      <button
                        type="button"
                        class="video-shorts-comments-surface__tools-trigger"
                        title={{i18n "video_shorts.comments.tools"}}
                        aria-label={{i18n "video_shorts.comments.tools"}}
                        aria-expanded={{if
                          (eq this.openToolsPostId (postKey comment))
                          "true"
                          "false"
                        }}
                        data-action="comment-tools-toggle"
                        data-post-id={{comment.post_id}}
                        {{on "click" (fn this.toggleTools comment)}}
                      >
                        {{dIcon "ellipsis-vertical"}}
                      </button>

                      {{#if (eq this.openToolsPostId (postKey comment))}}
                        <div
                          class="video-shorts-comments-surface__tools-menu"
                          data-video-shorts-comment-tools-menu={{comment.post_id}}
                          role="menu"
                          {{on "click" this.stopPropagation}}
                        >
                          {{#if (this.canEditComment comment)}}
                            <button
                              type="button"
                              role="menuitem"
                              data-action="edit-comment"
                              {{on "click" (fn this.openEdit comment)}}
                            >
                              {{dIcon "pencil"}}
                              <span>{{i18n "video_shorts.comments.edit"}}</span>
                            </button>
                          {{/if}}

                          {{#if comment.post_url}}
                            <button
                              type="button"
                              role="menuitem"
                              data-action="copy-comment-link"
                              {{on "click" (fn this.copyCommentLink comment)}}
                            >
                              {{dIcon "link"}}
                              <span>{{i18n "video_shorts.comments.copy_link"}}</span>
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              data-action="open-comment-topic"
                              {{on "click" (fn this.openCommentTopic comment)}}
                            >
                              {{dIcon "up-right-from-square"}}
                              <span>{{i18n "video_shorts.comments.open_in_topic"}}</span>
                            </button>
                          {{/if}}

                          {{#if (this.canFlagComment comment)}}
                            <button
                              type="button"
                              role="menuitem"
                              data-action="flag-comment"
                              {{on "click" (fn this.flagComment comment)}}
                            >
                              {{dIcon "flag"}}
                              <span>{{i18n "video_shorts.comments.report"}}</span>
                            </button>
                          {{/if}}

                          {{#if (this.canDeleteComment comment)}}
                            <button
                              type="button"
                              role="menuitem"
                              class="danger"
                              data-action="delete-comment"
                              disabled={{eq this.deletingPostId (postKey comment)}}
                              {{on "click" (fn this.deleteComment comment)}}
                            >
                              {{dIcon "trash-can"}}
                              <span>{{i18n "video_shorts.comments.delete"}}</span>
                            </button>
                          {{/if}}
                        </div>
                      {{/if}}
                    </div>
                  </div>

                  {{#if (eq this.commentReplyPostId (postKey comment))}}
                    <div class="video-shorts-comments-surface__comment-reply-marker">
                      <span data-video-shorts-reply-target>
                        {{this.commentReplyStatus}}
                      </span>
                    </div>
                  {{/if}}

                  {{#if (this.hasChildReplies comment)}}
                    <ol class="video-shorts-comments-surface__child-list">
                      {{#each (this.childRepliesFor comment) as |childReply|}}
                        <li
                          class="video-shorts-comments-surface__child-comment"
                          data-post-id={{childReply.post_id}}
                          data-post-number={{childReply.post_number}}
                          data-highlighted={{if
                            (eq this.highlightedPostId (postKey childReply))
                            "true"
                            "false"
                          }}
                        >
                          <a
                            class="video-shorts-comments-surface__avatar-link video-shorts-comments-surface__avatar-link--small"
                            href={{this.userPathFor childReply}}
                            data-user-card={{this.displayName childReply}}
                          >
                            <img
                              class="video-shorts-comments-surface__avatar video-shorts-comments-surface__avatar--small"
                              src={{this.avatarUrl childReply 32}}
                              alt=""
                              loading="lazy"
                            />
                          </a>

                          <div class="video-shorts-comments-surface__comment-main">
                            <div class="video-shorts-comments-surface__comment-header">
                              <a
                                class="video-shorts-comments-surface__username"
                                href={{this.userPathFor childReply}}
                                data-user-card={{this.displayName childReply}}
                              >
                                @{{this.displayName childReply}}
                              </a>
                              {{#if childReply.created_at}}
                                <time
                                  class="video-shorts-comments-surface__time"
                                  datetime={{childReply.created_at}}
                                >
                                  {{dFormatDate childReply.created_at leaveAgo="true"}}
                                </time>
                              {{/if}}
                            </div>

                            {{#if (eq this.editingPostId (postKey childReply))}}
                              <form
                                class="video-shorts-comments-surface__edit-input"
                                {{on "submit" (fn this.saveEdit childReply)}}
                              >
                                <textarea
                                  data-video-shorts-edit-input
                                  value={{this.editingText}}
                                  disabled={{this.editingSubmitting}}
                                  {{this.focusInput}}
                                  {{on "input" this.updateEditingText}}
                                ></textarea>

                                {{#if this.editingError}}
                                  <p
                                    class="video-shorts-comments-surface__reply-error"
                                    role="alert"
                                  >
                                    {{this.editingError}}
                                  </p>
                                {{/if}}

                                <div class="video-shorts-comments-surface__form-actions">
                                  <button
                                    type="button"
                                    class="btn-flat"
                                    data-action="cancel-edit"
                                    {{on "click" this.cancelEdit}}
                                  >
                                    {{i18n "video_shorts.comments.cancel"}}
                                  </button>
                                  <button
                                    type="submit"
                                    class="btn btn-primary"
                                    data-action="save-edit"
                                    disabled={{this.editingSubmitting}}
                                  >
                                    {{if
                                      this.editingSubmitting
                                      (i18n "video_shorts.comments.saving")
                                      (i18n "video_shorts.comments.save")
                                    }}
                                  </button>
                                </div>
                              </form>
                            {{else}}
                              <div class="video-shorts-comments-surface__cooked">
                                {{trustHTML childReply.cooked}}
                              </div>
                            {{/if}}

                            <div class="video-shorts-comments-surface__comment-actions">
                              <button
                                type="button"
                                class="video-shorts-comments-surface__text-action"
                                data-action="reply-to-comment"
                                data-post-id={{childReply.post_id}}
                                {{on "click" (fn this.openCommentReply childReply true)}}
                              >
                                {{i18n "video_shorts.comments.reply"}}
                              </button>

                              <div class="video-shorts-comments-surface__tools">
                                <button
                                  type="button"
                                  class="video-shorts-comments-surface__tools-trigger"
                                  title={{i18n "video_shorts.comments.tools"}}
                                  aria-label={{i18n "video_shorts.comments.tools"}}
                                  aria-expanded={{if
                                    (eq this.openToolsPostId (postKey childReply))
                                    "true"
                                    "false"
                                  }}
                                  data-action="comment-tools-toggle"
                                  data-post-id={{childReply.post_id}}
                                  {{on "click" (fn this.toggleTools childReply)}}
                                >
                                  {{dIcon "ellipsis-vertical"}}
                                </button>

                                {{#if (eq this.openToolsPostId (postKey childReply))}}
                                  <div
                                    class="video-shorts-comments-surface__tools-menu"
                                    data-video-shorts-comment-tools-menu={{childReply.post_id}}
                                    role="menu"
                                    {{on "click" this.stopPropagation}}
                                  >
                                    {{#if (this.canEditComment childReply)}}
                                      <button
                                        type="button"
                                        role="menuitem"
                                        data-action="edit-comment"
                                        {{on "click" (fn this.openEdit childReply)}}
                                      >
                                        {{dIcon "pencil"}}
                                        <span>{{i18n "video_shorts.comments.edit"}}</span>
                                      </button>
                                    {{/if}}

                                    {{#if childReply.post_url}}
                                      <button
                                        type="button"
                                        role="menuitem"
                                        data-action="copy-comment-link"
                                        {{on "click" (fn this.copyCommentLink childReply)}}
                                      >
                                        {{dIcon "link"}}
                                        <span>{{i18n "video_shorts.comments.copy_link"}}</span>
                                      </button>
                                      <button
                                        type="button"
                                        role="menuitem"
                                        data-action="open-comment-topic"
                                        {{on "click" (fn this.openCommentTopic childReply)}}
                                      >
                                        {{dIcon "up-right-from-square"}}
                                        <span>{{i18n "video_shorts.comments.open_in_topic"}}</span>
                                      </button>
                                    {{/if}}

                                    {{#if (this.canFlagComment childReply)}}
                                      <button
                                        type="button"
                                        role="menuitem"
                                        data-action="flag-comment"
                                        {{on "click" (fn this.flagComment childReply)}}
                                      >
                                        {{dIcon "flag"}}
                                        <span>{{i18n "video_shorts.comments.report"}}</span>
                                      </button>
                                    {{/if}}

                                    {{#if (this.canDeleteComment childReply)}}
                                      <button
                                        type="button"
                                        role="menuitem"
                                        class="danger"
                                        data-action="delete-comment"
                                        disabled={{eq
                                          this.deletingPostId
                                          (postKey childReply)
                                        }}
                                        {{on "click" (fn this.deleteComment childReply)}}
                                      >
                                        {{dIcon "trash-can"}}
                                        <span>{{i18n "video_shorts.comments.delete"}}</span>
                                      </button>
                                    {{/if}}
                                  </div>
                                {{/if}}
                              </div>
                            </div>

                            {{#if (eq this.commentReplyPostId (postKey childReply))}}
                              <div
                                class="video-shorts-comments-surface__comment-reply-marker"
                              >
                                <span data-video-shorts-reply-target>
                                  {{this.commentReplyStatus}}
                                </span>
                              </div>
                            {{/if}}

                            {{#if (this.hasChildReplies childReply)}}
                              <ol class="video-shorts-comments-surface__child-list">
                                {{#each
                                  (this.childRepliesFor childReply)
                                  as |grandchildReply|
                                }}
                                  <li
                                    class="video-shorts-comments-surface__child-comment video-shorts-comments-surface__child-comment--nested"
                                    data-post-id={{grandchildReply.post_id}}
                                    data-post-number={{grandchildReply.post_number}}
                                    data-highlighted={{if
                                      (eq this.highlightedPostId (postKey grandchildReply))
                                      "true"
                                      "false"
                                    }}
                                  >
                                    <a
                                      class="video-shorts-comments-surface__avatar-link video-shorts-comments-surface__avatar-link--small"
                                      href={{this.userPathFor grandchildReply}}
                                      data-user-card={{this.displayName grandchildReply}}
                                    >
                                      <img
                                        class="video-shorts-comments-surface__avatar video-shorts-comments-surface__avatar--small"
                                        src={{this.avatarUrl grandchildReply 32}}
                                        alt=""
                                        loading="lazy"
                                      />
                                    </a>

                                    <div class="video-shorts-comments-surface__comment-main">
                                      <div
                                        class="video-shorts-comments-surface__comment-header"
                                      >
                                        <a
                                          class="video-shorts-comments-surface__username"
                                          href={{this.userPathFor grandchildReply}}
                                          data-user-card={{this.displayName grandchildReply}}
                                        >
                                          @{{this.displayName grandchildReply}}
                                        </a>
                                        {{#if grandchildReply.created_at}}
                                          <time
                                            class="video-shorts-comments-surface__time"
                                            datetime={{grandchildReply.created_at}}
                                          >
                                            {{dFormatDate
                                              grandchildReply.created_at
                                              leaveAgo="true"
                                            }}
                                          </time>
                                        {{/if}}
                                      </div>

                                      {{#if
                                        (eq
                                          this.editingPostId
                                          (postKey grandchildReply)
                                        )
                                      }}
                                        <form
                                          class="video-shorts-comments-surface__edit-input"
                                          {{on
                                            "submit"
                                            (fn this.saveEdit grandchildReply)
                                          }}
                                        >
                                          <textarea
                                            data-video-shorts-edit-input
                                            value={{this.editingText}}
                                            disabled={{this.editingSubmitting}}
                                            {{this.focusInput}}
                                            {{on "input" this.updateEditingText}}
                                          ></textarea>

                                          {{#if this.editingError}}
                                            <p
                                              class="video-shorts-comments-surface__reply-error"
                                              role="alert"
                                            >
                                              {{this.editingError}}
                                            </p>
                                          {{/if}}

                                          <div
                                            class="video-shorts-comments-surface__form-actions"
                                          >
                                            <button
                                              type="button"
                                              class="btn-flat"
                                              data-action="cancel-edit"
                                              {{on "click" this.cancelEdit}}
                                            >
                                              {{i18n "video_shorts.comments.cancel"}}
                                            </button>
                                            <button
                                              type="submit"
                                              class="btn btn-primary"
                                              data-action="save-edit"
                                              disabled={{this.editingSubmitting}}
                                            >
                                              {{if
                                                this.editingSubmitting
                                                (i18n "video_shorts.comments.saving")
                                                (i18n "video_shorts.comments.save")
                                              }}
                                            </button>
                                          </div>
                                        </form>
                                      {{else}}
                                        <div class="video-shorts-comments-surface__cooked">
                                          {{trustHTML grandchildReply.cooked}}
                                        </div>
                                      {{/if}}

                                      <div
                                        class="video-shorts-comments-surface__comment-actions"
                                      >
                                        <button
                                          type="button"
                                          class="video-shorts-comments-surface__text-action"
                                          data-action="reply-to-comment"
                                          data-post-id={{grandchildReply.post_id}}
                                          {{on
                                            "click"
                                              (fn
                                                this.openCommentReply
                                                grandchildReply
                                                true
                                              )
                                          }}
                                        >
                                          {{i18n "video_shorts.comments.reply"}}
                                        </button>

                                        <div class="video-shorts-comments-surface__tools">
                                          <button
                                            type="button"
                                            class="video-shorts-comments-surface__tools-trigger"
                                            title={{i18n
                                              "video_shorts.comments.tools"
                                            }}
                                            aria-label={{i18n
                                              "video_shorts.comments.tools"
                                            }}
                                            aria-expanded={{if
                                              (eq
                                                this.openToolsPostId
                                                (postKey grandchildReply)
                                              )
                                              "true"
                                              "false"
                                            }}
                                            data-action="comment-tools-toggle"
                                            data-post-id={{grandchildReply.post_id}}
                                            {{on
                                              "click"
                                              (fn this.toggleTools grandchildReply)
                                            }}
                                          >
                                            {{dIcon "ellipsis-vertical"}}
                                          </button>

                                          {{#if
                                            (eq
                                              this.openToolsPostId
                                              (postKey grandchildReply)
                                            )
                                          }}
                                            <div
                                              class="video-shorts-comments-surface__tools-menu"
                                              data-video-shorts-comment-tools-menu={{grandchildReply.post_id}}
                                              role="menu"
                                              {{on "click" this.stopPropagation}}
                                            >
                                              {{#if
                                                (this.canEditComment grandchildReply)
                                              }}
                                                <button
                                                  type="button"
                                                  role="menuitem"
                                                  data-action="edit-comment"
                                                  {{on
                                                    "click"
                                                    (fn this.openEdit grandchildReply)
                                                  }}
                                                >
                                                  {{dIcon "pencil"}}
                                                  <span>{{i18n
                                                      "video_shorts.comments.edit"
                                                    }}</span>
                                                </button>
                                              {{/if}}

                                              {{#if grandchildReply.post_url}}
                                                <button
                                                  type="button"
                                                  role="menuitem"
                                                  data-action="copy-comment-link"
                                                  {{on
                                                    "click"
                                                    (fn
                                                      this.copyCommentLink
                                                      grandchildReply
                                                    )
                                                  }}
                                                >
                                                  {{dIcon "link"}}
                                                  <span>{{i18n
                                                      "video_shorts.comments.copy_link"
                                                    }}</span>
                                                </button>
                                                <button
                                                  type="button"
                                                  role="menuitem"
                                                  data-action="open-comment-topic"
                                                  {{on
                                                    "click"
                                                    (fn
                                                      this.openCommentTopic
                                                      grandchildReply
                                                    )
                                                  }}
                                                >
                                                  {{dIcon "up-right-from-square"}}
                                                  <span>{{i18n
                                                      "video_shorts.comments.open_in_topic"
                                                    }}</span>
                                                </button>
                                              {{/if}}

                                              {{#if
                                                (this.canFlagComment grandchildReply)
                                              }}
                                                <button
                                                  type="button"
                                                  role="menuitem"
                                                  data-action="flag-comment"
                                                  {{on
                                                    "click"
                                                    (fn
                                                      this.flagComment
                                                      grandchildReply
                                                    )
                                                  }}
                                                >
                                                  {{dIcon "flag"}}
                                                  <span>{{i18n
                                                      "video_shorts.comments.report"
                                                    }}</span>
                                                </button>
                                              {{/if}}

                                              {{#if
                                                (this.canDeleteComment
                                                  grandchildReply)
                                              }}
                                                <button
                                                  type="button"
                                                  role="menuitem"
                                                  class="danger"
                                                  data-action="delete-comment"
                                                  disabled={{eq
                                                    this.deletingPostId
                                                    (postKey grandchildReply)
                                                  }}
                                                  {{on
                                                    "click"
                                                    (fn
                                                      this.deleteComment
                                                      grandchildReply
                                                    )
                                                  }}
                                                >
                                                  {{dIcon "trash-can"}}
                                                  <span>{{i18n
                                                      "video_shorts.comments.delete"
                                                    }}</span>
                                                </button>
                                              {{/if}}
                                            </div>
                                          {{/if}}
                                        </div>
                                      </div>

                                      {{#if
                                        (eq
                                          this.commentReplyPostId
                                          (postKey grandchildReply)
                                        )
                                      }}
                                        <div
                                          class="video-shorts-comments-surface__comment-reply-marker"
                                        >
                                          <span data-video-shorts-reply-target>
                                            {{this.commentReplyStatus}}
                                          </span>
                                        </div>
                                      {{/if}}

                                      {{#if
                                        (this.hasChildReplies grandchildReply)
                                      }}
                                        <ol
                                          class="video-shorts-comments-surface__child-list video-shorts-comments-surface__child-list--deep"
                                        >
                                          {{#each
                                            (this.deepRepliesFor grandchildReply)
                                            as |deepReply|
                                          }}
                                            <li
                                              class="video-shorts-comments-surface__child-comment video-shorts-comments-surface__child-comment--nested video-shorts-comments-surface__child-comment--deep"
                                              data-post-id={{deepReply.post_id}}
                                              data-post-number={{deepReply.post_number}}
                                              data-highlighted={{if
                                                (eq
                                                  this.highlightedPostId
                                                  (postKey deepReply)
                                                )
                                                "true"
                                                "false"
                                              }}
                                            >
                                              <a
                                                class="video-shorts-comments-surface__avatar-link video-shorts-comments-surface__avatar-link--small"
                                                href={{this.userPathFor deepReply}}
                                                data-user-card={{this.displayName
                                                  deepReply
                                                }}
                                              >
                                                <img
                                                  class="video-shorts-comments-surface__avatar video-shorts-comments-surface__avatar--small"
                                                  src={{this.avatarUrl
                                                    deepReply
                                                    32
                                                  }}
                                                  alt=""
                                                  loading="lazy"
                                                />
                                              </a>

                                              <div
                                                class="video-shorts-comments-surface__comment-main"
                                              >
                                                <div
                                                  class="video-shorts-comments-surface__comment-header"
                                                >
                                                  <a
                                                    class="video-shorts-comments-surface__username"
                                                    href={{this.userPathFor
                                                      deepReply
                                                    }}
                                                    data-user-card={{this.displayName
                                                      deepReply
                                                    }}
                                                  >
                                                    @{{this.displayName
                                                      deepReply
                                                    }}
                                                  </a>
                                                  {{#if deepReply.created_at}}
                                                    <time
                                                      class="video-shorts-comments-surface__time"
                                                      datetime={{deepReply.created_at}}
                                                    >
                                                      {{dFormatDate
                                                        deepReply.created_at
                                                        leaveAgo="true"
                                                      }}
                                                    </time>
                                                  {{/if}}
                                                </div>

                                                {{#if
                                                  (eq
                                                    this.editingPostId
                                                    (postKey deepReply)
                                                  )
                                                }}
                                                  <form
                                                    class="video-shorts-comments-surface__edit-input"
                                                    {{on
                                                      "submit"
                                                      (fn
                                                        this.saveEdit
                                                        deepReply
                                                      )
                                                    }}
                                                  >
                                                    <textarea
                                                      data-video-shorts-edit-input
                                                      value={{this.editingText}}
                                                      disabled={{this.editingSubmitting}}
                                                      {{this.focusInput}}
                                                      {{on
                                                        "input"
                                                        this.updateEditingText
                                                      }}
                                                    ></textarea>

                                                    {{#if this.editingError}}
                                                      <p
                                                        class="video-shorts-comments-surface__reply-error"
                                                        role="alert"
                                                      >
                                                        {{this.editingError}}
                                                      </p>
                                                    {{/if}}

                                                    <div
                                                      class="video-shorts-comments-surface__form-actions"
                                                    >
                                                      <button
                                                        type="button"
                                                        class="btn-flat"
                                                        data-action="cancel-edit"
                                                        {{on
                                                          "click"
                                                          this.cancelEdit
                                                        }}
                                                      >
                                                        {{i18n
                                                          "video_shorts.comments.cancel"
                                                        }}
                                                      </button>
                                                      <button
                                                        type="submit"
                                                        class="btn btn-primary"
                                                        data-action="save-edit"
                                                        disabled={{this.editingSubmitting}}
                                                      >
                                                        {{if
                                                          this.editingSubmitting
                                                          (i18n
                                                            "video_shorts.comments.saving"
                                                          )
                                                          (i18n
                                                            "video_shorts.comments.save"
                                                          )
                                                        }}
                                                      </button>
                                                    </div>
                                                  </form>
                                                {{else}}
                                                  <div
                                                    class="video-shorts-comments-surface__cooked"
                                                  >
                                                    {{trustHTML
                                                      deepReply.cooked
                                                    }}
                                                  </div>
                                                {{/if}}

                                                <div
                                                  class="video-shorts-comments-surface__comment-actions"
                                                >
                                                  <button
                                                    type="button"
                                                    class="video-shorts-comments-surface__text-action"
                                                    data-action="reply-to-comment"
                                                    data-post-id={{deepReply.post_id}}
                                                    {{on
                                                      "click"
                                                      (fn
                                                        this.openCommentReply
                                                        deepReply
                                                        true
                                                      )
                                                    }}
                                                  >
                                                    {{i18n
                                                      "video_shorts.comments.reply"
                                                    }}
                                                  </button>

                                                  <div
                                                    class="video-shorts-comments-surface__tools"
                                                  >
                                                    <button
                                                      type="button"
                                                      class="video-shorts-comments-surface__tools-trigger"
                                                      title={{i18n
                                                        "video_shorts.comments.tools"
                                                      }}
                                                      aria-label={{i18n
                                                        "video_shorts.comments.tools"
                                                      }}
                                                      aria-expanded={{if
                                                        (eq
                                                          this.openToolsPostId
                                                          (postKey deepReply)
                                                        )
                                                        "true"
                                                        "false"
                                                      }}
                                                      data-action="comment-tools-toggle"
                                                      data-post-id={{deepReply.post_id}}
                                                      {{on
                                                        "click"
                                                        (fn
                                                          this.toggleTools
                                                          deepReply
                                                        )
                                                      }}
                                                    >
                                                      {{dIcon
                                                        "ellipsis-vertical"
                                                      }}
                                                    </button>

                                                    {{#if
                                                      (eq
                                                        this.openToolsPostId
                                                        (postKey deepReply)
                                                      )
                                                    }}
                                                      <div
                                                        class="video-shorts-comments-surface__tools-menu"
                                                        data-video-shorts-comment-tools-menu={{deepReply.post_id}}
                                                        role="menu"
                                                        {{on
                                                          "click"
                                                          this.stopPropagation
                                                        }}
                                                      >
                                                        {{#if
                                                          (this.canEditComment
                                                            deepReply)
                                                        }}
                                                          <button
                                                            type="button"
                                                            role="menuitem"
                                                            data-action="edit-comment"
                                                            {{on
                                                              "click"
                                                              (fn
                                                                this.openEdit
                                                                deepReply
                                                              )
                                                            }}
                                                          >
                                                            {{dIcon "pencil"}}
                                                            <span>{{i18n
                                                                "video_shorts.comments.edit"
                                                              }}</span>
                                                          </button>
                                                        {{/if}}

                                                        {{#if deepReply.post_url}}
                                                          <button
                                                            type="button"
                                                            role="menuitem"
                                                            data-action="copy-comment-link"
                                                            {{on
                                                              "click"
                                                              (fn
                                                                this.copyCommentLink
                                                                deepReply
                                                              )
                                                            }}
                                                          >
                                                            {{dIcon "link"}}
                                                            <span>{{i18n
                                                                "video_shorts.comments.copy_link"
                                                              }}</span>
                                                          </button>
                                                          <button
                                                            type="button"
                                                            role="menuitem"
                                                            data-action="open-comment-topic"
                                                            {{on
                                                              "click"
                                                              (fn
                                                                this.openCommentTopic
                                                                deepReply
                                                              )
                                                            }}
                                                          >
                                                            {{dIcon
                                                              "up-right-from-square"
                                                            }}
                                                            <span>{{i18n
                                                                "video_shorts.comments.open_in_topic"
                                                              }}</span>
                                                          </button>
                                                        {{/if}}

                                                        {{#if
                                                          (this.canFlagComment
                                                            deepReply)
                                                        }}
                                                          <button
                                                            type="button"
                                                            role="menuitem"
                                                            data-action="flag-comment"
                                                            {{on
                                                              "click"
                                                              (fn
                                                                this.flagComment
                                                                deepReply
                                                              )
                                                            }}
                                                          >
                                                            {{dIcon "flag"}}
                                                            <span>{{i18n
                                                                "video_shorts.comments.report"
                                                              }}</span>
                                                          </button>
                                                        {{/if}}

                                                        {{#if
                                                          (this.canDeleteComment
                                                            deepReply)
                                                        }}
                                                          <button
                                                            type="button"
                                                            role="menuitem"
                                                            class="danger"
                                                            data-action="delete-comment"
                                                            disabled={{eq
                                                              this.deletingPostId
                                                              (postKey deepReply)
                                                            }}
                                                            {{on
                                                              "click"
                                                              (fn
                                                                this.deleteComment
                                                                deepReply
                                                              )
                                                            }}
                                                          >
                                                            {{dIcon
                                                              "trash-can"
                                                            }}
                                                            <span>{{i18n
                                                                "video_shorts.comments.delete"
                                                              }}</span>
                                                          </button>
                                                        {{/if}}
                                                      </div>
                                                    {{/if}}
                                                  </div>
                                                </div>

                                                {{#if
                                                  (eq
                                                    this.commentReplyPostId
                                                    (postKey deepReply)
                                                  )
                                                }}
                                                  <div
                                                    class="video-shorts-comments-surface__comment-reply-marker"
                                                  >
                                                    <span
                                                      data-video-shorts-reply-target
                                                    >
                                                      {{this.commentReplyStatus}}
                                                    </span>
                                                  </div>
                                                {{/if}}
                                              </div>
                                            </li>
                                          {{/each}}
                                        </ol>
                                      {{/if}}
                                    </div>
                                  </li>
                                {{/each}}
                              </ol>
                            {{/if}}

                          </div>
                        </li>
                      {{/each}}
                    </ol>
                  {{/if}}
                </div>
              </article>
            </li>
          {{else}}
            <li class="video-shorts-comments-surface__state">
              {{i18n "video_shorts.comments.empty"}}
            </li>
          {{/each}}
        </ol>

        {{#if this.hasMore}}
          <button
            type="button"
            class="btn btn-flat video-shorts-comments-surface__load-more"
            disabled={{this.loadingMore}}
            {{on "click" this.loadMore}}
          >
            {{if
              this.loadingMore
              (i18n "video_shorts.comments.loading_more")
              (i18n "video_shorts.comments.load_more")
            }}
          </button>
        {{/if}}
      {{/if}}

      {{#if this.currentUser}}
        <div
          class="video-shorts-comments-surface__reply"
          data-video-shorts-youtube-composer
        >
          <form
            class="video-shorts-comments-surface__reply-form"
            {{on "submit" this.publishActiveReply}}
          >
            <div class="video-shorts-comments-surface__composer-row">
              {{#if this.currentUserAvatarUrl}}
                <img
                  class="video-shorts-comments-surface__composer-avatar"
                  src={{this.currentUserAvatarUrl}}
                  alt=""
                />
              {{else}}
                <span
                  class="video-shorts-comments-surface__composer-avatar video-shorts-comments-surface__composer-avatar--placeholder"
                ></span>
              {{/if}}

              <div class="video-shorts-comments-surface__composer-body">
                {{#if this.commentReplyPostId}}
                  {{#if this.commentReplyStatus}}
                    <div
                      class="video-shorts-comments-surface__comment-reply-status"
                      data-video-shorts-comment-reply-status
                    >
                      <span data-video-shorts-reply-target>
                        {{this.commentReplyStatus}}
                      </span>
                      <button
                        type="button"
                        data-action="cancel-comment-reply"
                        aria-label={{i18n
                          "video_shorts.comments.cancel_reply_to"
                          username=this.selectedReplyUsernameLabel
                        }}
                        {{on "click" this.cancelCommentReply}}
                      >
                        {{dIcon "xmark"}}
                      </button>
                    </div>
                  {{/if}}

                  <textarea
                    data-video-shorts-comment-reply-input
                    data-action="reply"
                    value={{this.commentReplyText}}
                    disabled={{this.commentReplySubmitting}}
                    placeholder={{i18n "video_shorts.comments.reply"}}
                    {{this.focusInput}}
                    {{on "input" this.updateCommentReplyText}}
                  ></textarea>

                  {{#if this.commentReplyError}}
                    <p
                      class="video-shorts-comments-surface__comment-reply-error"
                      role="alert"
                    >
                      {{this.commentReplyError}}
                    </p>
                  {{/if}}

                  {{#if this.commentReplyNotice}}
                    <p
                      class="video-shorts-comments-surface__comment-reply-notice"
                    >
                      {{this.commentReplyNotice}}
                    </p>
                  {{/if}}

                  <div class="video-shorts-comments-surface__form-actions">
                    <button
                      type="button"
                      class="btn-flat"
                      data-action="cancel-comment-reply"
                      {{on "click" this.cancelCommentReply}}
                    >
                      {{i18n "video_shorts.comments.cancel"}}
                    </button>
                    <button
                      type="submit"
                      class="btn btn-primary"
                      data-action="publish-comment-reply"
                      disabled={{this.commentReplySubmitting}}
                    >
                      {{if
                        this.commentReplySubmitting
                        (i18n "video_shorts.comments.publishing")
                        (i18n "video_shorts.comments.publish")
                      }}
                    </button>
                  </div>
                {{else}}
                  <textarea
                    data-video-shorts-reply-input
                    data-action="reply"
                    value={{this.replyText}}
                    disabled={{this.replySubmitting}}
                    placeholder={{i18n "video_shorts.comments.reply"}}
                    {{on "focus" this.openReply}}
                    {{on "input" this.updateReplyText}}
                  ></textarea>

                  {{#if this.replyError}}
                    <p
                      class="video-shorts-comments-surface__reply-error"
                      role="alert"
                    >
                      {{this.replyError}}
                    </p>
                  {{/if}}

                  {{#if this.replyNotice}}
                    <p class="video-shorts-comments-surface__reply-notice">
                      {{this.replyNotice}}
                    </p>
                  {{/if}}

                  <div class="video-shorts-comments-surface__form-actions">
                    <button
                      type="submit"
                      class="btn btn-primary"
                      data-action="publish-reply"
                      disabled={{this.replySubmitting}}
                    >
                      {{if
                        this.replySubmitting
                        (i18n "video_shorts.comments.publishing")
                        (i18n "video_shorts.comments.publish")
                      }}
                    </button>
                  </div>
                {{/if}}
              </div>
            </div>
          </form>
        </div>
      {{/if}}
    </div>
  </template>
}
