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
import { getAbsoluteURL } from "discourse/lib/get-url";
import { userPath } from "discourse/lib/url";
import { clipboardCopy } from "discourse/lib/utilities";
import { eq, not, or } from "discourse/truth-helpers";
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

function postKey(post) {
  return String(post?.post_id || post?.id || "");
}

function normalizeUsername(post) {
  return post?.username || post?.name || "";
}

function replyToUsername(post) {
  return (
    post?.reply_to_user?.username ||
    post?.reply_to_username ||
    post?.reply_to_user_username ||
    null
  );
}

function rawWithReplyTargetMention(raw, username) {
  const trimmed = raw.trim();

  if (!username) {
    return trimmed;
  }

  const mention = `@${username}`;
  const existingMention = new RegExp(`^@${username}(\\s|$)`);

  return existingMention.test(trimmed) ? trimmed : `${mention} ${trimmed}`;
}

export default class VideoShortsCommentsSurface extends Component {
  @service currentUser;
  @service dialog;
  @service modal;

  @tracked comments = [];
  @tracked loading = true;
  @tracked loadingMore = false;
  @tracked error = null;
  @tracked hasMore = false;
  @tracked nextAfter = null;

  @tracked replyOpen = false;
  @tracked replyText = "";
  @tracked replyError = null;
  @tracked replyNotice = null;
  @tracked replySubmitting = false;

  @tracked commentReplyPostId = null;
  @tracked commentReplyParentPostId = null;
  @tracked commentReplyText = "";
  @tracked commentReplyError = null;
  @tracked commentReplyNotice = null;
  @tracked commentReplySubmitting = false;

  @tracked editingPostId = null;
  @tracked editingText = "";
  @tracked editingError = null;
  @tracked editingSubmitting = false;

  @tracked deletingPostId = null;
  @tracked openToolsPostId = null;
  @tracked highlightedPostId = null;
  @tracked childRepliesByPostId = {};

  activePostId = null;
  loadToken = 0;

  loadForItem = modifier((element, [item]) => {
    if (!item || item.post_id === this.activePostId) {
      return;
    }

    this.activePostId = item.post_id;
    this.comments = [];
    this.childRepliesByPostId = {};
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

  childRepliesFor = (comment) => {
    return (
      this.childRepliesByPostId[postKey(comment)] ||
      comment.replies ||
      []
    );
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

  replyTargetFor = (post) => {
    return replyToUsername(post);
  };

  shouldShowReplyTarget = (post) => {
    const username = this.replyTargetFor(post);

    if (!username) {
      return false;
    }

    const raw = post?.raw?.trim() || "";
    const cooked = post?.cooked?.replace(/<[^>]+>/g, " ").trim() || "";
    const mentionPattern = new RegExp(`^@${username}\\b`, "i");

    return !mentionPattern.test(raw) && !mentionPattern.test(cooked);
  };

  replyTargetPath = (post) => {
    const username = this.replyTargetFor(post);

    return username ? userPath(username) : null;
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

get item() {
    return this.args.item;
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

  get commentReplyStatus() {
    if (!this.selectedReplyUsername) {
      return null;
    }

    return i18n("video_shorts.comments.replying_to", {
      username: this.selectedReplyUsername,
    });
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

      const existingIds = new Set(this.comments.map((comment) => comment.id));
      const deduped = comments.filter((comment) => !existingIds.has(comment.id));

      this.comments = append ? [...this.comments, ...deduped] : deduped;
      this.hasMore = response.hasMore;
      this.nextAfter = response.nextAfter;
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
        if (comment.replies?.length || !comment.reply_count) {
          return comment;
        }

        const response = await fetchVideoShortsComments({
          postId: comment.post_id,
        });

        return this.isStale(token)
          ? comment
          : { ...comment, replies: response.comments };
      })
    );

    return loaded;
  }

  isStale(token) {
    return isDestroying(this) || isDestroyed(this) || token !== this.loadToken;
  }

  

  








findCommentByPostId(postId) {
    const targetKey = String(postId || "");

    for (const comment of this.comments) {
      if (postKey(comment) === targetKey) {
        return comment;
      }

      const child = this.childRepliesFor(comment).find((reply) => {
        return postKey(reply) === targetKey;
      });

      if (child) {
        return child;
      }
    }

    return null;
  }

  parentForPostId(postId) {
    const targetKey = String(postId || "");

    for (const comment of this.comments) {
      if (postKey(comment) === targetKey) {
        return comment;
      }

      if (
        this.childRepliesFor(comment).some((reply) => postKey(reply) === targetKey)
      ) {
        return comment;
      }
    }

    return null;
  }

  appendChildReply(parentComment, childReply) {
    const parentKey = postKey(parentComment);
    const currentChildren = this.childRepliesFor(parentComment);

    if (currentChildren.some((reply) => postKey(reply) === postKey(childReply))) {
      return;
    }

    const children = [...currentChildren, childReply];

    this.childRepliesByPostId = {
      ...this.childRepliesByPostId,
      [parentKey]: children,
    };
    this.comments = this.comments.map((comment) => {
      if (postKey(comment) !== parentKey) {
        return comment;
      }

      return {
        ...comment,
        reply_count: (comment.reply_count || 0) + 1,
        replies: children,
      };
    });
  }

  replaceComment(updatedComment) {
    const updatedKey = postKey(updatedComment);

    this.comments = this.comments.map((comment) => {
      if (postKey(comment) === updatedKey) {
        return { ...comment, ...updatedComment };
      }

      const children = this.childRepliesFor(comment).map((reply) => {
        return postKey(reply) === updatedKey ? { ...reply, ...updatedComment } : reply;
      });

      return { ...comment, replies: children };
    });
  }

  removeComment(post) {
    const targetKey = postKey(post);

    this.comments = this.comments
      .map((comment) => {
        if (postKey(comment) === targetKey) {
          return this.childRepliesFor(comment).length
            ? {
                ...comment,
                cooked: `<p>${i18n("video_shorts.comments.deleted_placeholder")}</p>`,
                raw: "",
                can_edit: false,
                can_delete: false,
              }
            : null;
        }

        const children = this.childRepliesFor(comment).filter((reply) => {
          return postKey(reply) !== targetKey;
        });

        return {
          ...comment,
          reply_count: children.length,
          replies: children,
        };
      })
      .filter(Boolean);
  }

  

  

  

  

  

  

  

  

  

  resetReplyState() {
    this.replyOpen = false;
    this.replyText = "";
    this.replyError = null;
    this.replyNotice = null;
    this.replySubmitting = false;
  }

  resetCommentReplyState() {
    this.commentReplyPostId = null;
    this.commentReplyParentPostId = null;
    this.commentReplyText = "";
    this.commentReplyError = null;
    this.commentReplyNotice = null;
    this.commentReplySubmitting = false;
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

    this.openToolsPostId = null;
    this.replyOpen = true;
    this.replyError = null;
    this.replyNotice = null;
    this.resetCommentReplyState();
  }

  @action
  updateReplyText(event) {
    this.replyText = event.target.value;
  }

  @action
  cancelReply() {
    this.resetReplyState();
  }

  @action
  async publishReply(event) {
    event?.preventDefault();

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
      });

      const createdPost = result.post;

      if (createdPost) {
        this.comments = [...this.comments, createdPost];
        this.highlightedPostId = postKey(createdPost);
        this.args.onReplyPublished?.(createdPost);
        this.resetReplyState();
      } else if (result.action === "enqueued") {
        this.replyNotice = i18n("video_shorts.comments.reply_pending");
      }
    } catch (error) {
      this.replyError = videoShortsReplyErrorMessage(error);
    } finally {
      this.replySubmitting = false;
    }
  }

  @action
  openCommentReply(comment, parentComment = comment) {
    if (!this.currentUser) {
      return this.showLogin();
    }

    this.commentReplyPostId = postKey(comment);
    this.commentReplyParentPostId = postKey(parentComment);
    this.commentReplyText = "";
    this.commentReplyError = null;
    this.commentReplyNotice = null;
    this.openToolsPostId = null;
    this.replyOpen = false;
    this.resetEditingState();
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
  async publishCommentReply(event) {
    event?.preventDefault();

    const target = this.selectedReplyTarget;
    const parent = this.parentForPostId(this.commentReplyParentPostId);

    if (!target || !parent) {
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
        raw: rawWithReplyTargetMention(
          this.trimmedCommentReply,
          normalizeUsername(target)
        ),
        replyToPostNumber: target.post_number,
      });

      const createdPost = result.post;

      if (createdPost) {
        this.appendChildReply(parent, createdPost);
        this.highlightedPostId = postKey(createdPost);
        this.args.onReplyPublished?.(createdPost);
        this.resetCommentReplyState();
      } else if (result.action === "enqueued") {
        this.commentReplyNotice = i18n("video_shorts.comments.reply_pending");
      }
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
    this.resetCommentReplyState();
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

      this.replaceComment(updatedComment);
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
    this.openToolsPostId = null;

    this.modal.show(FlagModal, {
      model: {
        flagModel: {
          ...comment,
          id: comment.post_id,
          topic_id: this.item.topic_id,
        },
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

        try {
          await deleteVideoShortsComment(comment.post_id);
          this.removeComment(comment);
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
      data-comments-post-id={{@item.post_id}}
      {{this.loadForItem @item}}
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
        <ol class="video-shorts-comments-surface__list">
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
                      {{on "click" (fn this.openCommentReply comment comment)}}
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
                    <form
                      class="video-shorts-comments-surface__comment-reply-form"
                      {{on "submit" this.publishCommentReply}}
                    >
                      {{#if this.commentReplyStatus}}
                        <div
                          class="video-shorts-comments-surface__comment-reply-status"
                          data-video-shorts-comment-reply-status
                        >
                          {{this.commentReplyStatus}}
                          <button
                            type="button"
                            data-action="cancel-comment-reply"
                            aria-label={{i18n
                              "video_shorts.comments.cancel_reply_to"
                              username=this.selectedReplyUsername
                            }}
                            {{on "click" this.cancelCommentReply}}
                          >
                            {{dIcon "xmark"}}
                          </button>
                        </div>
                      {{/if}}

                      <textarea
                        data-video-shorts-comment-reply-input
                        value={{this.commentReplyText}}
                        disabled={{this.commentReplySubmitting}}
                        placeholder={{i18n
                          "video_shorts.comments.reply_to"
                          username=this.selectedReplyUsername
                        }}
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
                          data-video-shorts-comment-reply-notice
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
                          disabled={{or
                            this.commentReplySubmitting
                            (not this.trimmedCommentReply)
                          }}
                        >
                          {{if
                            this.commentReplySubmitting
                            (i18n "video_shorts.comments.publishing")
                            (i18n "video_shorts.comments.publish")
                          }}
                        </button>
                      </div>
                    </form>
                  {{/if}}

                  {{#if (this.childRepliesFor comment)}}
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
                            class="video-shorts-comments-surface__avatar-link"
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

                            {{#if (this.shouldShowReplyTarget childReply)}}
                              <a
                                class="video-shorts-comments-surface__reply-target"
                                data-video-shorts-reply-target
                                href={{this.replyTargetPath childReply}}
                                data-user-card={{this.replyTargetFor childReply}}
                              >
                                @{{this.replyTargetFor childReply}}
                              </a>
                            {{/if}}

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
                                {{on "click" (fn this.openCommentReply childReply comment)}}
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
                              <form
                                class="video-shorts-comments-surface__comment-reply-form"
                                {{on "submit" this.publishCommentReply}}
                              >
                                {{#if this.commentReplyStatus}}
                                  <div
                                    class="video-shorts-comments-surface__comment-reply-status"
                                    data-video-shorts-comment-reply-status
                                  >
                                    {{this.commentReplyStatus}}
                                    <button
                                      type="button"
                                      data-action="cancel-comment-reply"
                                      aria-label={{i18n
                                        "video_shorts.comments.cancel_reply_to"
                                        username=this.selectedReplyUsername
                                      }}
                                      {{on "click" this.cancelCommentReply}}
                                    >
                                      {{dIcon "xmark"}}
                                    </button>
                                  </div>
                                {{/if}}

                                <textarea
                                  data-video-shorts-comment-reply-input
                                  value={{this.commentReplyText}}
                                  disabled={{this.commentReplySubmitting}}
                                  placeholder={{i18n
                                    "video_shorts.comments.reply_to"
                                    username=this.selectedReplyUsername
                                  }}
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
                                    data-video-shorts-comment-reply-notice
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
                                    disabled={{or
                                      this.commentReplySubmitting
                                      (not this.trimmedCommentReply)
                                    }}
                                  >
                                    {{if
                                      this.commentReplySubmitting
                                      (i18n "video_shorts.comments.publishing")
                                      (i18n "video_shorts.comments.publish")
                                    }}
                                  </button>
                                </div>
                              </form>
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

      <div class="video-shorts-comments-surface__reply">
        {{#if this.replyOpen}}
          <form
            class="video-shorts-comments-surface__reply-input"
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
              <p class="video-shorts-comments-surface__reply-error" role="alert">
                {{this.replyError}}
              </p>
            {{/if}}
            {{#if this.replyNotice}}
              <p
                class="video-shorts-comments-surface__reply-notice"
                data-video-shorts-reply-notice
              >
                {{this.replyNotice}}
              </p>
            {{/if}}

            <div class="video-shorts-comments-surface__form-actions">
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
                disabled={{or this.replySubmitting (not this.trimmedReply)}}
              >
                {{if
                  this.replySubmitting
                  (i18n "video_shorts.comments.publishing")
                  (i18n "video_shorts.comments.publish")
                }}
              </button>
            </div>
          </form>
        {{else}}
          <button
            type="button"
            class="btn btn-flat video-shorts-comments-surface__reply-open"
            data-action="reply"
            {{on "click" this.openReply}}
          >
            {{dIcon "reply"}}
            <span>{{i18n "video_shorts.comments.reply"}}</span>
          </button>
        {{/if}}
      </div>
    </div>
  </template>
}
