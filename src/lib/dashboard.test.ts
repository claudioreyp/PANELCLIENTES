import { describe, expect, it } from "vitest";
import { datePreset, dashboardMoney, limaToday, shiftDay } from "./dashboard";

describe("dashboard periods", () => {
  it("uses Lima around the UTC date boundary", () => {
    expect(limaToday(new Date("2026-09-09T04:59:59Z"))).toBe("2026-09-08");
    expect(limaToday(new Date("2026-09-09T05:00:00Z"))).toBe("2026-09-09");
  });
  it("includes today in rolling ranges and excludes the current calendar month", () => {
    expect(datePreset("Últimos 7 días", "2026-09-08")).toMatchObject({ from: "2026-09-02", to: "2026-09-08" });
    expect(datePreset("Últimos 30 días", "2026-09-08")).toMatchObject({ from: "2026-08-10", to: "2026-09-08" });
    expect(datePreset("Mes anterior", "2026-09-08")).toMatchObject({ from: "2026-08-01", to: "2026-08-31" });
    expect(datePreset("6 meses anteriores", "2026-01-03")).toMatchObject({ from: "2025-07-01", to: "2025-12-31" });
  });
  it("handles leap years and local money presentation", () => {
    expect(datePreset("Mes anterior", "2024-03-31").to).toBe("2024-02-29");
    expect(shiftDay("2024-03-01", -1)).toBe("2024-02-29");
    expect(dashboardMoney(135)).toBe("135 S/");
    expect(dashboardMoney(67.5, true)).toBe("67.50 S/");
  });
});
