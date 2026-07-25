import PostStream from "discourse/models/post-stream";
import Topic from "discourse/models/topic";
import TopicDetails from "discourse/models/topic-details";

function positiveInteger(value) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }

  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    return null;
  }

  const normalized = Number(value);

  return Number.isSafeInteger(normalized) ? normalized : null;
}

function topicSlug(topicUrl, topicId) {
  if (typeof topicUrl !== "string") {
    return "topic";
  }

  try {
    const { pathname } = new URL(topicUrl, "https://discourse.invalid");
    const segments = pathname.split("/").filter(Boolean);

    if (
      segments[0] === "t" &&
      segments.length >= 3 &&
      positiveInteger(segments[2]) === topicId
    ) {
      return segments[1];
    }
  } catch {}

  return "topic";
}

export function createVideoShortsNativeTopic(item, store) {
  if (!store || typeof store.createRecord !== "function") {
    throw new TypeError("A Discourse store is required");
  }

  if (!item || typeof item !== "object" || Array.isArray(item)) {
    throw new TypeError("A video shorts feed item is required");
  }

  const topicId = positiveInteger(item.topic_id);
  const postId = positiveInteger(item.post_id);
  const postNumber = positiveInteger(item.post_number);

  if (topicId === null || postId === null || postNumber === null) {
    throw new TypeError(
      "Video shorts topic, post, and post number ids must be positive integers"
    );
  }

  const title = typeof item.title === "string" ? item.title : "";
  const isolatedStore = Object.create(store);

  isolatedStore.createRecord = (type, attributes = {}) => {
    if (type === "postStream") {
      return PostStream.create({
        ...attributes,
        store: isolatedStore,
        __type: "postStream",
        __state: "created",
      });
    }

    if (type === "topicDetails") {
      return TopicDetails.create({
        ...attributes,
        store: isolatedStore,
        __type: "topicDetails",
        __state: "created",
      });
    }

    return store.createRecord(type, attributes);
  };

  const details = TopicDetails.create({
    id: topicId,
    can_create_post: Boolean(item.actions?.can_reply),
    can_edit_staff_notes: Boolean(
      item.topic_details?.can_edit_staff_notes
    ),
    participants: [],
    store: isolatedStore,
    __type: "topicDetails",
    __state: "created",
  });

  return Topic.create({
    id: topicId,
    slug: topicSlug(item.topic_url, topicId),
    title,
    fancy_title: title,
    archetype: "regular",
    draft_key: `topic_${topicId}`,
    draft_sequence: 0,
    posters: [],
    details,
    store: isolatedStore,
    __type: "topic",
    __state: "created",
  });
}
