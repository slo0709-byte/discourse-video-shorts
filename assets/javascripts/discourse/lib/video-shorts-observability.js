const EMPTY_COUNTERS = Object.freeze({
  routeGenerations: 0,
  windowGenerations: 0,
  itemGenerations: 0,
  listeners: 0,
  subscriptions: 0,
  mountedMedia: 0,
  audibleMedia: 0,
  aborts: 0,
  policyHeartbeats: 0,
  deltaLagMs: null,
  maxDeltaLagMs: null,
  deltaSamples: 0,
  leaseAgeMs: 0,
});

function defaultNow() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function positiveInteger(value, name) {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer`);
  }
}

function nonNegativeNumber(value, name) {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative number`);
  }
}

export default class VideoShortsLifecycleCounters {
  constructor({ now = defaultNow } = {}) {
    this.now = now;
    this.reset();
  }

  reset() {
    this.counters = { ...EMPTY_COUNTERS };
    this.leaseStartedAt = null;
  }

  recordRouteGeneration(count = 1) {
    this.increment("routeGenerations", count);
  }

  recordWindowGeneration(count = 1) {
    this.increment("windowGenerations", count);
  }

  recordItemGeneration(count = 1) {
    this.increment("itemGenerations", count);
  }

  addListener(count = 1) {
    positiveInteger(count, "count");
    this.adjustActive("listeners", count);
  }

  removeListener(count = 1) {
    positiveInteger(count, "count");
    this.adjustActive("listeners", -count);
  }

  subscribe(count = 1) {
    positiveInteger(count, "count");
    this.adjustActive("subscriptions", count);
  }

  unsubscribe(count = 1) {
    positiveInteger(count, "count");
    this.adjustActive("subscriptions", -count);
  }

  mountMedia(count = 1) {
    positiveInteger(count, "count");
    this.adjustActive("mountedMedia", count);
  }

  unmountMedia(count = 1) {
    positiveInteger(count, "count");
    this.adjustActive("mountedMedia", -count);
  }

  markMediaAudible(count = 1) {
    positiveInteger(count, "count");
    this.adjustActive("audibleMedia", count);
  }

  markMediaSilent(count = 1) {
    positiveInteger(count, "count");
    this.adjustActive("audibleMedia", -count);
  }

  recordAbort(count = 1) {
    this.increment("aborts", count);
  }

  recordPolicyHeartbeat(count = 1) {
    this.increment("policyHeartbeats", count);
  }

  recordDeltaLag(lagMs) {
    nonNegativeNumber(lagMs, "lagMs");
    this.counters.deltaLagMs = lagMs;
    this.counters.maxDeltaLagMs = Math.max(
      this.counters.maxDeltaLagMs ?? 0,
      lagMs,
    );
    this.counters.deltaSamples += 1;
  }

  retainLease() {
    if (this.leaseStartedAt === null) {
      this.leaseStartedAt = this.now();
    }
  }

  releaseLease() {
    this.leaseStartedAt = null;
  }

  snapshot() {
    const leaseAgeMs =
      this.leaseStartedAt === null
        ? 0
        : Math.max(0, this.now() - this.leaseStartedAt);

    return Object.freeze({ ...this.counters, leaseAgeMs });
  }

  increment(name, count) {
    positiveInteger(count, "count");
    this.counters[name] += count;
  }

  adjustActive(name, delta) {
    const nextValue = this.counters[name] + delta;
    if (nextValue < 0) {
      throw new RangeError(`${name} cannot be negative`);
    }
    this.counters[name] = nextValue;
  }
}

export function installVideoShortsLifecycleCounters(
  target = globalThis,
  options,
) {
  const counters = new VideoShortsLifecycleCounters(options);
  target.videoShortsLifecycleCounters = counters;
  return counters;
}

export { EMPTY_COUNTERS };
