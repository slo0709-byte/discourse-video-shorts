import { ajax } from "discourse/lib/ajax";
import { normalizeComment } from "discourse/plugins/discourse-video-shorts/discourse/lib/video-shorts-comments";

function responsePost(response) {
  return response?.post || response;
}

export async function fetchVideoShortsComment(postId) {
  const response = await ajax(`/posts/${postId}.json`);

  return normalizeComment(responsePost(response));
}

export async function updateVideoShortsComment({ postId, raw }) {
  const response = await ajax(`/posts/${postId}.json`, {
    type: "PUT",
    data: {
      post: { raw },
    },
  });

  return normalizeComment(responsePost(response));
}

export async function deleteVideoShortsComment(postId) {
  await ajax(`/posts/${postId}.json`, {
    type: "DELETE",
  });
}
