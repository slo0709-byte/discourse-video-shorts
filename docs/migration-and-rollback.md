# Migration and rollback

## Scope

Normal deployment and rollback are plugin-scoped. They must preserve all core Discourse writes, including `Topic`, `Post`, `PostAction`, `Bookmark`, users, permissions, and uploads. Whole-database point-in-time recovery is not a normal plugin rollback.

The current plugin migrations create only:

- `video_shorts_origin_policies`: singleton external-media policy;
- `video_shorts_origin_policy_revisions`: append-only policy audit history;
- `video_shorts_comment_changes`: append-only realtime invalidations retained by the scheduled prune job.

There is no media-candidate index migration or backfill/reindex/repair job in the current implementation.

## Pre-deploy record

Retain the immutable old and new artifact/image SHAs, old site settings, Discourse tag `v2026.7.0-latest` and commit `ded677e00beb0e9bae6e70b69582aecfb72b5477`, asset manifests, Hls.js checksum/SBOM, plugin-table export, migration state, and database backup/PITR capability. Verify the disaster capability can meet RPO at most 5 minutes and RTO at most 60 minutes; otherwise block release.

## Required staging old -> new -> old rehearsal

1. On a production-equivalent clone, run an old-version smoke check.
2. While old is active, record test core content and interactions.
3. Deploy new with `video_shorts_enabled=false`; migrate, rebuild assets, restart, and smoke normal core routes plus the disabled feature.
4. Configure a canary group, enable the feature, and exercise the approved matrix. During new, create ordinary topics, posts, comments, likes, and bookmarks and record their IDs/timestamps.
5. Set `video_shorts_enabled=false` and `external_media_enabled=false`. Stop and verify zero active or scheduled plugin jobs, including `PruneVideoShortsCommentChanges`; record the last known checkpoint where applicable.
6. Restore the immutable old artifact and old settings, rebuild assets, restart, and smoke old behavior.
7. Prove every core write made before and during new still exists and remains usable. Confirm new jobs are zero, new routes/assets have no background activity, error rate returns to baseline, and the old homepage/topic/login/comment paths work.

Do not record this rehearsal as passed without retained raw evidence. It is a release blocker when absent or when any core write is lost.

## Routine production rollback

1. Disable external media, then set `video_shorts_enabled=false`.
2. Stop plugin jobs and verify they are neither queued nor executing. Preserve job/checkpoint evidence.
3. Restore the recorded old immutable artifact/image and exact old settings. Rebuild assets, restart application processes, and run core plus old-plugin smoke checks.
4. Retain all plugin tables by default. The old version must ignore unknown plugin-owned tables. Do not run migration `down` during the incident and do not delete audit/change tables as cleanup.
5. If a compatibility matrix explicitly requires plugin-table handling, first export those tables and use only a separately rehearsed plugin-scoped restore or safe down migration. Never touch core tables.
6. Verify core writes are preserved, new job count is zero, new route/asset activity is zero, and errors return to baseline before closing rollback.

## Upgrade and downgrade behavior

Upgrade creates the policy singleton with `external_media_enabled=false`, revision `0`, and no origins, then creates comment-change storage. Existing site-setting values retain Discourse's stored values; new settings use their declared defaults. Keep the feature disabled until migration, diagnostics, canary, and evidence checks complete.

Downgrade normally restores code and settings while retaining plugin tables and revisions. The comment-change prune job must be stopped before old code runs. Retained tables are inert when old code does not reference them and remain available for audit or a later re-upgrade.

## Disaster PITR only

PITR is permitted only for site-wide data corruption when plugin-scoped recovery is ineffective and the incident commander, DBA, and security owner approve it in writing. Enter maintenance mode and stop writes; record the incident point and last consistent point. Restore to an isolated database, validate it, then cut over. Reconcile normal core writes between the restore point and write stop through the supported audit/WAL/business-event process with deduplication. If complete reconciliation cannot be proved, remain read-only and escalate.

After PITR, verify topics, posts, post actions, bookmarks, user counts, permissions, attachments, and plugin tables before reopening writes. Meeting RPO <= 5 minutes and RTO <= 60 minutes is mandatory; a backup that cannot meet them blocks release rather than changing the thresholds. Returning to pre-deploy row counts is not proof of successful recovery.
