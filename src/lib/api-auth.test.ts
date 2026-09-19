import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({
  getSession: vi.fn(),
  refreshSession: vi.fn(),
}));

vi.mock("./supabase", () => ({
  supabase: { auth: authMock },
}));

import { api, authHeaders, isUnauthorizedError } from "./api";
import { ORDER_PRINT_EVENT } from "./print-events";

describe("authenticated API transport", () => {
  beforeEach(() => {
    localStorage.clear();
    authMock.getSession.mockReset();
    authMock.refreshSession.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("refreshes a missing session once before building protected headers", async () => {
    authMock.getSession.mockResolvedValue({ data: { session: null } });
    authMock.refreshSession.mockResolvedValue({
      data: { session: { access_token: "renewed-token" } },
    });

    await expect(authHeaders()).resolves.toMatchObject({
      Authorization: "Bearer renewed-token",
    });
    expect(authMock.refreshSession).toHaveBeenCalledOnce();
  });

  it("does not send a protected request when no bearer can be obtained", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    authMock.getSession.mockResolvedValue({ data: { session: null } });
    authMock.refreshSession.mockResolvedValue({ data: { session: null } });

    await expect(api("/context")).rejects.toMatchObject({
      status: 401,
      message: "Tu sesión expiró. Vuelve a ingresar",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["getSession", "refreshSession"] as const)("does not expire a session when %s cannot reach Auth", async (operation) => {
    const outage = { name: "AuthRetryableFetchError", message: "Failed to fetch", status: 0 };
    authMock.getSession.mockResolvedValue({ data: { session: null } });
    authMock[operation].mockResolvedValue({ data: { session: null }, error: outage });
    localStorage.setItem("impulsa.authMode", "supabase");
    localStorage.setItem("impulsa.businessId", "2");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    let caught: unknown;
    try { await api("/context"); } catch (error) { caught = error; }

    expect(caught).toMatchObject({ status: 503, code: "AUTH_UNAVAILABLE" });
    expect(isUnauthorizedError(caught)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(localStorage.getItem("impulsa.authMode")).toBe("supabase");
    expect(localStorage.getItem("impulsa.businessId")).toBe("2");
    if (operation === "getSession") expect(authMock.refreshSession).not.toHaveBeenCalled();
  });

  it("handles a thrown network error without reporting a wrong password or expired session", async () => {
    authMock.getSession.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(authHeaders()).rejects.toMatchObject({ status: 503, code: "AUTH_UNAVAILABLE" });
    expect(authMock.refreshSession).not.toHaveBeenCalled();
  });

  it("replaces a backend bearer error with the session-expired message", async () => {
    authMock.getSession.mockResolvedValue({
      data: { session: { access_token: "expired-token" } },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ detail: "Bearer token required" }),
      { status: 401, headers: { "content-type": "application/json" } },
    )));

    await expect(api("/context")).rejects.toMatchObject({
      status: 401,
      message: "Tu sesión expiró. Vuelve a ingresar",
    });
  });

  it("does not reuse a cached catalog response after a write", async () => {
    authMock.getSession.mockResolvedValue({
      data: { session: { access_token: "active-token" } },
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ categories: [] }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);

    await api("/catalog?branch_id=1");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it.each(["confirm-and-send", "table-checkout/start"])("requests durable jobs after a confirmed %s", async (operation) => {
    authMock.getSession.mockResolvedValue({ data: { session: { access_token: "test-token" } } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ order: { id: 17, branch_id: 2, version: 6 } }), { status: 200, headers: { "content-type": "application/json" } })));
    const listener = vi.fn();
    window.addEventListener(ORDER_PRINT_EVENT, listener);
    try {
      await api(`/orders/17/${operation}`, { method: "POST" });
      expect(listener).toHaveBeenCalledOnce();
      expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({ orderId: 17, branchId: 2, version: 6 });
    } finally { window.removeEventListener(ORDER_PRINT_EVENT, listener); }
  });

  it("never triggers another document on table payment or a rejected close", async () => {
    authMock.getSession.mockResolvedValue({ data: { session: { access_token: "test-token" } } });
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ order: { id: 17, branch_id: 2 } }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: "Version conflict" }), { status: 409, headers: { "content-type": "application/json" } })));
    const listener = vi.fn();
    window.addEventListener(ORDER_PRINT_EVENT, listener);
    try {
      await api("/orders/17/table-checkout/pay", { method: "POST" });
      await expect(api("/orders/17/table-checkout/start", { method: "POST" })).rejects.toMatchObject({ status: 409 });
      expect(listener).not.toHaveBeenCalled();
    } finally { window.removeEventListener(ORDER_PRINT_EVENT, listener); }
  });

  it.each([
    ["item-batches", { tickets: [{ id: 5 }] }, 1],
    ["item-batches", { tickets: [] }, 0],
    ["item-revisions", { created_ticket_ids: [6] }, 1],
    ["item-revisions", { created_ticket_ids: [], updated_ticket_ids: [5] }, 0],
  ])("requests new commands for %s without printing drafts or repeating an existing revision", async (operation, extra, expected) => {
    authMock.getSession.mockResolvedValue({ data: { session: { access_token: "test-token" } } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ order: { id: 17, branch_id: 2, version: 7 }, ...(extra as object) }), { status: 200, headers: { "content-type": "application/json" } })));
    const listener = vi.fn();
    window.addEventListener(ORDER_PRINT_EVENT, listener);
    try {
      await api(`/orders/17/${operation}`, { method: "POST" });
      expect(listener).toHaveBeenCalledTimes(expected as number);
    } finally { window.removeEventListener(ORDER_PRINT_EVENT, listener); }
  });
});
