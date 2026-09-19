import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImageCropper } from "./ImageCropper";

const drawImage = vi.fn();
const file = new File(["source"], "image.png", { type: "image/png" });
let resize: ResizeObserverCallback;

function decode(width = 1200, height = 800) {
  const image = screen.getByAltText("Vista para recortar");
  Object.defineProperties(image, { naturalWidth: { value: width }, naturalHeight: { value: height } });
  fireEvent.load(image);
  return image;
}

describe("shared ImageCropper contract", () => {
  beforeEach(() => {
    let next = 0;
    vi.stubGlobal("URL", class extends URL {
      static createObjectURL = vi.fn(() => `blob:crop-${++next}`);
      static revokeObjectURL = vi.fn();
    });
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: ResizeObserverCallback) { resize = callback; }
      observe() {}
      disconnect() {}
    });
    vi.stubGlobal("PointerEvent", MouseEvent);
    drawImage.mockReset();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(new Blob(["crop"], { type: "image/webp" })));
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("keeps catalog defaults and transfers the successful preview URL to the caller", async () => {
    const onSave = vi.fn();
    const consoleError = vi.spyOn(console, "error");
    const { unmount } = render(<ImageCropper file={file} onCancel={vi.fn()} onSave={onSave} />);
    expect(screen.getByRole("dialog", { name: "Ajusta el encuadre" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Usar imagen" })).toBeDisabled();
    decode();
    fireEvent.click(screen.getByRole("button", { name: "Usar imagen" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.any(Blob), "blob:crop-2"));
    expect(drawImage.mock.calls[0].slice(-2)).toEqual([1024, 1024]);
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:crop-1");
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith("blob:crop-2");
    expect(consoleError).not.toHaveBeenCalled();
  });

  it.each(["reject", "false"])("preserves source, zoom and crop after onSave %s and releases only its failed preview", async (failure) => {
    const onSave = failure === "reject" ? vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(true) : vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    render(<ImageCropper file={file} onCancel={vi.fn()} onSave={onSave} />);
    const image = decode();
    fireEvent.change(screen.getByRole("slider"), { target: { value: "2" } });
    fireEvent.keyDown(screen.getByRole("group", { name: "Encuadre de imagen" }), { key: "ArrowRight" });
    const transform = image.style.transform;
    fireEvent.click(screen.getByRole("button", { name: "Usar imagen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Conservamos el recorte");
    expect(image).toHaveAttribute("src", "blob:crop-1");
    expect(image.style.transform).toBe(transform);
    expect(screen.getByRole("slider")).toHaveValue("2");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:crop-2");
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith("blob:crop-1");
    fireEvent.click(screen.getByRole("button", { name: "Usar imagen" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    expect(drawImage.mock.calls[0].slice(1)).toEqual(drawImage.mock.calls[1].slice(1));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("clamps drag offsets after zooming out and resizing without exporting blank edges", async () => {
    const onSave = vi.fn();
    render(<ImageCropper file={file} aspectRatio={16 / 9} onCancel={vi.fn()} onSave={onSave} />);
    decode(800, 1200);
    const frame = screen.getByRole("group", { name: "Encuadre de imagen" });
    Object.defineProperty(frame, "setPointerCapture", { value: vi.fn() });
    fireEvent.click(screen.getByRole("button", { name: "Aumentar zoom" }));
    expect(screen.getByRole("slider")).toHaveValue("1.1");
    fireEvent.change(screen.getByRole("slider"), { target: { value: "3" } });
    expect(screen.getByRole("button", { name: "Aumentar zoom" })).toBeDisabled();
    fireEvent.pointerDown(frame, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(frame, { clientX: 10000, clientY: 10000 });
    fireEvent.pointerUp(frame);
    fireEvent.change(screen.getByRole("slider"), { target: { value: "1" } });
    act(() => resize([{ contentRect: { width: 300 } } as ResizeObserverEntry], {} as ResizeObserver));
    expect(screen.getByRole("button", { name: "Reducir zoom" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Usar imagen" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [, x, y, width, height] = drawImage.mock.calls[0];
    expect(x).toBeGreaterThanOrEqual(0);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(x + width).toBeLessThanOrEqual(800);
    expect(y + height).toBeLessThanOrEqual(1200);
    expect(width / height).toBeCloseTo(16 / 9);
    expect(drawImage.mock.calls[0].slice(-2)).toEqual([1024, 576]);
  });

  it("recovers a missing canvas context without uploading or dropping the source", async () => {
    const onSave = vi.fn();
    render(<ImageCropper file={file} onCancel={vi.fn()} onSave={onSave} />);
    decode();
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValueOnce(null);
    fireEvent.click(screen.getByRole("button", { name: "Usar imagen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo preparar");
    expect(onSave).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Usar imagen" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  });

  it("preserves the menu aspect ratio rather than forcing a square", async () => {
    const onSave = vi.fn();
    render(<ImageCropper file={file} aspectRatio="original" onCancel={vi.fn()} onSave={onSave} />);
    decode(800, 1600);
    fireEvent.click(screen.getByRole("button", { name: "Usar imagen" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const dimensions = drawImage.mock.calls[0].slice(-2);
    expect(dimensions[0] / dimensions[1]).toBe(0.5);
  });
});
