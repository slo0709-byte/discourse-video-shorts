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
import { fetchVideoShortsComments } from "discourse/plugins/discourse-video-shorts/discourse/lib/video-shorts-comments";
import {
  createVideoShortsReply,
  videoShortsReplyErrorMessage,
} from "discourse/plugins/discourse-video-shorts/discourse/lib/video-shorts-reply";
import { videoShortsAccentStyle } from "discourse/plugins/discourse-video-shorts/discourse/lib/video-shorts-visual-accent";

const TOP_LEVEL_COMPOSER = "reply";
const COMMENT_REPLY_COMPOSER = "comment-reply";
const ACTION_SHEET_INTERACTIVE_TARGET_SELECTOR =
  "a, button, input, textarea, select, label, .video-shorts-comments-surface__tools, .video-shorts-comments-surface__tools-menu, .video-shorts-comments-surface__edit-input";

function postKey(post) {
  return String(post?.post_id || post?.id || "");
}

function withoutKey(object, key) {
  const nextObject = { ...object };

  delete nextObject[key];

  return nextObject;
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

function isActionSheetInteractiveTarget(target) {
  return Boolean(target?.closest?.(ACTION_SHEET_INTERACTIVE_TARGET_SELECTOR));
}

const CommentBranchControls = <template>
  {{#if (@surface.canShowViewRepliesControl @comment)}}
    <button
      type="button"
      class="video-shorts-comments-surface__text-action video-shorts-comments-surface__branch-control"
      data-video-shorts-view-replies
      disabled={{@surface.isLoadingReplies @comment}}
      aria-expanded="false"
      aria-label={{@surface.viewRepliesAriaLabel @comment}}
      {{on "click" (fn @surface.loadReplyBranch @comment)}}
    >
      {{#if (@surface.isLoadingReplies @comment)}}
        <span data-video-shorts-replies-loading>
          {{i18n "video_shorts.comments.loading_replies"}}
        </span>
      {{else}}
        {{@surface.viewRepliesLabel @comment}}
      {{/if}}
    </button>
  {{else if (@surface.canShowLoadMoreRepliesControl @comment)}}
    <button
      type="button"
      class="video-shorts-comments-surface__text-action video-shorts-comments-surface__branch-control"
      data-video-shorts-load-more-replies
      disabled={{@surface.isLoadingReplies @comment}}
      aria-expanded="true"
      aria-label={{@surface.loadMoreRepliesAriaLabel @comment}}
      {{on "click" (fn @surface.loadReplyBranch @comment)}}
    >
      {{#if (@surface.isLoadingReplies @comment)}}
        <span data-video-shorts-replies-loading>
          {{i18n "video_shorts.comments.loading_replies"}}
        </span>
      {{else}}
        {{@surface.loadMoreRepliesLabel @comment}}
      {{/if}}
    </button>
  {{/if}}

  {{#if (@surface.replyErrorFor @comment)}}
    <div
      class="video-shorts-comments-surface__reply-error video-shorts-comments-surface__branch-error"
      data-video-shorts-replies-error
      role="alert"
    >
      {{i18n "video_shorts.comments.replies_error"}}
    </div>
    <button
      type="button"
      class="video-shorts-comments-surface__text-action video-shorts-comments-surface__branch-control"
      data-video-shorts-retry-replies
      aria-label={{i18n "video_shorts.comments.retry_replies"}}
      {{on "click" (fn @surface.loadReplyBranch @comment)}}
    >
      {{i18n "video_shorts.comments.retry_replies"}}
    </button>
  {{/if}}
</template>;

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
  @tracked actionSheetPostId = null;
  @tracked highlightedPostId = null;
  @tracked childRepliesByPostId = {};
  @tracked expandedReplyPostIds = {};
  @tracked loadingReplyPostIds = {};
  @tracked replyErrorsByPostId = {};
  @tracked replyPaginationByPostId = {};
  @tracked localReplyCount = null;
  @tracked hasDeletedPlaceholderContext = false;
  @tracked activeComposer = null;

  activePostId = null;
  loadToken = 0;
  loadingReplyPromisesByPostId = {};

  loadForItem = modifier((element, [item]) => {
    if (!item || item.post_id === this.activePostId) {
      return;
    }

    this.activePostId = item.post_id;
    this.comments = [];
    this.childRepliesByPostId = {};
    this.expandedReplyPostIds = {};
    this.loadingReplyPostIds = {};
    this.replyErrorsByPostId = {};
    this.replyPaginationByPostId = {};
    this.loadingReplyPromisesByPostId = {};
    this.localReplyCount = null;
    this.hasDeletedPlaceholderContext = false;
    this.hasMore = false;
    this.nextAfter = null;
    this.actionSheetPostId = null;
    this.resetReplyState();
    this.resetCommentReplyState();
    this.resetEditingState();
    this.loadComments({ item });
  });

  focusInput = modifier((element) => {
    queueMicrotask(() => {
      if (!isDestroying(this) && !isDestroyed(this)) {
        element.focus({ preventScroll: true });
      }
    });
  });

  closeToolsOnOutsideInteraction = modifier((element) => {
    const closeOnOutsidePointer = (event) => {
      if (
        !this.openToolsPostId &&
        !this.actionSheetPostId &&
        !this.commentReplyPostId
      ) {
        return;
      }

      if (
        element.contains(event.target) &&
        event.target.closest(
          ".video-shorts-comments-surface__tools, .video-shorts-comments-surface__action-sheet, .video-shorts-comments-surface__reply-dialog",
        )
      ) {
        return;
      }

      this.closeTools();
      this.closeActionSheet();
      this.cancelCommentReply();
    };

    const closeOnEscape = (event) => {
      if (event.key === "Escape") {
        this.closeTools();
        this.closeActionSheet();
        this.cancelCommentReply();
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
    return this.childRepliesByPostId[postKey(comment)] || [];
  };

  hasChildReplies = (comment) => {
    return this.visualRepliesFor(comment).length > 0;
  };

  isTopLevelDisplayComment = (comment) => {
    const key = postKey(comment);

    return Boolean(
      key && this.comments.some((candidate) => postKey(candidate) === key)
    );
  };

  visualReplyHostFor = (comment) => {
    let host = this.findCommentByPostId(postKey(comment)) || comment;
    let guard = 0;

    while (host && !this.isTopLevelDisplayComment(host) && guard < 20) {
      const parent = this.findCommentByPostNumber(host.reply_to_post_number);

      if (!parent || postKey(parent) === postKey(host)) {
        break;
      }

      host = parent;
      guard += 1;
    }

    return host || comment;
  };

  visualRepliesFor = (comment) => {
    if (!this.isTopLevelDisplayComment(comment)) {
      return [];
    }

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

  canShowEditAction = (post) => {
    return !isDeletedPlaceholder(post) && this.canEditComment(post);
  };

  canShowDeleteAction = (post) => {
    return !isDeletedPlaceholder(post) && this.canDeleteComment(post);
  };

  canShowFlagAction = (post) => {
    return !isDeletedPlaceholder(post) && this.canFlagComment(post);
  };

  hasCommentLinkAction = (post) => {
    return Boolean(post?.post_url);
  };

  canShowReplyAction = () => {
    return !this.currentUser || this.canCreatePost;
  };

  replyActionUsesMentionLabel = (post) => {
    const postNumber = Number(post?.post_number || 0);
    const sourcePostNumber = Number(this.item?.post_number || 0);

    return Boolean(postNumber && postNumber !== sourcePostNumber);
  };

  replyDisplayTargetLabel = (post) => {
    const replyToPostNumber = Number(post?.reply_to_post_number || 0);
    const sourcePostNumber = Number(this.item?.post_number || 0);

    if (!replyToPostNumber || replyToPostNumber === sourcePostNumber) {
      return null;
    }

    const parent = this.findCommentByPostNumber(replyToPostNumber);

    if (!parent) {
      return null;
    }

    const username = post?.reply_to_username || normalizeUsername(parent);

    if (!username) {
      return null;
    }

    return username.startsWith("@") ? username : `@${username}`;
  };

  hasLoadedReplyBranch = (comment) => {
    return Object.prototype.hasOwnProperty.call(
      this.childRepliesByPostId,
      postKey(comment)
    );
  };

  hasExpandedReplies = (comment) => {
    return Boolean(this.expandedReplyPostIds[postKey(comment)]);
  };

  isLoadingReplies = (comment) => {
    return Boolean(this.loadingReplyPostIds[postKey(comment)]);
  };

  replyErrorFor = (comment) => {
    return this.replyErrorsByPostId[postKey(comment)] || null;
  };

  replyPaginationFor = (comment) => {
    return this.replyPaginationByPostId[postKey(comment)] || {
      hasMore: false,
      nextAfter: null,
    };
  };

  replyBranchRemainingCount = (comment) => {
    const replyCount = Number(comment?.reply_count || 0);
    const loadedCount = this.childRepliesFor(comment).length;
    const pagination = this.replyPaginationFor(comment);

    if (pagination.hasMore) {
      return Math.max(replyCount - loadedCount, 0);
    }

    return replyCount;
  };

  canShowReplyBranchControl = (comment) => {
    if (
      !this.isTopLevelDisplayComment(comment) ||
      Number(comment?.reply_count || 0) <= 0
    ) {
      return false;
    }

    const pagination = this.replyPaginationFor(comment);

    return !this.hasExpandedReplies(comment) || pagination.hasMore;
  };

  canShowViewRepliesControl = (comment) => {
    return (
      this.canShowReplyBranchControl(comment) && !this.hasExpandedReplies(comment)
    );
  };

  canShowLoadMoreRepliesControl = (comment) => {
    return (
      this.canShowReplyBranchControl(comment) &&
      this.hasExpandedReplies(comment) &&
      this.replyPaginationFor(comment).hasMore &&
      this.replyBranchRemainingCount(comment) > 0
    );
  };

  viewRepliesLabel = (comment) => {
    return i18n("video_shorts.comments.view_replies", {
      count: this.replyBranchRemainingCount(comment),
    });
  };

  viewRepliesAriaLabel = (comment) => {
    return i18n("video_shorts.comments.view_replies_aria", {
      count: this.replyBranchRemainingCount(comment),
      username: this.displayName(comment),
    });
  };

  loadMoreRepliesLabel = (comment) => {
    return i18n("video_shorts.comments.load_more_replies", {
      count: this.replyBranchRemainingCount(comment),
    });
  };

  loadMoreRepliesAriaLabel = (comment) => {
    return i18n("video_shorts.comments.load_more_replies_aria", {
      count: this.replyBranchRemainingCount(comment),
      username: this.displayName(comment),
    });
  };

  deepRepliesFor = () => {
    return [];
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

  sourceReplyCount() {
    const replyCount = Number(this.args.replyCount);

    if (Number.isFinite(replyCount)) {
      return replyCount;
    }

    const itemReplyCount = Number(this.item?.counts?.reply_count);

    if (Number.isFinite(itemReplyCount)) {
      return itemReplyCount;
    }

    return this.commentTreeCount();
  }

  syncLoadedReplyCount() {
    const replyCountValue = this.sourceReplyCount();

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
    const count = Number.isFinite(this.localReplyCount)
      ? this.localReplyCount
      : this.sourceReplyCount();

    return i18n("video_shorts.comments.count", { count });
  }

  get replyActionsVisible() {
    return this.activeComposer === TOP_LEVEL_COMPOSER || this.replySubmitting;
  }

  get commentReplyActionsVisible() {
    return Boolean(this.commentReplyPostId) || this.commentReplySubmitting;
  }

  get selectedReplyTarget() {
    return this.findCommentByPostId(this.commentReplyPostId);
  }

  get selectedActionSheetComment() {
    return this.findCommentByPostId(this.actionSheetPostId);
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

  get commentReplyPlaceholder() {
    if (this.selectedReplyTargetUsesMentionLabel) {
      return i18n("video_shorts.comments.reply_to_user", {
        username: this.selectedReplyUsernameLabel,
      });
    }

    return i18n("video_shorts.comments.reply");
  }

  get commentReplyDialogLabel() {
    const username = this.selectedReplyUsernameLabel;

    if (username) {
      return i18n("video_shorts.comments.reply_to_user", { username });
    }

    return i18n("video_shorts.comments.reply");
  }

  get currentUserAvatarUrl() {
    return (this.currentUser?.avatar_template || "").replace("{size}", 40);
  }

  async loadComments({ append = false, item = this.item } = {}) {
    const token = append ? this.loadToken : ++this.loadToken;

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

      const comments = this.commentsWithoutLoadedChildren(response.comments);

      const existingIds = append
        ? new Set(this.comments.map((comment) => comment.id))
        : null;
      const deduped = append
        ? comments.filter((comment) => !existingIds.has(comment.id))
        : comments;

      if (!append) {
        this.childRepliesByPostId = {};
        this.expandedReplyPostIds = {};
        this.loadingReplyPostIds = {};
        this.replyErrorsByPostId = {};
        this.replyPaginationByPostId = {};
        this.loadingReplyPromisesByPostId = {};
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

  commentsWithoutLoadedChildren(comments = []) {
    return comments.map((comment) => {
      return {
        ...comment,
        replies: [],
      };
    });
  }

  currentItemIdentity(item = this.item) {
    return [
      item?.topic_id || "",
      item?.post_id || "",
      item?.post_number || "",
      item?.topic_url || "",
    ].join(":");
  }

  isStale(token, itemIdentity = null) {
    return (
      isDestroying(this) ||
      isDestroyed(this) ||
      token !== this.loadToken ||
      (itemIdentity && itemIdentity !== this.currentItemIdentity())
    );
  }

  updateReplyBranchComment(comment, children) {
    const targetKey = postKey(comment);

    const updateInTree = (comments) => {
      return comments.map((candidate) => {
        const currentChildren = this.childRepliesFor(candidate);
        let nextCandidate = candidate;

        if (postKey(candidate) === targetKey) {
          nextCandidate = {
            ...candidate,
            replies: children,
          };
        } else if (currentChildren.length) {
          nextCandidate = {
            ...candidate,
            replies: updateInTree(currentChildren),
          };
        }

        return nextCandidate;
      });
    };

    this.comments = updateInTree(this.comments);
  }

  @action
  loadReplyBranch(comment, event) {
    event?.preventDefault();
    event?.stopPropagation();

    const key = postKey(comment);

    if (!key) {
      return;
    }

    const existingRequest = this.loadingReplyPromisesByPostId[key];

    if (existingRequest) {
      return existingRequest;
    }

    const append = this.hasExpandedReplies(comment);
    const pagination = this.replyPaginationFor(comment);

    if (append && !pagination.hasMore) {
      return;
    }

    const token = this.loadToken;
    const itemIdentity = this.currentItemIdentity();
    let request;

    this.loadingReplyPostIds = {
      ...this.loadingReplyPostIds,
      [key]: true,
    };
    this.replyErrorsByPostId = withoutKey(this.replyErrorsByPostId, key);

    request = (async () => {
      try {
        const response = await fetchVideoShortsComments({
          postId: comment.post_id,
          after: append ? pagination.nextAfter : null,
        });

        if (this.isStale(token, itemIdentity)) {
          return;
        }

        const currentChildren = append ? this.childRepliesFor(comment) : [];
        const children = this.uniqueReplies([
          ...currentChildren,
          ...this.commentsWithoutLoadedChildren(response.comments),
        ]);

        this.childRepliesByPostId = {
          ...this.childRepliesByPostId,
          [key]: children,
        };
        this.expandedReplyPostIds = {
          ...this.expandedReplyPostIds,
          [key]: true,
        };
        this.replyPaginationByPostId = {
          ...this.replyPaginationByPostId,
          [key]: {
            hasMore: response.hasMore,
            nextAfter: response.nextAfter,
          },
        };
        this.updateReplyBranchComment(comment, children);
      } catch (error) {
        if (!this.isStale(token, itemIdentity)) {
          this.replyErrorsByPostId = {
            ...this.replyErrorsByPostId,
            [key]: error,
          };
        }
      } finally {
        if (this.loadingReplyPromisesByPostId[key] === request) {
          this.loadingReplyPromisesByPostId = withoutKey(
            this.loadingReplyPromisesByPostId,
            key
          );
        }

        if (!this.isStale(token, itemIdentity)) {
          this.loadingReplyPostIds = withoutKey(this.loadingReplyPostIds, key);
        }
      }
    })();

    this.loadingReplyPromisesByPostId = {
      ...this.loadingReplyPromisesByPostId,
      [key]: request,
    };

    return request;
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
        return (placeholder.replies || []).map((child) => postKey(child));
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
    const key = postKey(comment);
    const replyCount = Number(comment?.reply_count || 0);
    const pagination = this.replyPaginationFor(comment);
    const hasCompleteLocalBranch =
      this.hasLoadedReplyBranch(comment) &&
      !pagination.hasMore &&
      currentChildren.length >= replyCount;

    if (!replyCount || hasCompleteLocalBranch) {
      return currentChildren;
    }

    try {
      const response = await fetchVideoShortsComments({
        postId: comment.post_id,
      });

      const children = this.uniqueReplies([
        ...this.commentsWithoutLoadedChildren(response.comments),
        ...currentChildren,
        ...this.loadedFlatChildrenFor(comment),
      ]);

      if (key) {
        this.childRepliesByPostId = {
          ...this.childRepliesByPostId,
          [key]: children,
        };
        this.expandedReplyPostIds = {
          ...this.expandedReplyPostIds,
          [key]: true,
        };
        this.replyPaginationByPostId = {
          ...this.replyPaginationByPostId,
          [key]: {
            hasMore: response.hasMore,
            nextAfter: response.nextAfter,
          },
        };
        this.updateReplyBranchComment(comment, children);
      }

      return children;
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
            reply_count: Math.max(
              Number(comment?.reply_count || 0),
              children.length
            ),
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
            reply_count: Math.max(
              Number(comment?.reply_count || 0) - 1,
              childResult.comments.length
            ),
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
      this.expandedReplyPostIds = {
        ...this.expandedReplyPostIds,
        [targetKey]: true,
      };
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

  findCommentByPostNumber(postNumber) {
    const targetNumber = Number(postNumber || 0);

    if (!targetNumber) {
      return null;
    }

    const findInTree = (comments) => {
      for (const comment of comments) {
        if (Number(comment?.post_number || 0) === targetNumber) {
          return comment;
        }

        const child = findInTree(this.childRepliesFor(comment));

        if (child) {
          return child;
        }
      }

      return null;
    };

    return findInTree(this.comments);
  }

  appendChildReply(parentComment, childReply) {
    const displayParent = this.visualReplyHostFor(parentComment);
    const parentKey = postKey(displayParent);
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
      this.expandedReplyPostIds = {
        ...this.expandedReplyPostIds,
        [parentKey]: true,
      };
    }

    return appended;
  }

  async refreshReplyBranchAfterCreate(parentComment, createdReply, shouldRefresh) {
    if (!shouldRefresh) {
      return;
    }

    const displayParent = this.visualReplyHostFor(parentComment);
    const key = postKey(displayParent);
    const token = this.loadToken;
    const itemIdentity = this.currentItemIdentity();

    try {
      const response = await fetchVideoShortsComments({
        postId: displayParent.post_id,
      });

      if (this.isStale(token, itemIdentity)) {
        return;
      }

      const children = this.uniqueReplies([
        ...this.commentsWithoutLoadedChildren(response.comments),
        createdReply,
      ]);

      this.childRepliesByPostId = {
        ...this.childRepliesByPostId,
        [key]: children,
      };
      this.expandedReplyPostIds = {
        ...this.expandedReplyPostIds,
        [key]: true,
      };
      this.replyPaginationByPostId = {
        ...this.replyPaginationByPostId,
        [key]: {
          hasMore: response.hasMore,
          nextAfter: response.nextAfter,
        },
      };
      this.updateReplyBranchComment(displayParent, children);
    } catch {
      this.replyPaginationByPostId = {
        ...this.replyPaginationByPostId,
        [key]: {
          hasMore: true,
          nextAfter: null,
        },
      };
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
    this.activeComposer = null;
  }

  resetCommentReplyState() {
    this.commentReplyPostId = null;
    this.commentReplyText = "";
    this.commentReplyError = null;
    this.commentReplyNotice = null;
    this.commentReplySubmitting = false;
    this.commentReplyMentionRequired = false;
    if (this.activeComposer === COMMENT_REPLY_COMPOSER) {
      this.activeComposer = null;
    }
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
    this.actionSheetPostId = null;
    this.activeComposer = TOP_LEVEL_COMPOSER;
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
    this.commentReplyMentionRequired =
      Boolean(mentionRequired) || this.replyActionUsesMentionLabel(target);
    this.activeComposer = COMMENT_REPLY_COMPOSER;
    this.openToolsPostId = null;
    this.actionSheetPostId = null;
    this.resetEditingState();
  }

  @action
  focusCommentReplyInput() {
    if (this.commentReplyPostId) {
      this.activeComposer = COMMENT_REPLY_COMPOSER;
    }
  }

  @action
  deactivateComposerOnFocusOut(event) {
    const form = event.currentTarget;

    if (form.contains(event.relatedTarget)) {
      return;
    }

    requestAnimationFrame(() => {
      if (
        !isDestroying(this) &&
        !isDestroyed(this) &&
        !form.contains(document.activeElement)
      ) {
        this.activeComposer = null;
      }
    });
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
  cancelReply() {
    this.resetReplyState();
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
        const displayParent = this.visualReplyHostFor(target);
        const shouldRefreshBranch =
          !this.hasLoadedReplyBranch(displayParent) &&
          Number(displayParent?.reply_count || 0) > 0;

        this.appendChildReply(target, result.post);
        await this.refreshReplyBranchAfterCreate(
          displayParent,
          result.post,
          shouldRefreshBranch
        );
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
    this.actionSheetPostId = null;
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
  openActionSheet(comment, event) {
    if (isActionSheetInteractiveTarget(event?.target)) {
      return;
    }

    this.actionSheetPostId = postKey(comment);
    this.openToolsPostId = null;
  }

  @action
  openActionSheetFromKeyboard(comment, event) {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    if (isActionSheetInteractiveTarget(event.target)) {
      return;
    }

    event.preventDefault();
    this.openActionSheet(comment, event);
  }

  @action
  closeActionSheet() {
    this.actionSheetPostId = null;
  }

  @action
  stopPropagation(event) {
    event.stopPropagation();
  }

  @action
  async copyCommentLink(comment) {
    this.openToolsPostId = null;
    this.actionSheetPostId = null;

    if (comment.post_url) {
      await clipboardCopy(getAbsoluteURL(comment.post_url)).catch(popupAjaxError);
    }
  }

  @action
  openCommentTopic(comment) {
    this.openToolsPostId = null;
    this.actionSheetPostId = null;

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
    this.actionSheetPostId = null;
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
    this.actionSheetPostId = null;
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
          {{#if this.currentUser}}
            <li
              class="video-shorts-comments-surface__top-composer"
              data-video-shorts-youtube-composer
            >
              <form
                class="video-shorts-comments-surface__reply-form"
                {{on "submit" this.publishReply}}
                {{on "focusout" this.deactivateComposerOnFocusOut}}
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

                    {{#if this.replyActionsVisible}}
                      <div
                        class="video-shorts-comments-surface__form-actions"
                        data-video-shorts-reply-actions
                      >
                        <button
                          type="button"
                          class="btn-flat"
                          data-action="cancel-reply"
                          {{on "click" this.cancelReply}}
                        >
                          {{i18n "video_shorts.comments.cancel"}}
                        </button>
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
            </li>
          {{/if}}

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
              <article
                class="video-shorts-comments-surface__comment-card"
              >
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
                    <div
                      class="video-shorts-comments-surface__cooked"
                      role="button"
                      tabindex="0"
                      {{on "click" (fn this.openActionSheet comment)}}
                      {{on
                        "keydown"
                        (fn this.openActionSheetFromKeyboard comment)
                      }}
                    >
                      {{#if (this.replyDisplayTargetLabel comment)}}
                        <span
                          class="video-shorts-comments-surface__reply-target-label"
                          data-video-shorts-reply-target
                        >
                          {{this.replyDisplayTargetLabel comment}}
                        </span>
                      {{/if}}
                      {{trustHTML comment.cooked}}
                    </div>
                  {{/if}}

                  <div class="video-shorts-comments-surface__comment-actions">
                    <button
                      type="button"
                      class="video-shorts-comments-surface__text-action"
                      data-action="reply-to-comment"
                      data-post-id={{comment.post_id}}
                      {{on "click" (fn this.openCommentReply comment true)}}
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

                  <CommentBranchControls
                    @comment={{comment}}
                    @surface={{this}}
                  />

                  {{#if (this.hasChildReplies comment)}}
                    <ol
                      class="video-shorts-comments-surface__child-list"
                      data-video-shorts-child-list
                    >
                      {{#each (this.visualRepliesFor comment) as |childReply|}}
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
                              <div
                                class="video-shorts-comments-surface__cooked"
                                role="button"
                                tabindex="0"
                                {{on "click" (fn this.openActionSheet childReply)}}
                                {{on
                                  "keydown"
                                  (fn
                                    this.openActionSheetFromKeyboard
                                    childReply
                                  )
                                }}
                              >
                                {{#if (this.replyDisplayTargetLabel childReply)}}
                                  <span
                                    class="video-shorts-comments-surface__reply-target-label"
                                    data-video-shorts-reply-target
                                  >
                                    {{this.replyDisplayTargetLabel childReply}}
                                  </span>
                                {{/if}}
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

                            <CommentBranchControls
                              @comment={{childReply}}
                              @surface={{this}}
                            />

                            {{#if (this.hasChildReplies childReply)}}
                              <ol
                                class="video-shorts-comments-surface__child-list"
                                data-video-shorts-child-list
                              >
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
                                        <div
                                          class="video-shorts-comments-surface__cooked"
                                          role="button"
                                          tabindex="0"
                                          {{on
                                            "click"
                                            (fn
                                              this.openActionSheet
                                              grandchildReply
                                            )
                                          }}
                                          {{on
                                            "keydown"
                                            (fn
                                              this.openActionSheetFromKeyboard
                                              grandchildReply
                                            )
                                          }}
                                        >
                                          {{#if
                                            (this.replyDisplayTargetLabel
                                              grandchildReply)
                                          }}
                                            <span
                                              class="video-shorts-comments-surface__reply-target-label"
                                              data-video-shorts-reply-target
                                            >
                                              {{this.replyDisplayTargetLabel
                                                grandchildReply
                                              }}
                                            </span>
                                          {{/if}}
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

                                      <CommentBranchControls
                                        @comment={{grandchildReply}}
                                        @surface={{this}}
                                      />

                                      {{#if
                                        (this.hasChildReplies grandchildReply)
                                      }}
                                        <ol
                                          class="video-shorts-comments-surface__child-list video-shorts-comments-surface__child-list--deep"
                                          data-video-shorts-child-list
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
                                                    role="button"
                                                    tabindex="0"
                                                    {{on
                                                      "click"
                                                      (fn
                                                        this.openActionSheet
                                                        deepReply
                                                      )
                                                    }}
                                                    {{on
                                                      "keydown"
                                                      (fn
                                                        this.openActionSheetFromKeyboard
                                                        deepReply
                                                      )
                                                    }}
                                                  >
                                                    {{#if
                                                      (this.replyDisplayTargetLabel
                                                        deepReply)
                                                    }}
                                                      <span
                                                        class="video-shorts-comments-surface__reply-target-label"
                                                        data-video-shorts-reply-target
                                                      >
                                                        {{this.replyDisplayTargetLabel
                                                          deepReply
                                                        }}
                                                      </span>
                                                    {{/if}}
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

                                                <CommentBranchControls
                                                  @comment={{deepReply}}
                                                  @surface={{this}}
                                                />
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

        {{#if this.selectedActionSheetComment}}
          <div
            class="video-shorts-comments-surface__action-sheet"
            data-video-shorts-comment-action-sheet
            data-post-id={{this.selectedActionSheetComment.post_id}}
            role="menu"
            {{on "click" this.stopPropagation}}
          >
            {{#if (this.canShowReplyAction this.selectedActionSheetComment)}}
              <button
                type="button"
                role="menuitem"
                data-action="reply-to-comment"
                {{on
                  "click"
                  (fn
                    this.openCommentReply
                    this.selectedActionSheetComment
                    (this.replyActionUsesMentionLabel
                      this.selectedActionSheetComment
                    )
                  )
                }}
              >
                {{dIcon "reply"}}
                <span>{{i18n "video_shorts.comments.reply"}}</span>
              </button>
            {{/if}}

            {{#if (this.canShowEditAction this.selectedActionSheetComment)}}
              <button
                type="button"
                role="menuitem"
                data-action="edit-comment"
                {{on "click" (fn this.openEdit this.selectedActionSheetComment)}}
              >
                {{dIcon "pencil"}}
                <span>{{i18n "video_shorts.comments.edit"}}</span>
              </button>
            {{/if}}

            {{#if (this.hasCommentLinkAction this.selectedActionSheetComment)}}
              <button
                type="button"
                role="menuitem"
                data-action="copy-comment-link"
                {{on
                  "click"
                  (fn this.copyCommentLink this.selectedActionSheetComment)
                }}
              >
                {{dIcon "link"}}
                <span>{{i18n "video_shorts.comments.copy_link"}}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                data-action="open-comment-topic"
                {{on
                  "click"
                  (fn this.openCommentTopic this.selectedActionSheetComment)
                }}
              >
                {{dIcon "up-right-from-square"}}
                <span>{{i18n "video_shorts.comments.open_in_topic"}}</span>
              </button>
            {{/if}}

            {{#if (this.canShowFlagAction this.selectedActionSheetComment)}}
              <button
                type="button"
                role="menuitem"
                data-action="flag-comment"
                {{on "click" (fn this.flagComment this.selectedActionSheetComment)}}
              >
                {{dIcon "flag"}}
                <span>{{i18n "video_shorts.comments.report"}}</span>
              </button>
            {{/if}}

            {{#if (this.canShowDeleteAction this.selectedActionSheetComment)}}
              <button
                type="button"
                role="menuitem"
                class="danger"
                data-action="delete-comment"
                disabled={{eq
                  this.deletingPostId
                  (postKey this.selectedActionSheetComment)
                }}
                {{on
                  "click"
                  (fn this.deleteComment this.selectedActionSheetComment)
                }}
              >
                {{dIcon "trash-can"}}
                <span>{{i18n "video_shorts.comments.delete"}}</span>
              </button>
            {{/if}}
          </div>
        {{/if}}
      {{/if}}

      {{#if this.currentUser}}
        {{#if this.commentReplyPostId}}
          <button
            type="button"
            class="video-shorts-comments-surface__reply-dialog-backdrop"
            aria-label={{i18n "video_shorts.comments.cancel"}}
            {{on "click" this.cancelCommentReply}}
          ></button>

        <div
          class="video-shorts-comments-surface__reply-dialog"
          data-video-shorts-comment-reply-dialog
          role="dialog"
          aria-modal="false"
          aria-label={{this.commentReplyDialogLabel}}
        >
          <form
            class="video-shorts-comments-surface__reply-form"
            {{on "submit" this.publishActiveReply}}
            {{on "focusout" this.deactivateComposerOnFocusOut}}
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
                  placeholder={{this.commentReplyPlaceholder}}
                  {{this.focusInput}}
                  {{on "focus" this.focusCommentReplyInput}}
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

                {{#if this.commentReplyActionsVisible}}
                  <div
                    class="video-shorts-comments-surface__form-actions"
                    data-video-shorts-comment-reply-actions
                  >
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
                {{/if}}
              </div>
            </div>
          </form>
        </div>
        {{/if}}
      {{/if}}
    </div>
  </template>
}
