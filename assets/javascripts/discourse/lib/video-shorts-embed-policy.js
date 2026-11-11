const PROVIDER_HOSTS = {
  bilibili: new Set(["player.bilibili.com"]),
  youtube: new Set(["www.youtube.com", "www.youtube-nocookie.com"]),
  vimeo: new Set(["player.vimeo.com"]),
};

const BILIBILI_VIDEO_ID_PATTERN = /^BV[0-9A-Za-z]{10}$/;
const YOUTUBE_VIDEO_ID_PATTERN = /^[0-9A-Za-z_-]{11}$/;
const VIMEO_VIDEO_ID_PATTERN = /^[0-9]+$/;

const PROVIDER_CAPABILITIES = {
  bilibili: { autoplay: true, hostChrome: true },
  youtube: { autoplay: true, hostChrome: true },
  vimeo: { autoplay: false, hostChrome: false },
};

export const VIDEO_SHORTS_IFRAME_ALLOW =
  "autoplay; fullscreen; picture-in-picture; encrypted-media";
export const VIDEO_SHORTS_IFRAME_SANDBOX =
  "allow-scripts allow-same-origin allow-presentation";

export function videoShortsNeedsHostLoadingOverlay(iframe, loadState) {
  return (
    loadState === "loading" &&
    Boolean(iframe) &&
    iframe.capabilities.hostChrome !== true
  );
}

function normalizeBilibiliUrl(url) {
  if (url.pathname !== "/player.html") {
    return null;
  }

  const videoId = url.searchParams.get("bvid");
  const page = url.searchParams.get("page") || "1";

  if (
    url.searchParams.getAll("bvid").length !== 1 ||
    !BILIBILI_VIDEO_ID_PATTERN.test(videoId) ||
    !/^[1-9][0-9]*$/.test(page)
  ) {
    return null;
  }

  url.search = "";
  url.searchParams.set("bvid", videoId);
  url.searchParams.set("page", page);
  url.searchParams.set("autoplay", "1");
  url.searchParams.set("danmaku", "0");
  return url;
}

function normalizeYouTubeUrl(url) {
  const match = url.pathname.match(/^\/embed\/([^/]+)$/);

  if (!match || !YOUTUBE_VIDEO_ID_PATTERN.test(match[1])) {
    return null;
  }

  url.search = "";
  url.searchParams.set("autoplay", "1");
  url.searchParams.set("mute", "1");
  url.searchParams.set("playsinline", "1");
  url.searchParams.set("controls", "1");
  url.searchParams.set("rel", "0");
  url.searchParams.set("enablejsapi", "1");
  return url;
}

function normalizeVimeoUrl(url) {
  const match = url.pathname.match(/^\/video\/([0-9]+)$/);

  if (!match || !VIMEO_VIDEO_ID_PATTERN.test(match[1])) {
    return null;
  }

  url.search = "";
  return url;
}

const PROVIDER_NORMALIZERS = {
  bilibili: normalizeBilibiliUrl,
  youtube: normalizeYouTubeUrl,
  vimeo: normalizeVimeoUrl,
};

export function trustedVideoShortsIframe(media) {
  if (
    !media ||
    media.renderability !== "iframe_candidate" ||
    typeof media.embed_url !== "string"
  ) {
    return null;
  }

  const allowedHosts = PROVIDER_HOSTS[media.provider];
  const normalize = PROVIDER_NORMALIZERS[media.provider];

  if (!allowedHosts || !normalize) {
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

    if (!normalize(url)) {
      return null;
    }

    url.hash = "";

    return {
      provider: media.provider,
      src: url.toString(),
      title: `${media.provider} video embed`,
      allow: VIDEO_SHORTS_IFRAME_ALLOW,
      sandbox: VIDEO_SHORTS_IFRAME_SANDBOX,
      referrerPolicy: "strict-origin-when-cross-origin",
      capabilities: { ...PROVIDER_CAPABILITIES[media.provider] },
    };
  } catch {
    return null;
  }
}
