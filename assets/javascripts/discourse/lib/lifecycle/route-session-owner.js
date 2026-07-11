export default class VideoShortsRouteSessionOwner {
  constructor({
    policy,
    realtime,
    leases,
    onRevisionChange,
    sessionIdentity,
    getSessionIdentity,
    onSessionChange,
  } = {}) {
    this.policy = policy;
    this.realtime = realtime;
    this.leases = leases;
    this.onRevisionChange = onRevisionChange;
    this.sessionIdentity = sessionIdentity;
    this.getSessionIdentity = getSessionIdentity;
    this.onSessionChange = onSessionChange;
    this.generation = 0;
    this.destroyed = false;
    this.feedWindow = null;
    this.playbackOwners = new Set();
    this.sessionResources = new Set();
    this.cleanup = [];
  }

  get isCurrent() {
    return !this.destroyed;
  }

  async start() {
    if (!this.isCurrent) {
      return null;
    }

    const generation = this.generation;
    const snapshot = await this.policy?.revalidate?.();
    if (!this.isGenerationCurrent(generation)) {
      return null;
    }

    const unsubscribe = this.policy?.onRevisionChange?.((revision) => {
      if (this.isCurrent) {
        this.handleRevisionChange(revision);
      }
    });
    if (unsubscribe) {
      this.cleanup.push(unsubscribe);
    }

    this.listen(window, "online", () => this.handleWake());
    this.listen(window, "focus", () => this.handleWake());
    this.listen(document, "visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        this.suspendPlayback();
      } else {
        this.handleWake();
      }
    });
    this.listen(window, "pagehide", () => this.suspendPlayback());
    this.listen(window, "pageshow", () => this.handleWake());
    return snapshot;
  }

  isGenerationCurrent(generation) {
    return this.isCurrent && generation === this.generation;
  }

  isSessionCurrent() {
    if (!this.isCurrent) {
      return false;
    }

    if (
      !this.getSessionIdentity ||
      this.getSessionIdentity() === this.sessionIdentity
    ) {
      return true;
    }

    this.releaseSessionResources({ revoke: true });
    this.destroy();
    this.onSessionChange?.();
    return false;
  }

  listen(target, event, callback) {
    target.addEventListener(event, callback);
    this.cleanup.push(() => target.removeEventListener(event, callback));
  }

  attachFeedWindow(owner) {
    this.feedWindow?.destroy();
    this.feedWindow = owner;
    return owner;
  }

  registerPlayback(owner) {
    if (!this.isCurrent) {
      owner.destroy();
      return () => {};
    }
    this.playbackOwners.add(owner);
    return () => this.playbackOwners.delete(owner);
  }

  subscribeRealtime(sourcePostId, callback) {
    if (!this.isCurrent || !this.realtime) {
      return () => {};
    }

    return this.ownSessionResource(
      this.realtime.subscribe(sourcePostId, callback),
    );
  }

  openAuthorizationLease(sourcePostId, onRevoked) {
    if (!this.isCurrent || !this.leases) {
      onRevoked?.();
      return () => {};
    }

    return this.ownSessionResource(
      this.leases.open(sourcePostId, onRevoked),
      onRevoked,
    );
  }

  ownSessionResource(release, onRevoked = null) {
    const resource = { release, onRevoked, released: false };
    this.sessionResources.add(resource);

    return () => this.releaseSessionResource(resource);
  }

  releaseSessionResource(resource, { revoke = false } = {}) {
    if (resource.released) {
      return;
    }

    resource.released = true;
    this.sessionResources.delete(resource);
    if (revoke) {
      resource.onRevoked?.();
    }
    resource.release?.();
  }

  releaseSessionResources({ revoke = false } = {}) {
    for (const resource of [...this.sessionResources]) {
      this.releaseSessionResource(resource, { revoke });
    }
  }

  async revalidate() {
    if (!this.isSessionCurrent() || document.visibilityState === "hidden") {
      return null;
    }
    const generation = this.generation;
    const snapshot = await this.policy?.revalidate?.();
    return this.isGenerationCurrent(generation) ? snapshot : null;
  }

  async handleWake() {
    if (!this.isSessionCurrent()) {
      return null;
    }

    this.leases?.revalidate?.();
    return await this.revalidateAndResume();
  }

  async revalidateAndResume() {
    const snapshot = await this.revalidate();
    if (!snapshot || !this.isCurrent) {
      return null;
    }

    for (const owner of this.playbackOwners) {
      owner.resume?.();
    }
    return snapshot;
  }

  handleRevisionChange(revision) {
    if (!this.isCurrent) {
      return;
    }

    this.generation += 1;
    this.releaseSessionResources({ revoke: true });
    this.destroyPlayback();
    this.feedWindow?.destroy();
    this.feedWindow = null;
    this.policy?.reset?.();
    this.onRevisionChange?.(revision);
  }

  suspendPlayback() {
    for (const owner of this.playbackOwners) {
      if (owner.suspend) {
        owner.suspend();
      } else {
        owner.pause?.();
      }
    }
  }

  destroyPlayback() {
    for (const owner of [...this.playbackOwners]) {
      owner.destroy?.();
    }
    this.playbackOwners.clear();
  }

  destroy() {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    this.generation += 1;
    this.releaseSessionResources();
    this.destroyPlayback();
    this.feedWindow?.destroy();
    this.feedWindow = null;
    for (const cleanup of this.cleanup.splice(0)) {
      cleanup();
    }
    this.policy?.reset?.();
  }
}
