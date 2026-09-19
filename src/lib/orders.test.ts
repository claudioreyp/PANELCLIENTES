import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "./api";
import { loadOrdersWorkspace, normalizeOrderDetailResponse, resolveIdempotentIntent } from "./orders";

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return { ...actual, api: vi.fn() };
});

const apiMock = vi.mocked(api);

describe("idempotent order intents", () => {
  it("keeps both the key and original body when only the optimistic version changes", () => {
    const first = resolveIdempotentIntent(
      null,
      "8:confirm",
      JSON.stringify({ expected_version: 3 }),
      () => "intent-1",
    );
    const retry = resolveIdempotentIntent(
      first,
      "8:confirm",
      JSON.stringify({ expected_version: 4 }),
      () => "intent-2",
    );

    expect(retry).toBe(first);
    expect(retry).toEqual({
      signature: "8:confirm",
      key: "intent-1",
      body: JSON.stringify({ expected_version: 3 }),
    });
  });

  it("creates a new intent after the user changes the operation payload", () => {
    const first = resolveIdempotentIntent(null, "8:payment:cash:20", "body-1", () => "intent-1");
    const changed = resolveIdempotentIntent(first, "8:payment:cash:25", "body-2", () => "intent-2");

    expect(changed).toEqual({ signature: "8:payment:cash:25", key: "intent-2", body: "body-2" });
  });
});

describe("orders workspace compatibility", () => {
  beforeEach(() => apiMock.mockReset());

  it.each(["orders", "table_history"] as const)("loads all dates for %s with server pagination and without legacy truncation", async (view) => {
    apiMock.mockResolvedValueOnce({ period: "all", view, items: [], page: 19, page_size: 12, total: 240, review_count: 4 });
    const result = await loadOrdersWorkspace({ branchId: 1, period: "all", view, page: 19, pageSize: 12, search: "#7", timezone: "America/Lima" });
    const url = new URL(apiMock.mock.calls[0][0], "http://test.invalid");
    expect(url.searchParams.get("period")).toBe("all");
    expect(url.searchParams.get("view")).toBe(view);
    expect(url.searchParams.has("day")).toBe(false);
    expect(result).toMatchObject({ total: 240, page: 19, branch_id: 1 });
    expect(apiMock).toHaveBeenCalledTimes(1);
  });

  it.each(["missing", "ignored"])("rejects an API with %s all-dates support instead of presenting partial history", async (kind) => {
    if (kind === "missing") apiMock.mockRejectedValueOnce(new ApiError("Contrato ausente", 404, null, "API_CONTRACT_UNSUPPORTED"));
    else apiMock.mockResolvedValueOnce({ items: [], total: 0, page: 1, page_size: 12, review_count: 0 });
    await expect(loadOrdersWorkspace({ branchId: 1, period: "all", page: 1, pageSize: 12, search: "", timezone: "America/Lima" })).rejects.toThrow(/historial completo/);
    expect(apiMock).toHaveBeenCalledTimes(1);
  });

  it("uses the paginated workspace contract when it is available", async () => {
    apiMock.mockResolvedValueOnce({ items: [], page: 2, page_size: 10, total: 19, review_count: 3 });
    const result = await loadOrdersWorkspace({
      branchId: 1,
      day: "2026-08-27",
      search: "Ana",
      page: 2,
      pageSize: 10,
      timezone: "America/Lima",
    });
    expect(result).toMatchObject({ page: 2, total: 19, review_count: 3 });
    expect(apiMock).toHaveBeenCalledWith(expect.stringContaining("/orders/workspace?"));
  });

  it("falls back to the legacy order list only when the route is not deployed", async () => {
    apiMock
      .mockRejectedValueOnce(new ApiError("Contrato ausente", 404, null, "API_CONTRACT_UNSUPPORTED"))
      .mockResolvedValueOnce([{
        id: 8,
        number: "0008",
        business_id: 1,
        branch_id: 1,
        channel: "delivery",
        source: "pos",
        status: "draft",
        payment_status: "pending",
        delivery_address: null,
        subtotal: 25,
        discount: 0,
        delivery_fee: 5,
        total: 30,
        version: 1,
        created_at: "2026-08-27T18:00:00-05:00",
        items: [{ id: 1, product_id: 2, name: "Pizza", quantity: 1, unit_price: 25, modifiers: [], status: "draft", line_total: 25 }],
      }]);
    const result = await loadOrdersWorkspace({
      branchId: 1,
      day: "2026-08-27",
      search: "",
      page: 1,
      pageSize: 10,
      timezone: "America/Lima",
    });
    expect(result.items[0]).toMatchObject({ id: 8, item_count: 1, total: 30 });
    expect(apiMock).toHaveBeenCalledTimes(2);
  });
});

describe("order detail normalization", () => {
  it("unwraps the API response, selects the latest evidence and orders tickets by sequence", () => {
    const order = {
      id: 8,
      number: "0008",
      business_id: 1,
      branch_id: 1,
      channel: "delivery",
      source: "pos",
      status: "preparing",
      payment_status: "partial",
      subtotal: 30,
      discount: 0,
      delivery_fee: 0,
      total: 30,
      version: 2,
      created_at: "2026-08-27T18:00:00-05:00",
      items: [],
    };
    const evidence = (id: number, createdAt: string) => ({
      id,
      order_id: 8,
      provider: "yape",
      status: "under_review",
      warnings: [],
      image_url: `/evidence/${id}`,
      created_at: createdAt,
    });
    const ticket = (id: number, sequence: number) => ({
      id,
      order_id: 8,
      sequence,
      station: "kitchen",
      status: "queued" as const,
      items: [],
      print_count: 0,
      created_at: `2026-08-27T18:0${id}:00-05:00`,
    });

    const result = normalizeOrderDetailResponse({
      order,
      payments: [{ id: 1, order_id: 8, method: "cash", amount: 10, status: "confirmed", created_at: order.created_at }],
      payment_evidence: [evidence(1, "2026-08-27T18:01:00-05:00"), evidence(2, "2026-08-27T18:03:00-05:00")],
      tickets: [ticket(2, 2), ticket(1, 1)],
      payment_summary: { paid: 10, remaining: 20 },
    });

    expect(result.payment_evidence?.id).toBe(2);
    expect(result.kitchen_tickets.map((item) => item.sequence)).toEqual([1, 2]);
    expect(result).toMatchObject({ paid_amount: 10, remaining_amount: 20 });
  });

  it("normalizes the legacy flat detail response without losing its selected evidence", () => {
    const result = normalizeOrderDetailResponse({
      id: 9,
      number: "0009",
      business_id: 1,
      branch_id: 1,
      channel: "takeaway",
      source: "pos",
      status: "draft",
      payment_status: "pending",
      subtotal: 18,
      discount: 0,
      delivery_fee: 0,
      total: 18,
      version: 1,
      created_at: "2026-08-27T19:00:00-05:00",
      items: [],
      payments: [],
      payment_evidence: {
        id: 5,
        order_id: 9,
        provider: "yape",
        status: "under_review",
        warnings: [],
        image_url: "/evidence/5",
        created_at: "2026-08-27T19:01:00-05:00",
      },
      kitchen_tickets: [],
      paid_amount: 0,
      remaining_amount: 18,
    });

    expect(result).toMatchObject({ id: 9, paid_amount: 0, remaining_amount: 18 });
    expect(result.payment_evidence?.id).toBe(5);
    expect(result.kitchen_tickets).toEqual([]);
  });
});
