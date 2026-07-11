import Service, { service } from "@ember/service";

const CHANNEL_PREFIX = "/video-shorts/comments/";

export default class VideoShortsRealtimeService extends Service {
  @service messageBus;

  subscriptions = new Map();
  reconnectSubscribed = false;

  handleReconnect = () => {
    for (let [sourcePostId, { callbacks }] of this.subscriptions) {
      for (let callback of callbacks) {
        callback({ source_post_id: sourcePostId, reconnected: true });
      }
    }
  };

  willDestroy() {
    super.willDestroy(...arguments);

    for (let [sourcePostId, subscription] of this.subscriptions) {
      this.messageBus.unsubscribe(
        this.channelFor(sourcePostId),
        subscription.handler,
      );
    }

    this.subscriptions.clear();
    this.unsubscribeFromReconnects();
  }

  subscribe(sourcePostId, callback) {
    let sourcePostIdNumber = Number(sourcePostId);

    if (!Number.isSafeInteger(sourcePostIdNumber)) {
      throw new TypeError("sourcePostId must be an integer");
    }

    let subscription = this.subscriptions.get(sourcePostIdNumber);
    if (!subscription) {
      subscription = {
        callbacks: new Set(),
        lastChangeSequence: null,
        handler: (invalidation) =>
          this.handleInvalidation(sourcePostIdNumber, invalidation),
      };
      this.subscriptions.set(sourcePostIdNumber, subscription);
      this.messageBus.subscribe(
        this.channelFor(sourcePostIdNumber),
        subscription.handler,
      );
    }

    subscription.callbacks.add(callback);
    this.subscribeToReconnects();

    return () => this.unsubscribe(sourcePostIdNumber, callback);
  }

  unsubscribe(sourcePostId, callback) {
    let subscription = this.subscriptions.get(sourcePostId);
    if (!subscription) {
      return;
    }

    subscription.callbacks.delete(callback);
    if (subscription.callbacks.size) {
      return;
    }

    this.messageBus.unsubscribe(
      this.channelFor(sourcePostId),
      subscription.handler,
    );
    this.subscriptions.delete(sourcePostId);
    this.unsubscribeFromReconnects();
  }

  channelFor(sourcePostId) {
    return `${CHANNEL_PREFIX}${sourcePostId}`;
  }

  subscribeToReconnects() {
    if (this.reconnectSubscribed) {
      return;
    }

    window.addEventListener("online", this.handleReconnect);
    this.reconnectSubscribed = true;
  }

  unsubscribeFromReconnects() {
    if (this.subscriptions.size || !this.reconnectSubscribed) {
      return;
    }

    window.removeEventListener("online", this.handleReconnect);
    this.reconnectSubscribed = false;
  }

  handleInvalidation(sourcePostId, invalidation) {
    let payloadSourcePostId = Number(invalidation?.source_post_id);
    let changeSequence = Number(invalidation?.change_sequence);

    if (
      payloadSourcePostId !== sourcePostId ||
      !Number.isSafeInteger(changeSequence)
    ) {
      return;
    }

    let subscription = this.subscriptions.get(sourcePostId);
    if (
      !subscription ||
      (subscription.lastChangeSequence !== null &&
        changeSequence <= subscription.lastChangeSequence)
    ) {
      return;
    }

    subscription.lastChangeSequence = changeSequence;
    for (let callback of subscription.callbacks) {
      callback({
        source_post_id: sourcePostId,
        change_sequence: changeSequence,
      });
    }
  }
}

export { CHANNEL_PREFIX };
