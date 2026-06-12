# Discourse Video Shorts

Discourse plugin that adds a fixed `/videos` page and `/videos.json` feed for a Shorts-style vertical video experience backed by existing Discourse topics and posts.

## UX Contract

`/videos` is a Discourse-compatible vertical short-video feed. On desktop, it uses a YouTube Shorts-style structure inside the normal Discourse shell: a centered 9:16 player, an adjacent action rail, and an expandable right comments/context panel. On mobile, it becomes a route-scoped fullscreen player that hides Discourse chrome only while the viewer stays on `/videos`, with the action rail overlaid on the right side and comments opening as a bottom sheet.

The page is not an ordinary 16:9 video list and it is not an exact YouTube or TikTok clone. Metadata stays on the player stage, but likes, bookmarks, replies, shares, flags, and topic navigation continue to use Discourse-native behavior and permissions.

Comments open in context instead of navigating away from `/videos`. Desktop uses the right comments/context panel; mobile uses the bottom sheet. V1 comments are direct replies to the source video post from Discourse core `GET /posts/:post_id/replies.json`; they are not a full topic timeline or nested thread view. Publishing a reply from the panel/sheet posts through Discourse core post creation, stays on `/videos`, and refreshes/appends the direct replies in place. Anonymous write attempts use the native login flow without opening the topic route.

## Install

Place this plugin in a Discourse checkout's `plugins` directory and rebuild/restart Discourse using your normal plugin deployment process.

For local development in this workspace:

```bash
ln -s /root/shipinye/discourse-video-shorts /root/shipinye/discourse/plugins/discourse-video-shorts
cd /root/shipinye/discourse
LOAD_PLUGINS=1 bundle exec rspec plugins/discourse-video-shorts/spec
```

The plugin does not require Discourse core modifications.

## Settings

Enable and configure the feed from site settings:

- `video_shorts_enabled`: enables `/videos` and `/videos.json`.
- `video_shorts_source_category_ids`: pipe-delimited category ids. Matching is exact category only.
- `video_shorts_source_tag_names`: pipe-delimited tag names. Tags are ignored when Discourse tagging is disabled.
- `video_shorts_page_size`: default page size, clamped to 1-50.
- `video_shorts_candidate_scan_limit`: candidate scan limit, clamped to 1-1000.
- `video_shorts_debug_mode`: staff-facing diagnostics only.

Source matching is topic-level OR semantics: a post is eligible when its topic matches any configured source category or any configured source tag. Replies inherit their topic category and tags for source matching.

## Admin

The plugin registers a current Discourse admin plugin page at Admin > Plugins > Video Shorts. The custom Diagnostics tab summarizes feed health, effective sources, source warnings, provider counts, renderability counts, and a bounded sample of recent video candidates. The native Discourse Settings tab remains the source of truth for editing plugin settings.

The diagnostics API is admin-only at:

```text
/admin/plugins/discourse-video-shorts/diagnostics.json
```

Diagnostics are intentionally separate from public `/videos.json`; public feed responses do not include staff/admin configuration warnings.

## Hosted Video Uploads

Hosted videos use Discourse uploads already attached to posts. Configure Discourse core upload settings for your community before expecting hosted videos to appear, including allowed video extensions and upload size limits such as:

- `authorized_extensions`
- `authorized_extensions_for_staff`
- `theme_authorized_extensions`
- `max_attachment_size_kb`

This plugin does not transcode uploads and does not add an upload UI.

## Supported Media

The v1 extractor emits at most one feed item per post.

Supported native uploads:

- MP4
- WebM
- MOV/M4V when permitted by core upload settings

Provider links and cooked embeds:

- Bilibili canonical URLs such as `https://www.bilibili.com/video/BV...`
- Already-cooked Bilibili player iframe URLs
- Already-cooked YouTube iframe URLs
- Already-cooked Vimeo iframe URLs
- Raw YouTube page URLs normalized to YouTube embed URLs
- Raw Vimeo page URLs as known-provider fallbacks

Current provider contract is allowlist-based: trusted YouTube, Bilibili, and Vimeo embeds are serialized as `renderability: "iframe_candidate"` with a sanitized HTTPS `embed_url`, then revalidated in the browser before an iframe is rendered. Unsupported, malformed, non-HTTPS, or non-allowlisted provider URLs render a labeled topic fallback when their item is active. `b23.tv` expansion is out of scope for v1.

Discourse CSP must allow the trusted iframe providers in `frame-src`. The expected provider allowance includes `self`, `http:`, `https:`, `https://www.youtube.com`, `https://www.youtube-nocookie.com`, `https://player.bilibili.com`, and `https://player.vimeo.com`.

## Native Actions

The action rail reuses Discourse behavior:

- Like: `/post_actions`
- Bookmark: Discourse bookmark API
- Reply/comments: opens the right comments panel on desktop or bottom sheet on mobile; publishing stays on `/videos` and creates a Discourse reply to the source post
- Share: Discourse share modal
- Flag/report: Discourse flag modal
- Open topic: stable post URL
- Anonymous restricted actions: standard login route

There is no custom like, save, comment, share, or report system.

## Browser Behavior

Native videos are muted, inline, looped, and controlled by the active feed item. Native video elements are active-only: offscreen native items render placeholders and do not keep a mounted `<video>`.

Trusted provider iframes are also active-only. The active provider item renders a real iframe after snap or keyboard navigation; offscreen provider items render placeholders instead of eagerly loading every third-party iframe in the response page. Provider iframe playback controls remain provider-owned.

The desktop comments panel and mobile bottom sheet have their own scroll containers. Scrolling, Space, and ArrowDown while focus is inside comments or the reply input do not advance the video feed.

Keyboard shortcuts are scoped to the focused feed surface:

- Space: play/pause active native video
- M: mute/unmute active native video
- ArrowDown or J: next item
- ArrowUp or K: previous item

The plugin does not bind single-key shortcuts for native actions such as like, reply, or share.

## QA Seed Data

Automated tests use factories and a tiny MP4 fixture at:

```text
spec/fixtures/files/tiny-video.mp4
```

For local browser QA, use the seed script from the Discourse checkout:

```bash
cd /root/shipinye/discourse
RAILS_ENV=development LOAD_PLUGINS=1 bundle exec rails runner plugins/discourse-video-shorts/script/seed_video_shorts_qa.rb
```

The seed covers:

- native MP4 post
- Bilibili canonical URL
- cooked Bilibili iframe
- cooked YouTube iframe
- cooked Vimeo iframe
- private category video
- unsupported intended-video URL
- non-video post

## Test Commands

Backend/plugin regression:

```bash
cd /root/shipinye/discourse
LOAD_PLUGINS=1 bundle exec rspec plugins/discourse-video-shorts/spec
```

Frontend formatting and lint:

```bash
cd /root/shipinye/discourse
pnpm prettier --check --no-error-on-unmatched-pattern 'plugins/discourse-video-shorts/{assets,test}/javascripts/**/*.{js,gjs}' 'plugins/discourse-video-shorts/assets/stylesheets/**/*.scss'
pnpm eslint plugins/discourse-video-shorts/assets/javascripts plugins/discourse-video-shorts/test/javascripts --no-error-on-unmatched-pattern --max-warnings 0
pnpm stylelint 'plugins/discourse-video-shorts/assets/stylesheets/**/*.scss'
```

Frontend QUnit when a browser is available:

```bash
cd /root/shipinye/discourse
LOAD_PLUGINS=1 bin/qunit --standalone --target discourse-video-shorts plugins/discourse-video-shorts/test/javascripts/acceptance/videos-route-test.js
```

## Troubleshooting

- Empty feed for anonymous users: verify source categories/tags point to public visible topics with regular posts containing supported media.
- Empty feed for staff/admins: open Admin > Plugins > Video Shorts and validate category/tag settings in the Diagnostics tab.
- Hosted upload missing: verify the upload is attached to the post and core upload settings allow the extension.
- Provider embed does not play inline: v1 intentionally falls back to the Discourse post unless iframe renderability has explicit browser/CSP evidence.
- Comments do not show nested conversation: v1 intentionally shows direct replies to the source video post only, not the full topic timeline.
- Pagination returns `invalid_cursor`: source settings changed, the cursor was tampered with, or the cursor belongs to a different user/anonymous identity.

## V1 Exclusions

Out of scope for v1:

- recommendation algorithms or ML ranking
- adaptive streaming or transcoding
- custom upload/creator studio UI
- `b23.tv` short-link expansion
- arbitrary iframe support
- full topic timelines or nested replies inside the comments sheet
- custom comments, likes, saves, or reports
