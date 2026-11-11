# Discourse Video Shorts Design System

## 1. Atmosphere & Identity

The Shorts route is a focused, low-chrome viewing surface inside Discourse. Its
signature is a single 9:16 media stage with familiar Discourse actions and
comments arranged like a short-video feed. It inherits the active Discourse
theme instead of introducing a separate brand palette.

## 2. Color

### Palette

| Role               | Token                               | Source                                                | Usage                              |
| ------------------ | ----------------------------------- | ----------------------------------------------------- | ---------------------------------- |
| Page surface       | `--video-shorts-page-background`    | `--secondary`                                         | Feed and route background          |
| Stage surface      | `--video-shorts-stage-background`   | `--primary-very-low`; black only for the media canvas | Video letterbox and placeholders   |
| Overlay surface    | `--video-shorts-overlay-background` | translucent black                                     | Sound and blocked-play controls    |
| Overlay text       | `--video-shorts-overlay-foreground` | `--secondary` / white on the media canvas             | Controls over video                |
| Primary text       | Discourse `--primary`               | active theme                                          | Desktop metadata and controls      |
| Muted text         | Discourse `--primary-medium`        | active theme                                          | Counts and secondary copy          |
| Interactive accent | Discourse `--tertiary`              | active theme                                          | Focus and selected action state    |
| Border             | Discourse `--primary-low`           | active theme                                          | Comments and continuation surfaces |
| Desktop control    | Discourse `--secondary`             | active theme                                          | PC action-button surface           |
| Desktop hover      | Discourse `--primary-very-low`      | active theme                                          | PC action-button hover surface     |
| Form control       | Discourse `--d-input-*` tokens      | active theme                                          | Reply and edit fields               |
| Error              | Discourse `--danger`                | active theme                                          | Inline failures                    |

### Rules

- Theme-aware Discourse variables are the source of truth outside the video
  canvas.
- Black and white are reserved for the media canvas and overlays where the
  underlying video makes theme colors unreliable.
- Action state uses the site's `--tertiary`; no plugin-specific brand color is
  introduced.

## 3. Typography

### Scale

| Level       | Token / value                               | Usage                        |
| ----------- | ------------------------------------------- | ---------------------------- |
| Title       | Discourse `--font-up-1` on desktop          | Video title                  |
| Panel title | Discourse `--font-up-1`                     | Comments heading             |
| Body        | inherited Discourse font and size           | Metadata, controls, editor   |
| Secondary   | Discourse `--font-down-1`                   | Author, excerpt, comment text |
| Count       | Discourse `--font-down-2`, tabular numerals | Action counts                |

### Font Stack

- Primary: inherited from the active Discourse theme.
- Mono: inherited from Discourse when rendered content requires it.
- No plugin font downloads.

### Rules

- Titles use balanced wrapping; prose uses pretty wrapping.
- User identifiers use `overflow-wrap: anywhere`; Chinese excerpts use
  `word-break: keep-all` with strict line breaking and a `break-word` overflow
  fallback so proper names remain readable without creating overflow. A short
  final Chinese phrase is rendered as an atomic inline box so narrow mobile
  layouts do not strand a single character and its punctuation on the last
  line.
- Counts use tabular numerals to prevent rail jitter.

## 4. Spacing & Layout

### Base Unit

Spacing follows a `0.25rem` (4px at the default root size) base.

| Token / step | Value              | Usage                               |
| ------------ | ------------------ | ----------------------------------- |
| Tight        | `0.25rem`          | Icon and compact action spacing     |
| Compact      | `0.5rem`           | Rail and editor gaps                |
| Standard     | `0.75rem` / `1rem` | Stage, panel, and form padding      |
| Comfortable  | `1.25rem` / `2rem` | Panel and desktop layout separation |

### Desktop geometry tokens

| Token                                                | Value      | Usage                                             |
| ---------------------------------------------------- | ---------- | ------------------------------------------------- |
| `--video-shorts-desktop-stage-max-width`             | `27.5rem`  | Closed-comments 9:16 stage ceiling                |
| `--video-shorts-desktop-comments-stage-min-width`    | `16.25rem` | Smallest stage beside an open comments panel      |
| `--video-shorts-desktop-comments-stage-max-width`    | `25rem`    | Open-comments stage ceiling                       |
| `--video-shorts-desktop-sidebar-stage-max-width`     | `22.5rem`  | Stage ceiling when Discourse's sidebar is present |
| `--video-shorts-desktop-rail-width`                  | `3.75rem`  | Dedicated action-rail grid column                 |
| `--video-shorts-desktop-stage-rail-gap`              | `1rem`     | Stage-to-rail separation                          |

### Desktop visual chrome

- The PC stage uses a one-pixel `--primary-low` border and a theme-derived
  shadow so its edge remains visible in light and dark themes.
- PC action buttons use `--secondary` surfaces, `--primary-low` borders,
  `--primary-very-low` hover surfaces, and `--tertiary` for active state.
- Desktop metadata follows the 4px spacing rhythm: 12px inset, 4px author gap,
  and 6px title gap. Its media backing remains translucent black because theme
  foreground colors cannot guarantee contrast over arbitrary video frames;
  the thin accent edge uses `--tertiary`.
- Mobile typography, spacing, transparent action chrome, and provider safety
  reserves remain unchanged.

All desktop geometry tokens resolve to multiples of the 4px base unit. Both
the route-shell layer and the component layer consume the same tokens so a
theme or layout adjustment cannot desynchronize the stage and action rail.

### Provider control reserves

| Provider  | Mobile metadata / rail | Desktop metadata | Measured embedded control geometry |
| --------- | ---------------------- | ---------------- | ---------------------------------- |
| YouTube   | `7.5rem / 7.5rem`      | `7.5rem`         | Mobile drag target occupies the band 52–96px above the stage bottom; bottom controls begin about 126px above it |
| Bilibili  | `4rem / 3.25rem`       | `3.25rem`        | Mobile control bar is 44px tall and the progress line sits about 21–23px above the stage bottom; metadata keeps an extra 0.75rem visual buffer |

These reserves apply only to trusted provider iframes. Native and HLS media
keep their existing overlay placement. Metadata clears provider controls at every
breakpoint; the mobile action rail consumes its own named reserve while the
desktop rail remains outside the stage.

### Grid and Scroll Ownership

- `.video-shorts-feed__items` is the sole vertical scroll owner for the feed.
- Desktop uses one fluid feed column and an optional `300–420px` comments
  column.
- The stage is a 9:16 frame, bounded by the dynamic viewport height.
- Mobile and tablet widths below 1024px use the full route height and width,
  override surrounding theme gutters, and hide the scroll-owner scrollbar
  without changing its native snap behavior.
- Comments own their internal list scroll; wheel events in the panel must not
  advance the feed.
- Metadata and the action rail are absolutely positioned overlays on the active
  stage. They never contribute intrinsic size to a snap item, and mutable
  metadata is excluded from scroll anchoring. Expanding or collapsing a
  description may grow upward, but cannot change the stage rectangle or feed
  scroll position.

### Rules

- Full-height calculations use dynamic/small viewport units, never `100vh`.
- Scrollable grid children keep `min-height: 0`.
- Intrinsic calculations and safe-area expressions remain raw browser
  mechanics rather than design tokens.

## 5. Components

### Shorts feed

- **Structure**: viewport → focusable snap list → full-height feed items.
- **Variants**: mobile full-screen; desktop; desktop with comments panel.
- **States**: loading is owned by the Discourse route, empty, continuation,
  error, active item, pending scroll candidate.
- **Accessibility**: keyboard navigation, `aria-current`, descriptive item
  labels, focus restored after comments close.
- **Motion**: smooth snap navigation; playback ownership follows the dominant
  item immediately, while URL and `aria-current` wait for scrolling to settle.
- **Layout**: bounded `scroll-body-shell`; the snap list is the scroll owner.

### Media stage

- **Structure**: one active player plus placeholder or conservative native-video
  prewarm for adjacent items.
- **Variants**: native MP4, active-only HLS, active-only trusted iframe,
  fallback link.
- **States**: active, adjacent prewarm, inactive placeholder, autoplay blocked,
  muted/unmuted, media error.
- **Accessibility**: inactive prewarm media is not interactive; active sound and
  play controls are labelled.
- **Motion**: no decorative animation; player activation follows intersection
  dominance so the previous provider is stopped before navigation state settles.
- **Layout**: `frame` with 9:16 aspect ratio or full mobile canvas.
- **Provider contract**: trusted iframe wrappers and frames expose the validated
  provider name. Provider-specific safe areas move plugin overlays away from
  the embedded player's own controls; no transparent proxy layer covers or
  attempts to forward cross-origin progress gestures.
- **Admin capability contract**: native Discourse site settings independently
  control whether YouTube and Bilibili items enter the Shorts feed. Disabling a
  provider never edits, hides, or replaces its original Discourse topic,
  comments, or native onebox/embed.

### Action rail

- **Structure**: native Discourse like, bookmark, reply, share, flag, and topic
  actions.
- **Variants**: light/dark theme and video-overlay placement.
- **States**: default, hover, focus, pressed, selected, pending, disabled, error
  rollback.
- **Accessibility**: like and bookmark expose `aria-pressed`; pending actions
  expose `aria-busy` and prevent duplicate requests.
- **Topic navigation**: the final action uses the registered
  `up-right-from-square` icon and links directly to the original post.
- **Motion**: micro feedback uses only `transform` and `opacity`.
- **Layout**: vertical `stack`.
- **Provider controls**: metadata ends above the measured YouTube or Bilibili
  control band at every breakpoint. On mobile, the rail also ends above that
  provider's own band instead of occupying the embedded progress area.
- **Mobile comments state**: while the bottom sheet is open, the background rail
  is non-painted and non-interactive until the sheet closes; the desktop rail
  remains visible beside its comments panel.

### Comments panel and sheet

- **Structure**: header, native Discourse post list, compact editor.
- **Variants**: desktop side panel and mobile bottom sheet.
- **States**: loading, empty, error, reply/edit, composer open.
- **Accessibility**: labelled panel, close control, keyboard-safe editor, native
  Discourse post actions.
- **Form controls**: borders, text, and backgrounds use Discourse semantic
  `--d-input-*` tokens. Focus paints exactly one border using
  `--d-input-border-focus` with `--tertiary` as fallback; the compact editor
  does not add a parallel plugin shadow ring.
- **Edit lifecycle**: the native Discourse comment subtree remains mounted,
  inert, and transparent beneath the compact edit form; cancel reveals the same
  node without rebuilding its PostMenu.
- **Motion**: desktop panel enters in 180ms. The mobile sheet stays at its final
  position while asynchronous comments mount, fading in over 120ms with
  `cubic-bezier(0.2, 0, 0, 1)` and out over 100ms with
  `cubic-bezier(0.4, 0, 1, 1)`. Its backdrop settles in the same 120ms window;
  reduced motion disables both sheet and backdrop animations.
- **Layout**: bounded nested `scroll-body-shell` with a named comment-list
  scroll owner.

### Mobile route back control

- **Structure**: a 44px transparent hit target with Discourse's `arrow-left`
  icon.
- **States**: default, hover, pressed, and focus-visible stay background-free;
  keyboard focus retains the shared theme focus ring.
- **Accessibility**: translated label and title identify the navigation action.
- **Motion**: no decorative animation.

## 6. Motion & Interaction

| Type                   | Duration             | Easing     | Usage                                       |
| ---------------------- | -------------------- | ---------- | ------------------------------------------- |
| Micro                  | `120ms`              | `ease-out` | Action press, selected and pending feedback |
| Chrome reveal          | `60ms` + `120ms`     | `ease-out` | Video-first metadata and action reveal       |
| Panel                  | `180ms`              | `ease-out` | Desktop comments panel                      |
| Mobile sheet enter     | `120ms`              | `cubic-bezier(0.2, 0, 0, 1)` | Fixed-position comments-sheet fade |
| Mobile sheet exit      | `100ms`              | `cubic-bezier(0.4, 0, 1, 1)` | Fixed-position comments-sheet fade |
| Scroll settle fallback | `120ms` quiet period | n/a        | Commit URL and `aria-current` navigation     |
| Scroll-driven          | native scroll snap   | browser    | Feed navigation                             |

Rules:

- Animate only `transform` and `opacity`, and avoid spatial motion when
  asynchronous content mounting could create a second perceived settle.
- The mobile comments sheet owns its container motion instead of inheriting
  Discourse's full-height modal slide. The container holds its final position,
  fades between `0.96` and `1`, and synchronizes the backdrop to the same
  120ms entrance window.
- On an item's first activation, reserve one complete media-only paint, then
  reveal metadata and the action rail together after a `60ms` delay with a
  `120ms` opacity transition. The DOM and layout slots exist from the first
  frame; returning to an already revealed item is immediate.
- `prefers-reduced-motion: reduce` disables non-essential transitions and
  smooth scrolling.
- Only the dominant item plays; adjacent native media may fetch metadata but
  remains paused and non-interactive.
- Opening or closing a lightweight editor never changes the feed's
  `scroll-snap-type`; input locking is limited to pointer and touch behavior.
- Expanding or collapsing metadata changes only the overlay's upper edge. The
  media stage, snap item, and feed scroll offset remain invariant.

## 7. Depth & Surface

Strategy: mixed, inherited from the existing plugin.

- The media stage uses `--video-shorts-shadow-stage`.
- Floating controls and the comments panel use
  `--video-shorts-shadow-floating`.
- Comments use a theme-aware border because it communicates containment.
- The mobile back control has no painted surface or elevation; only its
  focus-visible ring may draw around the hit target.
- Mobile full-screen media removes stage radius and shadow.

## 8. Accessibility Constraints & Accepted Debt

### Constraints

- Target WCAG 2.2 AA within the limits of the active Discourse theme.
- Every interactive element is keyboard reachable and has a visible focus
  state.
- Like and bookmark expose selected and busy states to assistive technology.
- Inactive preloaded media cannot add focus targets.
- Reduced-motion preferences are respected.

### Accepted Debt

| Item                                                                                            | Location    | Why accepted                                                               | Owner / Exit                                                        |
| ----------------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Live multi-theme, mobile/tablet/desktop visual verification depends on a running Discourse host | `/videos`   | This plugin repository does not include a standalone Discourse runtime     | Run route visual QA in the parent Discourse checkout before release |
| Existing raw media-canvas black/white values                                                    | Shorts SCSS | Video overlays require stable contrast across arbitrary themes and footage | Revisit only with a proven theme-aware media-overlay contrast model |
