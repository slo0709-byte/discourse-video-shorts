import { module, test } from "qunit";
import { trustedVideoShortsIframe } from "discourse/plugins/discourse-video-shorts/discourse/lib/video-shorts-embed-policy";

function iframeCandidate(provider, embedUrl) {
  return {
    provider,
    renderability: "iframe_candidate",
    embed_url: embedUrl,
  };
}

module("Unit | Lib | video shorts embed policy", function () {
  test("normalizes trusted TikTok player URLs to the plugin playback contract", function (assert) {
    const iframe = trustedVideoShortsIframe(
      iframeCandidate(
        "tiktok",
        "https://www.tiktok.com/player/v1/6718335390845095173?autoplay=1&token=secret#leak"
      )
    );

    assert.strictEqual(
      iframe.src,
      "https://www.tiktok.com/player/v1/6718335390845095173?autoplay=0&loop=1&rel=0"
    );
    assert.strictEqual(iframe.provider, "tiktok");
    assert.strictEqual(iframe.referrerPolicy, "strict-origin-when-cross-origin");
  });

  test("normalizes trusted Douyin player URLs to the official iframe contract", function (assert) {
    const iframe = trustedVideoShortsIframe(
      iframeCandidate(
        "douyin",
        "https://open.douyin.com/player/video?vid=7380000000000000001&autoplay=1&token=secret#leak"
      )
    );

    assert.strictEqual(
      iframe.src,
      "https://open.douyin.com/player/video?vid=7380000000000000001&autoplay=0"
    );
    assert.strictEqual(iframe.provider, "douyin");
    assert.strictEqual(iframe.referrerPolicy, "strict-origin-when-cross-origin");
  });

  test("rejects deceptive platform hosts, paths, and identifiers", function (assert) {
    const samples = [
      iframeCandidate(
        "tiktok",
        "https://www.tiktok.com.evil.example/player/v1/6718335390845095173"
      ),
      iframeCandidate(
        "tiktok",
        "https://www.tiktok.com:444/player/v1/6718335390845095173"
      ),
      iframeCandidate(
        "tiktok",
        "https://user:pass@www.tiktok.com/player/v1/6718335390845095173"
      ),
      iframeCandidate(
        "tiktok",
        "https://www.tiktok.com/embed/v2/6718335390845095173"
      ),
      iframeCandidate(
        "tiktok",
        "https://www.tiktok.com/player/v1/not-a-video-id"
      ),
      iframeCandidate(
        "douyin",
        "https://open.douyin.com.evil.example/player/video?vid=7380000000000000001"
      ),
      iframeCandidate(
        "douyin",
        "https://open.douyin.com:444/player/video?vid=7380000000000000001"
      ),
      iframeCandidate(
        "douyin",
        "https://user:pass@open.douyin.com/player/video?vid=7380000000000000001"
      ),
      iframeCandidate(
        "douyin",
        "https://open.douyin.com/not-player/video?vid=7380000000000000001"
      ),
      iframeCandidate(
        "douyin",
        "https://open.douyin.com/player/video?vid=not-a-video-id"
      ),
    ];

    samples.forEach((media) => {
      assert.strictEqual(trustedVideoShortsIframe(media), null);
    });
  });
});
