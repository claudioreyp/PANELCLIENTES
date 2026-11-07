import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AgentAttentionEntry, AgentAttentionPanel } from "./AgentAttentionPanel";
import { api, privateImage } from "../lib/api";
import { ApiError } from "../lib/api";
import { ATTENTION_CLOSE_NOTE, attentionIntentScope } from "../lib/agent-attention-intent";
import type { AgentAttention } from "../types";

const tenant = vi.hoisted(() => ({ role: "dispatcher", branch: 2, day: "2026-10-18" }));
vi.mock("../lib/use-pos-day", () => ({ usePosDay: () => tenant.day }));
vi.mock("../lib/tenant", () => ({ useTenant: () => ({ branch: { id: tenant.branch }, context: { role: tenant.role, business: { id: 2 } } }) }));
vi.mock("../lib/auth", () => ({ useAuth: () => ({ user: { id: "operator-1" } }) }));
vi.mock("../lib/hooks", () => ({ useBranchRealtime: vi.fn() }));
vi.mock("../lib/api", async original => ({ ...await original<typeof import("../lib/api")>(), api: vi.fn(), privateImage: vi.fn() }));
const mocked = vi.mocked(api);
const mockedImage = vi.mocked(privateImage);
const item: AgentAttention = { id: "notice-1", business_id: 2, branch_id: 2, order_id: null, kind: "catering", summary: "Solicitud de catering", sender: "51900000000", details: {}, status: "pending", version: 4, created_at: "2026-10-18T15:00:00Z", resolved_at: null, resolved_by: null, resolution_note: null };
const mediaRef = "11111111-2222-4333-8444-555555555555";
const lateReceipt = { ...item, kind: "late_payment_receipt", details: { attachments: [{ media_ref: mediaRef, image_url: "https://invalid.example/private" }] } };
function blobUrls() {
  const createObjectURL = vi.fn(() => "blob:synthetic-receipt");
  const revokeObjectURL = vi.fn();
  vi.stubGlobal("URL", Object.assign(class extends URL {}, { createObjectURL, revokeObjectURL }));
  return { createObjectURL, revokeObjectURL };
}
function openEntry() { fireEvent.click(document.querySelector(".agent-attention-entry summary")!); }
beforeEach(() => { vi.clearAllMocks(); mocked.mockReset(); mockedImage.mockReset(); localStorage.clear(); tenant.role = "dispatcher"; tenant.branch = 2; tenant.day = "2026-10-18"; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("shows a catering request without inventing an order or order link", () => {
  render(<AgentAttentionEntry item={item} mayResolve onSaved={vi.fn()} onOpenOrder={vi.fn()} />);
  expect(screen.getByText(/Sin pedido registrado/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Ver pedido", hidden: true })).not.toBeInTheDocument();
});

it("loads a late receipt only on request using its authenticated scoped path, without payment actions", async () => {
  const urls = blobUrls();
  mockedImage.mockResolvedValue(new Blob(["synthetic"], { type: "image/png" }));
  const view = render(<AgentAttentionEntry item={lateReceipt} mayResolve onSaved={vi.fn()} />);
  openEntry();
  expect(mockedImage).not.toHaveBeenCalled();
  expect(screen.getByText(/No hay pedido ni pago aprobado/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Ver comprobante 1" }));
  expect(await screen.findByRole("img", { name: "Comprobante recibido fuera de horario 1" })).toHaveAttribute("src", "blob:synthetic-receipt");
  expect(mockedImage).toHaveBeenCalledExactlyOnceWith(`/api/v1/agent-attention/notice-1/attachments/${mediaRef}`);
  expect(mocked).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: /aprobar pago|crear pedido/i })).not.toBeInTheDocument();
  view.unmount();
  expect(urls.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:synthetic-receipt");
});

it("preserves a failed private image load for retry and releases the displayed blob when hidden", async () => {
  const urls = blobUrls();
  mockedImage.mockRejectedValueOnce(new TypeError("synthetic unavailable")).mockResolvedValueOnce(new Blob(["synthetic"], { type: "image/jpeg" }));
  render(<AgentAttentionEntry item={lateReceipt} mayResolve onSaved={vi.fn()} />);
  openEntry();
  fireEvent.click(screen.getByRole("button", { name: "Ver comprobante 1" }));
  fireEvent.click(await screen.findByRole("button", { name: "Reintentar imagen" }));
  await screen.findByRole("img");
  expect(mockedImage).toHaveBeenCalledTimes(2);
  expect(mockedImage.mock.calls[0]).toEqual(mockedImage.mock.calls[1]);
  fireEvent.click(screen.getByRole("button", { name: "Ocultar comprobante 1" }));
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  expect(urls.revokeObjectURL).toHaveBeenCalledOnce();
});

it("does not display a late receipt to a dispatcher or follow arbitrary attachment references", () => {
  render(<AgentAttentionEntry item={lateReceipt} mayResolve={false} onSaved={vi.fn()} />);
  openEntry();
  expect(screen.queryByRole("button", { name: /comprobante/ })).not.toBeInTheDocument();
  cleanup();
  render(<AgentAttentionEntry item={{ ...lateReceipt, details: { attachments: [{ media_ref: "../../other" }, { media_ref: "https://invalid.example" }, null] } }} mayResolve onSaved={vi.fn()} />);
  openEntry();
  expect(screen.queryByRole("button", { name: /comprobante/ })).not.toBeInTheDocument();
  expect(mockedImage).not.toHaveBeenCalled();
});

it("rejects a non-image response and does not retain a late result after switching attention", async () => {
  const urls = blobUrls();
  mockedImage.mockResolvedValueOnce(new Blob(["synthetic"], { type: "text/html" }));
  const view = render(<AgentAttentionEntry item={lateReceipt} mayResolve onSaved={vi.fn()} />);
  openEntry();
  fireEvent.click(screen.getByRole("button", { name: "Ver comprobante 1" }));
  await screen.findByRole("alert");
  expect(urls.createObjectURL).not.toHaveBeenCalled();
  let resolve!: (blob: Blob) => void;
  mockedImage.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  fireEvent.click(screen.getByRole("button", { name: "Reintentar imagen" }));
  view.rerender(<AgentAttentionEntry item={{ ...item, id: "notice-other" }} mayResolve onSaved={vi.fn()} />);
  await act(async () => { resolve(new Blob(["synthetic"], { type: "image/png" })); });
  expect(urls.createObjectURL).not.toHaveBeenCalled();
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
});

it("keeps an uncertain resolution body and key for the retry and rejects double clicks", async () => {
  mocked.mockRejectedValueOnce(new TypeError("network")).mockResolvedValueOnce({ ...item, status: "resolved" });
  const saved = vi.fn().mockResolvedValue(undefined);
  render(<AgentAttentionEntry item={item} mayResolve onSaved={saved} />);
  openEntry();
  fireEvent.change(screen.getByLabelText("Nota de revisión"), { target: { value: "Contactado por WhatsApp" } });
  const button = screen.getByRole("button", { name: "Resolver incidencia" });
  act(() => { fireEvent.click(button); fireEvent.click(button); });
  fireEvent.click(await screen.findByRole("button", { name: "Reintentar la misma revisión" }));
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
  expect(mocked).toHaveBeenCalledTimes(2);
  expect(mocked.mock.calls[0][1]).toEqual(mocked.mock.calls[1][1]);
  expect(JSON.parse(mocked.mock.calls[0][1]!.body as string)).toEqual({ expected_version: 4, status: "resolved", note: "Contactado por WhatsApp" });
});

it("displays financial history to a dispatcher without offering resolution", async () => {
  mocked.mockImplementation(async path => path.startsWith("/orders/") ? { id: 27, business_id: 2, branch_id: 2, source: "whatsapp_agent" } : [{ ...item, order_id: 27, kind: "financial_review", status: "acknowledged", resolution_note: "Revisar exceso", resolved_by: "staff-1" }]);
  render(<AgentAttentionPanel orderId={27} />);
  await screen.findByText(item.summary); openEntry();
  expect(screen.getByText("Revisar exceso", { exact: false })).toBeInTheDocument();
  expect(screen.getByText(/staff-1/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Resolver incidencia" })).not.toBeInTheDocument();
  expect(mocked.mock.calls[0][0]).toBe("/agent-attention?branch_id=2&status=all&order_id=27");
});

it("shows the requested original-payment change without changing payments or resolving the review", () => {
  render(<AgentAttentionEntry item={{ ...item, order_id: 27, kind: "financial_review", details: { kind: "original_payment_method_change", from_method: "yape", requested_method: "cash" } }} mayResolve onSaved={vi.fn()} />);
  openEntry();
  expect(screen.getByText(/Cambio solicitado:/)).toHaveTextContent("Cambio solicitado: de Yape a Efectivo.");
  expect(screen.getByText(/Esta revisión no modifica cobros/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Marcar revisada" })).toBeDisabled();
  expect(mocked).not.toHaveBeenCalled();
});

it.each([
  { kind: "original_payment_method_change", from_method: "yape", requested_method: "tarjeta" },
  { kind: "fulfillment_amount_changed", from_method: "yape", requested_method: "cash" },
])("does not invent or expose an unsupported original-payment request: %j", details => {
  render(<AgentAttentionEntry item={{ ...item, kind: "financial_review", details }} mayResolve onSaved={vi.fn()} />);
  openEntry();
  expect(screen.queryByText(/Cambio solicitado:/)).not.toBeInTheDocument();
  expect(screen.getByText(/Esta revisión no modifica cobros/)).toBeInTheDocument();
  expect(mocked).not.toHaveBeenCalled();
});

it("rejects an attention record from another branch", async () => {
  mocked.mockResolvedValue([{ ...item, branch_id: 3 }]);
  render(<AgentAttentionPanel />);
  await screen.findByRole("alert");
  expect(screen.queryByText(item.summary)).not.toBeInTheDocument();
});

it.each(["catering", "complaint", "financial_review", "late_payment_receipt"])("does not offer dispatcher resolution for %s", async kind => {
  mocked.mockResolvedValue([{ ...item, kind }]);
  render(<AgentAttentionPanel />);
  await screen.findByText(item.summary); openEntry();
  expect(screen.queryByRole("button", { name: "Resolver incidencia" })).not.toBeInTheDocument();
});

it("closes for everyone using the audited endpoint once, keeping a confirmed close after refresh fails", async () => {
  let finish!: (value: AgentAttention) => void;
  mocked.mockImplementation(() => new Promise(done => { finish = done; }));
  const saved = vi.fn().mockRejectedValue(new Error("refresh unavailable"));
  render(<AgentAttentionEntry item={item} mayResolve onSaved={saved} />);
  const close = screen.getByRole("button", { name: "Cerrar aviso" });
  act(() => { fireEvent.click(close); fireEvent.click(close); });
  expect(mocked).toHaveBeenCalledTimes(1);
  expect(mocked.mock.calls[0][0]).toBe("/agent-attention/notice-1/resolve");
  expect(JSON.parse(mocked.mock.calls[0][1]!.body as string)).toEqual({ expected_version: 4, status: "resolved", note: ATTENTION_CLOSE_NOTE });
  expect(screen.getByText("Pedido especial")).toBeInTheDocument();
  await act(async () => { finish({ ...item, status: "resolved", version: 5 }); });
  expect(screen.queryByText("Pedido especial")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Reintentar cierre" })).not.toBeInTheDocument();
  expect(saved).toHaveBeenCalledOnce();
});

it("retains an uncertain close across remount with the exact key and body, outside collapsed details", async () => {
  const scope = attentionIntentScope("operator-1", 2, 2, item.id);
  mocked.mockRejectedValueOnce(new TypeError("lost response")).mockResolvedValueOnce({ ...item, status: "resolved", version: 5 });
  const first = render(<AgentAttentionEntry item={item} mayResolve resolutionScope={scope} onSaved={vi.fn().mockResolvedValue(undefined)} />);
  fireEvent.click(screen.getByRole("button", { name: "Cerrar aviso" }));
  await screen.findByRole("button", { name: "Reintentar cierre" });
  expect(document.querySelector("details")).not.toHaveAttribute("open");
  expect(localStorage.getItem(scope)).not.toBeNull();
  first.unmount();
  render(<AgentAttentionEntry item={item} mayResolve resolutionScope={scope} onSaved={vi.fn().mockResolvedValue(undefined)} />);
  fireEvent.click(screen.getByRole("button", { name: "Reintentar cierre" }));
  await waitFor(() => expect(mocked).toHaveBeenCalledTimes(2));
  expect(mocked.mock.calls[0][1]).toEqual(mocked.mock.calls[1][1]);
  await waitFor(() => expect(localStorage.getItem(scope)).toBeNull());
});

it("does not reuse another operator, branch or business close intent", async () => {
  const otherScopes = [attentionIntentScope("operator-2", 2, 2, item.id), attentionIntentScope("operator-1", 3, 2, item.id), attentionIntentScope("operator-1", 2, 3, item.id)];
  for (const scope of otherScopes) localStorage.setItem(scope, JSON.stringify({ key: "other-intent", body: JSON.stringify({ status: "resolved", expected_version: 4, note: ATTENTION_CLOSE_NOTE }), close: true }));
  mocked.mockResolvedValueOnce({ ...item, status: "resolved", version: 5 });
  render(<AgentAttentionEntry item={item} mayResolve resolutionScope={attentionIntentScope("operator-1", 2, 2, item.id)} onSaved={vi.fn().mockResolvedValue(undefined)} />);
  expect(screen.queryByRole("button", { name: "Reintentar cierre" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Cerrar aviso" }));
  await waitFor(() => expect(mocked).toHaveBeenCalledOnce());
  expect(mocked.mock.calls[0][1]!.idempotencyKey).not.toBe("other-intent");
  expect(otherScopes.every(scope => localStorage.getItem(scope))).toBe(true);
});

it("keeps a version conflict visible and does not close a new version automatically", async () => {
  mocked.mockRejectedValueOnce(new ApiError("El aviso cambió; actualiza la información.", 409));
  const saved = vi.fn().mockResolvedValue(undefined), scope = attentionIntentScope("operator-1", 2, 2, item.id);
  const view = render(<AgentAttentionEntry item={item} mayResolve resolutionScope={scope} onSaved={saved} />);
  fireEvent.click(screen.getByRole("button", { name: "Cerrar aviso" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("alert")).toHaveTextContent("El aviso cambió. Revísalo antes de volver a cerrarlo.");
  expect(localStorage.getItem(scope)).toBeNull();
  view.rerender(<AgentAttentionEntry item={{ ...item, version: 5 }} mayResolve resolutionScope={scope} onSaved={saved} />);
  expect(mocked).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "Cerrar aviso" })).toBeEnabled();
});

it("does not hide a newer attention version when an earlier close finishes", async () => {
  let finish!: (value: AgentAttention) => void;
  mocked.mockImplementation(() => new Promise(done => { finish = done; }));
  const saved = vi.fn().mockResolvedValue(undefined);
  const view = render(<AgentAttentionEntry item={item} mayResolve onSaved={saved} />);
  fireEvent.click(screen.getByRole("button", { name: "Cerrar aviso" }));
  view.rerender(<AgentAttentionEntry item={{ ...item, version: 6 }} mayResolve onSaved={saved} />);
  await act(async () => { finish({ ...item, status: "resolved", version: 5 }); });
  expect(screen.getByText("Pedido especial")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Cerrar aviso" })).toBeEnabled();
});

it("does not send a close when its durable intent cannot be stored", async () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => { throw new Error("storage unavailable"); });
  render(<AgentAttentionEntry item={item} mayResolve resolutionScope={attentionIntentScope("operator-1", 2, 2, item.id)} onSaved={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Cerrar aviso" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo preparar el cierre");
  expect(mocked).not.toHaveBeenCalled();
});

it("does not hide a notice for an unverified closure response", async () => {
  mocked.mockResolvedValue({ ...item, business_id: 3, status: "resolved", version: 5 });
  render(<AgentAttentionEntry item={item} mayResolve onSaved={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Cerrar aviso" }));
  await screen.findByRole("button", { name: "Reintentar cierre" });
  expect(screen.getByText("Pedido especial")).toBeInTheDocument();
});

it("drops an uncertain close when a refreshed resolved record is already authoritative", () => {
  const scope = attentionIntentScope("operator-1", 2, 2, item.id);
  localStorage.setItem(scope, JSON.stringify({ key: "uncertain", body: JSON.stringify({ expected_version: 4, status: "resolved", note: ATTENTION_CLOSE_NOTE }), close: true }));
  render(<AgentAttentionEntry item={{ ...item, status: "resolved", version: 5 }} mayResolve keepResolved resolutionScope={scope} onSaved={vi.fn()} />);
  expect(localStorage.getItem(scope)).toBeNull();
  expect(screen.queryByRole("button", { name: "Cerrar aviso" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Reintentar cierre" })).not.toBeInTheDocument();
  expect(mocked).not.toHaveBeenCalled();
});

it.each(["financial_review", "complaint", "notification_review"])("does not offer a dispatcher the close action for %s", async kind => {
  mocked.mockResolvedValue([{ ...item, kind }]);
  render(<AgentAttentionPanel />);
  await screen.findByText(item.summary);
  expect(screen.queryByRole("button", { name: "Cerrar aviso" })).not.toBeInTheDocument();
});

it("keeps permitted dispatcher delivery closure and a compact folio from an agent-created order", async () => {
  mocked.mockImplementation(async path => path.startsWith("/orders/") ? { id: 27, business_id: 2, branch_id: 2, source: "whatsapp_agent", folio: 103 } : [{ ...item, order_id: 27, kind: "location_after_dispatch" }]);
  render(<AgentAttentionPanel />);
  await screen.findByText("Cambio de ubicación");
  expect(screen.getByText(/Folio #103/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Cerrar aviso" })).toBeInTheDocument();
});

it("filters all manual-order agent notices without changing the original source after agent intervention", async () => {
  tenant.role = "owner";
  const records = [
    { ...item, id: "manual", order_id: 27, kind: "notification_review", summary: "Aviso manual antiguo" },
    { ...item, id: "payment", order_id: 27, kind: "financial_review", summary: "Comprobar pago" },
    { ...item, id: "agent", order_id: 28, kind: "notification_review", summary: "Aviso de pedido WhatsApp" },
    { ...item, id: "changed", order_id: 29, kind: "notification_review", summary: "Aviso de pedido modificado" },
  ];
  mocked.mockImplementation(async path => {
    if (path.startsWith("/agent-attention")) return records;
    const id = Number(path.split("/").pop());
    return { id, business_id: 2, branch_id: 2, folio: id, source: id === 28 ? "whatsapp_agent" : "pos", ...(id === 29 ? { recent_modification: { source: "agent" } } : {}) };
  });
  render(<AgentAttentionPanel />);
  await screen.findByText("Avisos pendientes (1)");
  expect(screen.queryByText("Aviso manual antiguo")).not.toBeInTheDocument();
  expect(screen.queryByText("Comprobar pago")).not.toBeInTheDocument();
  expect(screen.getByText("Aviso de pedido WhatsApp")).toBeInTheDocument();
  expect(screen.queryByText("Aviso de pedido modificado")).not.toBeInTheDocument();
  expect(mocked.mock.calls.filter(([path]) => path === "/orders/27")).toHaveLength(1);
  expect(mocked.mock.calls.every(([, options]) => !options?.method)).toBe(true);
});

it.each(["unavailable", "wrong-scope"])("does not publish an incomplete or unscoped classification: %s", async state => {
  mocked.mockImplementation(async path => {
    if (path.startsWith("/agent-attention")) return [{ ...item, order_id: 27, kind: "notification_review" }];
    if (state === "unavailable") throw new Error("read unavailable");
    return { id: 27, business_id: 2, branch_id: state === "wrong-scope" ? 3 : 2, source: "pos" };
  });
  render(<AgentAttentionPanel />);
  await screen.findByRole("alert");
  expect(screen.queryByText(item.summary)).not.toBeInTheDocument();
});

it("does not expose manual-order technical history as an agent review inside the order", async () => {
  mocked.mockImplementation(async path => path.startsWith("/orders/") ? { id: 27, business_id: 2, branch_id: 2, source: "pos" } : [{ ...item, order_id: 27, kind: "notification_review", status: "resolved" }]);
  render(<AgentAttentionPanel orderId={27} />);
  await waitFor(() => expect(mocked).toHaveBeenCalledTimes(2));
  expect(screen.queryByText(item.summary)).not.toBeInTheDocument();
  expect(screen.queryByText("Revisiones del pedido")).not.toBeInTheDocument();
});

it.each(["pos", "manual", "public_store", "integration", "unknown"])("hides every agent notice for non-agent source %s in both views", async source => {
  tenant.role = "owner";
  mocked.mockImplementation(async path => path.startsWith("/orders/")
    ? { id: 27, business_id: 2, branch_id: 2, source, recent_modification: { source: "agent" }, recent_agent_addition: { source: "agent" } }
    : [{ ...item, order_id: 27, kind: "financial_review" }]);
  const view = render(<AgentAttentionPanel />);
  await waitFor(() => expect(mocked).toHaveBeenCalledTimes(2));
  expect(screen.queryByText(item.summary)).not.toBeInTheDocument();
  view.rerender(<AgentAttentionPanel orderId={27} />);
  await waitFor(() => expect(mocked).toHaveBeenCalledTimes(3));
  expect(screen.queryByText(item.summary)).not.toBeInTheDocument();
  expect(mocked.mock.calls.every(([, options]) => !options?.method)).toBe(true);
});

it("identifies a linked notice by folio and provider contact before expanding either view", async () => {
  mocked.mockImplementation(async path => path.startsWith("/orders/")
    ? { id: 27, business_id: 2, branch_id: 2, source: "whatsapp_agent", folio: 305 }
    : [{ ...item, order_id: 27, kind: "fulfillment_change", sender: "7499818262692@lid", contact_display_name: "Ana", contact_phone: "51900000000" }]);
  const view = render(<AgentAttentionPanel />);
  await screen.findByText(/Folio #305/);
  expect(screen.getByText("WhatsApp: Ana · +51900000000")).toBeVisible();
  expect(document.body.textContent).not.toContain("@lid");
  view.rerender(<AgentAttentionPanel orderId={27} />);
  await screen.findByText("Revisiones del pedido");
  expect(screen.getByText(/Folio #305/)).toBeVisible();
  expect(screen.getByText("WhatsApp: Ana · +51900000000")).toBeVisible();
});

it("keeps the read-only contact projection when a resolution response has only legacy fields", async () => {
  tenant.role = "owner";
  const linked = { ...item, order_id: 27, sender: "7499818262692@lid", contact_display_name: "Ana", contact_phone: null };
  let reads = 0;
  mocked.mockImplementation(async (path, options) => {
    if (path.startsWith("/orders/")) return { id: 27, business_id: 2, branch_id: 2, source: "whatsapp_agent" };
    if (options?.method === "POST") return { ...item, order_id: 27, sender: linked.sender, version: 5, status: "resolved" };
    if (++reads > 1) throw new TypeError("refresh unavailable");
    return [linked];
  });
  render(<AgentAttentionPanel orderId={27} />);
  await screen.findByText("WhatsApp: Ana");
  fireEvent.click(screen.getByRole("button", { name: "Cerrar aviso" }));
  await screen.findByText("Resuelta");
  expect(screen.getByText("WhatsApp: Ana")).toBeVisible();
  expect(document.body.textContent).not.toContain("@lid");
});

it("hides only previous technical notices and keeps every important, unknown or undated review", async () => {
  tenant.role = "owner";
  const importantKinds = ["financial_review", "late_payment_receipt", "delivery_quote", "fulfillment_change", "location_after_dispatch", "product_change_request", "complaint", "catering", "human_requested", "future_review_kind"];
  const records = [
    { ...item, id: "old", kind: "notification_review", created_at: "2026-10-18T04:59:59Z", summary: "Técnico anterior" },
    { ...item, id: "today", kind: "notification_review", created_at: "2026-10-18T05:00:00Z", summary: "Técnico de hoy" },
    { ...item, id: "invalid", kind: "notification_review", created_at: "invalid", summary: "Fecha desconocida" },
    { ...item, id: "usage", kind: "notification_review", created_at: "2026-10-17T15:00:00Z", details: { source: "agent_model_usage" }, summary: "Conexión por revisar" },
    ...importantKinds.map(kind => ({ ...item, id: kind, kind, created_at: "2026-09-01T15:00:00Z", summary: `Importante ${kind}` })),
  ];
  mocked.mockResolvedValue(records);
  render(<AgentAttentionPanel />);
  const toggle = await screen.findByRole("button", { name: "Ver anteriores (1)" });
  expect(screen.queryByText("Técnico anterior")).not.toBeInTheDocument();
  expect(screen.getByText("Técnico de hoy")).toBeInTheDocument();
  expect(screen.getByText("Fecha desconocida")).toBeInTheDocument();
  expect(screen.getByText("Conexión por revisar")).toBeInTheDocument();
  for (const kind of importantKinds) expect(screen.getByText(`Importante ${kind}`)).toBeInTheDocument();
  fireEvent.click(toggle);
  expect(screen.getByText("Técnico anterior")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Ocultar anteriores" }));
  expect(screen.queryByText("Técnico anterior")).not.toBeInTheDocument();
  expect(mocked).toHaveBeenCalledOnce();
  expect(mocked.mock.calls[0][1]?.method).toBeUndefined();
});

it("keeps previous notices accessible when the daily view is empty and collapses them on the next Lima day", async () => {
  tenant.role = "owner";
  mocked.mockResolvedValue([{ ...item, kind: "notification_review", created_at: "2026-10-17T15:00:00Z" }]);
  const view = render(<AgentAttentionPanel />);
  fireEvent.click(await screen.findByRole("button", { name: "Ver anteriores (1)" }));
  expect(screen.getByText(item.summary)).toBeInTheDocument();
  tenant.day = "2026-10-19";
  view.rerender(<AgentAttentionPanel />);
  expect(screen.queryByText(item.summary)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Ver anteriores (1)" })).toHaveAttribute("aria-expanded", "false");
  expect(screen.getByText("Avisos pendientes (0)")).toBeInTheDocument();
  expect(screen.getByText("No hay avisos nuevos. Puedes consultar los anteriores.")).toBeInTheDocument();
  expect(mocked).toHaveBeenCalledOnce();
});

it("keeps the existing explicit close available for a previous technical notice", async () => {
  tenant.role = "owner";
  const old = { ...item, kind: "notification_review", created_at: "2026-10-17T15:00:00Z" };
  mocked.mockImplementation(async (path, options) => path.endsWith("/resolve") && options?.method === "POST"
    ? { ...old, status: "resolved", version: 5 } : [old]);
  render(<AgentAttentionPanel />);
  fireEvent.click(await screen.findByRole("button", { name: "Ver anteriores (1)" }));
  expect(mocked.mock.calls.every(([, options]) => !options?.method)).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Cerrar aviso" }));
  await waitFor(() => expect(screen.queryByText(item.summary)).not.toBeInTheDocument());
  const writes = mocked.mock.calls.filter(([, options]) => options?.method === "POST");
  expect(writes).toHaveLength(1);
  expect(JSON.parse(writes[0][1]!.body as string)).toEqual({ expected_version: 4, status: "resolved", note: ATTENTION_CLOSE_NOTE });
});
