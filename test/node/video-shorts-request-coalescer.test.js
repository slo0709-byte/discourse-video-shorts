import assert from "node:assert/strict";
import test from "node:test";

import { createRequestCoalescer } from "../../assets/javascripts/discourse/lib/video-shorts-request-coalescer.js";

test("shares concurrent requests with the same transition key", async () => {
  const coalesce = createRequestCoalescer();
  let calls = 0;
  let resolveRequest;
  const pending = new Promise((resolve) => {
    resolveRequest = resolve;
  });
  const producer = () => {
    calls += 1;
    return pending;
  };

  const first = coalesce("initial:20", producer);
  const second = coalesce("initial:20", producer);

  assert.equal(calls, 1);
  assert.strictEqual(first, second);

  resolveRequest({ items: [1] });
  assert.deepEqual(await first, { items: [1] });
});

test("clears fulfilled and rejected requests", async () => {
  const coalesce = createRequestCoalescer();
  let calls = 0;

  await coalesce("initial:20", async () => ++calls);
  await coalesce("initial:20", async () => ++calls);
  assert.equal(calls, 2);

  await assert.rejects(
    coalesce("failed", async () => {
      throw new Error("network");
    }),
    /network/
  );
  assert.equal(await coalesce("failed", async () => "recovered"), "recovered");
});
