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
  test("normalizes trusted provider URLs with visible native controls", function (assert) {
    const samples = [
      {
        provider: "bilibili",
        input:
          "https://player.bilibili.com/player.html?bvid=BV1aPgQ6ZEmn&page=2&autoplay=0&token=secret#leak",
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

    for (const sample of samples) {
      const iframe = trustedVideoShortsIframe(
        iframeCandidate(sample.provider, sample.input)
      );

      assert.strictEqual(iframe.src, sample.expected, sample.provider);
      assert.strictEqual(iframe.provider, sample.provider, sample.provider);
      assert.strictEqual(
        iframe.referrerPolicy,
        "strict-origin-when-cross-origin",
        sample.provider
      );
      assert.true(iframe.capabilities.autoplay, sample.provider);
    }
  });

  test("returns explicit provider presentation capabilities", function (assert) {
    const youtube = trustedVideoShortsIframe(
      iframeCandidate("youtube", "https://www.youtube.com/embed/R-hnuaJNhEE")
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

  test("rejects deceptive hosts, paths, parameters, and identifiers", function (assert) {
    const samples = [
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

    for (const media of samples) {
      assert.strictEqual(trustedVideoShortsIframe(media), null);
    }
  });
});
