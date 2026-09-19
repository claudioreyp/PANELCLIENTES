import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BranchSettings } from "./GeneralAndBranchSettings";

const apiMock = vi.hoisted(() => vi.fn());
const refreshMock = vi.hoisted(() => vi.fn());
vi.mock("../../lib/api", async (importOriginal) => ({ ...await importOriginal<typeof import("../../lib/api")>(), api: apiMock }));
vi.mock("../../lib/tenant", () => ({ useTenant: () => ({ branch: { id: 7, name: "Principal", active: true }, refresh: refreshMock }) }));
vi.mock("../ImageCropper", () => ({ ImageCropper: ({ onSave, error }: { onSave: (blob: Blob, url: string) => Promise<void>; error: string | null }) => <div role="dialog" aria-label="Recortar imagen"><button onClick={() => void onSave(new Blob(["crop"], { type: "image/png" }), "blob:crop")}>Guardar recorte</button>{error && <p>{error}</p>}</div> }));

const profile = { id: 7, name: "Principal", address: "", maps_url: "", logo_url: null, cover_url: null, active: true, version: 4 };

describe("branch settings partial writes", () => {
  beforeEach(() => {
    apiMock.mockReset();
    refreshMock.mockReset();
    vi.stubGlobal("crypto", webcrypto);
    vi.stubGlobal("URL", class extends URL { static revokeObjectURL = vi.fn(); });
    apiMock.mockImplementation((_path: string, options?: RequestInit) => Promise.resolve(options?.method === "PATCH" ? { ...profile, ...JSON.parse(String(options.body)), version: 6 } : profile));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  async function uploadLogo() {
    const card = screen.getByText("Logotipo de la tienda").closest(".settings-media-card")!;
    fireEvent.change(card.querySelector('input[type="file"]')!, { target: { files: [new File(["image"], "logo.png", { type: "image/png" })] } });
    expect(apiMock.mock.calls.some(([, options]) => options?.method === "POST")).toBe(false);
    fireEvent.click(await screen.findByRole("button", { name: "Guardar recorte" }));
  }

  it("preserves unsaved profile fields when a logo upload succeeds and uses its confirmed version", async () => {
    render(<BranchSettings />);
    fireEvent.change(await screen.findByLabelText(/Alias de sucursal/), { target: { value: "Principal editada" } });
    apiMock.mockResolvedValueOnce({ ...profile, logo_url: "/logo.png", version: 5 });
    await uploadLogo();
    expect(await screen.findByText("El logotipo se actualizó correctamente.")).toBeVisible();
    expect(screen.getByDisplayValue("Principal editada")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText("Los datos de la sucursal se actualizaron.")).toBeVisible();
    const request = apiMock.mock.calls.find(([, options]) => options?.method === "PATCH")![1];
    expect(JSON.parse(request.body)).toMatchObject({ name: "Principal editada", logo_url: "/logo.png", expected_version: 5 });
  });

  it("does not mark a confirmed media upload as an unsaved draft", async () => {
    render(<BranchSettings />);
    await screen.findByLabelText(/Alias de sucursal/);
    apiMock.mockResolvedValueOnce({ ...profile, logo_url: "/logo.png", version: 5 });
    await uploadLogo();
    await screen.findByText("El logotipo se actualizó correctamente.");
    expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled();
  });

  it("reports media upload failures as errors, not success feedback", async () => {
    render(<BranchSettings />);
    fireEvent.change(await screen.findByLabelText(/Alias de sucursal/), { target: { value: "Borrador" } });
    apiMock.mockRejectedValueOnce(new Error("No se pudo cargar la imagen."));
    await uploadLogo();
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo cargar la imagen.");
    expect(screen.getByDisplayValue("Borrador")).toBeVisible();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("recovers a committed upload with the original key and crop after its response is lost", async () => {
    const confirmed = new Map<string, object>();
    let commits = 0;
    apiMock.mockImplementation((_path, options) => {
      if (options?.method !== "POST") return Promise.resolve(profile);
      if (confirmed.has(options.idempotencyKey)) return Promise.resolve(confirmed.get(options.idempotencyKey));
      commits++;
      confirmed.set(options.idempotencyKey, { ...profile, logo_url: "/confirmed.png", version: 5 });
      return Promise.reject(new Error("Respuesta perdida"));
    });
    render(<BranchSettings />);
    await screen.findByLabelText(/Alias de sucursal/);
    await uploadLogo();
    await screen.findByText(/Conservamos tu recorte/);
    expect(screen.queryByAltText("Logotipo de la tienda")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Guardar recorte" }));
    await screen.findByText("El logotipo se actualizó correctamente.");
    const writes = apiMock.mock.calls.filter(([, options]) => options?.method === "POST");
    expect(writes).toHaveLength(2);
    expect(writes[0][1].idempotencyKey).toBe(writes[1][1].idempotencyKey);
    expect(writes[1][1].body.get("file")).toBe(writes[0][1].body.get("file"));
    expect(writes[1][1].body.get("expected_version")).toBe("4");
    expect(commits).toBe(1);
    expect(screen.getByAltText("Logotipo de la tienda")).toHaveAttribute("src", expect.stringContaining("confirmed.png"));
  });

  it("keeps the old image until DELETE is confirmed and retries a lost response with the same key", async () => {
    let key: string | undefined;
    let commits = 0;
    apiMock.mockImplementation((_path, options) => {
      if (options?.method !== "DELETE") return Promise.resolve({ ...profile, logo_url: "/old.png" });
      if (options.idempotencyKey === key) return Promise.resolve({ ...profile, version: 5 });
      key = options.idempotencyKey;
      commits++;
      return Promise.reject(new Error("Respuesta perdida"));
    });
    render(<BranchSettings />);
    await screen.findByAltText("Logotipo de la tienda");
    const remove = async () => {
      fireEvent.click(screen.getByRole("button", { name: "Quitar imagen" }));
      fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Quitar imagen" }));
      await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    };
    await remove();
    expect(screen.getByAltText("Logotipo de la tienda")).toHaveAttribute("src", expect.stringContaining("old.png"));
    await remove();
    await screen.findByText("La imagen se eliminó correctamente.");
    expect(screen.queryByAltText("Logotipo de la tienda")).not.toBeInTheDocument();
    const writes = apiMock.mock.calls.filter(([, options]) => options?.method === "DELETE");
    expect(writes).toHaveLength(2);
    expect(writes[0][1].idempotencyKey).toBe(writes[1][1].idempotencyKey);
    expect(writes[1][1].body).toBe(writes[0][1].body);
    expect(commits).toBe(1);
  });

  it("does not relabel a successful archive as failed when tenant refresh fails", async () => {
    render(<BranchSettings />);
    await screen.findByLabelText(/Alias de sucursal/);
    refreshMock.mockRejectedValueOnce(new Error("Refresh failed"));
    fireEvent.click(screen.getByRole("button", { name: "Archivar sucursal" }));
    const dialog = screen.getByRole("alertdialog");
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Principal" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Archivar sucursal" }));
    expect(await screen.findByText("La sucursal se archivó. Su historial se conserva.")).toBeVisible();
    await waitFor(() => expect(screen.getByText(/no se pudo actualizar la vista/)).toBeVisible());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
