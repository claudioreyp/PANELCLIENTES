import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BranchMediaCard, type BranchMediaCardProps } from "./BranchMediaCard";
import { SettingsStateProvider } from "./SettingsState";

const drawImage = vi.fn();
let canvases: HTMLCanvasElement[];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function props(overrides: Partial<BranchMediaCardProps> = {}): BranchMediaCardProps {
  return { title: "Logotipo de la tienda", kind: "logo", currentUrl: null, disabled: false, onUpload: vi.fn().mockResolvedValue(true), onRemove: vi.fn().mockResolvedValue(true), ...overrides };
}

function selectImage(file = new File(["image"], "logo.png", { type: "image/png" })) {
  fireEvent.change(screen.getByLabelText(/Elegir imagen:/), { target: { files: [file] } });
}

function decodeImage(width = 1200, height = 800) {
  const image = screen.getByAltText("Vista para recortar");
  Object.defineProperties(image, { naturalWidth: { value: width, configurable: true }, naturalHeight: { value: height, configurable: true } });
  fireEvent.load(image);
}

function save() { fireEvent.click(screen.getByRole("button", { name: "Guardar" })); }

describe("BranchMediaCard", () => {
  beforeEach(() => {
    canvases = [];
    drawImage.mockClear();
    let nextUrl = 0;
    vi.stubGlobal("URL", class extends URL {
      static createObjectURL = vi.fn(() => `blob:media-${++nextUrl}`);
      static revokeObjectURL = vi.fn();
    });
    vi.stubGlobal("ResizeObserver", class {
      constructor(private callback: ResizeObserverCallback) {}
      observe() { this.callback([{ contentRect: { width: 480 } } as ResizeObserverEntry], this as unknown as ResizeObserver); }
      disconnect() {}
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (this: HTMLCanvasElement, callback) {
      canvases.push(this);
      callback(new Blob(["cropped"], { type: "image/webp" }));
    });
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it.each(["logo", "cover"] as const)("exports a %s only after decoding and saving, with the correct ratio", async (kind) => {
    const options = props({ kind });
    const registration = vi.fn();
    render(<SettingsStateProvider onRegistration={registration}><BranchMediaCard {...options} /></SettingsStateProvider>);
    selectImage();
    expect(screen.getByRole("dialog", { name: "Recortar imagen" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();
    expect(options.onUpload).not.toHaveBeenCalled();
    expect(registration).toHaveBeenLastCalledWith({ dirty: true, saving: false, save: null });
    decodeImage();
    save();
    await waitFor(() => expect(options.onUpload).toHaveBeenCalledTimes(1));
    const uploaded = vi.mocked(options.onUpload).mock.calls[0][0];
    expect(uploaded).toBeInstanceOf(File);
    expect(uploaded.type).toBe("image/webp");
    expect(uploaded.name).toBe(`${kind}.webp`);
    expect(options.onUpload).toHaveBeenCalledWith(uploaded, kind);
    expect(canvases[0].width).toBe(1024);
    expect(canvases[0].height).toBe(kind === "logo" ? 1024 : 576);
    const [, x, y, width, height] = drawImage.mock.calls[0];
    expect(width / height).toBeCloseTo(kind === "logo" ? 1 : 16 / 9);
    expect(x).toBeGreaterThanOrEqual(0);
    expect(y).toBeGreaterThanOrEqual(0);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Cargar imagen" })).toHaveFocus();
    expect(registration).toHaveBeenLastCalledWith({ dirty: false, saving: false, save: null });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:media-1");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:media-2");
  });

  it("retains the exact crop and dirty guard on false, then permits retry", async () => {
    const onUpload = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const registration = vi.fn();
    render(<SettingsStateProvider onRegistration={registration}><BranchMediaCard {...props({ onUpload })} /></SettingsStateProvider>);
    selectImage(); decodeImage();
    fireEvent.change(screen.getByRole("slider"), { target: { value: "2" } });
    fireEvent.keyDown(screen.getByRole("group", { name: "Encuadre de imagen" }), { key: "ArrowRight" });
    const transform = screen.getByAltText("Vista para recortar").style.transform;
    save();
    expect(await screen.findByRole("alert")).toHaveTextContent("Conservamos tu recorte");
    expect(screen.getByRole("slider")).toHaveValue("2");
    expect(screen.getByAltText("Vista para recortar").style.transform).toBe(transform);
    expect(registration).toHaveBeenLastCalledWith({ dirty: true, saving: false, save: null });
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith("blob:media-1");
    save();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onUpload).toHaveBeenCalledTimes(2);
    expect(drawImage.mock.calls[0].slice(1)).toEqual(drawImage.mock.calls[1].slice(1));
  });

  it("handles a rejecting callback without losing the draft", async () => {
    render(<BranchMediaCard {...props({ onUpload: vi.fn().mockRejectedValue(new Error("offline")) })} />);
    selectImage(); decodeImage(); save();
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo guardar");
    expect(screen.getByRole("button", { name: "Guardar" })).toBeEnabled();
  });

  it.each([false, true])("blocks duplicate export/upload while the parent sets mediaBusy and resolves %s", async (saved) => {
    const request = deferred<boolean>();
    const onUpload = vi.fn<BranchMediaCardProps["onUpload"]>(() => request.promise);
    function Parent() {
      const [busy, setBusy] = useState(false);
      return <BranchMediaCard {...props()} disabled={busy} onUpload={async (file, kind) => {
        setBusy(true);
        try { return await onUpload(file, kind); } finally { setBusy(false); }
      }} />;
    }
    render(<Parent />);
    selectImage(); decodeImage();
    const saveButton = screen.getByRole("button", { name: "Guardar" });
    fireEvent.click(saveButton); fireEvent.click(saveButton);
    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(1));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Recortar imagen" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Guardando..." })).toBeDisabled();
    await act(async () => { request.resolve(saved); });
    if (saved) {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Cargar imagen" })).toHaveFocus();
    } else {
      expect(await screen.findByRole("alert")).toHaveTextContent("Conservamos tu recorte");
      expect(screen.getByRole("button", { name: "Guardar" })).toBeEnabled();
    }
    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledTimes(1);
  });

  it("contains focus, Escape closes only the top confirmation, and discard restores the uploader", async () => {
    const registration = vi.fn();
    render(<StrictMode><SettingsStateProvider onRegistration={registration}><BranchMediaCard {...props()} /></SettingsStateProvider></StrictMode>);
    selectImage(); decodeImage();
    const close = screen.getByRole("button", { name: "Cerrar editor de imagen" });
    await waitFor(() => expect(close).toHaveFocus());
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(screen.getByRole("button", { name: "Guardar" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: "Escape" });
    expect(screen.getByRole("alertdialog", { name: "Descartar recorte" })).toBeVisible();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(registration).toHaveBeenLastCalledWith({ dirty: true, saving: false, save: null });
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Descartar recorte" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cargar imagen" })).toHaveFocus();
    expect(document.body.style.overflow).toBe("");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:media-2");
  });

  it.each([
    new File(["gif"], "wrong.gif", { type: "image/gif" }),
    new File([], "empty.png", { type: "image/png" }),
    new File([new Uint8Array(8 * 1024 * 1024 + 1)], "large.png", { type: "image/png" }),
  ])("rejects invalid selection $name without opening or uploading", (file) => {
    const options = props(); render(<BranchMediaCard {...options} />);
    selectImage(file);
    expect(screen.getByRole("alert")).toBeVisible();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(options.onUpload).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Elegir imagen:/)).toHaveValue("");
  });

  it("accepts the API's full 8 MB limit", () => {
    render(<BranchMediaCard {...props()} />);
    selectImage(new File([new Uint8Array(8 * 1024 * 1024)], "large.webp", { type: "image/webp" }));
    expect(screen.getByRole("dialog")).toBeVisible();
  });

  it("uses disabled only for launch controls, not to hide an existing draft", () => {
    const options = props({ disabled: true });
    const { rerender } = render(<BranchMediaCard {...options} />);
    expect(screen.getByRole("button", { name: "Cargar imagen" })).toBeDisabled();
    selectImage();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    rerender(<BranchMediaCard {...options} disabled={false} />);
    selectImage(); decodeImage();
    rerender(<BranchMediaCard {...options} disabled />);
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(screen.getByRole("button", { name: "Guardar" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Descartar recorte" })).toBeEnabled();
  });

  it("restores the uploader after a successful upload when the parent unlocks it later", async () => {
    const request = deferred<boolean>();
    const options = props({ onUpload: vi.fn(() => request.promise) });
    const { rerender } = render(<BranchMediaCard {...options} />);
    selectImage(); decodeImage(); save();
    await waitFor(() => expect(options.onUpload).toHaveBeenCalled());
    rerender(<BranchMediaCard {...options} disabled />);
    await act(async () => { request.resolve(true); });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cargar imagen" })).toBeDisabled();
    rerender(<BranchMediaCard {...options} disabled={false} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Cargar imagen" })).toHaveFocus());
  });

  it("keeps the dirty registration but releases the saving guard while context is inactive", async () => {
    const request = deferred<boolean>();
    const registration = vi.fn();
    const options = props({ onUpload: vi.fn(() => request.promise) });
    const surface = (enabled: boolean) => <SettingsStateProvider onRegistration={registration}><BranchMediaCard {...options} enabled={enabled} /></SettingsStateProvider>;
    const { rerender } = render(surface(true));
    selectImage(); decodeImage(); save();
    expect(registration).toHaveBeenLastCalledWith({ dirty: true, saving: true, save: null });
    await waitFor(() => expect(options.onUpload).toHaveBeenCalled());
    rerender(surface(false));
    expect(registration).toHaveBeenLastCalledWith({ dirty: true, saving: false, save: null });
    await act(async () => { request.resolve(true); });
    rerender(surface(true));
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(registration).toHaveBeenLastCalledWith({ dirty: true, saving: false, save: null });
  });

  it("retries decoding and canvas export inside the same dialog", async () => {
    const options = props(); render(<BranchMediaCard {...options} />);
    selectImage();
    fireEvent.error(screen.getByAltText("Vista para recortar"));
    expect(screen.getByRole("alert")).toHaveTextContent("No se pudo leer");
    fireEvent.click(screen.getByRole("button", { name: "Reintentar carga" }));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:media-1");
    decodeImage();
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementationOnce((callback) => callback(null));
    save();
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo preparar");
    expect(options.onUpload).not.toHaveBeenCalled();
    save();
    await waitFor(() => expect(options.onUpload).toHaveBeenCalledTimes(1));
  });

  it("invalidates pending export across disabled context lifetimes while preserving the crop", async () => {
    const options = props();
    const { rerender } = render(<BranchMediaCard {...options} />);
    selectImage(); decodeImage();
    fireEvent.change(screen.getByRole("slider"), { target: { value: "1.8" } });
    let finish!: BlobCallback;
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementationOnce((callback) => { finish = callback; });
    save();
    rerender(<BranchMediaCard {...options} enabled={false} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    rerender(<BranchMediaCard {...options} enabled />);
    await act(async () => { finish(new Blob(["crop"], { type: "image/webp" })); });
    expect(options.onUpload).not.toHaveBeenCalled();
    expect(screen.getByRole("slider")).toHaveValue("1.8");
    save();
    await waitFor(() => expect(options.onUpload).toHaveBeenCalledTimes(1));
  });

  it("ignores upload results from an old context and never switches a draft's callback", async () => {
    const request = deferred<boolean>();
    const firstUpload = vi.fn(() => request.promise);
    const nextUpload = vi.fn().mockResolvedValue(true);
    const options = props({ onUpload: firstUpload });
    const { rerender } = render(<BranchMediaCard {...options} />);
    selectImage(); decodeImage(); save();
    await waitFor(() => expect(firstUpload).toHaveBeenCalledTimes(1));
    rerender(<BranchMediaCard {...options} enabled={false} onUpload={nextUpload} />);
    rerender(<BranchMediaCard {...options} enabled onUpload={nextUpload} />);
    await act(async () => { request.resolve(true); });
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(nextUpload).not.toHaveBeenCalled();
    save();
    await waitFor(() => expect(firstUpload).toHaveBeenCalledTimes(2));
    expect(nextUpload).not.toHaveBeenCalled();
  });

  it("revokes source and export URLs immediately on unmount during upload", async () => {
    const request = deferred<boolean>();
    const options = props({ onUpload: vi.fn(() => request.promise) });
    const { unmount } = render(<BranchMediaCard {...options} />);
    selectImage(); decodeImage(); save();
    await waitFor(() => expect(options.onUpload).toHaveBeenCalled());
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:media-1");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:media-2");
    await act(async () => { request.resolve(true); });
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it("does not upload if unmounted during export", async () => {
    const options = props();
    let finish!: BlobCallback;
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementationOnce((callback) => { finish = callback; });
    const { unmount } = render(<BranchMediaCard {...options} />);
    selectImage(); decodeImage(); save(); unmount();
    await act(async () => { finish(new Blob(["crop"], { type: "image/webp" })); });
    expect(options.onUpload).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:media-1");
  });

  it("confirms removal, prevents double requests and retains the current image on failure", async () => {
    const request = deferred<boolean>();
    const options = props({ currentUrl: "/logo.png", onRemove: vi.fn(() => request.promise) });
    render(<BranchMediaCard {...options} />);
    fireEvent.click(screen.getByRole("button", { name: "Quitar imagen" }));
    const remove = within(screen.getByRole("alertdialog")).getByRole("button", { name: "Quitar imagen" });
    fireEvent.click(remove); fireEvent.click(remove);
    expect(options.onRemove).toHaveBeenCalledTimes(1);
    await act(async () => { request.resolve(false); });
    expect(screen.getByRole("alert")).toHaveTextContent("No se pudo quitar");
    expect(screen.getByAltText("Logotipo de la tienda")).toBeVisible();
    expect(screen.getByRole("button", { name: "Quitar imagen" })).toBeEnabled();
  });
});
