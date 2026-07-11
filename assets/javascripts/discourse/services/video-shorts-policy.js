import { tracked } from "@glimmer/tracking";
import Service from "@ember/service";

const POLICY_URL = "/videos/policy.json";
const HEARTBEAT_INTERVAL_MS = 1000;

function validSnapshot(payload) {
  return (
    payload &&
    Number.isInteger(payload.revision) &&
    payload.revision >= 0 &&
    typeof payload.external_media_enabled === "boolean" &&
    Array.isArray(payload.origins) &&
    payload.origins.every((origin) => {
      try {
        return (
          new URL(origin).protocol === "https:" &&
          new URL(origin).origin === origin
        );
      } catch {
        return false;
      }
    })
  );
}

export default class VideoShortsPolicyService extends Service {
  @tracked snapshot = null;
  @tracked frozen = false;

  etag = null;
  heartbeatTimer = null;
  retainCount = 0;
  inFlightCount = 0;
  revisionListeners = new Set();
  revalidation = null;

  get revision() {
    return this.snapshot?.revision ?? null;
  }

  onRevisionChange(callback) {
    this.revisionListeners.add(callback);
    return () => this.revisionListeners.delete(callback);
  }

  retainExternalResource() {
    this.retainCount += 1;
    this.startHeartbeat();

    let released = false;
    return () => {
      if (released) {
        return;
      }

      released = true;
      this.retainCount = Math.max(0, this.retainCount - 1);
      this.stopHeartbeatWhenIdle();
    };
  }

  beginExternalRequest() {
    this.inFlightCount += 1;
    this.startHeartbeat();

    let ended = false;
    return () => {
      if (ended) {
        return;
      }

      ended = true;
      this.inFlightCount = Math.max(0, this.inFlightCount - 1);
      this.stopHeartbeatWhenIdle();
    };
  }

  async revalidate({ signal } = {}) {
    if (this.revalidation) {
      return this.revalidation;
    }

    this.revalidation = this.fetchSnapshot(signal)
      .catch((error) => {
        this.freezeUnavailable();
        throw error;
      })
      .finally(() => {
        this.revalidation = null;
      });
    return this.revalidation;
  }

  async fetchSnapshot(signal) {
    let headers = { Accept: "application/json" };
    if (this.etag) {
      headers["If-None-Match"] = this.etag;
    }

    let response = await fetch(POLICY_URL, {
      credentials: "same-origin",
      headers,
      signal,
      cache: "no-store",
    });

    if (response.status === 304 && this.snapshot) {
      this.frozen = false;
      return this.snapshot;
    }

    if (!response.ok) {
      throw new Error("video_shorts_policy_unavailable");
    }

    let nextSnapshot = await response.json();
    if (!validSnapshot(nextSnapshot)) {
      throw new Error("video_shorts_policy_invalid");
    }

    let previousRevision = this.snapshot?.revision;
    this.etag =
      response.headers.get("ETag") || `"policy-${nextSnapshot.revision}"`;
    this.snapshot = Object.freeze({
      revision: nextSnapshot.revision,
      external_media_enabled: nextSnapshot.external_media_enabled,
      origins: Object.freeze([...nextSnapshot.origins]),
      generated_at: nextSnapshot.generated_at,
    });

    if (
      previousRevision !== undefined &&
      previousRevision !== nextSnapshot.revision
    ) {
      this.freezeForRevision(nextSnapshot.revision);
    } else {
      this.frozen = false;
    }

    return this.snapshot;
  }

  authorize(url, revision) {
    if (this.frozen || !this.snapshot || this.snapshot.revision !== revision) {
      return null;
    }

    if (!this.snapshot.external_media_enabled) {
      return null;
    }

    try {
      let parsed = new URL(url);
      return parsed.protocol === "https:" &&
        this.snapshot.origins.includes(parsed.origin)
        ? parsed
        : null;
    } catch {
      return null;
    }
  }

  freezeUnavailable() {
    if (this.frozen) {
      return;
    }

    this.frozen = true;
    for (let callback of this.revisionListeners) {
      callback(null);
    }
  }

  freezeForRevision(revision) {
    this.frozen = true;
    for (let callback of this.revisionListeners) {
      callback(revision);
    }
  }

  startHeartbeat() {
    if (
      this.heartbeatTimer ||
      (this.retainCount === 0 && this.inFlightCount === 0)
    ) {
      return;
    }

    this.heartbeatTimer = setInterval(() => {
      this.revalidate().catch(() => {
        this.frozen = true;
      });
    }, HEARTBEAT_INTERVAL_MS);
    this.revalidate().catch(() => {
      this.frozen = true;
    });
  }

  stopHeartbeatWhenIdle() {
    if (this.retainCount !== 0 || this.inFlightCount !== 0) {
      return;
    }

    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  reset() {
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.retainCount = 0;
    this.inFlightCount = 0;
    this.snapshot = null;
    this.etag = null;
    this.frozen = true;
  }
}

export { HEARTBEAT_INTERVAL_MS, POLICY_URL, validSnapshot };
