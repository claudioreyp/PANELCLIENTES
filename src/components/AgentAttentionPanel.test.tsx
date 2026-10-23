import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AgentAttentionEntry, AgentAttentionPanel } from "./AgentAttentionPanel";
import { api, privateImage } from "../lib/api";
import type { AgentAttention } from "../types";

const tenant = vi.hoisted(() => ({ role: "dispatcher", branch: 2 }));
vi.mock("../lib/tenant", () => ({ useTenant: () => ({ branch: { id: tenant.branch }, context: { role: tenant.role, business: { id: 2 } } }) }));
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
beforeEach(() => { vi.clearAllMocks(); mocked.mockReset(); mockedImage.mockReset(); tenant.role = "dispatcher"; tenant.branch = 2; });
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
  fireEvent.click(screen.getByText(item.summary));
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
  fireEvent.click(screen.getByText(item.summary));
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
  fireEvent.click(screen.getByText(item.summary));
  expect(screen.queryByRole("button", { name: /comprobante/ })).not.toBeInTheDocument();
  cleanup();
  render(<AgentAttentionEntry item={{ ...lateReceipt, details: { attachments: [{ media_ref: "../../other" }, { media_ref: "https://invalid.example" }, null] } }} mayResolve onSaved={vi.fn()} />);
  fireEvent.click(screen.getByText(item.summary));
  expect(screen.queryByRole("button", { name: /comprobante/ })).not.toBeInTheDocument();
  expect(mockedImage).not.toHaveBeenCalled();
});

it("rejects a non-image response and does not retain a late result after switching attention", async () => {
  const urls = blobUrls();
  mockedImage.mockResolvedValueOnce(new Blob(["synthetic"], { type: "text/html" }));
  const view = render(<AgentAttentionEntry item={lateReceipt} mayResolve onSaved={vi.fn()} />);
  fireEvent.click(screen.getByText(item.summary));
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
  fireEvent.click(screen.getByText(item.summary));
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
  fireEvent.click(await screen.findByText(item.summary));
  expect(screen.getByText("Revisar exceso", { exact: false })).toBeInTheDocument();
  expect(screen.getByText(/staff-1/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Resolver incidencia" })).not.toBeInTheDocument();
  expect(mocked.mock.calls[0][0]).toBe("/agent-attention?branch_id=2&status=all&order_id=27");
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
  fireEvent.click(await screen.findByText(item.summary));
  expect(screen.queryByRole("button", { name: "Resolver incidencia" })).not.toBeInTheDocument();
});
