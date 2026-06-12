import Component from "@glimmer/component";
import { tracked } from "@glimmer/tracking";
import { registerDestructor } from "@ember/destroyable";
import { action } from "@ember/object";
import DModal from "discourse/ui-kit/d-modal";
import VideoShortsCommentsSurface from "discourse/plugins/discourse-video-shorts/discourse/components/video-shorts/comments-surface";

export default class VideoShortsCommentsSheet extends Component {
  @tracked replyCountValue = null;

  constructor() {
    super(...arguments);
    registerDestructor(this, () => this.args.model?.opener?.focus?.());
  }

  get item() {
    return this.args.model?.item;
  }

  get replyCount() {
    return this.replyCountValue ?? this.item?.counts?.reply_count ?? 0;
  }

  get countLabel() {
    return `${this.replyCount} ${this.replyCount === 1 ? "reply" : "replies"}`;
  }

  @action
  close() {
    this.args.model?.onClose?.();
    this.args.closeModal();
    setTimeout(() => {
      const opener =
        document.querySelector(
          `[data-post-id="${this.item.post_id}"] [data-action="open-comments"]`
        ) || this.args.model?.opener;

      opener?.focus?.();
    }, 50);
  }

  @action
  handleReplyPublished(createdPost, submittedItem) {
    if (!createdPost?.id) {
      return;
    }

    this.replyCountValue = this.replyCount + 1;
    this.args.model?.onReplyPublished?.(createdPost, submittedItem);
  }

  <template>
    <DModal
      @title={{this.countLabel}}
      @closeModal={{this.close}}
      class="video-shorts-comments-sheet"
    >
      <:body>
        <div class="video-shorts-comments-sheet__body" tabindex="0">
          <VideoShortsCommentsSurface
            @item={{this.item}}
            @onReplyPublished={{this.handleReplyPublished}}
          />
        </div>
      </:body>
    </DModal>
  </template>
}
