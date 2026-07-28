import Component from "@glimmer/component";
import { tracked } from "@glimmer/tracking";
import { registerDestructor } from "@ember/destroyable";
import { action } from "@ember/object";
import { service } from "@ember/service";
import { modifier } from "ember-modifier";
import DModal from "discourse/ui-kit/d-modal";
import { i18n } from "discourse-i18n";
import VideoShortsCommentsSurface from "discourse/plugins/discourse-video-shorts/discourse/components/video-shorts/comments-surface";

const MAX_SHEET_RECT_RETRY_FRAMES = 12;
const MAX_KEYBOARD_RESERVE_RELEASE_FRAMES = 12;
const LIGHTWEIGHT_EDITOR_SELECTOR =
  "[data-video-shorts-inline-editor], [data-video-shorts-edit-editor], [data-video-shorts-reply-editor]";

export default class VideoShortsCommentsSheet extends Component {
  @service site;

  @tracked composerOpen = false;
  @tracked replyCountValue = null;
  closed = false;
  mobileComposerRestoreFocusTo = null;
  mobileComposerRestoreFocusSelector = null;
  mobileComposerRestoreFrame = null;
  mobileComposerSavedScrollTop = 0;

  suspendForMobileComposer = modifier((element) => {
    if (!this.site.mobileView) {
      return;
    }

    const modal = element.closest(".d-modal");
    const commentsList = modal?.querySelector(
      ".video-shorts-comments-surface__list"
    );
    const replyControl = document.querySelector("#reply-control");

    if (!modal || !replyControl) {
      return;
    }

    this.mobileComposerSavedScrollTop = commentsList?.scrollTop ?? 0;

    const rememberFocusTarget = (event) => {
      if (!(event.target instanceof Element)) {
        return;
      }

      const focusTarget = event.target.closest(
        "button, a[href], input, textarea, select, [tabindex]:not([tabindex='-1'])"
      );

      if (focusTarget && modal.contains(focusTarget)) {
        this.mobileComposerRestoreFocusTo = focusTarget;

        const comment = focusTarget.closest(
          "[data-video-shorts-native-comment][data-post-id]"
        );
        this.mobileComposerRestoreFocusSelector =
          comment && focusTarget.matches("button.reply")
            ? `[data-video-shorts-native-comment][data-post-id="${CSS.escape(
                comment.dataset.postId
              )}"] button.reply`
            : null;
      }
    };

    const syncModalSuspension = () => {
      const suspended = modal.classList.contains("is-composer-open");
      modal.inert = suspended;

      if (suspended) {
        modal.setAttribute("aria-hidden", "true");
      } else {
        modal.removeAttribute("aria-hidden");
      }
    };

    const update = () => {
      const isOpen = replyControl.classList.contains("open");

      if (isOpen === this.composerOpen) {
        return;
      }

      this.composerOpen = isOpen;

      if (isOpen) {
        this.mobileComposerSavedScrollTop = commentsList?.scrollTop ?? 0;

        if (modal.contains(document.activeElement)) {
          this.mobileComposerRestoreFocusTo = document.activeElement;
        }

        return;
      }

      if (this.mobileComposerRestoreFrame !== null) {
        cancelAnimationFrame(this.mobileComposerRestoreFrame);
      }

      this.mobileComposerRestoreFrame = requestAnimationFrame(() => {
        this.mobileComposerRestoreFrame = requestAnimationFrame(() => {
          this.mobileComposerRestoreFrame = null;

          if (commentsList) {
            commentsList.scrollTop = this.mobileComposerSavedScrollTop;
          }

          const focusTarget = this.mobileComposerRestoreFocusTo?.isConnected
            ? this.mobileComposerRestoreFocusTo
            : this.mobileComposerRestoreFocusSelector
              ? document.querySelector(this.mobileComposerRestoreFocusSelector)
              : null;

          if (focusTarget instanceof HTMLElement) {
            focusTarget.focus({ preventScroll: true });
          }
        });
      });
    };

    const observer = new MutationObserver(update);
    const modalObserver = new MutationObserver(syncModalSuspension);
    observer.observe(replyControl, {
      attributeFilter: ["class"],
      attributes: true,
    });
    modalObserver.observe(modal, {
      attributeFilter: ["class"],
      attributes: true,
    });
    modal.addEventListener("focusin", rememberFocusTarget);
    modal.addEventListener("pointerdown", rememberFocusTarget, true);
    update();
    syncModalSuspension();

    return () => {
      observer.disconnect();
      modalObserver.disconnect();
      modal.removeEventListener("focusin", rememberFocusTarget);
      modal.removeEventListener("pointerdown", rememberFocusTarget, true);

      modal.inert = false;
      modal.removeAttribute("aria-hidden");
    };
  });

  lockMobileSheetViewport = modifier((element) => {
    if (!this.site.mobileView) {
      return;
    }

    const sheet = element.closest(".video-shorts-comments-sheet");
    const container = sheet?.querySelector(".d-modal__container");
    const surface = sheet?.querySelector(".video-shorts-comments-surface");

    if (!sheet || !container || !surface) {
      return;
    }

    let rafId = null;
    let remainingLockAttempts = 0;
    const visualViewport = window.visualViewport;
    let inlineEditorList = null;
    let inlineEditorListBasePaddingBottom = 0;
    let inlineEditorListOriginalPaddingBottom = "";
    let inlineEditorKeyboardReserve = 0;
    let keyboardReserveReleaseFrame = null;
    let keyboardReserveReleaseAttempts = 0;
    let keyboardReserveStableFrames = 0;
    let keyboardReserveViewportBottom = null;
    let editorRemovalObserver = null;

    const clearInlineEditorKeyboardReserve = () => {
      if (keyboardReserveReleaseFrame !== null) {
        cancelAnimationFrame(keyboardReserveReleaseFrame);
        keyboardReserveReleaseFrame = null;
      }

      keyboardReserveReleaseAttempts = 0;
      keyboardReserveStableFrames = 0;
      keyboardReserveViewportBottom = null;

      if (!inlineEditorList) {
        return;
      }

      if (inlineEditorListOriginalPaddingBottom) {
        inlineEditorList.style.setProperty(
          "padding-bottom",
          inlineEditorListOriginalPaddingBottom
        );
      } else {
        inlineEditorList.style.removeProperty("padding-bottom");
      }

      inlineEditorList.style.removeProperty(
        "--video-shorts-comments-edit-keyboard-reserve"
      );
      inlineEditorList = null;
      inlineEditorListBasePaddingBottom = 0;
      inlineEditorListOriginalPaddingBottom = "";
      inlineEditorKeyboardReserve = 0;
    };

    const currentViewportBottom = () =>
      visualViewport
        ? visualViewport.offsetTop + visualViewport.height
        : window.innerHeight;

    const applyInlineEditorKeyboardReserve = (commentsList, reserve) => {
      commentsList.style.setProperty(
        "--video-shorts-comments-edit-keyboard-reserve",
        `${reserve}px`
      );
      commentsList.style.setProperty(
        "padding-bottom",
        `${inlineEditorListBasePaddingBottom + reserve}px`
      );
      inlineEditorKeyboardReserve = reserve;
    };

    const releaseInlineEditorKeyboardReserve = (commentsList) => {
      if (keyboardReserveReleaseFrame !== null) {
        return;
      }

      keyboardReserveReleaseAttempts = 0;
      keyboardReserveStableFrames = 0;
      keyboardReserveViewportBottom = currentViewportBottom();

      const releaseAfterViewportSettles = () => {
        keyboardReserveReleaseFrame = null;

        if (
          inlineEditorList !== commentsList ||
          !surface.contains(commentsList)
        ) {
          clearInlineEditorKeyboardReserve();
          return;
        }

        keyboardReserveReleaseAttempts += 1;

        const nextViewportBottom = currentViewportBottom();

        if (
          Math.abs(nextViewportBottom - keyboardReserveViewportBottom) < 1
        ) {
          keyboardReserveStableFrames += 1;
        } else {
          keyboardReserveStableFrames = 0;
        }

        keyboardReserveViewportBottom = nextViewportBottom;

        if (
          keyboardReserveStableFrames < 2 &&
          keyboardReserveReleaseAttempts <
            MAX_KEYBOARD_RESERVE_RELEASE_FRAMES
        ) {
          keyboardReserveReleaseFrame = requestAnimationFrame(
            releaseAfterViewportSettles
          );
          return;
        }

        const settledListRect = commentsList.getBoundingClientRect();
        const settledVisibleBottom = Math.min(
          settledListRect.bottom,
          nextViewportBottom
        );

        if (
          settledListRect.bottom - settledVisibleBottom < 1 &&
          !surface.querySelector(LIGHTWEIGHT_EDITOR_SELECTOR)
        ) {
          clearInlineEditorKeyboardReserve();
        }
      };

      keyboardReserveReleaseFrame = requestAnimationFrame(
        releaseAfterViewportSettles
      );
    };

    const keepFocusedInlineEditorVisible = () => {
      const commentsList = surface.querySelector(
        ".video-shorts-comments-surface__list"
      );
      const activeElement = document.activeElement;
      const editor = activeElement?.closest?.(LIGHTWEIGHT_EDITOR_SELECTOR);

      if (!commentsList) {
        clearInlineEditorKeyboardReserve();
        return;
      }

      if (!editor || !surface.contains(editor)) {
        if (
          inlineEditorList === commentsList &&
          inlineEditorKeyboardReserve > 0
        ) {
          releaseInlineEditorKeyboardReserve(commentsList);
        } else {
          clearInlineEditorKeyboardReserve();
        }
        return;
      }

      const listRect = commentsList.getBoundingClientRect();
      const viewportTop = visualViewport?.offsetTop ?? 0;
      const viewportBottom = currentViewportBottom();
      const visibleTop = Math.max(listRect.top, viewportTop);
      const visibleBottom = Math.min(listRect.bottom, viewportBottom);

      if (visibleBottom <= visibleTop) {
        return;
      }

      const padding = 12;
      const keyboardOcclusion = Math.max(
        listRect.bottom - visibleBottom,
        0
      );
      const keyboardReserve =
        keyboardOcclusion > 0 ? keyboardOcclusion + padding : 0;

      if (inlineEditorList !== commentsList) {
        clearInlineEditorKeyboardReserve();
        inlineEditorList = commentsList;
        inlineEditorListOriginalPaddingBottom =
          commentsList.style.getPropertyValue("padding-bottom");
        inlineEditorListBasePaddingBottom =
          Number.parseFloat(getComputedStyle(commentsList).paddingBottom) || 0;
      }

      if (keyboardReserve > 0 || inlineEditorKeyboardReserve === 0) {
        if (keyboardReserveReleaseFrame !== null) {
          cancelAnimationFrame(keyboardReserveReleaseFrame);
          keyboardReserveReleaseFrame = null;
        }

        keyboardReserveReleaseAttempts = 0;
        keyboardReserveStableFrames = 0;
        keyboardReserveViewportBottom = null;
        applyInlineEditorKeyboardReserve(commentsList, keyboardReserve);
      } else {
        releaseInlineEditorKeyboardReserve(commentsList);
      }

      const editorRect = editor.getBoundingClientRect();

      if (editorRect.bottom > visibleBottom - padding) {
        commentsList.scrollTop +=
          editorRect.bottom - (visibleBottom - padding);
      } else if (editorRect.top < visibleTop + padding) {
        commentsList.scrollTop = Math.max(
          commentsList.scrollTop - (visibleTop + padding - editorRect.top),
          0
        );
      }
    };

    const lockSheetRect = () => {
      const hasStableTop = sheet.style.getPropertyValue(
        "--video-shorts-comments-sheet-stable-top"
      );
      const hasStableHeight = sheet.style.getPropertyValue(
        "--video-shorts-comments-sheet-stable-height"
      );

      if (hasStableTop && hasStableHeight) {
        return true;
      }

      const capturedTop = sheet.style.getPropertyValue(
        "--video-shorts-comments-sheet-captured-top"
      );
      const capturedHeight = sheet.style.getPropertyValue(
        "--video-shorts-comments-sheet-captured-height"
      );

      if (capturedTop && capturedHeight) {
        sheet.style.setProperty(
          "--video-shorts-comments-sheet-stable-top",
          capturedTop
        );
        sheet.style.setProperty(
          "--video-shorts-comments-sheet-stable-height",
          capturedHeight
        );
        return true;
      }

      const rect = container.getBoundingClientRect();

      if (
        !rect.width ||
        !rect.height ||
        rect.top >= window.innerHeight ||
        rect.bottom > window.innerHeight + 2 ||
        rect.bottom <= 0
      ) {
        return false;
      }

      sheet.style.setProperty(
        "--video-shorts-comments-sheet-captured-top",
        `${rect.top}px`
      );
      sheet.style.setProperty(
        "--video-shorts-comments-sheet-captured-height",
        `${rect.height}px`
      );
      sheet.style.setProperty(
        "--video-shorts-comments-sheet-stable-top",
        `${rect.top}px`
      );
      sheet.style.setProperty(
        "--video-shorts-comments-sheet-stable-height",
        `${rect.height}px`
      );
      return true;
    };

    const queueLockSheetRect = () => {
      if (rafId !== null) {
        return;
      }

      rafId = requestAnimationFrame(() => {
        rafId = null;
        keepFocusedInlineEditorVisible();

        if (lockSheetRect()) {
          remainingLockAttempts = 0;
          return;
        }

        remainingLockAttempts -= 1;

        if (remainingLockAttempts > 0) {
          queueLockSheetRect();
        }
      });
    };

    const restartLockSheetRect = () => {
      remainingLockAttempts = MAX_SHEET_RECT_RETRY_FRAMES;
      queueLockSheetRect();
    };

    if (!lockSheetRect()) {
      restartLockSheetRect();
    }

    const releaseKeyboardReserve = () => {
      const commentsList = surface.querySelector(
        ".video-shorts-comments-surface__list"
      );

      if (
        commentsList &&
        inlineEditorList === commentsList &&
        inlineEditorKeyboardReserve > 0
      ) {
        releaseInlineEditorKeyboardReserve(commentsList);
      } else if (!surface.querySelector(LIGHTWEIGHT_EDITOR_SELECTOR)) {
        clearInlineEditorKeyboardReserve();
      }
    };

    editorRemovalObserver = new MutationObserver(() => {
      if (!surface.querySelector(LIGHTWEIGHT_EDITOR_SELECTOR)) {
        releaseKeyboardReserve();
      }
    });

    window.addEventListener("resize", restartLockSheetRect);
    visualViewport?.addEventListener("resize", restartLockSheetRect);
    visualViewport?.addEventListener("scroll", restartLockSheetRect);
    sheet.addEventListener("focusin", restartLockSheetRect);
    sheet.addEventListener("focusout", releaseKeyboardReserve, true);
    editorRemovalObserver.observe(surface, { childList: true, subtree: true });

    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }

      window.removeEventListener("resize", restartLockSheetRect);
      visualViewport?.removeEventListener("resize", restartLockSheetRect);
      visualViewport?.removeEventListener("scroll", restartLockSheetRect);
      sheet.removeEventListener("focusin", restartLockSheetRect);
      sheet.removeEventListener("focusout", releaseKeyboardReserve, true);
      editorRemovalObserver?.disconnect();
      sheet.style.removeProperty("--video-shorts-comments-sheet-stable-top");
      sheet.style.removeProperty("--video-shorts-comments-sheet-stable-height");
      sheet.style.removeProperty("--video-shorts-comments-sheet-captured-top");
      sheet.style.removeProperty(
        "--video-shorts-comments-sheet-captured-height"
      );
      clearInlineEditorKeyboardReserve();
    };
  });

  constructor() {
    super(...arguments);
    registerDestructor(this, () => {
      if (this.mobileComposerRestoreFrame !== null) {
        cancelAnimationFrame(this.mobileComposerRestoreFrame);
      }

      this.closeOnce();
    });
  }

  get item() {
    return this.args.model?.item;
  }

  get replyCount() {
    const authoritativeCount = this.args.model?.replyCount?.();

    return Number.isFinite(authoritativeCount)
      ? authoritativeCount
      : (this.replyCountValue ?? this.item?.counts?.reply_count ?? 0);
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
  handleCommentMutation(mutation) {
    const countDelta = mutation?.countDelta || 0;
    const hasReplyCountValue = Number.isFinite(mutation?.replyCountValue);

    if (countDelta !== 0 || hasReplyCountValue) {
      this.replyCountValue = hasReplyCountValue
        ? mutation.replyCountValue
        : Math.max(this.replyCount + countDelta, 0);
    }

    this.args.model?.onCommentMutation?.(mutation);

    return mutation;
  }

  <template>
    <DModal
      @title={{this.countLabel}}
      @closeModal={{this.close}}
      @hidden={{this.composerOpen}}
      class={{if
        this.composerOpen
        "video-shorts-comments-sheet is-composer-open"
        "video-shorts-comments-sheet"
      }}
    >
      <:body>
        <div
          class="video-shorts-comments-sheet__body"
          tabindex="0"
          {{this.lockMobileSheetViewport}}
          {{this.suspendForMobileComposer}}
        >
          <VideoShortsCommentsSurface
            @item={{this.item}}
            @replyCount={{this.replyCount}}
            @onCommentMutation={{this.handleCommentMutation}}
          />
        </div>
      </:body>
    </DModal>
  </template>
}
