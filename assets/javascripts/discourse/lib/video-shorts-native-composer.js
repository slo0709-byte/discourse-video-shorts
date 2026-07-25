import Composer from "discourse/models/composer";

const INVALID_TARGET_MESSAGE =
  "A valid Topic and Post from the same topic are required";

function isPositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function validateTarget(topic, post) {
  const validTopic =
    topic &&
    typeof topic === "object" &&
    !Array.isArray(topic) &&
    isPositiveInteger(topic.id) &&
    typeof topic.draft_key === "string" &&
    topic.draft_key.length > 0 &&
    Number.isSafeInteger(topic.draft_sequence) &&
    topic.draft_sequence >= 0;
  const validPost =
    post &&
    typeof post === "object" &&
    !Array.isArray(post) &&
    isPositiveInteger(post.id) &&
    isPositiveInteger(post.post_number) &&
    post.topic_id === topic?.id &&
    (!post.topic || post.topic === topic);

  if (!validTopic || !validPost) {
    throw new TypeError(INVALID_TARGET_MESSAGE);
  }
}

export function createVideoShortsNativeComposerBridge({
  composer,
  currentUser,
  showLogin,
}) {
  if (!composer || typeof composer.open !== "function") {
    throw new TypeError("A Discourse composer service is required");
  }

  if (typeof showLogin !== "function") {
    throw new TypeError("A native showLogin action is required");
  }

  const openReply = ({ topic, post }) => {
    validateTarget(topic, post);

    if (!currentUser) {
      return showLogin();
    }

    if (!topic.details?.can_create_post) {
      return false;
    }

    const postTarget = post.post_number === 1 ? null : post;

    return composer.open({
      action: Composer.REPLY,
      draftKey: topic.draft_key,
      draftSequence: topic.draft_sequence,
      post: postTarget,
      skipJumpOnSave: true,
      topic: postTarget ? undefined : topic,
    });
  };

  return {
    openPostReply: openReply,
    openTopLevelReply({ topic, sourcePost }) {
      return openReply({ topic, post: sourcePost });
    },
  };
}
