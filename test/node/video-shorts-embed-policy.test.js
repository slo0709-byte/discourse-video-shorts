import assert from "node:assert/strict";
import test from "node:test";
import {
  trustedVideoShortsIframe,
  videoShortsNeedsHostLoadingOverlay,
} from "../../assets/javascripts/discourse/lib/video-shorts-embed-policy.js";

function iframeCandidate(provider, embedUrl) {
  return {
    provider,
    renderability: "iframe_candidate",
    embed_url: embedUrl,
  };
}

test("normalizes supported providers with visible native controls", () => {
  const cases = [
    {
      provider: "bilibili",
      input:
        "https://player.bilibili.com/player.html?bvid=BV1aPgQ6ZEmn&page=2&autoplay=0&token=secret",
      expected:
        "https://player.bilibili.com/player.html?bvid=BV1aPgQ6ZEmn&page=2&autoplay=1&danmaku=0",
    },
    {
      provider: "youtube",
      input:
        "https://www.youtube.com/embed/R-hnuaJNhEE?autoplay=0&token=secret#leak",
      expected:
        "https://www.youtube.com/embed/R-hnuaJNhEE?autoplay=1&mute=1&playsinline=1&controls=1&rel=0&enablejsapi=1",
    },
  ];

  for (const sample of cases) {
    const iframe = trustedVideoShortsIframe(
      iframeCandidate(sample.provider, sample.input)
    );

    assert.equal(iframe.src, sample.expected);
  }
});

test("returns presentation capabilities with the trusted iframe", () => {
  const youtube = trustedVideoShortsIframe(
    iframeCandidate(
      "youtube",
      "https://www.youtube.com/embed/R-hnuaJNhEE"
    )
  );
  const bilibili = trustedVideoShortsIframe(
    iframeCandidate(
      "bilibili",
      "https://player.bilibili.com/player.html?bvid=BV1aPgQ6ZEmn"
    )
  );

  assert.deepEqual(youtube.capabilities, {
    autoplay: true,
    hostChrome: true,
  });
  assert.deepEqual(bilibili.capabilities, {
    autoplay: true,
    hostChrome: true,
  });
});

test("does not cover providers with native chrome during loading", () => {
  const bilibili = trustedVideoShortsIframe(
    iframeCandidate(
      "bilibili",
      "https://player.bilibili.com/player.html?bvid=BV1aPgQ6ZEmn"
    )
  );
  const youtube = trustedVideoShortsIframe(
    iframeCandidate(
      "youtube",
      "https://www.youtube.com/embed/R-hnuaJNhEE"
    )
  );
  const vimeo = trustedVideoShortsIframe(
    iframeCandidate("vimeo", "https://player.vimeo.com/video/123456")
  );

  assert.equal(videoShortsNeedsHostLoadingOverlay(bilibili, "loading"), false);
  assert.equal(videoShortsNeedsHostLoadingOverlay(youtube, "loading"), false);
  assert.equal(videoShortsNeedsHostLoadingOverlay(vimeo, "loading"), true);
  assert.equal(videoShortsNeedsHostLoadingOverlay(vimeo, "loaded"), false);
});

test("rejects untrusted hosts, ports, credentials, paths, and identifiers", () => {
  const invalid = [
    iframeCandidate(
      "youtube",
      "https://www.youtube.com.evil.example/embed/R-hnuaJNhEE"
    ),
    iframeCandidate(
      "youtube",
      "https://www.youtube.com:444/embed/R-hnuaJNhEE"
    ),
    iframeCandidate(
      "youtube",
      "https://user:pass@www.youtube.com/embed/R-hnuaJNhEE"
    ),
    iframeCandidate("youtube", "https://www.youtube.com/watch?v=R-hnuaJNhEE"),
    iframeCandidate("youtube", "https://www.youtube.com/embed/not valid"),
    iframeCandidate(
      "bilibili",
      "https://player.bilibili.com/player.html?bvid=not-a-video-id"
    ),
    iframeCandidate(
      "tiktok",
      "https://www.tiktok.com/player/v1/6718335390845095173"
    ),
    iframeCandidate(
      "douyin",
      "https://open.douyin.com/player/video?vid=7380000000000000001"
    ),
  ];

  for (const media of invalid) {
    assert.equal(trustedVideoShortsIframe(media), null);
  }
});
