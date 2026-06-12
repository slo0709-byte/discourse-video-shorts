import { ajax } from "discourse/lib/ajax";
import { i18n } from "discourse-i18n";
import { normalizeComment } from "discourse/plugins/discourse-video-shorts/discourse/lib/video-shorts-comments";

function responsePost(response) {
  return response?.post || response;
}

export async function createVideoShortsReply({
  item,
  raw,
  replyToPostNumber = item.post_number,
}) {
  const data = {
    archetype: "regular",
    draft_key: `topic_${item.topic_id}`,
    raw,
    topic_id: item.topic_id,
  };

  if (replyToPostNumber) {
    data.reply_to_post_number = replyToPostNumber;
  }

  const response = await ajax("/posts.json", {
    type: "POST",
    data,
  });

  if (response?.action === "enqueued") {
    return { action: "enqueued", post: null };
  }

  return { action: "created", post: normalizeComment(responsePost(response)) };
}

export function videoShortsReplyErrorMessage(error) {
  return (
    error?.jqXHR?.responseJSON?.errors?.[0] ||
    error?.payload?.errors?.[0] ||
    error?.message ||
    i18n("video_shorts.comments.publish_error")
  );
}
