const ACTIVE_MEDIA_STATES = new Set([
  "preparing",
  "loading",
  "ready",
  "playing",
  "paused",
]);

export default class VideoShortsPlaybackOwner {
  constructor({ parent, item, loader, onStateChange } = {}) {
    this.parent = parent;
    this.item = item;
    this.loader = loader;
    this.onStateChange = onStateChange;
    this.generation = 0;
    this.controller = null;
    this.destroyed = false;
    this.state = "idle";
    this.media = null;
    this.hls = null;
    this.cleanup = [];
  }

  get isCurrent() {
    return !this.destroyed && this.parent?.isCurrent !== false;
  }

  setState(state) {
    if (this.state === state) {
      return;
    }

    this.state = state;
    this.onStateChange?.(state, this);
  }

  attach({ media, hls } = {}) {
    if (!this.isCurrent) {
      hls?.destroy?.();
      return;
    }

    this.media = media || this.media;
    this.hls = hls || this.hls;
  }

  async prepare({ url, revision, kind, media } = {}) {
    if (!this.isCurrent || !this.loader || this.controller) {
      return null;
    }

    const generation = this.generation;
    const parentGeneration = this.parent?.generation;
    this.controller = new AbortController();
    this.media = media || null;
    this.setState("preparing");

    try {
      const prepared = await this.loader.prepare({
        url,
        revision,
        kind,
        signal: this.controller.signal,
        onStateChange: (state) => {
          if (this.isGenerationCurrent(generation, parentGeneration)) {
            this.setState(state);
          }
        },
      });

      if (!this.isGenerationCurrent(generation, parentGeneration)) {
        return null;
      }

      this.setState("ready");
      return prepared;
    } catch (error) {
      if (this.isGenerationCurrent(generation, parentGeneration)) {
        this.setState("idle");
      }
      throw error;
    }
  }

  isGenerationCurrent(generation, parentGeneration) {
    return (
      this.isCurrent &&
      generation === this.generation &&
      parentGeneration === this.parent?.generation
    );
  }

  listen(target, event, callback, options) {
    if (!target || !this.isCurrent) {
      return;
    }

    const generation = this.generation;
    const parentGeneration = this.parent?.generation;
    const guarded = (eventObject) => {
      if (this.isGenerationCurrent(generation, parentGeneration)) {
        callback(eventObject);
      }
    };

    target.addEventListener(event, guarded, options);
    this.cleanup.push(() =>
      target.removeEventListener(event, guarded, options),
    );
  }

  setTimer(callback, delay) {
    const generation = this.generation;
    const parentGeneration = this.parent?.generation;
    const timer = setTimeout(() => {
      if (this.isGenerationCurrent(generation, parentGeneration)) {
        callback();
      }
    }, delay);
    this.cleanup.push(() => clearTimeout(timer));
    return timer;
  }

  destroy() {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    this.generation += 1;
    this.controller?.abort();
    this.controller = null;
    this.loader?.abort?.();
    this.loader?.destroy?.();
    this.hls?.destroy?.();
    this.hls = null;

    for (const cleanup of this.cleanup.splice(0)) {
      cleanup();
    }

    if (this.media) {
      this.media.pause?.();
      this.media.removeAttribute?.("src");
      this.media.load?.();
      this.media.remove?.();
      this.media = null;
    }

    this.setState("idle");
  }
}

export { ACTIVE_MEDIA_STATES };
