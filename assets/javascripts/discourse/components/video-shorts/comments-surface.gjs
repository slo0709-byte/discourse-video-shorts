import Component from "@glimmer/component";
import { tracked } from "@glimmer/tracking";
import { isDestroyed, isDestroying } from "@ember/destroyable";
import { fn } from "@ember/helper";
import { on } from "@ember/modifier";
import { action } from "@ember/object";
import { getOwner } from "@ember/owner";
import { scheduleOnce } from "@ember/runloop";
import { service } from "@ember/service";
import { modifier } from "ember-modifier";
import AnonymousFlagModal from "discourse/components/modal/anonymous-flag";
import FlagModal from "discourse/components/modal/flag";
import HistoryModal from "discourse/components/modal/history";
import { popupAjaxError } from "discourse/lib/ajax-error";
import PostFlag from "discourse/lib/flag-targets/post-flag";
import { i18n } from "discourse-i18n";
import NativeComment from "discourse/plugins/discourse-video-shorts/discourse/components/video-shorts/native-comment";
import {
  fetchVideoShortsComment,
  updateVideoShortsComment,
} from "discourse/plugins/discourse-video-shorts/discourse/lib/video-shorts-comment-actions";
import {
  fetchVideoShortsComments,
  fetchVideoShortsReplyBranch,
  normalizeComment,
} from "discourse/plugins/discourse-video-shorts/discourse/lib/video-shorts-comments";
import { videoShortsNativePost } from "discourse/plugins/discourse-video-shorts/discourse/lib/video-shorts-native-post";
import { createVideoShortsNativeTopic } from "discourse/plugins/discourse-video-shorts/discourse/lib/video-shorts-native-topic";
import {
  createVideoShortsRealtimeCommentsLedger,
  gateVideoShortsRealtimeComment,
} from "discourse/plugins/discourse-video-shorts/discourse/lib/video-shorts-realtime-comments";
import {
  createVideoShortsReply,
  videoShortsReplyErrorMessage,
} from "discourse/plugins/discourse-video-shorts/discourse/lib/video-shorts-reply";
import { videoShortsAccentStyle } from "discourse/plugins/discourse-video-shorts/discourse/lib/video-shorts-visual-accent";

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

const NativeCommentRow = <template>
  <li
    class="video-shorts-comments-surface__comment video-shorts-comments-surface__comment--native"
    data-post-id={{@comment.post_id}}
    data-post-number={{@comment.post_number}}
  >
    {{#if (@surface.isEditingComment @comment)}}
      <form
        class="video-shorts-comments-surface__reply-editor video-shorts-comments-surface__edit-editor"
        data-video-shorts-edit-editor
        data-video-shorts-inline-editor
        data-post-id={{@comment.post_id}}
        data-depth={{@depth}}
        aria-label={{i18n "video_shorts.comments.edit"}}
        {{on "submit" @surface.saveEdit}}
      >
        {{#if @surface.editLoading}}
          <div
            class="video-shorts-comments-surface__edit-loading"
            data-video-shorts-edit-loading
          >
            {{i18n "video_shorts.comments.loading"}}
          </div>
        {{else}}
          <textarea
            data-video-shorts-edit-input
            value={{@surface.editText}}
            disabled={{@surface.editSubmitting}}
            placeholder={{i18n "video_shorts.comments.edit_placeholder"}}
            {{@surface.focusInput}}
            {{on "input" @surface.updateEditText}}
          ></textarea>
        {{/if}}

        {{#if @surface.editError}}
          <p
            class="video-shorts-comments-surface__reply-error"
            data-video-shorts-edit-error
            role="alert"
          >
            {{@surface.editError}}
          </p>
        {{/if}}

        <div class="video-shorts-comments-surface__reply-editor-actions">
          <button
            type="button"
            class="btn-flat"
            data-video-shorts-edit-cancel
            disabled={{@surface.editSubmitting}}
            {{on "click" @surface.cancelEdit}}
          >
            {{i18n "video_shorts.comments.cancel"}}
          </button>
          <button
            type="submit"
            class="btn btn-primary"
            data-video-shorts-edit-save
            disabled={{@surface.editSubmitDisabled}}
          >
            {{if
              @surface.editSubmitting
              (i18n "video_shorts.comments.saving")
              (i18n "video_shorts.comments.save")
            }}
          </button>
        </div>
      </form>
    {{else}}
      {{#let (@surface.nativePostFor @comment) as |post|}}
        {{#if post}}
          <NativeComment
            @post={{post}}
            @depth={{@depth}}
            @canCreatePost={{@surface.canUseNativeReply}}
            @deletePost={{@surface.deleteNativePost}}
            @editPost={{@surface.editNativePost}}
            @recoverPost={{@surface.recoverNativePost}}
            @replyToPost={{@surface.replyToNativePost}}
            @showFlags={{@surface.showNativeFlags}}
            @showHistory={{@surface.showNativeHistory}}
            @showLogin={{@surface.showLogin}}
            @toggleBranch={{fn @surface.loadReplyBranch @comment}}
          >
            <CommentBranchControls @comment={{@comment}} @surface={{@surface}} />
          </NativeComment>
        {{/if}}
      {{/let}}

      {{#if (@surface.isReplyingToComment @comment)}}
        <form
          class="video-shorts-comments-surface__reply-editor video-shorts-comments-surface__edit-editor video-shorts-comments-surface__inline-reply-editor"
          data-video-shorts-inline-editor
          data-video-shorts-inline-reply-editor
          data-video-shorts-reply-editor
          data-reply-kind="nested"
          data-post-id={{@comment.post_id}}
          data-depth={{@depth}}
          aria-label={{i18n "video_shorts.comments.reply"}}
          {{on "submit" @surface.publishCommentReply}}
        >
          <textarea
            data-video-shorts-reply-input
            data-target-post-id={{@surface.commentReplyPostId}}
            value={{@surface.commentReplyText}}
            disabled={{@surface.commentReplySubmitting}}
            placeholder={{i18n "video_shorts.comments.reply"}}
            {{@surface.focusInput}}
            {{on "input" @surface.updateCommentReplyText}}
          ></textarea>
          {{#if @surface.commentReplyError}}
            <p
              class="video-shorts-comments-surface__reply-error"
              role="alert"
            >
              {{@surface.commentReplyError}}
            </p>
          {{/if}}
          <div class="video-shorts-comments-surface__reply-editor-actions">
            <button
              type="button"
              class="btn-flat"
              data-video-shorts-reply-cancel
              {{on "click" @surface.cancelReply}}
            >
              {{i18n "video_shorts.comments.cancel"}}
            </button>
            <button
              type="submit"
              class="btn btn-primary"
              data-video-shorts-reply-submit
              disabled={{@surface.commentReplySubmitDisabled}}
            >
              {{i18n "video_shorts.comments.publish"}}
            </button>
          </div>
        </form>
      {{/if}}
    {{/if}}
  </li>
</template>;

export default class VideoShortsCommentsSurface extends Component {
  @service appEvents;
  @service currentUser;
  @service dialog;
  @service messageBus;
  @service modal;
  @service store;

  @tracked comments = [];
  @tracked loading = true;
  @tracked loadingMore = false;
  @tracked error = null;
  @tracked hasMore = false;
  @tracked nextAfter = null;
  @tracked childRepliesByPostId = {};
  @tracked expandedReplyPostIds = {};
  @tracked loadingReplyPostIds = {};
  @tracked replyErrorsByPostId = {};
  @tracked replyPaginationByPostId = {};
  @tracked localReplyCount = null;
  @tracked hasDeletedPlaceholderContext = false;
  @tracked replyText = "";
  @tracked replyError = null;
  @tracked replySubmitting = false;
  @tracked topLevelReplyOpen = false;
  @tracked commentReplyPostId = null;
  @tracked commentReplyText = "";
  @tracked commentReplyError = null;
  @tracked commentReplySubmitting = false;
  @tracked editPostId = null;
  @tracked editText = "";
  @tracked editError = null;
  @tracked editLoading = false;
  @tracked editSubmitting = false;

  activePostId = null;
  loadToken = 0;
  loadingReplyPromisesByPostId = {};
  realtimeSubscriptionId = 0;
  realtimeDeletedPostIds = new Set();
  nativeTopicIdentity = null;
  nativeTopic = null;
  nativePostRecords = new Map();

  clearReplyFeedLock = modifier(() => {
    return () => {
      document.body.classList.remove("video-shorts-lightweight-composer-open");
    };
  });

  focusInput = modifier((element) => {
    queueMicrotask(() => {
      if (!isDestroying(this) && !isDestroyed(this)) {
        element.focus({ preventScroll: true });
      }
    });
  });

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
    this.resetReplyEditors();
    this.nativeTopicIdentity = null;
    this.nativeTopic = null;
    this.nativePostRecords = new Map();
    this.realtimeDeletedPostIds = new Set();
    this.hasDeletedPlaceholderContext = false;
    this.hasMore = false;
    this.nextAfter = null;
    this.loadComments({ item });
  });

  realtimeForItem = modifier(
    (
      element,
      [topicIdValue, postId, postNumber, topicUrl, lastMessageId]
    ) => {
      const topicId = Number(topicIdValue);

      if (!Number.isSafeInteger(topicId) || topicId <= 0) {
        return;
      }

      const channel = `/topic/${topicId}`;
      const subscription = {
        active: true,
        id: ++this.realtimeSubscriptionId,
        itemIdentity: [topicId, postId, postNumber, topicUrl].join(":"),
        ledger: createVideoShortsRealtimeCommentsLedger(),
      };
      const callback = (data, globalId, messageId) => {
        return this.handleRealtimeComment(
          subscription,
          data,
          globalId,
          messageId
        );
      };

      this.messageBus.subscribe(channel, callback, lastMessageId);

      return () => {
        subscription.active = false;
        this.messageBus.unsubscribe(channel, callback);
      };
    }
  );

  syncReplyCount = modifier((_element, [replyCount]) => {
    const count = Number(replyCount);

    if (Number.isFinite(count) && count >= 0) {
      scheduleOnce("afterRender", this, this.applySyncedReplyCount, count);
    }
  });

  refreshOnReconnect = modifier(() => {
    const refresh = () => this.loadComments({ item: this.item });

    window.addEventListener("online", refresh);

    return () => window.removeEventListener("online", refresh);
  });

  reconcileNativeComposerEdits = modifier(() => {
    const eventName = "video-shorts:native-post-edited";

    this.appEvents.on(eventName, this, this.applyNativeComposerEdit);

    return () => {
      this.appEvents.off(eventName, this, this.applyNativeComposerEdit);
    };
  });

  childRepliesFor = (comment) => {
    return this.childRepliesByPostId[postKey(comment)] || [];
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

  displayName = (post) => {
    return normalizeUsername(post);
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

  isEditingComment = (comment) => {
    return postKey(comment) === this.editPostId;
  };

  isReplyingToComment = (comment) => {
    return postKey(comment) === this.commentReplyPostId;
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
      this.replyPaginationFor(comment).hasMore
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

  nativeTopicRecordFor = () => {
    const identity = this.currentItemIdentity();

    if (!this.nativeTopic || this.nativeTopicIdentity !== identity) {
      this.nativeTopic = createVideoShortsNativeTopic(this.item, this.store);
      this.nativeTopicIdentity = identity;
    }

    return this.nativeTopic;
  };

  nativePostFor = (comment, { suppressEmbeddedReplies = true } = {}) => {
    try {
      return videoShortsNativePost({
        comment: suppressEmbeddedReplies
          ? { ...comment, reply_count: 0 }
          : comment,
        item: this.item,
        topic: this.nativeTopicRecordFor(),
        store: this.store,
        records: this.nativePostRecords,
      });
    } catch {
      return null;
    }
  };

  applyNativeComposerEdit = (serverPost) => {
    if (isDestroying(this) || isDestroyed(this)) {
      return;
    }

    const normalized = normalizeComment(serverPost);

    if (this.findCommentByPostId(normalized.post_id)) {
      this.replaceComment(normalized);
    }
  };

  nativeSourcePostFor = () => {
    return this.nativePostFor(
      {
        id: this.item.post_id,
        post_id: this.item.post_id,
        post_number: this.item.post_number,
        topic_id: this.item.topic_id,
        user_id: this.item.user_id,
        username: this.item.username,
        name: this.item.name,
        avatar_template: this.item.avatar_template,
        cooked: this.item.excerpt || "",
        raw: "",
        created_at: this.item.created_at,
        reply_count: this.sourceReplyCount(),
        post_url: this.item.post_url,
        actions_summary: this.item.native_action_summary || [],
        can_edit: false,
        can_delete: false,
        can_flag: Boolean(this.item.actions?.can_flag),
      },
      { suppressEmbeddedReplies: false }
    );
  };

  applySyncedReplyCount(count) {
    if (
      !isDestroying(this) &&
      !isDestroyed(this) &&
      count !== this.localReplyCount
    ) {
      this.localReplyCount = count;
    }
  }

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

  get canUseNativeReply() {
    return !this.currentUser || this.canCreatePost;
  }

  get commentsAccentStyle() {
    return videoShortsAccentStyle(this.item);
  }

  get canCreatePost() {
    return Boolean(this.currentUser && this.item?.actions?.can_reply);
  }

  async loadComments({ append = false, item = this.item } = {}) {
    const token = append ? this.loadToken : ++this.loadToken;
    const commentsAtRequestStart = append
      ? null
      : new Map(this.comments.map((comment) => [postKey(comment), comment]));

    try {
      this.error = null;
      this.loading = !append;
      this.loadingMore = append;

      const response = await fetchVideoShortsComments({
        postId: item.post_id,
        after: append ? this.nextAfter : null,
        endpoint: item.comments_endpoint,
      });

      if (this.isStale(token)) {
        return;
      }

      const comments = this.commentsWithoutLoadedChildren(
        response.comments.filter(
          (comment) => !this.realtimeDeletedPostIds.has(postKey(comment))
        )
      );

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

      if (append) {
        this.comments = [...this.comments, ...deduped];
      } else {
        const commentsNow = new Map(
          this.comments.map((comment) => [postKey(comment), comment])
        );
        const removedDuringRequest = new Set(
          [...commentsAtRequestStart.keys()].filter((key) => !commentsNow.has(key))
        );
        const changedDuringRequest = new Map(
          [...commentsNow].filter(
            ([key, comment]) => commentsAtRequestStart.get(key) !== comment
          )
        );
        const responseKeys = new Set(deduped.map((comment) => postKey(comment)));
        const responseComments = deduped
          .filter((comment) => !removedDuringRequest.has(postKey(comment)))
          .map((comment) => changedDuringRequest.get(postKey(comment)) || comment);
        const realtimeAdditions = [...changedDuringRequest]
          .filter(([key]) => !responseKeys.has(key))
          .map(([, comment]) => comment);

        this.comments = [...realtimeAdditions, ...responseComments];
      }
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

  isStaleRealtime(subscription, event) {
    const postState = subscription.ledger.posts[event.postId];

    return (
      !subscription.active ||
      subscription.id !== this.realtimeSubscriptionId ||
      subscription.itemIdentity !== this.currentItemIdentity() ||
      postState?.lastMessageId !== event.messageId ||
      postState?.tombstone === true ||
      isDestroying(this) ||
      isDestroyed(this)
    );
  }

  isStaleRealtimeDeletion(subscription, event) {
    const postState = subscription.ledger.posts[event.postId];

    return (
      !subscription.active ||
      subscription.id !== this.realtimeSubscriptionId ||
      subscription.itemIdentity !== this.currentItemIdentity() ||
      postState?.lastMessageId !== event.messageId ||
      postState?.tombstone !== true ||
      isDestroying(this) ||
      isDestroyed(this)
    );
  }

  async handleRealtimeComment(subscription, data, globalId, messageId) {
    if (
      !subscription.active ||
      subscription.id !== this.realtimeSubscriptionId ||
      subscription.itemIdentity !== this.currentItemIdentity()
    ) {
      return;
    }

    const previousPostState = subscription.ledger.posts[data?.id];
    const gated = gateVideoShortsRealtimeComment(
      subscription.ledger,
      data,
      globalId,
      messageId
    );

    subscription.ledger = gated.ledger;

    if (!gated.accepted) {
      return;
    }

    const event = gated.event;

    if (event.type === "deleted" || event.type === "destroyed") {
      this.realtimeDeletedPostIds = new Set([
        ...this.realtimeDeletedPostIds,
        String(event.postId),
      ]);
      const loadedComment = this.findCommentByPostId(event.postId);

      if (loadedComment) {
        const snapshot = await this.childrenSnapshotForDelete(loadedComment);

        if (this.isStaleRealtimeDeletion(subscription, event)) {
          return;
        }

        const currentComment = this.findCommentByPostId(event.postId);

        if (!currentComment) {
          return;
        }

        this.removeComment(currentComment, {
          adjustCount: false,
          childrenSnapshot: snapshot.children,
          preserveUnknownReplies: true,
          replyPagination: snapshot.pagination,
        });
      }

      return;
    }

    if (event.type === "created" || event.type === "recovered") {
      const nextDeletedPostIds = new Set(this.realtimeDeletedPostIds);
      nextDeletedPostIds.delete(String(event.postId));
      this.realtimeDeletedPostIds = nextDeletedPostIds;
    }

    if (
      event.type === "revised" &&
      !previousPostState &&
      !this.findCommentByPostId(event.postId)
    ) {
      return;
    }

    return this.fetchAndApplyRealtimeComment(subscription, event);
  }

  async fetchAndApplyRealtimeComment(subscription, event) {
    try {
      const canonicalPost = await fetchVideoShortsComment(event.postId);

      if (
        this.isStaleRealtime(subscription, event) ||
        !this.hasRenderablePostData(canonicalPost)
      ) {
        return;
      }

      if (this.replaceComment(canonicalPost)) {
        return;
      }

      const sourcePostNumber = Number(this.item?.post_number || 0);
      const replyToPostNumber = Number(
        canonicalPost?.reply_to_post_number || 0
      );

      const isDirectReply =
        sourcePostNumber &&
        (replyToPostNumber === sourcePostNumber ||
          (!replyToPostNumber && sourcePostNumber === 1));

      if (isDirectReply) {
        this.prependComment(canonicalPost);
        return;
      }

      const parent = this.findCommentByPostNumber(replyToPostNumber);

      if (!parent) {
        return;
      }

      const displayParent = this.visualReplyHostFor(parent);

      if (
        !this.hasLoadedReplyBranch(displayParent) ||
        !this.hasExpandedReplies(displayParent)
      ) {
        return;
      }

      this.appendChildReply(parent, canonicalPost);
    } catch {
      // A later topic event or an explicit branch load can supply canonical data.
    }
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
        const response = await fetchVideoShortsReplyBranch({
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

  async refreshCommentsAfterMutation() {
    const deletedPlaceholders = this.deletedPlaceholdersForRefresh();

    await this.loadComments({ item: this.item });
    this.restoreDeletedPlaceholders(deletedPlaceholders);

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
    const replyCount = Number(comment?.reply_count || 0);
    const pagination = this.replyPaginationFor(comment);
    const hasCompleteLocalBranch =
      this.hasLoadedReplyBranch(comment) &&
      !pagination.hasMore &&
      currentChildren.length >= replyCount;

    if (!replyCount || hasCompleteLocalBranch) {
      return { children: currentChildren, pagination };
    }

    try {
      const response = await fetchVideoShortsReplyBranch({
        postId: comment.post_id,
      });

      const children = this.uniqueReplies([
        ...this.commentsWithoutLoadedChildren(response.comments),
        ...currentChildren,
        ...this.loadedFlatChildrenFor(comment),
      ]);

      return {
        children,
        pagination: {
          hasMore: response.hasMore,
          nextAfter: response.nextAfter,
        },
      };
    } catch {
      return { children: currentChildren, pagination };
    }
  }

  emitCommentMutation(mutation) {
    const mutationWithSource = {
      ...mutation,
      sourcePostId: mutation.sourcePostId || this.item?.post_id,
    };

    this.args.onCommentMutation?.(mutationWithSource);
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

      videoShortsNativePost({
        comment: { ...updatedComment, reply_count: 0 },
        item: this.item,
        topic: this.nativeTopicRecordFor(),
        store: this.store,
        records: this.nativePostRecords,
      });
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

          if (
            !children.length &&
            !(
              options.preserveUnknownReplies &&
              Number(comment?.reply_count || 0) > 0
            )
          ) {
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

      if (options.replyPagination) {
        this.replyPaginationByPostId = {
          ...this.replyPaginationByPostId,
          [targetKey]: options.replyPagination,
        };
      }
    }

    if (countDelta === 0) {
      countDelta = -1;
    }

    return {
      type: "delete",
      post,
      countDelta,
      replyCountValue:
        options.adjustCount === false
          ? null
          : this.replyCountValueAfterDelta(countDelta),
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

  prependComment(comment) {
    if (this.comments.some((existing) => postKey(existing) === postKey(comment))) {
      return;
    }

    this.comments = [comment, ...this.comments];
  }

  resetReplyEditors() {
    this.replyText = "";
    this.replyError = null;
    this.replySubmitting = false;
    this.topLevelReplyOpen = false;
    this.commentReplyPostId = null;
    this.commentReplyText = "";
    this.commentReplyError = null;
    this.commentReplySubmitting = false;
    this.editPostId = null;
    this.editText = "";
    this.editError = null;
    this.editLoading = false;
    this.editSubmitting = false;
    document.body.classList.remove("video-shorts-lightweight-composer-open");
  }

  emitCreatedComment(post) {
    this.emitCommentMutation({
      type: "create",
      post,
      countDelta: 0,
      replyCountValue: null,
    });
  }

  get selectedReplyTarget() {
    return this.findCommentByPostId(this.commentReplyPostId);
  }

  get replySubmitDisabled() {
    return this.replySubmitting || !this.replyText.trim();
  }

  get commentReplySubmitDisabled() {
    return this.commentReplySubmitting || !this.commentReplyText.trim();
  }

  get editSubmitDisabled() {
    return (
      this.editLoading || this.editSubmitting || !this.editText.trim()
    );
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
  updateEditText(event) {
    this.editText = event.target.value;
    this.editError = null;
  }

  @action
  cancelReply() {
    this.resetReplyEditors();
  }

  @action
  cancelEdit() {
    this.resetReplyEditors();
  }

  @action
  openNativeTopLevelReply() {
    if (!this.currentUser) {
      return this.showLogin();
    }

    this.resetReplyEditors();
    this.topLevelReplyOpen = true;
    document.body.classList.add("video-shorts-lightweight-composer-open");
  }

  @action
  replyToNativePost(post) {
    if (!this.currentUser) {
      return this.showLogin();
    }

    const target = this.findCommentByPostId(post?.id);
    if (!target) {
      return false;
    }

    this.resetReplyEditors();
    this.commentReplyPostId = postKey(target);
    document.body.classList.add("video-shorts-lightweight-composer-open");
  }

  @action
  async publishReply(event) {
    event?.preventDefault();
    const raw = this.replyText.trim();
    if (!raw) {
      this.replyError = i18n("video_shorts.comments.reply_empty");
      return;
    }

    const token = this.loadToken;
    const itemIdentity = this.currentItemIdentity();
    this.replySubmitting = true;
    this.replyError = null;
    try {
      const result = await createVideoShortsReply({
        item: this.item,
        raw,
        replyToPostNumber:
          Number(this.item?.post_number) > 1 ? this.item.post_number : null,
      });
      if (this.isStale(token, itemIdentity)) {
        return;
      }
      if (this.hasRenderablePostData(result.post)) {
        this.prependComment(result.post);
        this.emitCreatedComment(result.post);
      } else if (result.action !== "enqueued") {
        await this.refreshCommentsAfterMutation();
      }
      this.resetReplyEditors();
    } catch (error) {
      if (!this.isStale(token, itemIdentity)) {
        this.replyError = videoShortsReplyErrorMessage(error);
      }
    } finally {
      if (!this.isStale(token, itemIdentity)) {
        this.replySubmitting = false;
      }
    }
  }

  @action
  async publishCommentReply(event) {
    event?.preventDefault();
    const target = this.selectedReplyTarget;
    const raw = this.commentReplyText.trim();
    if (!target) {
      this.commentReplyError = i18n("video_shorts.comments.reply_target_missing");
      return;
    }
    if (!raw) {
      this.commentReplyError = i18n("video_shorts.comments.reply_empty");
      return;
    }

    const token = this.loadToken;
    const itemIdentity = this.currentItemIdentity();
    this.commentReplySubmitting = true;
    this.commentReplyError = null;
    try {
      const result = await createVideoShortsReply({
        item: this.item,
        raw,
        replyToPostNumber: target.post_number,
      });
      if (this.isStale(token, itemIdentity)) {
        return;
      }
      if (this.hasRenderablePostData(result.post)) {
        this.appendChildReply(target, result.post);
        this.emitCreatedComment(result.post);
      } else if (result.action !== "enqueued") {
        await this.refreshCommentsAfterMutation();
      }
      this.resetReplyEditors();
    } catch (error) {
      if (!this.isStale(token, itemIdentity)) {
        this.commentReplyError = videoShortsReplyErrorMessage(error);
      }
    } finally {
      if (!this.isStale(token, itemIdentity)) {
        this.commentReplySubmitting = false;
      }
    }
  }

  @action
  async editNativePost(post) {
    this.resetReplyEditors();

    if (!this.currentUser) {
      return this.showLogin();
    }

    if (!post?.can_edit) {
      return false;
    }

    const postId = postKey(post);
    const target = this.findCommentByPostId(postId);
    const token = this.loadToken;
    const itemIdentity = this.currentItemIdentity();

    this.editPostId = postId;
    this.editText = target?.raw || post.raw || "";
    this.editError = null;
    this.editLoading = true;
    document.body.classList.add("video-shorts-lightweight-composer-open");

    try {
      const freshComment = await fetchVideoShortsComment(postId);

      if (
        this.isStale(token, itemIdentity) ||
        this.editPostId !== postId
      ) {
        return false;
      }

      this.editText = freshComment.raw;
    } catch {
      if (
        !this.isStale(token, itemIdentity) &&
        this.editPostId === postId
      ) {
        this.editError = i18n("video_shorts.comments.edit_load_error");
      }
    } finally {
      if (
        !this.isStale(token, itemIdentity) &&
        this.editPostId === postId
      ) {
        this.editLoading = false;
      }
    }

    return false;
  }

  @action
  async saveEdit(event) {
    event?.preventDefault();

    const postId = this.editPostId;
    const raw = this.editText.trim();

    if (!postId) {
      return;
    }

    if (!raw) {
      this.editError = i18n("video_shorts.comments.edit_empty");
      return;
    }

    const token = this.loadToken;
    const itemIdentity = this.currentItemIdentity();

    this.editSubmitting = true;
    this.editError = null;

    try {
      const updatedComment = await updateVideoShortsComment({ postId, raw });

      if (
        this.isStale(token, itemIdentity) ||
        this.editPostId !== postId
      ) {
        return;
      }

      if (!this.replaceComment(updatedComment)) {
        await this.refreshCommentsAfterMutation();
      }

      this.resetReplyEditors();
    } catch {
      if (
        !this.isStale(token, itemIdentity) &&
        this.editPostId === postId
      ) {
        this.editError = i18n("video_shorts.comments.edit_save_error");
      }
    } finally {
      if (
        !this.isStale(token, itemIdentity) &&
        this.editPostId === postId
      ) {
        this.editSubmitting = false;
      }
    }
  }

  @action
  showNativeFlags(post) {
    this.modal.show(this.currentUser ? FlagModal : AnonymousFlagModal, {
      model: {
        flagTarget: new PostFlag(),
        flagModel: post,
        setHidden: () => post.set("hidden", true),
      },
    });
  }

  @action
  showNativeHistory(post, revision) {
    this.modal.show(HistoryModal, {
      model: {
        postId: post.id,
        postVersion: revision || "latest",
        post,
        editPost: this.editNativePost,
      },
    });
  }

  @action
  recoverNativePost(post) {
    return post.recover().then(() => {
      return this.refreshCommentsAfterMutation();
    });
  }

  @action
  deleteNativePost(post) {
    if (!post?.can_delete || !this.currentUser) {
      return false;
    }

    this.dialog.yesNoConfirm({
      message: i18n("post.confirm_delete"),
      didConfirm: async () => {
        const comment = this.findCommentByPostId(post.id);
        const snapshot = comment
          ? await this.childrenSnapshotForDelete(comment)
          : { children: [], pagination: null };

        try {
          await post.destroy(this.currentUser);

          if (comment) {
            const mutation = this.removeComment(comment, {
              childrenSnapshot: snapshot.children,
              replyPagination: snapshot.pagination,
            });
            this.emitCommentMutation(mutation);
          } else {
            await this.refreshCommentsAfterMutation();
          }
        } catch (error) {
          post.undoDeleteState();
          popupAjaxError(error);
        }
      },
    });
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

  <template>
    <div
      class="video-shorts-comments-surface"
      style={{this.commentsAccentStyle}}
      data-comments-post-id={{@item.post_id}}
      data-video-shorts-youtube-comments
      {{this.loadForItem @item}}
      {{this.realtimeForItem
        @item.topic_id
        @item.post_id
        @item.post_number
        @item.topic_url
        @item.message_bus_last_id
      }}
      {{this.syncReplyCount @replyCount}}
      {{this.refreshOnReconnect}}
      {{this.reconcileNativeComposerEdits}}
      {{this.clearReplyFeedLock}}
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
        {{#if this.canUseNativeReply}}
          <div class="video-shorts-comments-surface__native-toolbar">
            {{#if this.topLevelReplyOpen}}
              <form
                class="video-shorts-comments-surface__reply-editor"
                data-video-shorts-reply-editor
                data-reply-kind="top-level"
                {{on "submit" this.publishReply}}
              >
                <textarea
                  data-video-shorts-reply-input
                  value={{this.replyText}}
                  disabled={{this.replySubmitting}}
                  placeholder={{i18n "video_shorts.comments.reply"}}
                  {{this.focusInput}}
                  {{on "input" this.updateReplyText}}
                ></textarea>
                {{#if this.replyError}}
                  <p class="video-shorts-comments-surface__reply-error" role="alert">{{this.replyError}}</p>
                {{/if}}
                <div class="video-shorts-comments-surface__reply-editor-actions">
                  <button type="button" class="btn-flat" data-video-shorts-reply-cancel {{on "click" this.cancelReply}}>
                    {{i18n "video_shorts.comments.cancel"}}
                  </button>
                  <button type="submit" class="btn btn-primary" data-video-shorts-reply-submit disabled={{this.replySubmitDisabled}}>
                    {{i18n "video_shorts.comments.publish"}}
                  </button>
                </div>
              </form>
            {{else}}
              <button
                type="button"
                class="video-shorts-comments-surface__composer-entry"
                data-action="native-top-level-reply"
                data-video-shorts-top-level-composer-entry
                {{on "click" this.openNativeTopLevelReply}}
              >
                <span class="video-shorts-comments-surface__composer-placeholder">
                  {{i18n "video_shorts.comments.add_comment"}}
                </span>
              </button>
            {{/if}}
          </div>
        {{/if}}

        <ol
          class="video-shorts-comments-surface__list video-shorts-comments-surface__list--native"
          data-video-shorts-youtube-thread-list
        >
          {{#each this.comments as |comment|}}
            <NativeCommentRow
              @comment={{comment}}
              @depth={{0}}
              @surface={{this}}
            />

            {{#if (this.hasExpandedReplies comment)}}
              {{#each (this.visualRepliesFor comment) as |reply|}}
                <NativeCommentRow
                  @comment={{reply}}
                  @depth={{1}}
                  @surface={{this}}
                />
              {{/each}}
            {{/if}}
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
    </div>
  </template>
}
