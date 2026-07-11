# Discourse Video Shorts

Discourse plugin providing `/videos` and `/videos.json` for a vertical-video feed backed by Guardian-visible Discourse posts.

## Install

Set `DISCOURSE_ROOT` to a Discourse checkout and install this repository as its plugin:

```bash
export DISCOURSE_ROOT=/path/to/discourse
ln -s "$(pwd)" "$DISCOURSE_ROOT/plugins/discourse-video-shorts"
```

The plugin requires no Discourse core modifications.

## Configuration and administration

Enable the plugin and select source categories and/or tags in the native plugin settings. Source matching is category **OR** tag, and every feed response is filtered by the requesting user's Guardian permissions.

Administrators manage external-media policy at **Admin > Plugins > Video Shorts**. External media is disabled by default. When enabled, each allowed origin must be one exact, normalized HTTPS origin; wildcards, HTTP origins, and unlisted origins are rejected. Policy changes create a revision, and clients invalidate media authorized under an earlier revision.

## Approved media

The feed accepts at most one media item per post:

- Discourse-uploaded MP4 files when permitted by Discourse upload settings.
- HTTPS YouTube videos, rendered through the approved YouTube embed URL.
- HTTPS Bilibili canonical video URLs, rendered through the approved Bilibili player URL.
- External HTTPS MP4 URLs from an administrator-approved exact origin.
- External HTTPS HLS (`.m3u8`) URLs from an administrator-approved exact origin.

Vimeo, MOV, WebM, and M4V are not supported. Invalid, non-HTTPS, or policy-denied media stays a labeled post fallback rather than loading inline.

External MP4 and HLS requests are made only after the browser has the current policy snapshot. HLS manifests, variants, segments, initialization data, subtitles, and keys are checked against the same revision-bound exact HTTPS origin set; denied or stale requests fail closed.

## Native actions and comments

Likes and bookmarks remain native Discourse actions. Replies, shares, and flags also use native Discourse behavior and permissions.

Comments remain in `/videos`: desktop uses a side panel and mobile uses a sheet. The client receives a Guardian-filtered comment snapshot, applies secure comment deltas, and renews per-source Guardian authorization leases every five seconds. A denied, expired, or invalidated lease closes/refreshes the affected comments surface instead of exposing stale content.

## Test commands

From the Discourse root:

```bash
cd "$DISCOURSE_ROOT"
LOAD_PLUGINS=1 bundle exec rspec plugins/discourse-video-shorts/spec
LOAD_PLUGINS=1 bin/qunit --standalone --target discourse-video-shorts plugins/discourse-video-shorts/test/javascripts/acceptance/videos-route-test.js
```

## Hls.js supply chain

`public/javascripts/hls.min.js` is the vendored Hls.js 1.6.16 runtime. Its upstream source and Apache-2.0 attribution are recorded in `vendor/hls.LICENSE.txt`; `vendor/SBOM.spdx.json` records the package-to-file relationship and checksum.

Verify the exact runtime bytes from the Discourse checkout root:

```bash
sha256sum --check plugins/discourse-video-shorts/vendor/hls.js.lock.sha256
```
