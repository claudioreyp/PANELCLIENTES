import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../lib/api";
import { AgentSettings } from "./AgentSettings";
import { DeviceSettings } from "./DeviceSettings";
import { SettingsStateProvider } from "./SettingsState";

const mock = vi.hoisted(() => ({ api: vi.fn(), branch: { id: 7 }, qr: vi.fn() }));
vi.mock("../../lib/api", async (original) => ({ ...await original<typeof import("../../lib/api")>(), api: mock.api, privateImage: vi.fn(async () => new Blob(["image"])) }));
vi.mock("../../lib/tenant", () => ({ useTenant: () => ({ branch: mock.branch }) }));
vi.mock("qrcode", () => ({ default: { toDataURL: mock.qr } }));

const profile = { branch_id: 7, version: 3, name: "Ana", images: [{ id: "a", url: "/a" }, { id: "b", url: "/b" }], yape_qr_url: "/qr", yape_number: "999888777", payment_recipient_name: "Titular anterior" };
const link = { device: { id: 9, version: 1, paired: false, active: true }, url: "http://localhost/activar-dispositivo#token=isolated-link", expires_at: new Date(Date.now() + 600000).toISOString() };
const changes = vi.fn();
const registration = vi.fn();
function Devices({ enabled = true }: { enabled?: boolean }) { return <SettingsStateProvider enabled={enabled} onRegistration={registration}><DeviceSettings branchId={7} devices={[]} canManage onChange={changes} /></SettingsStateProvider>; }

beforeEach(() => {
  mock.api.mockReset(); mock.qr.mockResolvedValue("data:image/png;base64,QR"); changes.mockClear();
  mock.branch.id = 7;
  vi.stubGlobal("URL", class extends URL { static createObjectURL = vi.fn(() => "blob:isolated-image"); static revokeObjectURL = vi.fn(); });
  mock.api.mockImplementation(async (_path, options) => options?.method ? { ...profile, version: 4 } : profile);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("agent profile", () => {
  it("cancels payment drafts without saving or changing the name", async () => {
    render(<AgentSettings />);
    const number = await screen.findByLabelText("Número de Yape");
    await waitFor(() => expect(number).toHaveValue("999888777"));
    fireEvent.change(number, { target: { value: "111222333" } });
    fireEvent.change(screen.getByLabelText("Nombre (opcional)"), { target: { value: "Luna" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar datos de Yape" }));
    expect(number).toHaveValue("999888777");
    expect(screen.getByLabelText("Nombre (opcional)")).toHaveValue("Luna");
    expect(mock.api).toHaveBeenCalledTimes(1);
  });
  it("retains payment drafts across an image save and uses the new version", async () => {
    render(<AgentSettings />); await screen.findByDisplayValue("Ana");
    fireEvent.change(screen.getByLabelText("Número de Yape"), { target: { value: " 111222333 " } });
    fireEvent.change(screen.getByLabelText("Nombre del titular"), { target: { value: " Titular nuevo " } });
    fireEvent.click(screen.getByRole("button", { name: "Reemplazar QR" }));
    fireEvent.change(screen.getByLabelText("Archivo del agente"), { target: { files: [new File(["qr"], "qr.png", { type: "image/png" })] } });
    fireEvent.click(within(screen.getByRole("dialog", { name: "QR de Yape" })).getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByLabelText("Nombre del titular")).toHaveValue(" Titular nuevo ");
    fireEvent.click(screen.getByRole("button", { name: "Guardar datos de Yape" }));
    await waitFor(() => expect(mock.api.mock.calls.at(-1)![1].method).toBe("PATCH"));
    expect(JSON.parse(mock.api.mock.calls.at(-1)![1].body)).toEqual({ expected_version: 4, yape_number: "111222333", payment_recipient_name: "Titular nuevo" });
  });
  it("retries the identical payment attempt and prevents double submissions", async () => {
    render(<AgentSettings />); await screen.findByDisplayValue("Ana");
    fireEvent.change(screen.getByLabelText("Nombre del titular"), { target: { value: "Nuevo titular" } });
    let reject!: (error: Error) => void;
    mock.api.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    const save = screen.getByRole("button", { name: "Guardar datos de Yape" });
    fireEvent.click(save); fireEvent.click(save);
    expect(mock.api).toHaveBeenCalledTimes(2);
    const attempt = mock.api.mock.calls.at(-1);
    await act(async () => reject(new Error("Respuesta perdida")));
    expect(screen.getByLabelText("Nombre del titular")).toHaveValue("Nuevo titular");
    fireEvent.click(screen.getByRole("button", { name: "Reintentar guardado" }));
    await screen.findByText("Los cambios se guardaron correctamente.");
    expect(mock.api.mock.calls.at(-1)).toEqual(attempt);
  });
  it("registers a combined save for navigation and never carries drafts to another branch", async () => {
    const view = render(<SettingsStateProvider onRegistration={registration}><AgentSettings /></SettingsStateProvider>);
    await screen.findByDisplayValue("Ana");
    fireEvent.change(screen.getByLabelText("Nombre (opcional)"), { target: { value: "Sol" } });
    fireEvent.change(screen.getByLabelText("Nombre del titular"), { target: { value: "Titular nuevo" } });
    const registered = registration.mock.calls.at(-1)![0];
    expect(registered.dirty).toBe(true);
    await act(async () => registered.save());
    expect(JSON.parse(mock.api.mock.calls.at(-1)![1].body)).toMatchObject({ name: "Sol", payment_recipient_name: "Titular nuevo" });
    fireEvent.change(screen.getByLabelText("Nombre del titular"), { target: { value: "No debe viajar" } });
    mock.branch.id = 8;
    view.rerender(<SettingsStateProvider onRegistration={registration}><AgentSettings /></SettingsStateProvider>);
    await screen.findByDisplayValue("Ana");
    expect(screen.queryByDisplayValue("No debe viajar")).not.toBeInTheDocument();
  });
  it("registers its save callback without a parent update loop", async () => {
    function Workspace() {
      const [, register] = useState<unknown>(null);
      return <SettingsStateProvider onRegistration={register}><AgentSettings /></SettingsStateProvider>;
    }
    render(<Workspace />);
    expect(await screen.findByDisplayValue("Ana")).toBeVisible();
    expect(mock.api).toHaveBeenCalledTimes(1);
  });
  it("preserves name on failure and replays the exact attempt before accepting confirmed data", async () => {
    render(<AgentSettings />);
    const name = await screen.findByDisplayValue("Ana");
    fireEvent.change(name, { target: { value: "Luna" } });
    mock.api.mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await screen.findByText("offline");
    const attempt = mock.api.mock.calls.at(-1);
    expect(name).toHaveValue("Luna");
    fireEvent.click(screen.getByRole("button", { name: "Reintentar guardado" }));
    await screen.findByText("Los cambios se guardaron correctamente.");
    expect(mock.api.mock.calls.at(-1)).toEqual(attempt);
  });
  it("reorders IDs, confirms deletion, and keeps prior assets when cancelling a QR upload", async () => {
    render(<AgentSettings />); await screen.findByDisplayValue("Ana");
    fireEvent.click(screen.getByRole("button", { name: "Subir imagen 2" }));
    await screen.findByText("Los cambios se guardaron correctamente.");
    expect(JSON.parse(mock.api.mock.calls.at(-1)![1].body)).toMatchObject({ image_order: ["b", "a"], expected_version: 3 });
    fireEvent.click(screen.getByRole("button", { name: "Eliminar imagen 1" }));
    const dialog = screen.getByRole("alertdialog", { name: "Eliminar imagen" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Seguir editando" }));
    expect(mock.api.mock.calls.filter(([, options]) => options?.method === "DELETE")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Reemplazar QR" }));
    fireEvent.change(screen.getByLabelText("Archivo del agente"), { target: { files: [new File(["qr"], "qr.png", { type: "image/png" })] } });
    expect(screen.getByText(/imagen completa, sin recortar/)).toBeVisible();
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("dialog", { name: "QR de Yape" })).getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByAltText("QR de Yape guardado")).toBeVisible();
  });
  it("allows correction after a definitive rejection and ignores a late response from another branch", async () => {
    const view = render(<AgentSettings />); const name = await screen.findByDisplayValue("Ana");
    fireEvent.change(name, { target: { value: "Sol" } });
    mock.api.mockRejectedValueOnce(new ApiError("No permitido", 422));
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await screen.findByText("No permitido"); expect(name).toBeEnabled();
    let resolve!: (value: unknown) => void;
    mock.api.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    mock.branch.id = 8; view.rerender(<AgentSettings />);
    await act(async () => resolve({ ...profile, name: "WRONG BRANCH" }));
    expect(screen.queryByDisplayValue("WRONG BRANCH")).not.toBeInTheDocument();
  });
});

describe("device pairing", () => {
  it("generates QR locally on click, cancels on Escape and restores focus", async () => {
    mock.api.mockImplementation(async (_path, options) => options?.method === "POST" ? link : link.device);
    render(<Devices />); expect(mock.api).not.toHaveBeenCalled();
    const button = screen.getByRole("button", { name: "Vincular dispositivo" }); button.focus(); fireEvent.click(button);
    await screen.findByAltText("Código QR para vincular dispositivo");
    expect(screen.getByRole("status")).not.toHaveTextContent("11 min");
    expect(mock.qr).toHaveBeenCalledWith(link.url, expect.objectContaining({ margin: 4 }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mock.api.mock.calls.some(([, options]) => options?.method === "DELETE")).toBe(true);
    await waitFor(() => expect(button).toHaveFocus());
  });
  it("does not apply a pairing response after the active branch is disabled", async () => {
    let resolve!: (value: unknown) => void;
    mock.api.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const view = render(<Devices />); fireEvent.click(screen.getByRole("button", { name: "Vincular dispositivo" }));
    view.rerender(<Devices enabled={false} />);
    await act(async () => resolve(link));
    expect(screen.queryByAltText("Código QR para vincular dispositivo")).not.toBeInTheDocument();
    expect(changes).not.toHaveBeenCalled();
  });
  it("shows expired links without a usable QR", async () => {
    mock.api.mockResolvedValue({ ...link, expires_at: new Date(Date.now() - 1000).toISOString() });
    render(<Devices />); fireEvent.click(screen.getByRole("button", { name: "Vincular dispositivo" }));
    await screen.findByText(/El enlace venció/);
    expect(screen.queryByLabelText("Enlace de vinculación")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generar otro enlace" })).toBeEnabled();
  });
});
