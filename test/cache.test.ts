import test from "node:test";
import assert from "node:assert/strict";
import { TtlCache, cacheKey, getSharedCache, resetSharedCache } from "../src/cache.js";

test("TtlCache: hits, expires with clock, evicts LRU, and coalesces inflight", async () => {
  let now = 1000;
  const cache = new TtlCache({ maxEntries: 2, now: () => now });

  cache.set("k1", { v: 1 }, 500);
  assert.deepStrictEqual(cache.get("k1"), { v: 1 });

  now = 1600;
  assert.strictEqual(cache.get("k1"), undefined);

  cache.set("a", 1, 1000);
  cache.set("b", 2, 1000);
  assert.strictEqual(cache.get("a"), 1); // 'b' becomes LRU
  cache.set("c", 3, 1000); // evicts 'b'
  assert.strictEqual(cache.get("b"), undefined);
  assert.strictEqual(cache.get("a"), 1);
  assert.strictEqual(cache.get("c"), 3);

  let loaderCalls = 0;
  const [r1, r2] = await Promise.all([
    cache.wrap("inflight", 1000, async () => {
      loaderCalls += 1;
      await new Promise((r) => setTimeout(r, 15));
      return "ok";
    }),
    cache.wrap("inflight", 1000, async () => {
      loaderCalls += 1;
      return "ok";
    }),
  ]);
  assert.strictEqual(r1, "ok");
  assert.strictEqual(r2, "ok");
  assert.strictEqual(loaderCalls, 1);

  assert.strictEqual(cache.invalidate("inf"), 1);
});

test("TtlCache: errors are never cached and REWE_MCP_CACHE=false disables shared cache", async () => {
  const cache = new TtlCache({ maxEntries: 10 });
  let calls = 0;
  await assert.rejects(
    () =>
      cache.wrap("err", 1000, async () => {
        calls += 1;
        throw new Error("boom");
      }),
    /boom/
  );
  const ok = await cache.wrap("err", 1000, async () => {
    calls += 1;
    return "recovered";
  });
  assert.strictEqual(ok, "recovered");
  assert.strictEqual(calls, 2);

  assert.strictEqual(
    cacheKey("GET /x", [{ b: 2, a: 1 }]),
    cacheKey("GET /x", [{ a: 1, b: 2 }])
  );

  const prev = process.env.REWE_MCP_CACHE;
  process.env.REWE_MCP_CACHE = "false";
  try {
    const disabled = resetSharedCache();
    assert.strictEqual(disabled.isEnabled, false);
    assert.strictEqual(getSharedCache(), disabled);
  } finally {
    if (prev === undefined) delete process.env.REWE_MCP_CACHE;
    else process.env.REWE_MCP_CACHE = prev;
    resetSharedCache();
  }
});
