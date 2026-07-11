const EMBED_HOSTS = {
  bilibili: new Set(["player.bilibili.com"]),
  youtube: new Set(["www.youtube.com", "www.youtube-nocookie.com"]),
};

const EMBED_PATHS = {
  bilibili: (pathname) => pathname === "/player.html",
  youtube: (pathname) => pathname.startsWith("/embed/"),
};

export const VIDEO_SHORTS_IFRAME_ALLOW =
  "autoplay; fullscreen; picture-in-picture; encrypted-media";
export const VIDEO_SHORTS_IFRAME_SANDBOX =
  "allow-scripts allow-same-origin allow-presentation";

export function trustedVideoShortsIframe(media) {
  if (!media || typeof media.url !== "string") {
    return null;
  }

  const allowedHosts = EMBED_HOSTS[media.kind];

  if (!allowedHosts) {
    return null;
  }

  try {
    const url = new URL(media.url);

    if (
      url.protocol !== "https:" ||
      url.port ||
      url.username ||
      url.password ||
      !allowedHosts.has(url.hostname)
    ) {
      return null;
    }

    if (!EMBED_PATHS[media.kind](url.pathname)) {
      return null;
    }

    return {
      src: url.toString(),
      title: `${media.kind} video embed`,
      allow: VIDEO_SHORTS_IFRAME_ALLOW,
      sandbox: VIDEO_SHORTS_IFRAME_SANDBOX,
      referrerPolicy: "strict-origin-when-cross-origin",
    };
  } catch {
    return null;
  }
}
