import Component from "@glimmer/component";
import { tracked } from "@glimmer/tracking";
import { on } from "@ember/modifier";
import { action } from "@ember/object";
import { getOwner } from "@ember/owner";
import { service } from "@ember/service";
import FlagModal from "discourse/components/modal/flag";
import ShareTopicModal from "discourse/components/modal/share-topic";
import { ajax } from "discourse/lib/ajax";
import { popupAjaxError } from "discourse/lib/ajax-error";
import PostFlag from "discourse/lib/flag-targets/post-flag";
import Composer from "discourse/models/composer";
import Post from "discourse/models/post";
import { not } from "discourse/truth-helpers";
import dIcon from "discourse/ui-kit/helpers/d-icon";
import { i18n } from "discourse-i18n";
import VideoShortsCommentsSheet from "discourse/plugins/discourse-video-shorts/discourse/components/modal/video-shorts-comments-sheet";

export default class VideoShortsActionRail extends Component {
  @service composer;
  @service currentUser;
  @service modal;
  @service site;
  @service store;

  @tracked liked = this.args.item?.actions?.liked || false;
  @tracked bookmarked = this.args.item?.actions?.bookmarked || false;
  @tracked likeCountValue = this.args.item?.counts?.like_count || 0;
  @tracked bookmarkCountValue = this.args.item?.counts?.bookmark_count || 0;

  get likeCount() {
    return this.formatCount(this.likeCountValue);
  }

  get replyCount() {
    return this.formatCount(
      this.args.replyCount ?? this.args.item?.counts?.reply_count ?? 0
    );
  }

  get bookmarkCount() {
    return this.formatCount(this.bookmarkCountValue);
  }

  formatCount(value) {
    const count = Number(value) || 0;

    if (count < 1000) {
      return `${count}`;
    }

    if (count < 10_000) {
      return `${Math.floor(count / 100) / 10}k`;
    }

    if (count < 1_000_000) {
      return `${Math.floor(count / 1000)}k`;
    }

    if (count < 10_000_000) {
      return `${Math.floor(count / 100_000) / 10}m`;
    }

    return `${Math.floor(count / 1_000_000)}m`;
  }

  get canLike() {
    if (!this.currentUser) {
      return true;
    }

    return Boolean(this.args.item?.actions?.can_like || this.liked);
  }

  get canBookmark() {
    if (!this.currentUser) {
      return true;
    }

    return Boolean(this.args.item?.actions?.can_bookmark || this.bookmarked);
  }

  get canReply() {
    if (!this.currentUser) {
      return true;
    }

    return Boolean(this.args.item?.actions?.can_reply);
  }

  get canFlag() {
    if (!this.currentUser) {
      return true;
    }

    return Boolean(this.args.item?.actions?.can_flag);
  }

  get likeActionTypeId() {
    return this.site.post_action_types.find((type) => type.name_key === "like")
      ?.id;
  }

  get topicRecord() {
    return this.store.createRecord("topic", {
      id: this.args.item.topic_id,
      title: this.args.item.title,
      fancy_title: this.args.item.title,
      draft_key: `topic_${this.args.item.topic_id}`,
      draft_sequence: 0,
      details: {
        can_create_post: this.canReply,
      },
    });
  }

  postRecordFrom(data = {}) {
    return this.store.createRecord("post", {
      ...data,
      id: this.args.item.post_id,
      post_number: this.args.item.post_number,
      username: this.args.item.username,
      topic_id: this.args.item.topic_id,
      topic_slug: this.args.item.topic_url?.split("/")[2],
      topic: this.topicRecord,
      hidden: false,
    });
  }

  get postRecord() {
    return this.postRecordFrom();
  }

  showLogin() {
    return getOwner(this).lookup("route:application").send("showLogin");
  }

  @action
  async toggleLike() {
    if (!this.currentUser) {
      return this.showLogin();
    }

    if (!this.canLike || !this.likeActionTypeId) {
      return;
    }

    try {
      if (this.liked) {
        await ajax(`/post_actions/${this.args.item.post_id}`, {
          type: "DELETE",
          data: { post_action_type_id: this.likeActionTypeId },
        });
        this.liked = false;
        this.likeCountValue = Math.max(this.likeCountValue - 1, 0);
      } else {
        await ajax("/post_actions", {
          type: "POST",
          data: {
            id: this.args.item.post_id,
            post_action_type_id: this.likeActionTypeId,
          },
        });
        this.liked = true;
        this.likeCountValue += 1;
      }
    } catch (error) {
      popupAjaxError(error);
    }
  }

  @action
  async toggleBookmark() {
    if (!this.currentUser) {
      return this.showLogin();
    }

    if (!this.canBookmark) {
      return;
    }

    try {
      if (this.bookmarked) {
        await Post.destroyBookmark(this.args.item.post_id);
        this.bookmarked = false;
        this.bookmarkCountValue = Math.max(this.bookmarkCountValue - 1, 0);
      } else {
        await Post.updateBookmark(this.args.item.post_id, true);
        this.bookmarked = true;
        this.bookmarkCountValue += 1;
      }
    } catch (error) {
      popupAjaxError(error);
    }
  }

  @action
  openComposerReply() {
    if (!this.currentUser) {
      return this.showLogin();
    }

    if (!this.canReply) {
      return;
    }

    this.composer.open({
      action: Composer.REPLY,
      draftKey: `topic_${this.args.item.topic_id}`,
      draftSequence: 0,
      post: this.args.item.post_number === 1 ? null : this.postRecord,
      skipJumpOnSave: true,
      topic: this.topicRecord,
    });
  }

  @action
  openComments(event) {
    event?.preventDefault();

    if (this.args.onOpenComments) {
      this.args.onOpenComments({
        item: this.args.item,
        opener: event?.currentTarget,
        onReply: this.openComposerReply,
      });
      return;
    }

    this.modal.show(VideoShortsCommentsSheet, {
      model: {
        item: this.args.item,
        opener: event?.currentTarget,
        onReply: this.openComposerReply,
      },
    });
  }

  @action
  share(event) {
    event?.preventDefault();

    this.modal.show(ShareTopicModal, {
      model: {
        topic: this.topicRecord,
        post: this.postRecord,
        allowInvites: false,
      },
    });
  }

  @action
  async flag() {
    if (!this.currentUser) {
      return this.showLogin();
    }

    if (!this.canFlag) {
      return;
    }

    try {
      const postData = await ajax(`/posts/${this.args.item.post_id}.json`);
      const post = this.postRecordFrom(postData);

      this.modal.show(FlagModal, {
        model: {
          flagTarget: new PostFlag(),
          flagModel: post,
          setHidden: () => post.set("hidden", true),
        },
      });
    } catch (error) {
      popupAjaxError(error);
    }
  }

  <template>
    <div class="video-shorts-action-rail">
      <button
        type="button"
        class="video-shorts-action-rail__button"
        data-action="like"
        aria-label={{i18n "video_shorts.actions.like"}}
        disabled={{not this.canLike}}
        {{on "click" this.toggleLike}}
      >
        {{dIcon (if this.liked "d-liked" "d-unliked")}}
        <span class="video-shorts-action-rail__count">{{this.likeCount}}</span>
      </button>

      <button
        type="button"
        class="video-shorts-action-rail__button"
        data-action="bookmark"
        aria-label={{i18n "video_shorts.actions.bookmark"}}
        disabled={{not this.canBookmark}}
        {{on "click" this.toggleBookmark}}
      >
        {{dIcon "bookmark"}}
        <span class="video-shorts-action-rail__count">{{this.bookmarkCount}}</span>
      </button>

      <button
        type="button"
        class="video-shorts-action-rail__button"
        data-action="open-comments"
        aria-label={{i18n "video_shorts.actions.open_comments"}}
        {{on "click" this.openComments}}
      >
        {{dIcon "reply"}}
        <span class="video-shorts-action-rail__count">{{this.replyCount}}</span>
      </button>

      <a
        class="video-shorts-action-rail__button"
        data-action="share"
        href={{@item.actions.share_url}}
        aria-label={{i18n "video_shorts.actions.share"}}
        {{on "click" this.share}}
      >
        {{dIcon "share"}}
      </a>

      <button
        type="button"
        class="video-shorts-action-rail__button"
        data-action="flag"
        aria-label={{i18n "video_shorts.actions.flag"}}
        disabled={{not this.canFlag}}
        {{on "click" this.flag}}
      >
        {{dIcon "flag"}}
      </button>

      <a
        class="video-shorts-action-rail__button"
        data-action="open-topic"
        href={{@item.post_url}}
        aria-label={{i18n "video_shorts.actions.open_topic"}}
      >
        {{dIcon "external-link"}}
      </a>
    </div>
  </template>
}
