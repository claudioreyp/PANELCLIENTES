import { describe, expect, it } from "vitest";
import { formatPosDate, parsePosDate } from "./pos-dates";
import { elapsedSeconds, formatCommandElapsed } from "../components/DigitalCommandBoard";

describe("POS timestamps", () => {
  it.each(["2026-09-08T20:00:00", "2026-09-08T20:00:00Z", "2026-09-08T15:00:00-05:00", "2026-09-08 20:00:00.000000"])("reads %s as the same UTC instant", (value) => {
    expect(parsePosDate(value).toISOString()).toBe("2026-09-08T20:00:00.000Z");
    expect(elapsedSeconds(value, Date.parse("2026-09-08T20:05:12Z"))).toBe(312);
    expect(formatPosDate(value, { hour: "2-digit", minute: "2-digit", hour12: false })).toBe("15:00");
  });
  it("uses the previous Lima day around midnight UTC", () => {
    expect(formatPosDate("2026-09-09T02:00:00", { day: "numeric" })).toBe("8");
  });
  it.each(["2026-09-13T03:18:00", "2026-09-13T03:18:00Z", "2026-09-12T22:18:00-05:00", "2026-09-13 03:18:00.000000"])("keeps the reported order on September 12 at 22:18 for %s", (value) => {
    expect(formatPosDate(value, { day: "numeric" })).toBe("12");
    expect(formatPosDate(value, { hour: "2-digit", minute: "2-digit", hour12: false })).toBe("22:18");
  });
  it("handles missing, invalid and future timestamps without NaN or negative timers", () => {
    expect(elapsedSeconds("bad", Date.now())).toBeNull();
    expect(elapsedSeconds("", Date.now())).toBeNull();
    expect(elapsedSeconds("2026-09-09T00:00:00Z", Date.parse("2026-09-08T00:00:00Z"))).toBe(0);
    expect(formatCommandElapsed(null)).toBe("--:--");
    expect(formatCommandElapsed(5999)).toBe("99:59");
    expect(formatCommandElapsed(6000)).toBe("+99 mins");
  });
});
