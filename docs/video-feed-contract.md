# Video Feed API Contract

Endpoint: `GET /videos.json`

Status: v1 vertical short-feed contract. The server emits only visible Discourse posts with supported native media or normalized provider media. The browser renders a Discourse-compatible 9:16 snap feed and revalidates provider iframe candidates before creating iframe elements.

`/videos` keeps Discourse permissions, topic links, reply creation, and native post actions. On desktop, it uses a YouTube Shorts-style layout inside the normal shell: centered 9:16 snap-scrolled player, adjacent action rail, and an expandable right comments/context panel. On mobile, it is route-scoped fullscreen and hides Discourse chrome only while the viewer remains on `/videos`; the action rail overlays the player on the right and comments open in a bottom sheet. It is not a 16:9 list, not an exact YouTube clone, and does not add custom likes, comments, saves, shares, or reports.

Comments are read without route navigation. V1 uses native Discourse post JSON only: opening comments starts from direct replies to the source video post through Discourse core `GET /posts/:post_id/replies.json`, and visible descendant branches load through the same replies endpoint for each parent post. It does not embed the full topic route, `PostStream`, or a custom comments store. The payload remains native Discourse post JSON, including fields such as `reply_to_post_number`, `reply_count`, and `actions_summary`, so clients can load visible descendant replies and wire native actions without plugin-defined action enums. Publishing from the comments panel/sheet calls Discourse core post creation with the source `topic_id` and `reply_to_post_number`, stays on `/videos`, and refreshes/appends replies in context. Anonymous write attempts use the native login flow.

## Query

- `page_size`: non-integer, missing, or `<= 0` uses configured default; values above 50 clamp to 50.
- `scan_limit`: non-integer, missing, or `<= 0` uses configured default; values above 1000 clamp to 1000.
- `cursor`: opaque signed token returned by a previous response.

Invalid, tampered, identity-mismatched, or source-scope-mismatched cursors return HTTP 400:

```json
{ "error": "invalid_cursor" }
```

## Response

```json
{
  "items": [],
  "next_cursor": null,
  "scan_limit_reached": false
}
```

Each item:

```json
{
  "topic_id": 123,
  "post_id": 456,
  "post_number": 2,
  "topic_url": "/t/topic-slug/123",
  "post_url": "/t/topic-slug/123/2",
  "title": "Topic title",
  "excerpt": "Plain cooked excerpt",
  "username": "author",
  "avatar_template": "/user_avatar/...",
  "created_at": "2026-06-07T00:00:00.000Z",
  "counts": {
    "like_count": 1,
    "reply_count": 0,
    "bookmark_count": 0
  },
  "actions": {
    "liked": false,
    "can_like": true,
    "bookmarked": false,
    "bookmark_id": null,
    "can_bookmark": true,
    "can_flag": true,
    "can_reply": true,
    "share_url": "/t/topic-slug/123/2"
  },
  "native_action_summary": [
    {
      "id": 2,
      "count": 1,
      "can_act": true
    }
  ],
  "media": {
    "provider": "native",
    "renderability": "native",
    "dedupe_key": "native:upload:1",
    "video_url": "/uploads/default/original/1X/example.mp4",
    "upload_id": 1
  }
}
```

Provider iframe media:

```json
{
  "provider": "bilibili",
  "renderability": "iframe_candidate",
  "embed_url": "https://player.bilibili.com/player.html?bvid=BV1Q541167Qg&page=1",
  "dedupe_key": "bilibili:BV1Q541167Qg:page:1"
}
```

Provider fallback media:

```json
{
  "provider": "unsupported",
  "renderability": "fallback",
  "fallback": "post",
  "fallback_reason": "unsupported_intended_video",
  "dedupe_key": "unsupported:..."
}
```

Rules:

- Candidate scan order is `post.created_at DESC, post.id DESC`.
- Cursor resumes after the last scanned candidate, not merely the last emitted item.
- Cursor source-scope digest comes from `DiscourseVideoShorts::SourceSelection`; source setting changes invalidate old cursors, but `page_size` changes do not.
- Logged-in cursors bind to `current_user.id`; anonymous cursors bind to `anonymous`.
- The endpoint scans until it emits `page_size` items, reaches EOF, or hits `scan_limit`.
- `scan_limit_reached=true` means a partial page is acceptable and the client should use `next_cursor` to continue.
- Dedupe is per response page by server-produced `media.dedupe_key`.
- Cross-page duplicate media is allowed in v1.
- Native upload URLs are emitted only after post visibility is confirmed and through current Discourse URL helpers.
- Provider media includes `embed_url` only when `renderability` is `iframe_candidate` and the server has normalized it to a trusted HTTPS allowlisted provider URL. Fallback provider media must not include `embed_url`.
- `native_action_summary` mirrors Discourse `PostSerializer#actions_summary` for native post action flows such as like and flag/report; clients must treat action ids as Discourse-provided values, not plugin-defined enums.
- `counts.reply_count` is the count of visible comments under the video item, not only the direct `Post#reply_count`: OP video posts count visible topic comments excluding the source post; non-OP video posts count visible descendants through `PostReply`. Hidden, deleted, or inaccessible replies are excluded.

## Browser Rendering Rules

- Feed items are displayed as a centered vertical 9:16 player stage inside the Discourse route outlet.
- Desktop renders the action rail adjacent to the player stage, not covering the video, and opens comments in a right comments/context panel.
- Mobile renders the player fullscreen, overlays the action rail on the right side, and opens comments in a bottom sheet.
- `.video-shorts-feed__items` is the vertical mandatory scroll-snap container.
- Metadata stays inside `.video-shorts-item__stage`.
- Native videos are active-only. Offscreen native items render placeholders and do not keep mounted `<video>` elements.
- Provider `iframe_candidate` media is active-only and renders only after the browser revalidates provider, protocol, host, and path. Offscreen provider items render placeholders and do not keep mounted iframes.
- Unsupported or unsafe provider media renders a fallback topic link when the item is active.
- The right comments panel and bottom sheet own their scroll containers. Feed keyboard shortcuts are ignored while focus is inside comments, dialogs, or reply inputs.
- Reduced-motion preference keeps feed scroll behavior non-animated.

## CSP Requirements

Trusted provider iframes require a compatible Discourse `frame-src` policy. The plugin contract expects `frame-src` to include `self`, `http:`, `https:`, `https://www.youtube.com`, `https://www.youtube-nocookie.com`, `https://player.bilibili.com`, and `https://player.vimeo.com`. Provider candidates still revalidate protocol, host, and path in the browser before rendering an iframe.

## Comments Contract

The action rail comments button uses `[data-action="open-comments"]`. On desktop it opens `.video-shorts-comments-panel` in the `/videos` layout. On mobile it opens `.video-shorts-comments-sheet` in a Discourse `DModal` bottom sheet. Opening comments must not change `location.pathname` away from `/videos` and must not immediately open the composer or the topic route.

The sheet loader consumes native Discourse serialized posts from the core replies array. Opening comments loads only direct replies to the source video post through `GET /posts/:post_id/replies.json` and must not fan out into child branch requests or topic-route batches.

Child replies are collapsed by default at every depth. Any rendered post with `reply_count > 0` exposes the localized `[data-video-shorts-view-replies]` branch control. Its visible label is the generic localized "view more" text without a numeric count; source `reply_count` remains available only for branch state, pagination, and accessible labels. Clicking that control fetches one direct child page for that parent through `GET /posts/:post_id/replies.json`; double-clicks dedupe to one branch request, stale responses are ignored, and grandchildren stay collapsed until their own branch control is used. Paginated branches expose `[data-video-shorts-load-more-replies]` based on the remaining source count.

Reply descendants are not rendered as child rows until the matching parent branch is opened. Counts shown in the action rail, desktop panel, mobile sheet title, and count mutation events stay source/server based and must not be replaced by the number of currently loaded DOM rows. Reply publish and delete flows may refresh only the affected parent branch; unrelated collapsed branches remain collapsed.

Lazy branch loading is scoped to comments. It does not change native HLS/video rendering, provider iframe validation, or the stable action rail comments selector `[data-action="open-comments"]`.

Regression coverage must preserve those boundaries: acceptance tests assert that opening comments performs only the top-level direct-replies load, performs zero branch requests before a `[data-video-shorts-view-replies]` click even when multiple parents have `reply_count`, keeps descendants collapsed until their branch is opened, and keeps server/source counts visible while branches are unloaded. Static safety checks must continue to reject clone/CDN shortcuts and unsafe rendering patterns such as `innerHTML`, `data-lucide`, Tailwind CDN usage, `@ts-ignore`, `@ts-expect-error`, `as any`, and synthetic raw `@username` reply bodies.

The native reply objects include Discourse serializer fields such as:

```json
{
  "id": 456,
  "post_number": 2,
  "reply_to_post_number": 1,
  "reply_count": 3,
  "actions_summary": [
    {
      "id": 2,
      "count": 1,
      "can_act": true
    }
  ]
}
```

The comments UI normalizes each rendered reply to:

```json
{
  "id": 456,
  "post_id": 456,
  "post_number": 2,
  "username": "reply-author",
  "avatar_template": "/user_avatar/...",
  "cooked": "<p>Reply body</p>",
  "created_at": "2026-06-08T00:00:00.000Z",
  "post_url": "/t/topic-slug/123/2"
}
```

Pagination is adapter-derived: a core replies page of 20 items means `hasMore=true`, and `nextAfter` is the last rendered `post_number`. Empty arrays render an empty state; HTTP errors render an error state.

The comments Reply action opens an in-context reply field for logged-in users. Successful publish posts to Discourse core with `topic_id`, `raw`, `draft_key`, and source `reply_to_post_number`; the page remains on `/videos`, the active video stays active, the direct replies list appends or refreshes without duplicates, and the reply count updates in the action rail and comments title. Server validation and pending/enqueued responses render inside the panel/sheet without topic navigation.
