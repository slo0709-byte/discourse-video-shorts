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
import { BookmarkFormData } from "discourse/lib/bookmark-form-data";
import PostFlag from "discourse/lib/flag-targets/post-flag";
import { not } from "discourse/truth-helpers";
import dIcon from "discourse/ui-kit/helpers/d-icon";
import { i18n } from "discourse-i18n";
import VideoShortsCommentsSheet from "discourse/plugins/discourse-video-shorts/discourse/components/modal/video-shorts-comments-sheet";
import { videoShortsNativePost } from "discourse/plugins/discourse-video-shorts/discourse/lib/video-shorts-native-post";
import { createVideoShortsNativeTopic } from "discourse/plugins/discourse-video-shorts/discourse/lib/video-shorts-native-topic";

export default class VideoShortsActionRail extends Component {
  @service bookmarkApi;
  @service currentUser;
  @service modal;
  @service site;
  @service store;

  @tracked liked = this.args.item?.actions?.liked || false;
  @tracked bookmarked = this.args.item?.actions?.bookmarked || false;
  @tracked bookmarkId = this.args.item?.actions?.bookmark_id || null;
  @tracked likeCountValue = this.args.item?.counts?.like_count || 0;
  @tracked bookmarkCountValue = this.args.item?.counts?.bookmark_count || 0;
  @tracked likePending = false;
  @tracked bookmarkPending = false;

  nativeTopicIdentity = null;
  nativeTopic = null;
  nativePostRecords = new Map();

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

  get likeButtonClass() {
    return `video-shorts-action-rail__button ${
      this.liked ? "is-active" : ""
    } ${this.likePending ? "is-pending" : ""}`;
  }

  get bookmarkButtonClass() {
    return `video-shorts-action-rail__button ${
      this.bookmarked ? "is-active" : ""
    } ${this.bookmarkPending ? "is-pending" : ""}`;
  }

  get likeDisabled() {
    return !this.canLike || this.likePending;
  }

  get bookmarkDisabled() {
    return !this.canBookmark || this.bookmarkPending;
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

    const actions = this.args.item?.actions;
    const likeAction = this.args.item?.native_action_summary?.find(
      (itemAction) => itemAction.id === this.likeActionTypeId
    );

    return Boolean(actions?.can_like || likeAction?.can_undo || this.liked);
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

  nativeTopicRecord() {
    const identity = `${this.args.item.topic_id}:${this.args.item.post_id}`;

    if (!this.nativeTopic || this.nativeTopicIdentity !== identity) {
      this.nativeTopic = createVideoShortsNativeTopic(
        this.args.item,
        this.store
      );
      this.nativeTopicIdentity = identity;
      this.nativePostRecords = new Map();
    }

    return this.nativeTopic;
  }

  nativePostRecord() {
    const item = this.args.item;

    return videoShortsNativePost({
      comment: {
        id: item.post_id,
        post_id: item.post_id,
        post_number: item.post_number,
        topic_id: item.topic_id,
        username: item.username,
        name: item.name,
        avatar_template: item.avatar_template,
        cooked: item.excerpt || "",
        created_at: item.created_at,
        post_url: item.post_url,
        reply_count: item.counts?.reply_count || 0,
        actions_summary: item.native_action_summary || [],
        can_flag: this.canFlag,
        hidden: false,
      },
      item,
      topic: this.nativeTopicRecord(),
      store: this.store,
      records: this.nativePostRecords,
    });
  }

  showLogin() {
    return getOwner(this).lookup("route:application").send("showLogin");
  }

  @action
  async toggleLike() {
    if (!this.currentUser) {
      return this.showLogin();
    }

    if (this.likePending || !this.canLike || !this.likeActionTypeId) {
      return;
    }

    const previousLiked = this.liked;
    const previousCount = this.likeCountValue;

    this.likePending = true;
    this.liked = !previousLiked;
    this.likeCountValue = Math.max(previousCount + (previousLiked ? -1 : 1), 0);

    try {
      if (previousLiked) {
        await ajax(`/post_actions/${this.args.item.post_id}`, {
          type: "DELETE",
          data: { post_action_type_id: this.likeActionTypeId },
        });
      } else {
        await ajax("/post_actions", {
          type: "POST",
          data: {
            id: this.args.item.post_id,
            post_action_type_id: this.likeActionTypeId,
          },
        });
      }
    } catch (error) {
      this.liked = previousLiked;
      this.likeCountValue = previousCount;
      popupAjaxError(error);
    } finally {
      this.likePending = false;
    }
  }

  @action
  async toggleBookmark() {
    if (!this.currentUser) {
      return this.showLogin();
    }

    if (this.bookmarkPending || !this.canBookmark) {
      return;
    }

    if (this.bookmarked && !this.bookmarkId) {
      return;
    }

    const previousBookmarked = this.bookmarked;
    const previousBookmarkId = this.bookmarkId;
    const previousCount = this.bookmarkCountValue;

    this.bookmarkPending = true;

    if (this.bookmarked && this.bookmarkId) {
      try {
        this.bookmarked = false;
        this.bookmarkId = null;
        this.bookmarkCountValue = Math.max(previousCount - 1, 0);

        await ajax(`/bookmarks/${previousBookmarkId}.json`, {
          method: "DELETE",
        });
      } catch (error) {
        this.bookmarked = previousBookmarked;
        this.bookmarkId = previousBookmarkId;
        this.bookmarkCountValue = previousCount;
        popupAjaxError(error);
      } finally {
        this.bookmarkPending = false;
      }

      return;
    }

    try {
      this.bookmarked = true;
      this.bookmarkCountValue = previousCount + 1;

      const bookmark = this.bookmarkApi.buildNewBookmark(
        "Post",
        this.args.item.post_id
      );
      const formData = new BookmarkFormData(bookmark);
      const saved = await this.bookmarkApi.create(formData);

      if (!saved) {
        this.bookmarked = previousBookmarked;
        this.bookmarkId = previousBookmarkId;
        this.bookmarkCountValue = previousCount;
        return;
      }

      this.bookmarked = true;
      this.bookmarkId = saved.id;
    } catch (error) {
      this.bookmarked = previousBookmarked;
      this.bookmarkId = previousBookmarkId;
      this.bookmarkCountValue = previousCount;
      popupAjaxError(error);
    } finally {
      this.bookmarkPending = false;
    }
  }

  @action
  openComments(event) {
    event?.preventDefault();

    if (this.args.onOpenComments) {
      this.args.onOpenComments({
        item: this.args.item,
      });
      return;
    }

    this.modal.show(VideoShortsCommentsSheet, {
      model: {
        item: this.args.item,
        replyCount: () =>
          this.args.replyCount ?? this.args.item?.counts?.reply_count ?? 0,
      },
    });
  }

  @action
  share(event) {
    event?.preventDefault();

    this.modal.show(ShareTopicModal, {
      model: {
        topic: this.nativeTopicRecord(),
        post: this.nativePostRecord(),
        allowInvites: false,
      },
    });
  }

  @action
  flag() {
    if (!this.currentUser) {
      return this.showLogin();
    }

    if (!this.canFlag) {
      return;
    }

    const post = this.nativePostRecord();

    this.modal.show(FlagModal, {
      model: {
        flagTarget: new PostFlag(),
        flagModel: post,
        setHidden: () => post.set("hidden", true),
      },
    });
  }

  <template>
    <div class="video-shorts-action-rail">
      <button
        type="button"
        class={{this.likeButtonClass}}
        data-action="like"
        aria-label={{i18n "video_shorts.actions.like"}}
        aria-pressed={{if this.liked "true" "false"}}
        aria-busy={{if this.likePending "true" "false"}}
        disabled={{this.likeDisabled}}
        {{on "click" this.toggleLike}}
      >
        {{dIcon (if this.liked "d-liked" "d-unliked")}}
        <span class="video-shorts-action-rail__count">{{this.likeCount}}</span>
      </button>

      <button
        type="button"
        class={{this.bookmarkButtonClass}}
        data-action="bookmark"
        aria-label={{i18n "video_shorts.actions.bookmark"}}
        aria-pressed={{if this.bookmarked "true" "false"}}
        aria-busy={{if this.bookmarkPending "true" "false"}}
        disabled={{this.bookmarkDisabled}}
        {{on "click" this.toggleBookmark}}
      >
        {{dIcon "bookmark"}}
        <span
          class="video-shorts-action-rail__count"
        >{{this.bookmarkCount}}</span>
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
        {{dIcon "up-right-from-square"}}
      </a>
    </div>
  </template>
}
