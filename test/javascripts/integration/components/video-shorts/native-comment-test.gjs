import { on } from "@ember/modifier";
import { getOwner } from "@ember/owner";
import { click, render, settled } from "@ember/test-helpers";
import { module, test } from "qunit";
import DMenus from "discourse/float-kit/components/d-menus";
import { setupRenderingTest } from "discourse/tests/helpers/component-test";
import NativeComment from "discourse/plugins/discourse-video-shorts/discourse/components/video-shorts/native-comment";
import { videoShortsNativePost } from "discourse/plugins/discourse-video-shorts/discourse/lib/video-shorts-native-post";
import { createVideoShortsNativeTopic } from "discourse/plugins/discourse-video-shorts/discourse/lib/video-shorts-native-topic";

function feedItem() {
  return {
    topic_id: 701,
    post_id: 700,
    post_number: 1,
    topic_url: "/t/video-topic/701/1",
    title: "Video topic",
    actions: { can_reply: true },
  };
}

function comment(overrides = {}) {
  return {
    id: 802,
    post_id: 802,
    post_number: 4,
    topic_id: 701,
    user_id: 91,
    username: "commenter",
    name: "Comment Author",
    avatar_template: "/user_avatar/localhost/commenter/{size}/1_2.png",
    cooked: "<p>Server-cooked comment</p>",
    raw: "Server-cooked comment",
    created_at: "2026-07-10T10:00:00.000Z",
    updated_at: "2026-07-10T11:00:00.000Z",
    version: 2,
    reply_count: 0,
    actions_summary: [
      { id: 2, count: 1, acted: false, can_act: true, can_undo: false },
      { id: 3, count: 0, acted: false, can_act: true, can_undo: false },
    ],
    can_edit: true,
    can_delete: true,
    can_recover: false,
    can_flag: true,
    can_view_edit_history: true,
    yours: true,
    ...overrides,
  };
}

module(
  "Integration | Component | video shorts native comment",
  function (hooks) {
    setupRenderingTest(hooks);

    hooks.beforeEach(function () {
      this.siteSettings.post_menu =
        "like|edit|flag|delete|reply|copyLink|admin|showMore";
      this.siteSettings.post_menu_hidden_items = "";

      this.store = getOwner(this).lookup("service:store");
      this.item = feedItem();
      this.topic = createVideoShortsNativeTopic(this.item, this.store);
      this.post = videoShortsNativePost({
        comment: comment(),
        item: this.item,
        topic: this.topic,
        store: this.store,
      });

      this.calls = [];
      this.replyToPost = (post) => this.calls.push(["reply", post]);
      this.editPost = (post) => this.calls.push(["edit", post]);
      this.deletePost = (post) => this.calls.push(["delete", post]);
      this.recoverPost = (post) => this.calls.push(["recover", post]);
      this.showFlags = (post) => this.calls.push(["flag", post]);
      this.showHistory = (post) => this.calls.push(["history", post]);
      this.showLogin = (post) => this.calls.push(["login", post]);
      this.toggleBranch = () => this.calls.push(["branch", this.post]);

      this.post.likeAction.togglePromise = (post) => {
        this.calls.push(["like", post]);
        return Promise.resolve({ acted: false });
      };
    });

    test("forwards every core admin action that its PostMenu can render", async function (assert) {
      this.currentUser.admin = true;
      this.currentUser.can_change_post_owner = true;
      this.topic.details.can_edit_staff_notes = true;
      this.topic.details.can_permanently_delete = true;
      this.topic.details.can_publish_page = true;
      this.post = videoShortsNativePost({
        comment: comment({
          id: 804,
          post_id: 804,
          post_number: 1,
          can_permanently_delete: true,
          can_wiki: true,
          deleted_at: "2026-07-10T12:00:00.000Z",
          hidden: true,
          locked: false,
          wiki: false,
        }),
        item: this.item,
        topic: this.topic,
        store: this.store,
      });

      for (const action of [
        "changeNotice",
        "changePostOwner",
        "grantBadge",
        "lockPost",
        "permanentlyDeletePost",
        "rebakePost",
        "showPagePublish",
        "togglePostType",
        "toggleWiki",
        "unhidePost",
        "unlockPost",
      ]) {
        this[action] = (post) => this.calls.push([action, post]);
      }

      await render(
        <template>
          <NativeComment
            @post={{this.post}}
            @depth={{0}}
            @canCreatePost={{true}}
            @changeNotice={{this.changeNotice}}
            @changePostOwner={{this.changePostOwner}}
            @grantBadge={{this.grantBadge}}
            @lockPost={{this.lockPost}}
            @permanentlyDeletePost={{this.permanentlyDeletePost}}
            @rebakePost={{this.rebakePost}}
            @showPagePublish={{this.showPagePublish}}
            @togglePostType={{this.togglePostType}}
            @toggleWiki={{this.toggleWiki}}
            @unhidePost={{this.unhidePost}}
            @unlockPost={{this.unlockPost}}
          />
          <DMenus />
        </template>
      );

      const clickAdminAction = async (selector) => {
        await click(".show-post-admin-menu");
        await click(
          `[data-content][data-identifier='admin-post-menu'] ${selector}`
        );
      };

      for (const [action, selector] of [
        ["togglePostType", ".toggle-post-type"],
        ["changeNotice", ".add-notice"],
        ["unhidePost", ".unhide-post"],
        ["changePostOwner", ".change-owner"],
        ["grantBadge", ".grant-badge"],
        ["lockPost", ".lock-post"],
        ["permanentlyDeletePost", ".permanently-delete"],
        ["toggleWiki", ".wiki"],
        ["showPagePublish", ".publish-page"],
        ["rebakePost", ".rebuild-html"],
      ]) {
        await clickAdminAction(selector);
        const call = this.calls.find(([name]) => name === action);
        assert.true(Boolean(call), `${action} is not rendered as a no-op`);
        assert.strictEqual(call[1], this.post, `${action} receives the Post`);
      }

      this.post.set("locked", true);
      await settled();
      await clickAdminAction(".unlock-post");
      const unlockCall = this.calls.find(([name]) => name === "unlockPost");
      assert.true(Boolean(unlockCall), "unlockPost is not rendered as a no-op");
      assert.strictEqual(unlockCall[1], this.post);
    });

    test("visible core field actions have native defaults when the caller omits callbacks", async function (assert) {
      this.currentUser.admin = true;
      this.post = videoShortsNativePost({
        comment: comment({
          id: 805,
          post_id: 805,
          post_number: 5,
          can_wiki: true,
          hidden: true,
          locked: false,
          wiki: false,
        }),
        item: this.item,
        topic: this.topic,
        store: this.store,
      });
      this.nativeCalls = [];
      this.post.updatePostField = (field, value) => {
        this.nativeCalls.push(["updatePostField", field, value]);
        this.post.set(field, value);
        return Promise.resolve();
      };
      this.post.rebake = () => {
        this.nativeCalls.push(["rebake"]);
        return Promise.resolve();
      };
      this.post.unhide = () => {
        this.nativeCalls.push(["unhide"]);
        return Promise.resolve();
      };

      await render(
        <template>
          <NativeComment
            @post={{this.post}}
            @depth={{0}}
            @canCreatePost={{true}}
          />
          <DMenus />
        </template>
      );

      const clickAdminAction = async (selector) => {
        await click(".show-post-admin-menu");
        await click(
          `[data-content][data-identifier='admin-post-menu'] ${selector}`
        );
      };

      await clickAdminAction(".toggle-post-type");
      await clickAdminAction(".unhide-post");
      await clickAdminAction(".lock-post");
      await clickAdminAction(".wiki");
      await clickAdminAction(".rebuild-html");

      assert.deepEqual(
        this.nativeCalls,
        [
          ["updatePostField", "post_type", 2],
          ["unhide"],
          ["updatePostField", "locked", true],
          ["updatePostField", "wiki", true],
          ["rebake"],
        ],
        "core actions call the Post model instead of silently resolving"
      );
    });

    test("keeps reply expansion owned by core Post without a duplicate callback", async function (assert) {
      this.siteSettings.post_menu = "replies|showMore";
      this.post = videoShortsNativePost({
        comment: comment({ reply_count: 1 }),
        item: this.item,
        topic: this.topic,
        store: this.store,
      });
      const originalFind = this.store.find;
      const requests = [];

      this.store.find = (type, query) => {
        requests.push([type, query]);
        return Promise.resolve({ content: [] });
      };

      try {
        await render(
          <template>
            <NativeComment
              @post={{this.post}}
              @depth={{0}}
              @canCreatePost={{true}}
            />
            <DMenus />
          </template>
        );

        await click(".post-action-menu__show-replies");

        assert.deepEqual(
          requests,
          [["post-reply", { postId: 802, after: 1 }]],
          "Post.toggleReplies loads its own native reply records"
        );
      } finally {
        this.store.find = originalFind;
      }
    });

    test("renders the store-backed Post and native PostMenu with bound actions", async function (assert) {
      await render(
        <template>
          <NativeComment
            @post={{this.post}}
            @depth={{2}}
            @canCreatePost={{true}}
            @replyToPost={{this.replyToPost}}
            @editPost={{this.editPost}}
            @deletePost={{this.deletePost}}
            @recoverPost={{this.recoverPost}}
            @showFlags={{this.showFlags}}
            @showHistory={{this.showHistory}}
            @showLogin={{this.showLogin}}
            @toggleBranch={{this.toggleBranch}}
            as |node|
          >
            <button
              class="test-toggle-native-comment-branch"
              type="button"
              {{on "click" node.toggleBranch}}
            >
              Toggle branch
            </button>
          </NativeComment>
          <DMenus />
        </template>
      );

      assert
        .dom('[data-video-shorts-native-comment][data-post-id="802"]')
        .hasAttribute("data-depth", "2", "the plugin owns only the tree wrapper");
      assert
        .dom('[data-video-shorts-native-comment] > .topic-post')
        .exists("the wrapper renders the core Post component");
      assert
        .dom('.topic-post article.boxed[data-post-id="802"]')
        .exists("the core Post article identity is preserved");
      assert.dom(".post-menu-area").exists("the core PostMenu is present");
      assert.dom(".names").includesText("commenter");
      assert.dom(".cooked").hasText("Server-cooked comment");
      assert.dom("a.post-date").exists("native post metadata is rendered");

      await click(".post-action-menu__reply");
      await click(".post-action-menu__edit");
      await click(".post-action-menu__delete");
      await click(".post-action-menu__flag");
      await click(".post-action-menu__like");
      await click(".test-toggle-native-comment-branch");

      for (const action of ["reply", "edit", "delete", "flag", "like", "branch"]) {
        const call = this.calls.find(([name]) => name === action);
        assert.true(Boolean(call), `${action} reaches its native callback`);
        assert.strictEqual(call[1], this.post, `${action} receives the Post`);
      }
    });

    test("permission-denied posts do not gain plugin controls or actions", async function (assert) {
      this.post = videoShortsNativePost({
        comment: comment({
          id: 803,
          post_id: 803,
          post_number: 5,
          actions_summary: [],
          can_edit: false,
          can_delete: false,
          can_recover: false,
          can_flag: false,
          can_view_edit_history: false,
          yours: false,
        }),
        item: this.item,
        topic: this.topic,
        store: this.store,
      });

      await render(
        <template>
          <NativeComment
            @post={{this.post}}
            @depth={{0}}
            @canCreatePost={{false}}
          />
          <DMenus />
        </template>
      );

      assert.dom(".topic-post article.boxed").exists();
      assert.dom(".post-action-menu__reply").doesNotExist();
      assert.dom(".post-action-menu__edit").doesNotExist();
      assert.dom(".post-action-menu__delete").doesNotExist();
      assert.dom(".post-action-menu__flag").doesNotExist();
      assert.dom(".post-action-menu__like").doesNotExist();
      assert
        .dom('[data-video-shorts-native-comment] [class*="video-shorts-comment-row"]')
        .doesNotExist("the component does not recreate custom comment markup");

      this.post.set("cooked", "<p>Updated server-cooked comment</p>");
      await settled();
      assert
        .dom(".cooked")
        .hasText("Updated server-cooked comment", "store record updates stay live");
    });
  }
);
