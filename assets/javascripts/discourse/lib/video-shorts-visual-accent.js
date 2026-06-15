import { trustHTML } from "@ember/template";

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function videoShortsVisualAccentColor(item) {
  const candidate =
    item?.visual_accent_color || item?.accent_color || item?.category_color;

  if (typeof candidate !== "string") {
    return null;
  }

  const color = candidate.startsWith("#") ? candidate : `#${candidate}`;

  return HEX_COLOR.test(color) ? color : null;
}

export function videoShortsAccentStyle(item) {
  const color = videoShortsVisualAccentColor(item) || "var(--tertiary)";

  return trustHTML(`--video-shorts-current-accent: ${color};`);
}
