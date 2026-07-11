import Service from "@ember/service";

const LEASE_URL = "/videos/authorization-leases.json";
const LEASE_INTERVAL_MS = 2000;
const MAX_ACTIVE_SOURCE_IDS = 3;

function leaseExpiry(lease) {
  let value = lease?.expires_at || lease?.expiresAt || lease?.expires;
  let time = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

function leasesFrom(payload) {
  if (Array.isArray(payload?.leases)) {
    return payload.leases;
  }

  if (Array.isArray(payload?.authorization_leases)) {
    return payload.authorization_leases;
  }

  return payload?.authorization_lease ? [payload.authorization_lease] : [];
}

export default class VideoShortsAuthorizationLeaseService extends Service {
  activeSourceIds = new Set();
  leases = new Map();
  deadlines = new Map();
  timer = null;
  revokedCallbacks = new Map();
  validationGeneration = 0;

  willDestroy() {
    super.willDestroy(...arguments);
    this.stop();
    this.validationGeneration += 1;
    this.leases.clear();
    this.deadlines.clear();
    this.activeSourceIds.clear();
    this.revokedCallbacks.clear();
  }

  open(sourcePostId, onRevoked) {
    let normalizedSourcePostId = Number(sourcePostId);
    if (!Number.isSafeInteger(normalizedSourcePostId)) {
      throw new TypeError("sourcePostId must be an integer");
    }

    this.activeSourceIds.add(normalizedSourcePostId);
    this.deadlines.set(normalizedSourcePostId, Date.now() + 5000);

    let callbacks = this.revokedCallbacks.get(normalizedSourcePostId);
    if (!callbacks) {
      callbacks = new Set();
      this.revokedCallbacks.set(normalizedSourcePostId, callbacks);
    }
    callbacks.add(onRevoked);

    this.start();
    return () => this.close(normalizedSourcePostId, onRevoked);
  }

  close(sourcePostId, onRevoked) {
    let normalizedSourcePostId = Number(sourcePostId);
    let callbacks = this.revokedCallbacks.get(normalizedSourcePostId);
    callbacks?.delete(onRevoked);

    if (callbacks?.size) {
      return;
    }

    this.revokedCallbacks.delete(normalizedSourcePostId);
    this.activeSourceIds.delete(normalizedSourcePostId);
    this.leases.delete(normalizedSourcePostId);
    this.deadlines.delete(normalizedSourcePostId);
    this.validationGeneration += 1;
    if (!this.activeSourceIds.size) {
      this.stop();
    }
  }

  start() {
    if (this.timer) {
      return;
    }

    this.revalidate();
    this.timer = setInterval(() => this.revalidate(), LEASE_INTERVAL_MS);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  async revalidate() {
    this.expireLeases();
    let sourcePostIds = [...this.activeSourceIds].slice(
      0,
      MAX_ACTIVE_SOURCE_IDS,
    );
    if (!sourcePostIds.length || !navigator.onLine) {
      return;
    }

    let validationGeneration = this.validationGeneration;
    try {
      let response = await fetch(LEASE_URL, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-CSRF-Token": document.querySelector("meta[name='csrf-token']")
            ?.content,
        },
        body: JSON.stringify({ source_post_ids: sourcePostIds }),
      });
      if (validationGeneration !== this.validationGeneration) {
        return;
      }

      if (response.status === 403 || response.status === 404) {
        this.revoke();
        return;
      }

      if (!response.ok) {
        return;
      }

      let payload = await response.json();
      if (validationGeneration !== this.validationGeneration) {
        return;
      }

      for (let lease of leasesFrom(payload)) {
        let sourcePostId = Number(lease.source_post_id || lease.post_id);
        let expiresAt = leaseExpiry(lease);
        if (
          sourcePostIds.includes(sourcePostId) &&
          this.activeSourceIds.has(sourcePostId) &&
          expiresAt > 0
        ) {
          this.leases.set(sourcePostId, expiresAt);
          this.deadlines.set(sourcePostId, expiresAt);
        }
      }
      this.expireLeases();
    } catch {
      // Transient network errors are retried by the interval without user noise.
    }
  }

  expireLeases() {
    let now = Date.now();
    for (let sourcePostId of this.activeSourceIds) {
      if ((this.deadlines.get(sourcePostId) || 0) <= now) {
        this.revoke();
        return;
      }
    }
  }

  revoke() {
    this.stop();
    this.validationGeneration += 1;
    let callbacks = [
      ...new Set(
        [...this.revokedCallbacks.values()].flatMap((sourceCallbacks) => [
          ...sourceCallbacks,
        ]),
      ),
    ];
    this.leases.clear();
    this.deadlines.clear();
    this.activeSourceIds.clear();
    this.revokedCallbacks.clear();

    for (let callback of callbacks) {
      callback?.();
    }
  }
}

export { LEASE_INTERVAL_MS, LEASE_URL, MAX_ACTIVE_SOURCE_IDS };
