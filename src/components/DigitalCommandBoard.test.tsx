import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../lib/api";
import type { KitchenTicket } from "../types";
import { CommandCard, DigitalCommandBoard } from "./DigitalCommandBoard";

vi.mock("../lib/api", async (original) => ({ ...await original<typeof import("../lib/api")>(), api: vi.fn() }));
vi.mock("../lib/hooks", async (original) => ({ ...await original<typeof import("../lib/hooks")>(), useBranchRealtime: vi.fn() }));
const ticket: KitchenTicket = { id: 1, order_id: 42, order_folio: 7, order_number: "2026-00042", sequence: 2, channel: "takeaway", customer_name: "Pepe", created_by: "private-uuid", created_by_name: "Ana Pérez", source: "pos", station: "kitchen", status: "queued", created_at: "2026-09-08T20:00:00", print_count: 0, items: [
  { item_id: 1, name: "Alitas", variant_name: "Grande", quantity: 2, notes: "Salsas aparte", modifiers: [
    { modifier_id: 1, group_name: "Salsas", name: "BBQ", price_delta: 0 },
    { modifier_id: 2, group_name: "Extras", name: "Pepino", price_delta: 3 },
    { modifier_id: 2, group_name: "Extras", name: "Pepino", price_delta: 3 },
    { modifier_id: 3, name: "Opción histórica" },
  ], combo_components: [{ product_id: 2, name: "Papas", quantity: 1 }] },
] };
const now = Date.parse("2026-09-08T22:05:12Z");
const response = (items = [ticket], total = items.length) => ({ items, total, active_count: total, page: 1, page_size: 12, view: "active" });

afterEach(() => { cleanup(); vi.resetAllMocks(); });
describe("digital command cards", () => {
  it("uses complete snapshots, counts units, retains combos and never exposes prices or actor IDs", () => {
    render(<CommandCard ticket={ticket} view="active" now={now} pending={false} onAction={vi.fn()} />);
    for (const text of ["#7", "Comanda #2", "Tomado por Ana Pérez", "2 × Alitas - Grande", "Salsas aparte", "Salsas", "2 × BBQ", "Extras", "4 × Pepino", "Personalizaciones", "2 × Papas"]) expect(screen.getByText(text)).toBeVisible();
    expect(screen.queryByText(/private-uuid|S\//)).not.toBeInTheDocument();
    expect(screen.getByRole("timer")).toHaveTextContent("+99 mins");
    expect(screen.getByRole("timer")).toHaveAccessibleName("Tiempo de preparación: 125 minutos y 12 segundos");
  });
  it.each(["active", "history"] as const)("hides the code and global order ID in %s cards without changing action payloads", (view) => {
    const onAction = vi.fn();
    const { container, rerender } = render(<CommandCard ticket={ticket} view={view} now={now} pending={false} onAction={onAction} />);
    expect(screen.getByText("#7")).toBeVisible();
    expect(container.innerHTML).not.toContain(ticket.order_number);
    expect(screen.queryByText("#42")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button"));
    expect(onAction).toHaveBeenLastCalledWith(ticket);
    for (const order_folio of [null, undefined]) {
      const legacy = { ...ticket, order_folio };
      rerender(<CommandCard ticket={legacy} view={view} now={now} pending={false} onAction={onAction} />);
      expect(screen.getByText("Sin folio")).toBeVisible();
      expect(screen.queryByText("#7")).not.toBeInTheDocument();
      expect(container.innerHTML).not.toContain(ticket.order_number);
      expect(container.querySelector('[title*="42"], [aria-label*="42"]')).toBeNull();
      fireEvent.click(screen.getByRole("button"));
      expect(onAction).toHaveBeenLastCalledWith(legacy);
    }
  });
  it("falls back to source, retains corrective history and freezes the completed timer", () => {
    render(<CommandCard ticket={{ ...ticket, created_by_name: null, source: "whatsapp", kind: "revision", context: { modified_at: "2026-09-08T22:00:00" }, ready_at: "2026-09-08T20:11:04", items: [
      { ...ticket.items[0], action: "modified", previous_name: "Alitas - Mediano", previous_quantity: 1 },
      { item_id: 2, name: "Refresco", quantity: 1, action: "cancelled", cancellation_reason: "Ya no lo desea" },
    ] }} view="history" now={now} pending={false} onAction={vi.fn()} />);
    for (const text of ["Origen: WhatsApp", "Modificado hace 5 min", "Antes: 1 × Alitas - Mediano", "Cancelado", "Motivo: Ya no lo desea"]) expect(screen.getByText(text)).toBeVisible();
    expect(screen.getByRole("timer")).toHaveTextContent("11:04");
    expect(screen.getByRole("timer")).toHaveAttribute("data-urgency", "warning");
  });
});

describe("command board mutations", () => {
  it("reloads a stale command and requires a new version and key for completion", async () => {
    let posts = 0;
    vi.mocked(api).mockImplementation(async (_path, options) => {
      if (options?.method === "POST") {
        posts++;
        if (posts === 1) throw new ApiError("La comanda cambió. Revisa sus productos.", 409, undefined, "KITCHEN_TICKET_STALE");
        return {};
      }
      return response(posts > 1 ? [] : [{ ...ticket, version: posts ? 2 : 1, items: [{ ...ticket.items[0], notes: posts ? "Sin sal" : "Salsas aparte" }] }]);
    });
    render(<DigitalCommandBoard branchId={1} />);
    fireEvent.click(await screen.findByRole("button", { name: "Completar comanda" }));
    await screen.findByText("Sin sal");
    expect(screen.getByRole("alert")).toHaveTextContent("Revisa");
    fireEvent.click(screen.getByRole("button", { name: "Completar comanda" }));
    await screen.findByText("No hay comandas por preparar");
    const writes = vi.mocked(api).mock.calls.filter(([, options]) => options?.method === "POST");
    expect(writes[1][1]?.idempotencyKey).not.toBe(writes[0][1]?.idempotencyKey);
    expect(JSON.parse(String(writes[1][1]?.body)).expected_version).toBe(2);
  });
  it("preserves a last-page completion when loading the preceding page would fail", async () => {
    let completed = false;
    vi.mocked(api).mockImplementation(async (_path, options) => {
      if (options?.method === "POST") { completed = true; return {}; }
      if (completed) throw new Error("Offline");
      return response([ticket], 13);
    });
    render(<DigitalCommandBoard branchId={1} />);
    fireEvent.click(await screen.findByRole("button", { name: "Página siguiente" }));
    fireEvent.click(await screen.findByRole("button", { name: "Completar comanda" }));
    expect(await screen.findByText("No hay más comandas en esta página")).toBeVisible();
    expect(screen.getByText("Comanda completada y guardada en el historial.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Página anterior" })).toBeEnabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("keeps a confirmed completion and success even when its refresh fails", async () => {
    let completed = false;
    vi.mocked(api).mockImplementation(async (_path, options) => {
      if (options?.method === "POST") { completed = true; return { command: { ...ticket, status: "ready" } }; }
      if (completed) throw new Error("Read offline");
      return response();
    });
    render(<StrictMode><DigitalCommandBoard branchId={1} /></StrictMode>);
    fireEvent.click(await screen.findByRole("button", { name: "Completar comanda" }));
    expect(await screen.findByText("No hay comandas por preparar")).toBeVisible();
    await waitFor(() => expect(screen.getByText("Comanda completada y guardada en el historial.")).toBeVisible());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("0 comandas por preparar")).toBeVisible();
    expect(vi.mocked(api).mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1);
  });
  it("retains the command on failure and reuses the same idempotency key to retry", async () => {
    let posts = 0;
    vi.mocked(api).mockImplementation(async (_path, options) => {
      if (options?.method === "POST") { posts++; if (posts === 1) throw new Error("Conexión interrumpida. Reintenta."); return {}; }
      return response(posts > 1 ? [] : [ticket]);
    });
    render(<DigitalCommandBoard branchId={1} />);
    fireEvent.click(await screen.findByRole("button", { name: "Completar comanda" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Reintenta");
    fireEvent.click(screen.getByRole("button", { name: "Completar comanda" }));
    await screen.findByText("No hay comandas por preparar");
    const writes = vi.mocked(api).mock.calls.filter(([, options]) => options?.method === "POST");
    expect(writes[0][1]?.idempotencyKey).toBe(writes[1][1]?.idempotencyKey);
    expect(JSON.parse(String(writes[1][1]?.body))).toEqual({ expected_status: "queued", expected_version: 1 });
  });
  it("loads history lazily, paginates twelve and resets on branch change", async () => {
    vi.mocked(api).mockImplementation(async () => response([ticket], 13));
    const rendered = render(<DigitalCommandBoard branchId={1} />);
    await screen.findByRole("button", { name: "Completar comanda" });
    expect(api).toHaveBeenLastCalledWith(expect.stringContaining("view=active&page=1&page_size=12"));
    fireEvent.click(screen.getByRole("button", { name: "Página siguiente" }));
    await waitFor(() => expect(api).toHaveBeenLastCalledWith(expect.stringContaining("page=2&page_size=12")));
    fireEvent.click(await screen.findByRole("button", { name: "Ver historial" }));
    await screen.findByRole("button", { name: "Devolver a preparación" });
    expect(api).toHaveBeenLastCalledWith(expect.stringContaining("view=history&page=1"));
    rendered.rerender(<DigitalCommandBoard branchId={2} />);
    await screen.findByRole("button", { name: "Completar comanda" });
    expect(api).toHaveBeenLastCalledWith(expect.stringContaining("branch_id=2&view=active&page=1"));
  });
});
