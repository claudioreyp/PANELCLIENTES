import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardPage } from "./Dashboard";

const apiMock = vi.hoisted(() => vi.fn());
const realtime = vi.hoisted(() => ({ callbacks: [] as (() => void)[] }));
const tenant = vi.hoisted(() => ({ branch: { id: 1 }, context: { role: "owner" } }));
vi.mock("../lib/api", () => ({ api: apiMock }));
vi.mock("../lib/tenant", () => ({ useTenant: () => tenant }));
vi.mock("../lib/hooks", async (original) => ({ ...await original<typeof import("../lib/hooks")>(), useBranchRealtime: (_id: number, callback: () => void) => { realtime.callbacks.push(callback); } }));

const catalog = { branch: { id: 1 }, categories: [], products: [], modifier_groups: [{ id: 1, name: "Salsas", minimum: 0, modifiers: [{ id: 1, name: "BBQ", active: true, available: false }] }], ingredients: [], promotions: [] };
const report = { sales: 135, orders: 2, shipping: 10, average_ticket: 67.5, granularity: "hour", series: [{ key: "10:00", sales: 135, orders: 2, shipping: 10 }], weekdays: [], channels: [{ name: "Punto de venta", sales: 135, orders: 2 }], services: [], payment_methods: [], top_products: [], bottom_products: [] };
const app = () => <StrictMode><MemoryRouter><DashboardPage /></MemoryRouter></StrictMode>;
beforeEach(() => { apiMock.mockReset(); realtime.callbacks = []; tenant.branch = { id: 1 }; });
afterEach(cleanup);

describe("analytic home", () => {
  it("shows honest empty panels and exposes metric definitions on demand", async () => {
    apiMock.mockImplementation((path: string) => Promise.resolve(path.startsWith("/catalog") ? catalog : { ...report, sales: 0, orders: 0, shipping: 0, average_ticket: 0, series: [{ key: "10:00", sales: 0, orders: 0, shipping: 0 }] }));
    render(app());
    await screen.findByText("0.00 S/");
    const sales = within(screen.getByRole("region", { name: "Total de ventas" }));
    expect(sales.getByText("No hay datos para mostrar")).toBeVisible();
    expect(sales.queryByRole("group", { name: "Ventas por período" })).not.toBeInTheDocument();
    for (const title of ["Ventas por canal de venta", "Pedidos por canal de venta"]) {
      expect(within(screen.getByRole("region", { name: title })).getByText("No hay datos para mostrar")).toBeVisible();
    }
    const information = sales.getByRole("button", { name: "Información: Total de ventas" });
    information.focus();
    fireEvent.click(information);
    expect(sales.getByText(/Incluye pagos pendientes/)).toBeVisible();
    fireEvent.keyDown(information, { key: "Escape" });
    expect(information).toHaveFocus();
    expect(sales.getByText(/Incluye pagos pendientes/)).not.toBeVisible();
  });

  it("does not treat confirmed zero-value orders as a lack of activity", async () => {
    apiMock.mockImplementation((path: string) => Promise.resolve(path.startsWith("/catalog") ? catalog : { ...report, sales: 0, shipping: 0, average_ticket: 0 }));
    render(app());
    expect(await screen.findByRole("group", { name: "Ventas por período" })).toBeVisible();
  });

  it("keeps current stock while dates change and preserves confirmed metrics during failed refresh", async () => {
    let fail = false;
    apiMock.mockImplementation((path: string) => path.startsWith("/catalog") ? Promise.resolve(catalog) : fail ? Promise.reject(new Error("Offline")) : Promise.resolve(report));
    render(app());
    await screen.findByText("67.50 S/");
    expect(await screen.findByRole("link", { name: /BBQ.*Salsas/ })).toBeVisible();
    expect(screen.queryByText("Propinas")).not.toBeInTheDocument();
    fail = true;
    await act(async () => { realtime.callbacks.forEach((callback) => callback()); });
    expect(await screen.findByRole("alert")).toHaveTextContent("Se conservan los últimos datos");
    expect(screen.getByText("67.50 S/")).toBeVisible();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Hoy" }));
    fireEvent.click(screen.getByRole("button", { name: "Últimos 7 días" }));
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    await screen.findByText("67.50 S/");
    expect(await screen.findByRole("link", { name: /BBQ.*Salsas/ })).toBeVisible();
  });
  it("shows a retry instead of fake zeros and discards pending data from the previous branch", async () => {
    let complete!: (value: unknown) => void;
    apiMock.mockImplementation((path: string) => path.startsWith("/catalog") ? Promise.resolve(catalog) : path.includes("branch_id=1") ? new Promise((resolve) => { complete = resolve; }) : Promise.reject(new Error("Offline")));
    const view = render(app());
    tenant.branch = { id: 2 }; view.rerender(app());
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo cargar el resumen");
    await act(async () => complete(report));
    expect(screen.queryByText("67.50 S/")).not.toBeInTheDocument();
    expect(within(screen.getByRole("alert")).getByRole("button", { name: "Reintentar" })).toBeEnabled();
  });
});
