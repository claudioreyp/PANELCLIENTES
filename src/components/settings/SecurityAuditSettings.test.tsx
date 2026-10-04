import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../../lib/api";
import { useBranchRealtime } from "../../lib/hooks";
import { AuditReturnLink, auditReturnPath, positiveRouteId } from "../../lib/audit-navigation";
import { SecurityAuditSettings } from "./SecurityAuditSettings";

const tenant = vi.hoisted(() => ({ branch: { id: 1 } }));
vi.mock("../../lib/tenant", () => ({ useTenant: () => tenant }));
vi.mock("../../lib/api", async (original) => ({ ...await original<typeof import("../../lib/api")>(), api: vi.fn() }));
vi.mock("../../lib/hooks", () => ({ useBranchRealtime: vi.fn() }));

const entry = { id: 44, branch_id: 1, actor_display_name: "Equipo de prueba", action: "order.items_revised", summary: "canceló un producto de un pedido", categories: ["item_cancellation"], created_at: "2026-09-12T20:58:00" };
const detail = { id: 44, branch_id: 1, actor_name: "Equipo de prueba", occurred_at: entry.created_at, summary: entry.summary, fields: [{ label: "Folio de pedido", value: "#7" }], sections: [{ title: "Pizza", fields: [{ label: "Motivo de cancelación", value: null }, { label: "Cantidad cancelada", value: "1" }] }], target: { kind: "order", branch_id: 1, order_id: 700, label: "Pedido #CODIGO-ENTERO (#7)" } };
const list = { items: [entry], page: 2, page_size: 10, total: 15 };
function Destination() { const location = useLocation(); return <><p>{location.pathname}{location.search}</p><AuditReturnLink /></>; }
const app = (path = "/configuracion/seguridad?audit_branch_id=1&page=2&category=item_cancellation") => <MemoryRouter initialEntries={[path]}><Routes><Route path="/configuracion/seguridad" element={<SecurityAuditSettings />} /><Route path="*" element={<Destination />} /></Routes></MemoryRouter>;

beforeEach(() => { tenant.branch = { id: 1 }; vi.mocked(api).mockImplementation(async (path) => path.includes("/audit/44") ? detail : list); });
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe("security audit consultation", () => {
  it("opens readable snapshots, follows the exact order, and restores filters, page and focus", async () => {
    render(app());
    const row = await screen.findByRole("button", { name: "Equipo de prueba canceló un producto de un pedido" });
    fireEvent.click(row);
    const modal = await screen.findByRole("dialog", { name: "Detalle de la acción" });
    expect(await within(modal).findByText("Motivo no registrado")).toBeVisible();
    expect(within(modal).getByText("Pizza")).toBeVisible();
    expect(within(modal).getByText(/3:58/)).toBeVisible();
    const link = within(modal).getByRole("link", { name: "Pedido #CODIGO-ENTERO (#7)" });
    expect(link).toHaveAttribute("href", "/pedidos?order_id=700");
    expect(link).toHaveClass("audit-navigation-link");
    fireEvent.click(link);
    expect(screen.getByText("/pedidos?order_id=700")).toBeVisible();
    fireEvent.click(screen.getByRole("link", { name: "Regresar al historial de seguridad" }));
    const restored = await screen.findByRole("button", { name: "Equipo de prueba canceló un producto de un pedido" });
    await waitFor(() => expect(restored).toHaveFocus());
    expect(screen.getByLabelText("Acción")).toHaveValue("item_cancellation");
    expect(screen.getByText("11 - 15 de 15 acciones")).toBeVisible();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("restores row focus on Escape without losing pagination", async () => {
    render(app());
    const row = await screen.findByRole("button", { name: /canceló un producto/ });
    fireEvent.click(row);
    await screen.findByText("Pizza");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(row).toHaveFocus();
    expect(screen.getByText("11 - 15 de 15 acciones")).toBeVisible();
  });

  it("preserves confirmed list data during a refresh failure and retries", async () => {
    render(app());
    await screen.findByRole("button", { name: /canceló un producto/ });
    vi.mocked(api).mockRejectedValueOnce(new Error("Sin conexión"));
    fireEvent.click(screen.getByRole("button", { name: "Actualizar historial" }));
    expect(await screen.findByText("Sin conexión")).toBeVisible();
    expect(screen.getByRole("button", { name: /canceló un producto/ })).toBeVisible();
    expect(screen.getByText("11 - 15 de 15 acciones")).toBeVisible();
    expect(vi.mocked(api).mock.calls.at(-1)?.[0]).toContain("page=1");
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(screen.queryByText("Sin conexión")).not.toBeInTheDocument());
  });

  it("keeps the detail open for retry and never uses a cross-branch target", async () => {
    vi.mocked(api).mockImplementation(async (path) => {
      if (path.includes("/audit/44")) throw new Error("No se pudo consultar");
      return list;
    });
    render(app());
    fireEvent.click(await screen.findByRole("button", { name: /canceló un producto/ }));
    await screen.findByText("No se pudo consultar");
    vi.mocked(api).mockResolvedValue({ ...detail, target: { ...detail.target, branch_id: 2 } });
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await screen.findByText("Pizza");
    expect(screen.queryByRole("link", { name: /Pedido/ })).not.toBeInTheDocument();
  });

  it("discards late detail responses when the branch changes", async () => {
    let resolve!: (value: unknown) => void;
    vi.mocked(api).mockImplementation(async (path) => path.includes("/audit/44") ? new Promise((done) => { resolve = done; }) : list);
    const view = render(app());
    fireEvent.click(await screen.findByRole("button", { name: /canceló un producto/ }));
    await screen.findByText("Consultando la acción...");
    tenant.branch = { id: 2 };
    view.rerender(app());
    await act(async () => resolve(detail));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("Pizza")).not.toBeInTheDocument();
    expect(vi.mocked(api).mock.calls.some(([path]) => path.includes("branch_id=2"))).toBe(true);
  });

  it("applies semantic filters server-side and resets pagination", async () => {
    render(app());
    await screen.findByRole("button", { name: /canceló un producto/ });
    fireEvent.change(screen.getByLabelText("Acción"), { target: { value: "cash_withdrawal" } });
    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2026-09-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Filtros" }));
    await waitFor(() => expect(vi.mocked(api).mock.calls.some(([path]) => path.includes("page=1") && path.includes("category=cash_withdrawal") && path.includes("from=2026-09-01"))).toBe(true));
    expect(vi.mocked(api).mock.calls.every(([path]) => path.includes("critical_only=true"))).toBe(true);
  });

  it.each(["cash_discrepancy", "refund_method_change"])("requests the critical %s category", async (category) => {
    render(app());
    await screen.findByRole("button", { name: /canceló un producto/ });
    fireEvent.change(screen.getByLabelText("Acción"), { target: { value: category } });
    fireEvent.click(screen.getByRole("button", { name: "Filtros" }));
    await waitFor(() => expect(vi.mocked(api).mock.calls.at(-1)?.[0]).toContain(`category=${category}`));
    expect(screen.getByRole("option", { name: "Todas las acciones críticas" })).toBeInTheDocument();
  });

  it("refreshes the current historical page on events and coalesces bursts during an in-flight read", async () => {
    render(app());
    await screen.findByRole("button", { name: /canceló un producto/ });
    let resolve!: (value: unknown) => void;
    vi.mocked(api).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const onEvent = vi.mocked(useBranchRealtime).mock.calls.at(-1)![1];
    act(() => { onEvent(); onEvent(); window.dispatchEvent(new Event("focus")); });
    await waitFor(() => expect(vi.mocked(api)).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api).mock.calls.at(-1)?.[0]).toContain("page=2");
    act(() => { onEvent(); onEvent(); onEvent(); });
    await act(async () => resolve(list));
    await waitFor(() => expect(vi.mocked(api)).toHaveBeenCalledTimes(3));
    expect(screen.getByText("11 - 15 de 15 acciones")).toBeVisible();
  });

  it("defers hidden-view refresh until it becomes visible and removes listeners on unmount", async () => {
    const view = render(app());
    await screen.findByRole("button", { name: /canceló un producto/ });
    const onEvent = vi.mocked(useBranchRealtime).mock.calls.at(-1)![1];
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    act(() => { onEvent(); window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange")); });
    expect(vi.mocked(api)).toHaveBeenCalledTimes(1);
    visibility.mockReturnValue("visible");
    act(() => { document.dispatchEvent(new Event("visibilitychange")); window.dispatchEvent(new Event("focus")); });
    await waitFor(() => expect(vi.mocked(api)).toHaveBeenCalledTimes(2));
    view.unmount();
    act(() => { onEvent(); window.dispatchEvent(new Event("focus")); });
    expect(vi.mocked(api)).toHaveBeenCalledTimes(2);
    visibility.mockRestore();
  });

  it("removes private confirmed rows after access is denied", async () => {
    render(app("/configuracion/seguridad"));
    await screen.findByRole("button", { name: /canceló un producto/ });
    vi.mocked(api).mockRejectedValueOnce(new ApiError("Sin permiso", 403));
    fireEvent.click(screen.getByRole("button", { name: "Actualizar historial" }));
    await screen.findByText("Sin permiso");
    expect(screen.queryByRole("button", { name: /canceló un producto/ })).not.toBeInTheDocument();
  });

  it("links a discrepant cut to its exact historic register and cut", async () => {
    vi.mocked(api).mockImplementation(async (path) => path.includes("/audit/44") ? { ...detail, target: { kind: "cash_cut", branch_id: 1, register_id: 6, cut_id: 3741, label: "Corte #3741" } } : list);
    render(app());
    fireEvent.click(await screen.findByRole("button", { name: /canceló un producto/ }));
    expect(await screen.findByRole("link", { name: "Corte #3741" })).toHaveAttribute("href", "/caja?register_id=6&cut_id=3741");
  });

  it("links a withdrawal to the exact historic movement and register", async () => {
    vi.mocked(api).mockImplementation(async (path) => path.includes("/audit/44") ? { ...detail, target: { kind: "cash_movement", branch_id: 1, register_id: 6, movement_id: 9424, label: "Movimiento #9424" } } : list);
    render(app());
    fireEvent.click(await screen.findByRole("button", { name: /canceló un producto/ }));
    expect(await screen.findByRole("link", { name: "Movimiento #9424" })).toHaveAttribute("href", "/caja?tab=movements&register_id=6&movement_id=9424");
  });

  it("rejects invalid IDs and unsafe return destinations", () => {
    for (const value of ["1e3", "-3", "0", "999999999999999999999", "3.2", ""]) expect(positiveRouteId(value)).toBeNull();
    expect(positiveRouteId("42")).toBe(42);
    expect(auditReturnPath({ auditReturnTo: "https://untrusted.invalid" })).toBeNull();
    expect(auditReturnPath({ auditReturnTo: "/configuracion/seguridad-mal" })).toBeNull();
    expect(auditReturnPath({ auditReturnTo: "/configuracion/seguridad?page=2" })).toBe("/configuracion/seguridad?page=2");
  });
});
