const DEFAULT_NEIGHBOR_COUNT = 2;

export function videoShortsItemIsMounted(
  index,
  activeIndex,
  neighborCount = DEFAULT_NEIGHBOR_COUNT,
) {
  return Math.abs(index - activeIndex) <= neighborCount;
}

export function videoShortsFeedKeyAction(key) {
  if (key === "ArrowDown" || key === "j" || key === "J") {
    return "next";
  }

  if (key === "ArrowUp" || key === "k" || key === "K") {
    return "previous";
  }

  if (key === " " || key === "Spacebar") {
    return "toggle-playback";
  }

  if (key === "m" || key === "M") {
    return "toggle-mute";
  }

  if (key === "Escape") {
    return "escape";
  }

  return null;
}
