import { beforeEach, expect, it, vi } from "vitest";
import { PrintPolicyError, PrintRetryPolicy, PRINT_RETRY_CUTOVER, type AutomaticPrintJob } from "./print-retry-policy";

function locks() {
  const queues = new Map<string, Promise<unknown>>();
  return { request: (key: string, _options: unknown, run: () => Promise<unknown>) => {
    const task = (queues.get(key) ?? Promise.resolve()).then(run);
    queues.set(key, task.catch(() => {}));
    return task;
  } } as unknown as Pick<LockManager, "request">;
}
const fresh = (): AutomaticPrintJob => ({ id: "one", order_id: 12, created_at: new Date(PRINT_RETRY_CUTOVER + 1).toISOString(), status: "pending", retryable: false });
const signal = () => new AbortController().signal;
beforeEach(() => localStorage.clear());

it("persists initial plus one safe retry, with a one-second delay and no daily reset", async () => {
  let now = PRINT_RETRY_CUTOVER + 10;
  const lock = locks(), first = new PrintRetryPolicy(2, 7, localStorage, lock, () => now);
  const send = vi.fn(async () => ({ outcome: "not_sent" as const }));
  expect(await first.attempt(fresh(), signal(), send)).toMatchObject({ attempted: true });
  expect(await first.attempt(fresh(), signal(), send)).toEqual({ attempted: false });
  now += 1000;
  const next = new PrintRetryPolicy(2, 7, localStorage, lock, () => now);
  expect(await next.attempt(fresh(), signal(), send)).toMatchObject({ attempted: true });
  now += 86400000;
  expect(await next.attempt(fresh(), signal(), send)).toEqual({ attempted: false });
  expect(send.mock.calls).toEqual([[false], [true]]);
  expect(next.retries()).toEqual([]);
});

it.each([undefined, "invalid", new Date(PRINT_RETRY_CUTOVER - 1).toISOString()])("gives legacy creation %s exactly one final attempt", async created_at => {
  const policy = new PrintRetryPolicy(2, 7, localStorage, locks());
  const send = vi.fn(async () => ({ outcome: "not_sent" as const }));
  await policy.attempt({ ...fresh(), created_at }, signal(), send);
  await policy.attempt({ ...fresh(), created_at }, signal(), send);
  expect(send).toHaveBeenCalledTimes(1);
  expect(policy.retries()).toEqual([]);
});

it("serializes competing tabs and never retries an uncertain send", async () => {
  const lock = locks(), a = new PrintRetryPolicy(2, 7, localStorage, lock), b = new PrintRetryPolicy(2, 7, localStorage, lock);
  const send = vi.fn(async () => ({ outcome: "unknown" as const }));
  await Promise.all([a.attempt(fresh(), signal(), send), b.attempt(fresh(), signal(), send)]);
  expect(send).toHaveBeenCalledTimes(1);
  expect(a.retries()).toEqual([]);
});

it("keeps dismissal through the retry without canceling it, and separates new documents and scopes", async () => {
  let now = PRINT_RETRY_CUTOVER;
  const lock = locks(), policy = new PrintRetryPolicy(2, 7, localStorage, lock, () => now);
  const send = vi.fn(async () => ({ outcome: "not_sent" as const }));
  await policy.attempt(fresh(), signal(), send);
  await policy.dismiss(["one"], signal());
  now += 1000;
  await policy.attempt(fresh(), signal(), send);
  expect(send).toHaveBeenCalledTimes(2);
  expect(policy.isDismissed(["one"])).toBe(true);
  expect(policy.canAttempt({ ...fresh(), id: "new-addition" })).toBe(true);
  expect(new PrintRetryPolicy(9, 7, localStorage, lock).canAttempt(fresh())).toBe(true);
  expect(new PrintRetryPolicy(2, 8, localStorage, lock).canAttempt(fresh())).toBe(true);
});

it("excludes known manual copies and untracked failed jobs", () => {
  const policy = new PrintRetryPolicy(2, 7, localStorage, locks());
  policy.markManual("one", 12);
  expect(policy.canAttempt(fresh())).toBe(false);
  expect(policy.canAttempt({ ...fresh(), id: "old-failed", status: "failed", retryable: true })).toBe(false);
});

it("requires durable reservation and cross-tab coordination before touching QZ", async () => {
  const send = vi.fn(async () => ({ outcome: "printed" as const }));
  await expect(new PrintRetryPolicy(2, 7, localStorage, undefined).attempt(fresh(), signal(), send)).rejects.toBeInstanceOf(PrintPolicyError);
  const broken = { getItem: () => null, setItem: () => { throw new Error("full"); } } as unknown as Storage;
  await expect(new PrintRetryPolicy(2, 7, broken, locks()).attempt(fresh(), signal(), send)).rejects.toBeInstanceOf(PrintPolicyError);
  expect(send).not.toHaveBeenCalled();
});
