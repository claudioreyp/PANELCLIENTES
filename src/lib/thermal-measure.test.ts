import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { measureThermalDocument, thermalRasterHeight } from "./thermal-measure";

const html = '<!doctype html><html><head><style>.thermal-document { width:80mm; }</style></head><body><div class="thermal-document">Synthetic receipt</div></body></html>';
let callbacks: FrameRequestCallback[];

async function tick() {
  const pending = callbacks.splice(0);
  pending.forEach((callback) => callback(0));
  await Promise.resolve();
  await Promise.resolve();
}

function load(height = 500, paperWidth: 58 | 80 = 80) {
  const frame = document.querySelector("iframe")!;
  const doc = frame.contentDocument!;
  doc.body.innerHTML = '<div class="thermal-document">Synthetic receipt</div>';
  const root = doc.querySelector<HTMLElement>(".thermal-document")!;
  const width = paperWidth * 96 / 25.4;
  let currentHeight = height;
  const rect = vi.spyOn(root, "getBoundingClientRect").mockImplementation(() => ({
    x: 0, y: 0, top: 0, left: 0, right: width, bottom: currentHeight, width, height: currentHeight, toJSON: () => ({}),
  }));
  Object.defineProperties(root, {
    scrollHeight: { configurable: true, get: () => Math.round(currentHeight) },
    scrollWidth: { configurable: true, value: Math.round(width) },
    clientWidth: { configurable: true, value: Math.round(width) },
  });
  return { frame, doc, root, rect, setHeight: (value: number) => { currentHeight = value; }, start: () => frame.dispatchEvent(new Event("load")) };
}

describe("thermal height measurement", () => {
  beforeEach(() => {
    callbacks = [];
    vi.useFakeTimers();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { callbacks.push(callback); return callbacks.length; });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  });
  afterEach(() => { document.body.innerHTML = ""; vi.restoreAllMocks(); vi.useRealTimers(); });

  it.each([58, 80] as const)("maps CSS pixels to RAW dots at %s mm without using the intermediate points as CSS width", (width) => {
    const result = thermalRasterHeight(500.25, width);
    expect(result.widthCssPx).toBeCloseTo(width * 96 / 25.4);
    expect(result.pageHeightDots).toBe(Math.ceil(500.25 * (width === 58 ? 384 : 576) / result.widthCssPx) + 2);
    expect(thermalRasterHeight(50_000, width).pageHeightDots).toBeGreaterThan(result.pageHeightDots);
  });

  it.each([0, -1, NaN, Infinity, Number.MAX_VALUE])("rejects invalid or unrepresentable height %s instead of clamping it", (height) => {
    expect(() => thermalRasterHeight(height, 80)).toThrow();
  });

  it.each([58, 80] as const)("isolates styles, stabilizes three readings and cleans up at %s mm", async (width) => {
    document.body.style.fontSize = "90px";
    const work = measureThermalDocument(html, width, new AbortController().signal);
    const fixture = load(500, width);
    expect(fixture.frame.getAttribute("sandbox")).toBe("allow-same-origin");
    expect(fixture.frame.srcdoc).toContain("default-src 'none'");
    expect(fixture.frame.style.width).toBe(`${width * 96 / 25.4}px`);
    fixture.start(); await tick();
    fixture.setHeight(510); await tick(); await tick();
    expect(fixture.frame.isConnected).toBe(true);
    await tick();
    expect(await work).toEqual(thermalRasterHeight(510, width));
    expect(document.querySelector("iframe")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    expect(window.cancelAnimationFrame).toHaveBeenCalled();
  });

  it("waits for fonts and images before starting measurements", async () => {
    const work = measureThermalDocument(html, 80, new AbortController().signal);
    const fixture = load();
    let fontsReady!: () => void, imageReady!: () => void;
    Object.defineProperty(fixture.doc, "fonts", { value: { ready: new Promise<void>((resolve) => { fontsReady = resolve; }) } });
    const img = fixture.doc.createElement("img");
    img.decode = vi.fn(() => new Promise<void>((resolve) => { imageReady = resolve; }));
    fixture.root.append(img); fixture.start(); await tick();
    expect(fixture.rect).not.toHaveBeenCalled();
    fontsReady(); await tick();
    expect(img.decode).toHaveBeenCalledOnce();
    expect(fixture.rect).not.toHaveBeenCalled();
    imageReady(); await tick(); await tick(); await tick(); await tick();
    await expect(work).resolves.toMatchObject({ heightCssPx: 500 });
  });

  it("rejects missing or ambiguous roots without creating an iframe", async () => {
    await expect(measureThermalDocument("<p>Not a receipt</p>", 80, new AbortController().signal)).rejects.toThrow("unico");
    await expect(measureThermalDocument(html.replace("</body>", '<div class="thermal-document"></div></body>'), 80, new AbortController().signal)).rejects.toThrow("unico");
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("rejects a pre-aborted request without inserting anything", () => {
    const controller = new AbortController(); controller.abort();
    expect(() => measureThermalDocument(html, 80, controller.signal)).toThrow();
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("aborts during resource loading and ignores late completion", async () => {
    const controller = new AbortController();
    const work = measureThermalDocument(html, 80, controller.signal);
    const fixture = load();
    let ready!: () => void;
    Object.defineProperty(fixture.doc, "fonts", { value: { ready: new Promise<void>((resolve) => { ready = resolve; }) } });
    fixture.start(); controller.abort();
    await expect(work).rejects.toMatchObject({ name: "AbortError" });
    ready(); await tick();
    expect(fixture.rect).not.toHaveBeenCalled();
    expect(document.querySelector("iframe")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("times out without an iframe load or any fallback height", async () => {
    const work = measureThermalDocument(html, 80, new AbortController().signal);
    document.querySelector("iframe")!.addEventListener("load", (event) => event.stopImmediatePropagation(), { capture: true });
    const assertion = expect(work).rejects.toThrow("a tiempo");
    await vi.advanceTimersByTimeAsync(10_000); await assertion;
    expect(document.querySelector("iframe")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("times out an unstable layout and releases the pending frame", async () => {
    const work = measureThermalDocument(html, 80, new AbortController().signal);
    const assertion = expect(work).rejects.toThrow("a tiempo");
    const fixture = load(); fixture.start(); await tick();
    for (let i = 0; i < 8; i++) { fixture.setHeight(500 + i); await tick(); }
    await vi.advanceTimersByTimeAsync(10_000); await assertion;
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("rejects horizontal overflow without clipping the receipt", async () => {
    const work = measureThermalDocument(html, 80, new AbortController().signal);
    const fixture = load(); Object.defineProperty(fixture.root, "scrollWidth", { value: 1000 });
    fixture.start(); await tick(); await tick();
    await expect(work).rejects.toThrow("ancho");
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("rejects failed image decoding and removes the sandbox", async () => {
    const work = measureThermalDocument(html, 80, new AbortController().signal);
    const fixture = load(), img = fixture.doc.createElement("img");
    img.decode = vi.fn().mockRejectedValue(new Error("Image failed"));
    fixture.root.append(img); fixture.start();
    await expect(work).rejects.toThrow("Image failed");
    expect(document.querySelector("iframe")).toBeNull();
  });
});
