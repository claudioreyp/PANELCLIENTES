import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RestaurantContext } from "../types";
import { TenantProvider, useTenant } from "./tenant";
import { useTableZoneSession } from "./table-zone-session";

const { apiMock, signOutMock, authMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  signOutMock: vi.fn(),
  authMock: { user: { id: "dev-owner" } as { id: string } | null },
}));

vi.mock("./api", () => ({
  api: apiMock,
  isUnauthorizedError: (value: unknown) => Boolean(
    value
    && typeof value === "object"
    && "status" in value
    && Number((value as { status?: unknown }).status) === 401,
  ),
}));

vi.mock("./auth", () => ({
  useAuth: () => ({
    user: authMock.user,
    signOut: signOutMock,
  }),
}));

const context: RestaurantContext = {
  business: {
    id: 1,
    slug: "pizza-house",
    name: "Pizza House",
    status: "active",
    plan: "starter",
    currency: "PEN",
    timezone: "America/Lima",
    modules: { pos: true },
  },
  branches: [{
    id: 1,
    business_id: 1,
    slug: "principal",
    name: "Sucursal principal",
    opening_hours: {},
    accepted_payment_methods: ["cash"],
    delivery_enabled: true,
    takeaway_enabled: true,
    delivery_fee: 0,
    active: true,
  }],
  role: "owner",
};

function Probe() {
  const tenant = useTenant();
  return (
    <div>
      <span>{tenant.loading ? "Cargando" : tenant.context?.business.name || "Sin contexto"}</span>
      {tenant.error && <span>{tenant.error}</span>}
    </div>
  );
}

function ZoneProbe() {
  const session = useTableZoneSession();
  const [, setRevision] = useState(0);
  return <>
    <Probe />
    <output data-testid="remembered-zone">{session?.read(1, 1) ?? "none"}</output>
    <button type="button" onClick={() => { session?.select(1, 1, 52); setRevision((current) => current + 1); }}>Select terrace</button>
  </>;
}

describe("TenantProvider", () => {
  afterEach(cleanup);

  beforeEach(() => {
    apiMock.mockReset();
    signOutMock.mockReset();
    authMock.user = { id: "dev-owner" };
    localStorage.clear();
    sessionStorage.clear();
  });

  it("recovers automatically when the API becomes available after a network failure", async () => {
    const networkError = Object.assign(new Error("No pudimos conectar con el servidor del POS."), { status: 0 });
    apiMock.mockRejectedValueOnce(networkError).mockResolvedValueOnce(context);

    render(<TenantProvider><Probe /></TenantProvider>);

    expect(await screen.findByText(networkError.message)).toBeInTheDocument();
    expect(await screen.findByText("Pizza House", {}, { timeout: 2000 })).toBeInTheDocument();

    expect(apiMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry HTTP errors automatically", async () => {
    const serverError = Object.assign(new Error("Error HTTP 500"), { status: 500 });
    apiMock.mockRejectedValueOnce(serverError);

    render(<TenantProvider><Probe /></TenantProvider>);
    expect(await screen.findByText(serverError.message)).toBeInTheDocument();

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 1200));
    });

    expect(apiMock).toHaveBeenCalledTimes(1);
  });

  it("keeps zone memory while children unmount and the same authenticated user refreshes", async () => {
    apiMock.mockResolvedValue(context);
    const view = render(<TenantProvider><ZoneProbe /></TenantProvider>);
    await screen.findByText("Pizza House");
    fireEvent.click(screen.getByRole("button", { name: "Select terrace" }));
    view.rerender(<TenantProvider><Probe /></TenantProvider>);
    authMock.user = { id: "dev-owner" };
    view.rerender(<TenantProvider><ZoneProbe /></TenantProvider>);
    await screen.findByText("Pizza House");
    expect(screen.getByTestId("remembered-zone")).toHaveTextContent("52");
    expect(Object.keys(localStorage).sort()).toEqual(["impulsa.branchId", "impulsa.businessId"]);
    expect(sessionStorage.length).toBe(0);
  });

  it("clears zone memory on logout, even when the same user logs back in", async () => {
    apiMock.mockResolvedValue(context);
    const view = render(<TenantProvider><ZoneProbe /></TenantProvider>);
    await screen.findByText("Pizza House");
    fireEvent.click(screen.getByRole("button", { name: "Select terrace" }));
    authMock.user = null;
    view.rerender(<TenantProvider><ZoneProbe /></TenantProvider>);
    expect(screen.getByTestId("remembered-zone")).toHaveTextContent("none");
    authMock.user = { id: "dev-owner" };
    view.rerender(<TenantProvider><ZoneProbe /></TenantProvider>);
    await screen.findByText("Pizza House");
    expect(screen.getByTestId("remembered-zone")).toHaveTextContent("none");
  });

  it("does not share zone memory with a different authenticated user", async () => {
    apiMock.mockResolvedValue(context);
    const view = render(<TenantProvider><ZoneProbe /></TenantProvider>);
    await screen.findByText("Pizza House");
    fireEvent.click(screen.getByRole("button", { name: "Select terrace" }));
    authMock.user = { id: "other-owner" };
    view.rerender(<TenantProvider><ZoneProbe /></TenantProvider>);
    await screen.findByText("Pizza House");
    expect(screen.getByTestId("remembered-zone")).toHaveTextContent("none");
  });

  it("discards zone memory when the tenant provider is unmounted", async () => {
    apiMock.mockResolvedValue(context);
    const view = render(<TenantProvider><ZoneProbe /></TenantProvider>);
    await screen.findByText("Pizza House");
    fireEvent.click(screen.getByRole("button", { name: "Select terrace" }));
    view.unmount();
    render(<TenantProvider><ZoneProbe /></TenantProvider>);
    await screen.findByText("Pizza House");
    expect(screen.getByTestId("remembered-zone")).toHaveTextContent("none");
  });
});
