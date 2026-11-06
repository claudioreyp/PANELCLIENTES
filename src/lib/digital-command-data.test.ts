import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { commandsForPeriod, loadActiveCommands } from "./digital-command-data";
import type { KitchenCommandResponse, KitchenTicket } from "../types";

vi.mock("./api", () => ({ api: vi.fn() }));
const ticket = (id: number, created_at = "2026-09-08T05:00:00Z"): KitchenTicket => ({ id, order_id: id, created_at, status: "queued", station: "kitchen", items: [], print_count: 0 });
const page = (items: KitchenTicket[], total: number, number = 1): KitchenCommandResponse => ({ items, total, page: number, page_size: 100, active_count: total, view: "active" });

beforeEach(() => { vi.resetAllMocks(); });

describe("active command collection", () => {
  it("reads all API pages at up to 100 before publishing the full collection", async () => {
    vi.mocked(api).mockResolvedValueOnce(page(Array.from({ length: 100 }, (_, index) => ticket(index + 1)), 215))
      .mockResolvedValueOnce(page(Array.from({ length: 100 }, (_, index) => ticket(index + 101)), 215, 2))
      .mockResolvedValueOnce(page(Array.from({ length: 15 }, (_, index) => ticket(index + 201)), 215, 3));
    const result = await loadActiveCommands(7);
    expect(result.items).toHaveLength(215);
    expect(result.total).toBe(215);
    expect(api).toHaveBeenNthCalledWith(1, "/kitchen/commands?branch_id=7&view=active&page=1&page_size=100");
    expect(api).toHaveBeenNthCalledWith(2, "/kitchen/commands?branch_id=7&view=active&page=2&page_size=100");
    expect(api).toHaveBeenNthCalledWith(3, "/kitchen/commands?branch_id=7&view=active&page=3&page_size=100");
  });

  it("rejects a whole read when one later page fails, without returning its first page", async () => {
    vi.mocked(api).mockResolvedValueOnce(page(Array.from({ length: 100 }, (_, index) => ticket(index + 1)), 101)).mockRejectedValueOnce(new Error("Offline"));
    await expect(loadActiveCommands(7)).rejects.toThrow("Offline");
    expect(api).toHaveBeenCalledTimes(2);
  });

  it("rejects duplicate IDs that reveal a command moved between pages", async () => {
    vi.mocked(api).mockResolvedValueOnce(page(Array.from({ length: 100 }, (_, index) => ticket(index + 1)), 101)).mockResolvedValueOnce(page([ticket(1)], 101, 2));
    await expect(loadActiveCommands(7)).rejects.toThrow("lista completa");
  });

  it("rejects a changing total without publishing a partial collection", async () => {
    vi.mocked(api).mockResolvedValueOnce(page(Array.from({ length: 100 }, (_, index) => ticket(index + 1)), 101)).mockResolvedValueOnce(page([], 100, 2));
    await expect(loadActiveCommands(7)).rejects.toThrow("cambiaron");
    expect(api).toHaveBeenCalledTimes(2);
  });

  it("rejects an incomplete page even when the server total has not changed", async () => {
    vi.mocked(api).mockResolvedValueOnce(page(Array.from({ length: 100 }, (_, index) => ticket(index + 1)), 102)).mockResolvedValueOnce(page([ticket(101)], 102, 2));
    await expect(loadActiveCommands(7)).rejects.toThrow("lista completa");
  });
});

describe("Lima command periods", () => {
  it("uses the command's kitchen time and keeps new additions to old orders today", () => {
    const earlier = ticket(1, "2026-09-08T04:59:59Z");
    const midnight = ticket(2, "2026-09-08T05:00:00Z");
    const addition = { ...earlier, id: 3, fired_at: "2026-09-08T15:00:00Z" };
    expect(commandsForPeriod([earlier, midnight, addition], "2026-09-08", "previous").map(({ id }) => id)).toEqual([1]);
    expect(commandsForPeriod([earlier, midnight, addition], "2026-09-08", "today").map(({ id }) => id)).toEqual([2, 3]);
  });

  it("retains invalid and future dates today instead of hiding them", () => {
    const uncertain = [ticket(1, "not-a-date"), ticket(2, "2026-09-09T10:00:00Z")];
    expect(commandsForPeriod(uncertain, "2026-09-08", "today")).toEqual(uncertain);
    expect(commandsForPeriod(uncertain, "2026-09-08", "previous")).toEqual([]);
  });
});
