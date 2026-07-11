import { module, test } from "qunit";
import VideoShortsLifecycleCounters, {
  installVideoShortsLifecycleCounters,
} from "discourse/plugins/discourse-video-shorts/discourse/lib/video-shorts-observability";

module("Video Shorts long-session observability", function (hooks) {
  let previousGlobalCounters;
  let hadGlobalCounters;

  hooks.beforeEach(function () {
    hadGlobalCounters = Object.hasOwn(
      globalThis,
      "videoShortsLifecycleCounters",
    );
    previousGlobalCounters = globalThis.videoShortsLifecycleCounters;
  });

  hooks.afterEach(function () {
    if (hadGlobalCounters) {
      globalThis.videoShortsLifecycleCounters = previousGlobalCounters;
    } else {
      delete globalThis.videoShortsLifecycleCounters;
    }
  });
  test("records lifecycle state without retaining route or media identifiers", function (assert) {
    let now = 1000;
    const counters = new VideoShortsLifecycleCounters({ now: () => now });

    counters.recordRouteGeneration();
    counters.recordWindowGeneration(2);
    counters.recordItemGeneration(3);
    counters.addListener(4);
    counters.subscribe(2);
    counters.mountMedia(2);
    counters.markMediaAudible();
    counters.recordAbort(2);
    counters.recordPolicyHeartbeat(3);
    counters.recordDeltaLag(18);
    counters.recordDeltaLag(27);
    counters.retainLease();
    now += 125;

    assert.deepEqual(counters.snapshot(), {
      routeGenerations: 1,
      windowGenerations: 2,
      itemGenerations: 3,
      listeners: 4,
      subscriptions: 2,
      mountedMedia: 2,
      audibleMedia: 1,
      aborts: 2,
      policyHeartbeats: 3,
      deltaLagMs: 27,
      maxDeltaLagMs: 27,
      deltaSamples: 2,
      leaseAgeMs: 125,
    });

    counters.removeListener(4);
    counters.unsubscribe(2);
    counters.markMediaSilent();
    counters.unmountMedia(2);
    counters.releaseLease();

    assert.deepEqual(counters.snapshot(), {
      routeGenerations: 1,
      windowGenerations: 2,
      itemGenerations: 3,
      listeners: 0,
      subscriptions: 0,
      mountedMedia: 0,
      audibleMedia: 0,
      aborts: 2,
      policyHeartbeats: 3,
      deltaLagMs: 27,
      maxDeltaLagMs: 27,
      deltaSamples: 2,
      leaseAgeMs: 0,
    });
  });

  test("rejects invalid counter transitions", function (assert) {
    const counters = new VideoShortsLifecycleCounters();

    assert.throws(
      () => counters.removeListener(),
      /listeners cannot be negative/,
    );
    assert.throws(
      () => counters.recordDeltaLag(-1),
      /lagMs must be a non-negative number/,
    );
    assert.throws(
      () => counters.recordRouteGeneration(0),
      /count must be a positive integer/,
    );
  });
  test("cleans up installed global counters", function (assert) {
    const counters = installVideoShortsLifecycleCounters(globalThis, {
      now: () => 1000,
    });

    counters.recordRouteGeneration();

    assert.strictEqual(globalThis.videoShortsLifecycleCounters, counters);
    assert.strictEqual(counters.snapshot().routeGenerations, 1);
  });
});
