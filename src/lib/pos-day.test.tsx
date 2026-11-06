import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { nextPosMidnight, posDayKey, posTimestampDay } from "./pos-day";
import { usePosDay } from "./use-pos-day";

afterEach(() => { cleanup(); vi.useRealTimers(); });

it("uses Lima midnight regardless of the browser timezone and accepts the API's UTC dates", () => {
  expect(posDayKey(Date.parse("2026-11-07T04:59:59Z"))).toBe("2026-11-06");
  expect(posDayKey(Date.parse("2026-11-07T05:00:00Z"))).toBe("2026-11-07");
  expect(posTimestampDay("2026-11-07T04:59:59")).toBe("2026-11-06");
  expect(posTimestampDay("2026-11-07T00:00:00-05:00")).toBe("2026-11-07");
  for (const value of [undefined, null, "", "invalid"]) expect(posTimestampDay(value)).toBeNull();
});

it.each([
  ["2026-11-30T23:00:00Z", "2026-12-01T05:00:00Z"],
  ["2026-12-31T23:00:00Z", "2027-01-01T05:00:00Z"],
  ["2028-02-28T23:00:00Z", "2028-02-29T05:00:00Z"],
  ["2026-11-07T05:00:00Z", "2026-11-08T05:00:00Z"],
])("schedules the next Lima midnight after %s", (now, next) => {
  expect(nextPosMidnight(Date.parse(now))).toBe(Date.parse(next));
});

it("updates an open view exactly at midnight and schedules the following day", () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-07T04:59:59Z"));
  const { result, unmount } = renderHook(usePosDay);
  expect(result.current).toBe("2026-11-06");
  act(() => vi.advanceTimersByTime(1000));
  expect(result.current).toBe("2026-11-07");
  act(() => vi.advanceTimersByTime(86400000));
  expect(result.current).toBe("2026-11-08");
  unmount(); expect(vi.getTimerCount()).toBe(0);
});

it.each(["focus", "pageshow", "visibilitychange"])("catches a suspended browser on %s without a reload", event => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-07T04:00:00Z"));
  const { result } = renderHook(usePosDay);
  vi.setSystemTime(new Date("2026-11-09T08:00:00Z"));
  act(() => (event === "visibilitychange" ? document : window).dispatchEvent(new Event(event)));
  expect(result.current).toBe("2026-11-09");
  expect(vi.getTimerCount()).toBe(1);
});
