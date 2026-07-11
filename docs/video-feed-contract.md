# Video Feed API Contract

`GET /videos.json` returns the version-1 Discourse Shorts feed. It exposes only regular, non-deleted posts whose topic matches at least one configured source category or tag and which the request Guardian can see. Source matching is category **OR** tag. Both first posts and replies are candidates, ordered by `(posts.created_at, posts.id) DESC`.

## Access and errors

The plugin switch being off returns `404 {"error":"not_found"}` and never emits feed data. Authorization failures return `403 {"error":"forbidden"}`; resources not visible to the requester return `404 {"error":"not_found"}`. Rate limiting returns `429 {"error":"rate_limited","retry_after":60}` and a `Retry-After` header. Database capacity failures return `503 {"error":"temporarily_unavailable"}`.

A cursor that is missing required fields, has an invalid signature, belongs to another user, or was produced for a different source, policy, canary, or schema revision returns:

```json
{ "error": "invalid_cursor" }
```

with HTTP 400.

## Query and paging

- `page_size` defaults to the site setting and is clamped to `1..20`.
- `scan_limit` defaults to the site setting and is clamped to `1..500`.
- `cursor` is an opaque signed server token. Clients must not construct or modify it.
- The cursor binds the authenticated identity (or `anonymous`), feed revision, last scanned `(created_at,id)`, and every already emitted media identity.

The server scans at most 500 candidates per request. It resumes after the last **scanned** candidate, not the last emitted item, and emits at most one media item for a post. Duplicate media identities are suppressed across every page represented by the signed cursor. This is the A1 bounded keyset-scan implementation; media extraction remains behind `MediaExtractorCache.extract_media_for_visible_post` so a future A2 candidate source can replace scanning without changing the response contract.

When scan budget is exhausted before database EOF, `next_cursor` is non-null and `scan.scan_limit_reached` is true, including valid empty item pages. Clients continue sequentially without showing a load-more control. Only actual candidate EOF has `next_cursor: null` and `scan.end_reached: true`.

## Success response

```json
{
  "schema_version": 1,
  "feed_revision": "signed source-policy-canary-schema digest",
  "items": [],
  "next_cursor": null,
  "scan": {
    "candidates_scanned": 0,
    "scan_limit_reached": false,
    "end_reached": true
  }
}
```

An authorized requester with no effective sources receives that exact empty terminal shape. `feed_revision` changes when the source scope, policy revision, canary audience digest, or schema version changes.

Every item has exactly these top-level fields:

```json
{
  "topic_id": 1,
  "post_id": 2,
  "post_number": 1,
  "topic_url": "/t/topic/1",
  "post_url": "/t/topic/1/1",
  "title": "Topic title",
  "excerpt": "Plain excerpt",
  "username": "author",
  "avatar_template": "/user_avatar/...",
  "created_at": "2026-07-10T00:00:00.000Z",
  "counts": { "like_count": 0, "reply_count": 0, "bookmark_count": 0 },
  "actions": {
    "liked": false,
    "bookmarked": false,
    "can_like": false,
    "can_bookmark": false,
    "can_reply": false,
    "can_flag": false,
    "share_url": "/t/topic/1/1"
  },
  "media": {
    "kind": "bilibili|youtube|upload_mp4|external_mp4|external_hls|fallback",
    "identity": "non-secret identity",
    "url": "only present when authorized",
    "required_origins": ["https://media.example"],
    "policy_revision": 7,
    "fallback_reason": null
  }
}
```

`counts.reply_count` is the current Guardian-visible regular descendant count; hidden and deleted replies are excluded. Like, bookmark, reply, and flag capabilities are native Discourse capabilities. The endpoint never serializes native action summaries, bookmark IDs, raw media URLs, media extractor dedupe keys, or data from an unauthorized post. External-media identities are versioned HMAC values, while provider and upload identities are normalized non-secret identifiers.
