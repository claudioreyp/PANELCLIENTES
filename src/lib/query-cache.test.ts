import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryCache, QUERY_IDLE_MS } from "./query-cache";

afterEach(() => vi.useRealTimers());
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
describe("session query cache", () => {
  it("deduplicates concurrent reads and retains cached content during refresh", async () => {
    const cache = new QueryCache();
    const pending = deferred<number>();
    const load = vi.fn(() => pending.promise);
    const first = cache.fetch("tables", load);
    const second = cache.fetch("tables", load);
    expect(load).toHaveBeenCalledTimes(1);
    pending.resolve(1); await Promise.all([first, second]);
    const refresh = deferred<number>();
    const updating = cache.fetch("tables", () => refresh.promise);
    expect(cache.entry("tables").snapshot).toEqual({ data: 1, loading: false, error: null });
    refresh.resolve(2); await updating;
    expect(cache.entry("tables").snapshot.data).toBe(2);
  });
  it("keeps errors honest and clears data after access rejection", async () => {
    const cache = new QueryCache(); cache.set("orders", [1]);
    await cache.fetch("orders", async () => { throw new Error("Offline"); });
    expect(cache.entry("orders").snapshot).toEqual({ data: [1], loading: false, error: "Offline" });
    await cache.fetch("orders", async () => { throw Object.assign(new Error("Denied"), { status: 403 }); });
    expect(cache.entry("orders").snapshot.data).toBeNull();
  });
  it("never lets late responses replace confirmed local writes or invalidated data", async () => {
    const cache = new QueryCache(); const late = deferred<number>();
    const first = cache.fetch("orders", () => late.promise);
    cache.set("orders", 2); late.resolve(1); await first;
    expect(cache.entry("orders").snapshot.data).toBe(2);
    const old = deferred<number>(); const reading = cache.fetch("orders", () => old.promise);
    cache.invalidate(); await cache.fetch("orders", async () => 4);
    old.resolve(3); await reading;
    expect(cache.entry("orders").snapshot.data).toBe(4);
  });
  it("separates sessions and parameters and discards results after disposal", async () => {
    const first = new QueryCache(); const second = new QueryCache();
    first.set("branch1:page1", 12);
    expect(first.entry("branch1:page2").snapshot.data).toBeNull();
    expect(second.entry("branch1:page1").snapshot.data).toBeNull();
    const late = deferred<number>(); const reading = first.fetch("late", () => late.promise);
    first.dispose(); late.resolve(4); await reading;
    expect(first.entry("late").snapshot.data).toBeNull();
  });
  it("expires unused data after five minutes, not while observed", async () => {
    vi.useFakeTimers();
    const cache = new QueryCache(); cache.set("catalog", 1);
    const off = cache.subscribe("catalog", vi.fn(), vi.fn());
    vi.advanceTimersByTime(QUERY_IDLE_MS + 1);
    expect(cache.entry("catalog").snapshot.data).toBe(1);
    off(); vi.advanceTimersByTime(QUERY_IDLE_MS - 1);
    expect(cache.entry("catalog").snapshot.data).toBe(1);
    vi.advanceTimersByTime(1);
    expect(cache.entry("catalog").snapshot.data).toBeNull();
  });
  it("refreshes active observers after invalidation and deduplicates their requests", async () => {
    const cache = new QueryCache(); const load = vi.fn(async () => 9);
    const off1 = cache.subscribe("tables", vi.fn(), () => { void cache.fetch("tables", load); });
    const off2 = cache.subscribe("tables", vi.fn(), () => { void cache.fetch("tables", load); });
    cache.invalidate(); await cache.fetch("tables", load);
    expect(load).toHaveBeenCalledTimes(1); off1(); off2(); cache.dispose();
  });
});
