import Component from "@glimmer/component";
import { concat, fn, hash } from "@ember/helper";
import { action } from "@ember/object";
import { service } from "@ember/service";
import ChangeOwnerModal from "discourse/components/modal/change-owner";
import ChangePostNoticeModal from "discourse/components/modal/change-post-notice";
import GrantBadgeModal from "discourse/components/modal/grant-badge";
import PermanentlyDeleteConfirmModal from "discourse/components/modal/permanently-delete-confirm";
import PublishPageModal from "discourse/components/modal/publish-page";
import RawEmailModal from "discourse/components/modal/raw-email";
import Post from "discourse/components/post";
import { ajax } from "discourse/lib/ajax";
import { popupAjaxError } from "discourse/lib/ajax-error";
import { i18n } from "discourse-i18n";

export default class VideoShortsNativeComment extends Component {
  @service currentUser;
  @service dialog;
  @service modal;
  @service site;

  @action
  changeNotice(post) {
    if (this.args.changeNotice) {
      return this.args.changeNotice(post);
    }

    return this.modal.show(ChangePostNoticeModal, { model: { post } });
  }

  @action
  changePostOwner(post) {
    if (this.args.changePostOwner) {
      return this.args.changePostOwner(post);
    }

    return this.modal.show(ChangeOwnerModal, {
      model: {
        deselectAll() {},
        multiSelect: false,
        selectedPostsCount: 1,
        selectedPostIds: [post.id],
        selectedPostsUsername: post.username,
        topic: post.topic,
      },
    });
  }

  @action
  grantBadge(post) {
    if (this.args.grantBadge) {
      return this.args.grantBadge(post);
    }

    return this.modal.show(GrantBadgeModal, {
      model: { selectedPost: post },
    });
  }

  @action
  lockPost(post) {
    if (this.args.lockPost) {
      return this.args.lockPost(post);
    }

    return post.updatePostField("locked", true);
  }

  @action
  unlockPost(post) {
    if (this.args.unlockPost) {
      return this.args.unlockPost(post);
    }

    return post.updatePostField("locked", false);
  }

  @action
  rebakePost(post) {
    if (this.args.rebakePost) {
      return this.args.rebakePost(post);
    }

    return post.rebake();
  }

  @action
  togglePostType(post) {
    if (this.args.togglePostType) {
      return this.args.togglePostType(post);
    }

    const regular = this.site.get("post_types.regular");
    const moderator = this.site.get("post_types.moderator_action");
    const postType = post.post_type === moderator ? regular : moderator;

    return post.updatePostField("post_type", postType);
  }

  @action
  toggleWiki(post) {
    if (this.args.toggleWiki) {
      return this.args.toggleWiki(post);
    }

    return post.updatePostField("wiki", !post.wiki);
  }

  @action
  unhidePost(post) {
    if (this.args.unhidePost) {
      return this.args.unhidePost(post);
    }

    return post.unhide();
  }

  @action
  expandHidden(post) {
    if (this.args.expandHidden) {
      return this.args.expandHidden(post);
    }

    return post.expandHidden();
  }

  @action
  showRawEmail(post) {
    if (this.args.showRawEmail) {
      return this.args.showRawEmail(post);
    }

    return this.modal.show(RawEmailModal, { model: post });
  }

  @action
  showPagePublish(post) {
    if (this.args.showPagePublish) {
      return this.args.showPagePublish(post);
    }

    return this.modal.show(PublishPageModal, { model: post.topic });
  }

  @action
  async permanentlyDeletePost(post) {
    if (this.args.permanentlyDeletePost) {
      return this.args.permanentlyDeletePost(post);
    }

    let result;

    try {
      result = await ajax(`/posts/${post.id}/permanently_delete_check.json`);
    } catch (error) {
      return popupAjaxError(error);
    }

    if (!result.can_permanently_delete) {
      return this.dialog.alert(result.reason);
    }

    const message = post.firstPost
      ? i18n("post.controls.permanently_delete_topic_confirmation")
      : i18n("post.controls.permanently_delete_post_confirmation");

    return this.modal.show(PermanentlyDeleteConfirmModal, {
      model: {
        message,
        confirmPhrase: i18n(
          "post.controls.permanently_delete_confirm_phrase"
        ),
        didConfirm: async () => {
          const options = { force_destroy: true };

          try {
            await post.destroy(this.currentUser, options);
          } catch (error) {
            post.undoDeleteState(options);
            popupAjaxError(error);
          }
        },
      },
    });
  }

  <template>
    <div
      ...attributes
      class="video-shorts-native-comment"
      data-video-shorts-native-comment
      data-depth={{@depth}}
      data-post-id={{@post.id}}
    >
      <Post
        @elementId={{concat "post_" @post.post_number}}
        @post={{@post}}
        @prevPost={{@prevPost}}
        @nextPost={{@nextPost}}
        @canCreatePost={{@canCreatePost}}
        @changeNotice={{fn this.changeNotice @post}}
        @changePostOwner={{fn this.changePostOwner @post}}
        @deletePost={{if @deletePost (fn @deletePost @post)}}
        @editPost={{if @editPost (fn @editPost @post)}}
        @expandHidden={{fn this.expandHidden @post}}
        @grantBadge={{fn this.grantBadge @post}}
        @lockPost={{fn this.lockPost @post}}
        @permanentlyDeletePost={{fn this.permanentlyDeletePost @post}}
        @rebakePost={{fn this.rebakePost @post}}
        @recoverPost={{if @recoverPost (fn @recoverPost @post)}}
        @replyToPost={{if @replyToPost (fn @replyToPost @post)}}
        @showFlags={{if @showFlags (fn @showFlags @post)}}
        @showHistory={{if @showHistory (fn @showHistory @post)}}
        @showLogin={{if @showLogin (fn @showLogin @post)}}
        @showPagePublish={{fn this.showPagePublish @post}}
        @showRawEmail={{fn this.showRawEmail @post}}
        @togglePostType={{fn this.togglePostType @post}}
        @toggleWiki={{fn this.toggleWiki @post}}
        @unhidePost={{fn this.unhidePost @post}}
        @unlockPost={{fn this.unlockPost @post}}
      />

      {{yield (hash post=@post depth=@depth toggleBranch=@toggleBranch)}}
    </div>
  </template>
}
