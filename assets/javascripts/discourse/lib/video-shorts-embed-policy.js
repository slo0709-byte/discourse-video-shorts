const PROVIDER_HOSTS = {
  bilibili: new Set(["player.bilibili.com"]),
  douyin: new Set(["open.douyin.com"]),
  tiktok: new Set(["www.tiktok.com"]),
  youtube: new Set(["www.youtube.com", "www.youtube-nocookie.com"]),
  vimeo: new Set(["player.vimeo.com"]),
};

const VIDEO_ID_PATTERN = /^[0-9]{6,30}$/;

const PROVIDER_PATHS = {
  bilibili: (pathname) => pathname === "/player.html",
  douyin: (pathname) => pathname === "/player/video",
  tiktok: (pathname) =>
    /^\/player\/v1\/[0-9]{6,30}$/.test(pathname),
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

    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.port !== "" ||
      !allowedHosts.has(url.hostname)
    ) {
      return null;
    }

    if (!PROVIDER_PATHS[media.provider](url.pathname)) {
      return null;
    }

    if (media.provider === "bilibili") {
      url.searchParams.set("autoplay", "0");
    }

    if (media.provider === "tiktok") {
      const videoId = url.pathname.split("/").at(-1);

      if (!VIDEO_ID_PATTERN.test(videoId)) {
        return null;
      }

      url.search = "";
      url.searchParams.set("autoplay", "0");
      url.searchParams.set("loop", "1");
      url.searchParams.set("rel", "0");
    }

    if (media.provider === "douyin") {
      const videoId = url.searchParams.get("vid");

      if (!VIDEO_ID_PATTERN.test(videoId)) {
        return null;
      }

      url.search = "";
      url.searchParams.set("vid", videoId);
      url.searchParams.set("autoplay", "0");
    }

    url.hash = "";

    return {
      provider: media.provider,
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
