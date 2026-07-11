import Component from "@glimmer/component";
import { tracked } from "@glimmer/tracking";
import { registerDestructor } from "@ember/destroyable";
import { action } from "@ember/object";
import { modifier } from "ember-modifier";
import DModal from "discourse/ui-kit/d-modal";
import { i18n } from "discourse-i18n";
import VideoShortsCommentsSurface from "discourse/plugins/discourse-video-shorts/discourse/components/video-shorts/comments-surface";

export default class VideoShortsCommentsSheet extends Component {
  @tracked replyCountValue = null;
  closed = false;

  lockMobileSheetViewport = modifier((element) => {
    const sheet = element.closest(".video-shorts-comments-sheet");
    const container = sheet?.querySelector(".d-modal__container");

    if (!sheet || !container) {
      return;
    }

    let rafId = null;

    const activeElementIsTextInput = () =>
      document.activeElement?.matches?.(
        "input, textarea, select, [contenteditable='true']"
      );

    const lockSheetRect = () => {
      rafId = null;
      const rect = container.getBoundingClientRect();

      if (
        !rect.width ||
        !rect.height ||
        rect.top >= window.innerHeight ||
        rect.bottom > window.innerHeight + 2 ||
        rect.bottom <= 0
      ) {
        rafId = requestAnimationFrame(lockSheetRect);
        return;
      }

      sheet.style.setProperty(
        "--video-shorts-comments-sheet-stable-top",
        `${rect.top}px`
      );
      sheet.style.setProperty(
        "--video-shorts-comments-sheet-stable-height",
        `${rect.height}px`
      );
      sheet.style.setProperty(
        "--video-shorts-comments-sheet-stable-bottom",
        "auto"
      );
    };

    const scheduleLockSheetRect = () => {
      if (activeElementIsTextInput()) {
        return;
      }

      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }

      rafId = requestAnimationFrame(lockSheetRect);
    };

    scheduleLockSheetRect();
    window.addEventListener("resize", scheduleLockSheetRect);
    window.visualViewport?.addEventListener("resize", scheduleLockSheetRect);

    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }

      window.removeEventListener("resize", scheduleLockSheetRect);
      window.visualViewport?.removeEventListener(
        "resize",
        scheduleLockSheetRect
      );
      sheet.style.removeProperty("--video-shorts-comments-sheet-stable-top");
      sheet.style.removeProperty("--video-shorts-comments-sheet-stable-height");
      sheet.style.removeProperty("--video-shorts-comments-sheet-stable-bottom");
    };
  });

  constructor() {
    super(...arguments);
    registerDestructor(this, () => this.closeOnce());
  }

  get item() {
    return this.args.model?.item;
  }

  get replyCount() {
    return this.replyCountValue ?? this.item?.counts?.reply_count ?? 0;
  }

  get countLabel() {
    const key =
      this.replyCount === 1
        ? "video_shorts.comments.count.one"
        : "video_shorts.comments.count.other";

    return i18n(key, { count: this.replyCount });
  }

  closeOnce() {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.args.model?.onClose?.();
  }

  @action
  close() {
    this.closeOnce();
    this.args.closeModal();
  }

  @action
  handleReplyPublished(createdPost, submittedItem) {
    return this.handleCommentMutation(
      {
        type: "create",
        post: createdPost,
        countDelta: 1,
      },
      submittedItem
    );
  }

  @action
  handleCommentDeleted(deletedPost) {
    return this.handleCommentMutation({
      type: "delete",
      post: deletedPost,
      countDelta: -1,
    });
  }

  @action
  handleCommentMutation(mutation, submittedItem) {
    const countDelta = mutation?.countDelta || 0;
    const hasReplyCountValue = Number.isFinite(mutation?.replyCountValue);

    if (countDelta !== 0 || hasReplyCountValue) {
      this.replyCountValue = hasReplyCountValue
        ? mutation.replyCountValue
        : Math.max(this.replyCount + countDelta, 0);
    }

    if (this.args.model?.onCommentMutation) {
      this.args.model.onCommentMutation(mutation, submittedItem);
      return mutation;
    }

    if (mutation.type === "create") {
      this.args.model?.onReplyPublished?.(mutation.post, submittedItem);
    } else if (mutation.type === "delete") {
      this.args.model?.onCommentDeleted?.(mutation.post);
    }

    return mutation;
  }

  <template>
    <DModal
      @title={{this.countLabel}}
      @closeModal={{this.close}}
      class="video-shorts-comments-sheet"
    >
      <:body>
        <div
          class="video-shorts-comments-sheet__body"
          tabindex="0"
          {{this.lockMobileSheetViewport}}
        >
          <VideoShortsCommentsSurface
            @item={{this.item}}
            @routeSessionOwner={{@model.routeSessionOwner}}
            @replyCount={{this.replyCount}}
            @onReplyPublished={{this.handleReplyPublished}}
            @onCommentDeleted={{this.handleCommentDeleted}}
            @onCommentMutation={{this.handleCommentMutation}}
            @onAuthorizationRevoked={{this.close}}
          />
        </div>
      </:body>
    </DModal>
  </template>
}
