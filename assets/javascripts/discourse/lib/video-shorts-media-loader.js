const EXTERNAL_FETCH_OPTIONS = {
  credentials: "omit",
  redirect: "error",
  referrerPolicy: "strict-origin-when-cross-origin",
};

export class VideoShortsMediaLoader {
  constructor({ policy, revision, signal, onRequestStart, onRequestEnd }) {
    this.policy = policy;
    this.revision = revision;
    this.signal = signal;
    this.onRequestStart = onRequestStart;
    this.onRequestEnd = onRequestEnd;
    this.controllers = new Set();
    this.destroyed = false;
  }

  async consume(url, options, consumeBody) {
    if (this.destroyed || !this.policy.authorize(url, this.revision)) {
      throw new Error("video_shorts_media_not_authorized");
    }

    let controller = new AbortController();
    let abort = () => controller.abort();
    this.controllers.add(controller);
    this.signal?.addEventListener("abort", abort, { once: true });
    options.signal?.addEventListener("abort", abort, { once: true });
    let endRequest = this.policy.beginExternalRequest();
    this.onRequestStart?.();

    try {
      let response = await fetch(url, {
        ...EXTERNAL_FETCH_OPTIONS,
        ...options,
        signal: controller.signal,
      });

      if (
        !response.ok ||
        response.redirected ||
        this.destroyed ||
        !this.policy.authorize(url, this.revision)
      ) {
        throw new Error("video_shorts_media_request_rejected");
      }

      return await consumeBody(response);
    } finally {
      this.controllers.delete(controller);
      this.signal?.removeEventListener("abort", abort);
      options.signal?.removeEventListener("abort", abort);
      endRequest();
      this.onRequestEnd?.();
    }
  }

  requestBlob(url, options = {}) {
    return this.consume(url, options, (response) => response.blob());
  }

  requestArrayBuffer(url, options = {}) {
    return this.consume(url, options, (response) => response.arrayBuffer());
  }

  createHlsLoader() {
    let mediaLoader = this;

    return class RevisionBoundHlsLoader {
      constructor() {
        this.controller = null;
        this.stats = {};
      }

      load(context, _config, callbacks) {
        this.controller = new AbortController();
        let startedAt = performance.now();
        this.stats = { trequest: startedAt, loaded: 0, total: 0 };

        mediaLoader
          .requestArrayBuffer(context.url, { signal: this.controller.signal })
          .then((data) => {
            if (!this.controller || mediaLoader.destroyed) {
              return;
            }

            this.stats.tload = performance.now();
            this.stats.tfirst = this.stats.tload;
            this.stats.loaded = data.byteLength;
            this.stats.total = data.byteLength;
            callbacks.onSuccess(
              { url: context.url, data },
              this.stats,
              context,
              null,
            );
          })
          .catch((error) => {
            if (this.controller) {
              callbacks.onError(
                { code: 0, text: "video_shorts_media_request_rejected" },
                context,
                error,
              );
            }
          });
      }

      abort() {
        this.controller?.abort();
      }

      destroy() {
        this.abort();
        this.controller = null;
      }
    };
  }

  destroy() {
    this.destroyed = true;
    for (let controller of this.controllers) {
      controller.abort();
    }
    this.controllers.clear();
  }
}

export { EXTERNAL_FETCH_OPTIONS };
