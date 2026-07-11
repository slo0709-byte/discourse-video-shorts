# Settings compatibility

## Site settings

These are the complete keys declared by `config/settings.yml`:

| Key | Type | Default | Client-visible | Compatibility notes |
|---|---|---:|---|---|
| `video_shorts_enabled` | boolean | `false` | yes | Full kill switch. False makes the page/feed unavailable. |
| `video_shorts_source_category_ids` | `category_list` | empty string | no | Pipe-delimited storage is normalized by Discourse; category and tag selection use OR. |
| `video_shorts_source_tag_names` | `tag_list` | empty string | no | Names are matched case-insensitively by effective source selection; requires Discourse tagging for tag matches. |
| `video_shorts_excerpt_character_limit` | integer, min `1` | `120` | yes | Controls serialized/displayed excerpt length. |
| `video_shorts_page_size` | integer, min `1` | `20` | no | Requested page size is capped by this configured value; do not raise it to evade performance gates. |
| `video_shorts_candidate_scan_limit` | integer, min `1` | `500` | no | Bounded candidate scan ceiling; the approved release contract is at most 500/request. |
| `video_shorts_debug_mode` | boolean | `false` | no | Server diagnostic behavior only; not a release-evidence substitute. |
| `video_shorts_canary_group_ids` | `group_list`, `allow_any: false` | empty string | no | Nonempty restricts access to listed groups; empty permits all otherwise eligible authenticated members. |

`external_media_enabled`, exact origins, and policy revision are deliberately not site settings. They live in `video_shorts_origin_policies` and are changed atomically through the admin origins controller so revision and audit history cannot be bypassed.

## Upgrade rules

1. Export all eight site-setting values and the current external policy before changing artifacts.
2. New installs receive the defaults above and therefore start disabled, with no source selection, no canary restriction, and external media disabled at policy revision `0`.
3. Discourse preserves stored values for existing keys across plugin upgrade. Do not silently convert category IDs to tag names, group IDs to names, or empty canary to a deny-all value.
4. Keep `video_shorts_enabled=false` while applying migrations and assets. Re-enable first for an explicit canary audience.
5. Never copy an origin list into a site setting or edit policy tables directly. Use the admin origin API so normalization, locking, revision increment, actor, and append-only audit apply.
6. A changed Discourse tag/commit requires compatibility evidence before relying on the stored list types or client exposure contract.

## Downgrade and rollback rules

Restore the exact captured old settings with the old immutable artifact. Disable the main switch before rollback and retain current plugin policy/audit/comment-change tables unless a separately rehearsed plugin-scoped procedure says otherwise. Old code must ignore unknown settings and tables.

Do not map `external_media_enabled` to `video_shorts_enabled`: the former controls only approved external MP4/HLS, while the latter controls the entire page and API. Do not lower the policy revision or restore an old revision row as current. After re-upgrade, clients must fetch a fresh policy/feed snapshot; old ETags and signed cursors are not compatibility guarantees.

## Operational validation

After any settings change, inspect admin diagnostics for configured/effective source lists, canary audience, scan/page limits, kill switch, and policy revision. Check access as an anonymous user, a logged-in nonmember, and a canary member. Empty sources must yield an empty authorized feed; a disabled main switch must yield 404. These checks verify configuration only and do not mean staging, browser/device, performance, visual, security, or rollback release gates passed.
