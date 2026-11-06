import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AgentAttentionEntry, AgentAttentionPanel } from "./AgentAttentionPanel";
import { api, privateImage } from "../lib/api";
import { ApiError } from "../lib/api";
import { ATTENTION_CLOSE_NOTE, attentionIntentScope } from "../lib/agent-attention-intent";
import type { AgentAttention } from "../types";

const tenant = vi.hoisted(() => ({ role: "dispatcher", branch: 2 }));
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
beforeEach(() => { vi.clearAllMocks(); mocked.mockReset(); mockedImage.mockReset(); localStorage.clear(); tenant.role = "dispatcher"; tenant.branch = 2; });
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
  mocked.mockResolvedValue([{ ...item, order_id: 27, kind: "financial_review", status: "acknowledged", resolution_note: "Revisar exceso", resolved_by: "staff-1" }]);
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

it("keeps permitted dispatcher delivery closure and a compact folio from a verified order", async () => {
  mocked.mockImplementation(async path => path.startsWith("/orders/") ? { id: 27, business_id: 2, branch_id: 2, source: "pos", folio: 103 } : [{ ...item, order_id: 27, kind: "location_after_dispatch" }]);
  render(<AgentAttentionPanel />);
  await screen.findByText("Cambio de ubicación");
  expect(screen.getByText(/Folio #103/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Cerrar aviso" })).toBeInTheDocument();
});

it("filters only manual-order notification reviews, preserving important reviews and agent markers", async () => {
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
  await screen.findByText("Avisos pendientes (3)");
  expect(screen.queryByText("Aviso manual antiguo")).not.toBeInTheDocument();
  expect(screen.getByText("Comprobar pago")).toBeInTheDocument();
  expect(screen.getByText("Aviso de pedido WhatsApp")).toBeInTheDocument();
  expect(screen.getByText("Aviso de pedido modificado")).toBeInTheDocument();
  expect(mocked.mock.calls.filter(([path]) => path === "/orders/27")).toHaveLength(1);
  expect(mocked.mock.calls.every(([, options]) => !options?.method)).toBe(true);
});

it.each(["unavailable", "wrong-scope", "missing-source", "agent-addition"])("keeps notification review when the manual-only classification is unsafe: %s", async state => {
  mocked.mockImplementation(async path => {
    if (path.startsWith("/agent-attention")) return [{ ...item, order_id: 27, kind: "notification_review" }];
    if (state === "unavailable") throw new Error("read unavailable");
    return { id: 27, business_id: 2, branch_id: state === "wrong-scope" ? 3 : 2, ...(state === "missing-source" ? {} : { source: "pos" }), ...(state === "agent-addition" ? { recent_agent_addition: { source: "agent" } } : {}) };
  });
  render(<AgentAttentionPanel />);
  await screen.findByText("Avisos pendientes (1)");
  expect(screen.getByText(item.summary)).toBeInTheDocument();
});

it("retains all per-order history even for a manual-order technical notification", async () => {
  mocked.mockImplementation(async path => path.startsWith("/orders/") ? { id: 27, business_id: 2, branch_id: 2, source: "pos" } : [{ ...item, order_id: 27, kind: "notification_review", status: "resolved" }]);
  render(<AgentAttentionPanel orderId={27} />);
  await screen.findByText(item.summary);
  expect(screen.getByText("Revisiones del pedido")).toBeInTheDocument();
});
