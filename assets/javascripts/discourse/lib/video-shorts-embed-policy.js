const PROVIDER_HOSTS = {
  bilibili: new Set(["player.bilibili.com"]),
  youtube: new Set(["www.youtube.com", "www.youtube-nocookie.com"]),
  vimeo: new Set(["player.vimeo.com"]),
};

const PROVIDER_PATHS = {
  bilibili: (pathname) => pathname === "/player.html",
  youtube: (pathname) => pathname.startsWith("/embed/"),
  vimeo: (pathname) => pathname.startsWith("/video/"),
};

export const VIDEO_SHORTS_IFRAME_ALLOW =
  "autoplay; fullscreen; picture-in-picture; encrypted-media";
export const VIDEO_SHORTS_IFRAME_SANDBOX =
  "allow-scripts allow-same-origin allow-presentation";

export function trustedVideoShortsIframe(media) {
  if (
    !media ||
    media.renderability !== "iframe_candidate" ||
    !media.embed_url
  ) {
    return null;
  }

  const allowedHosts = PROVIDER_HOSTS[media.provider];

  if (!allowedHosts) {
    return null;
  }

  try {
    const url = new URL(media.embed_url);

    if (url.protocol !== "https:" || !allowedHosts.has(url.hostname)) {
      return null;
    }

    if (!PROVIDER_PATHS[media.provider](url.pathname)) {
      return null;
    }

    if (media.provider === "bilibili") {
      url.searchParams.set("autoplay", "0");
    }

    return {
      src: url.toString(),
      title: `${media.provider} video embed`,
      allow: VIDEO_SHORTS_IFRAME_ALLOW,
      sandbox: VIDEO_SHORTS_IFRAME_SANDBOX,
      referrerPolicy: "strict-origin-when-cross-origin",
    };
  } catch {
    return null;
  }
}
