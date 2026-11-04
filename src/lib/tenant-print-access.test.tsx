import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PrintNotifications } from "../components/PrintNotifications";
import { TenantProvider, useTenant } from "./tenant";

const mocks = vi.hoisted(() => ({ signOut: vi.fn(), qzConnect: vi.fn() }));
vi.mock("./auth", () => ({ useAuth: () => ({ user: { id: "access-regression" }, signOut: mocks.signOut }) }));
vi.mock("./supabase", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "local-test-only" } } }) } } }));
vi.mock("./branch-realtime", () => ({ defaultRealtimeScope: {}, subscribeBranch: () => () => {} }));
vi.mock("./qz-tray", () => ({ qzBridge: { connect: mocks.qzConnect } }));

function Workspace() {
  const { context, loading, error, refresh } = useTenant();
  if (loading) return <p>Preparando el restaurante</p>;
  if (error) return <><p role="alert">{error}</p><button onClick={() => void refresh()}>Actualizar acceso</button></>;
  if (!context) return <p>Sin acceso</p>;
  return <><p>Pedido privado S/20</p><PrintNotifications branchId={1} automatic /></>;
}

beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("bounds the real API → tenant → print discovery remount loop and recovers after permission is restored", async () => {
  let denied = true;
  let resolveRecheck!: (response: Response) => void;
  const recheck = new Promise<Response>((resolve) => { resolveRecheck = resolve; });
  const paths: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    paths.push(path);
    // A failing implementation must stop inside this finite test perimeter.
    if (paths.length > 8) throw new DOMException("Regression request cap", "AbortError");
    expect(init?.method || "GET").toBe("GET");
    if (path.endsWith("/context")) {
      const response = Response.json({
        business: { id: 1, name: "Local synthetic restaurant" },
        branches: [{ id: 1, business_id: 1 }], role: "owner",
      });
      if (paths.filter((path) => path.endsWith("/context")).length === 2) return recheck;
      return response;
    }
    expect(path).toBe("/api/v1/orders/printing/pending");
    return denied
      ? Response.json({ detail: "Printing permission denied" }, { status: 403 })
      : Response.json({ branch_id: 1, items: [], next_after_order_id: null });
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<TenantProvider><Workspace /></TenantProvider>);

  await screen.findByText("Preparando el restaurante");
  // Hold the recheck until the protected workspace has actually unmounted,
  // matching the observed HTTP round trip rather than a same-tick mock response.
  await vi.waitFor(() => expect(paths.filter((path) => path.endsWith("/context"))).toHaveLength(2));
  expect(screen.queryByText("Pedido privado S/20")).not.toBeInTheDocument();
  await act(async () => resolveRecheck(Response.json({ business: { id: 1, name: "Local synthetic restaurant" }, branches: [{ id: 1, business_id: 1 }], role: "owner" })));
  expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos verificar los permisos");
  expect(screen.queryByText("Pedido privado S/20")).not.toBeInTheDocument();
  expect(paths.filter((path) => path.endsWith("/context"))).toHaveLength(2);
  expect(paths.filter((path) => path.endsWith("/printing/pending"))).toHaveLength(2);
  await act(async () => {
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("pos:access-invalidated"));
  });
  expect(fetchMock).toHaveBeenCalledTimes(4);
  expect(mocks.qzConnect).not.toHaveBeenCalled();

  denied = false;
  fireEvent.click(screen.getByRole("button", { name: "Actualizar acceso" }));
  await screen.findByText("Pedido privado S/20");
  await act(async () => {});
  expect(fetchMock).toHaveBeenCalledTimes(6);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(mocks.signOut).not.toHaveBeenCalled();
  expect(mocks.qzConnect).not.toHaveBeenCalled();
});
