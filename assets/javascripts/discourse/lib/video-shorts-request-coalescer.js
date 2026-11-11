export function createRequestCoalescer() {
  const inFlight = new Map();

  return function coalesce(key, producer) {
    const existing = inFlight.get(key);

    if (existing) {
      return existing;
    }

    let request;

    try {
      request = Promise.resolve(producer());
    } catch (error) {
      request = Promise.reject(error);
    }

    inFlight.set(key, request);

    const clear = () => {
      if (inFlight.get(key) === request) {
        inFlight.delete(key);
      }
    };

    request.then(clear, clear);
    return request;
  };
}
