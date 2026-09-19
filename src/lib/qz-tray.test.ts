import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, webcrypto } from "node:crypto";

const mocks = vi.hoisted(() => ({ api: vi.fn(), measure: vi.fn(), active: false, qz: {
  api: { setSha256Type: vi.fn() },
  websocket: { isActive: vi.fn(), connect: vi.fn(), disconnect: vi.fn() },
  security: { setCertificatePromise: vi.fn(), setSignaturePromise: vi.fn(), setSignatureAlgorithm: vi.fn() },
  printers: { find: vi.fn(), details: vi.fn() }, configs: { create: vi.fn() }, print: vi.fn(),
} }));
vi.mock("./api", async (original) => ({ ...await original<typeof import("./api")>(), api: mocks.api }));
vi.mock("qz-tray", () => ({ default: mocks.qz }));
vi.mock("./thermal-measure", () => ({ measureThermalDocument: mocks.measure }));

const hashRequest = (request: string): Promise<string> => mocks.qz.api.setSha256Type.mock.calls.at(-1)![0](request);
const signHash = (hash: string): Promise<string> => new Promise((resolve, reject) => mocks.qz.security.setSignaturePromise.mock.calls.at(-1)![0](hash)(resolve, reject));
const signRequest = async (request: string) => signHash(await hashRequest(request));

describe("bundled QZ connector", () => {
  beforeEach(() => {
    vi.resetModules(); vi.clearAllMocks(); mocks.active = false;
    vi.stubGlobal("crypto", webcrypto);
    mocks.api.mockResolvedValue({ mode: "manual-approval", certificate: null });
    mocks.measure.mockResolvedValue({ heightCssPx: 500, widthCssPx: 80 * 96 / 25.4, pageHeightDots: 955 });
    mocks.qz.websocket.isActive.mockImplementation(() => mocks.active);
    mocks.qz.websocket.connect.mockImplementation(async () => { mocks.active = true; });
    mocks.qz.websocket.disconnect.mockImplementation(async () => { mocks.active = false; });
    mocks.qz.printers.find.mockResolvedValue(["POS-80", "POS-80", ""]);
    mocks.qz.printers.details.mockResolvedValue([{ name: "POS-80", driver: "Thermal raster driver" }]);
    mocks.qz.print.mockResolvedValue(undefined);
    mocks.qz.configs.create.mockReturnValue({ printer: "POS-80" });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("loads the official bundled connector without a script URL and requests native approval", async () => {
    const { qzBridge } = await import("./qz-tray");
    const onState = vi.fn();
    expect(await qzBridge.printers(7, new AbortController().signal, onState)).toEqual({ printers: ["POS-80"], details: [{ name: "POS-80", driver: "Thermal raster driver" }], mode: "manual-approval" });
    expect(mocks.qz.printers.details).toHaveBeenCalledOnce();
    expect(mocks.qz.printers.find).not.toHaveBeenCalled();
    expect(mocks.api).toHaveBeenCalledWith("/settings/branches/7/printing/qz", expect.anything());
    expect(mocks.qz.websocket.connect).toHaveBeenCalledOnce();
    expect(onState.mock.calls.flat()).toEqual(["loading", "permission", "connecting"]);
    const resolve = vi.fn();
    mocks.qz.security.setCertificatePromise.mock.calls[0][0](resolve);
    expect(resolve).toHaveBeenCalledWith(null);
    expect(mocks.qz.security.setCertificatePromise.mock.calls[0][1]).toEqual({ rejectOnFailure: true });
  });

  it("deduplicates printer details and keeps unknown drivers without inventing them", async () => {
    mocks.qz.printers.details.mockResolvedValue([
      { name: "POS-80", driver: "Generic / Text Only" },
      { name: "POS-80", driver: "Duplicate driver" },
      { name: "No driver" }, { name: "Invalid driver", driver: 12 },
      { name: "", driver: "Unused" }, { name: "   " }, { name: 12 }, null, "Not a detail",
    ]);
    const { qzBridge } = await import("./qz-tray");
    expect(await qzBridge.printers(7, new AbortController().signal, vi.fn())).toEqual({
      printers: ["POS-80", "No driver", "Invalid driver"], mode: "manual-approval",
      details: [{ name: "POS-80", driver: "Generic / Text Only" }, { name: "No driver", driver: null }, { name: "Invalid driver", driver: null }],
    });
    expect(mocks.qz.printers.find).not.toHaveBeenCalled();
  });

  it("accepts a single printer detail from a provided host", async () => {
    vi.stubGlobal("qz", mocks.qz);
    mocks.qz.printers.details.mockResolvedValue({ name: "POS-80", driver: "Generic / Text Only" });
    const { qzBridge } = await import("./qz-tray");
    expect(await qzBridge.printers(7, new AbortController().signal, vi.fn())).toMatchObject({
      printers: ["POS-80"], details: [{ name: "POS-80", driver: "Generic / Text Only" }],
    });
  });

  it.each([false, true])("supports a legacy host returning names only (single: %s) without inferring its driver", async (single) => {
    vi.stubGlobal("qz", { ...mocks.qz, api: undefined, printers: { find: mocks.qz.printers.find } });
    const name = "Generic / Text Only";
    mocks.qz.printers.find.mockResolvedValue(single ? name : [name, name, "", "   "]);
    const { qzBridge } = await import("./qz-tray");
    expect(await qzBridge.printers(7, new AbortController().signal, vi.fn())).toEqual({
      printers: [name], details: [{ name, driver: null }], mode: "manual-approval",
    });
    const beforeSend = vi.fn().mockResolvedValue(undefined);
    await qzBridge.dispatch({ branchId: 7, printerName: name, paperWidth: 80, copies: 1, printLanguage: "pixel", html: "<p>Legacy host</p>", jobName: "Legacy", signal: new AbortController().signal, beforeSend, onSending: vi.fn() });
    expect(mocks.qz.printers.details).not.toHaveBeenCalled();
    expect(beforeSend).toHaveBeenCalledOnce();
    expect(mocks.qz.print).toHaveBeenCalledOnce();
    expect(mocks.qz.print.mock.calls[0][1]).toEqual([
      { type: "pixel", format: "html", flavor: "plain", data: "<p>Legacy host</p>", options: { pageWidth: 80 } },
    ]);
  });

  it.each([
    ["Generic / Text Only", undefined],
    ["Generic / Text Only", "pixel"],
    ["generic/text only", "pixel"],
    ["Genérico / Sólo texto", "pixel"],
  ] as const)("blocks driver %s in %s mode before claiming or sending", async (driver, printLanguage) => {
    mocks.qz.printers.details.mockResolvedValue([{ name: "POS-80", driver }]);
    const { qzBridge } = await import("./qz-tray");
    const beforeSend = vi.fn().mockResolvedValue(undefined), onSending = vi.fn();
    await expect(qzBridge.dispatch({ branchId: 7, orderId: 12, printerName: "POS-80", paperWidth: 80, copies: 1, printLanguage, html: "<p>Do not send</p>", jobName: "Ticket", signal: new AbortController().signal, beforeSend, onSending })).rejects.toThrow("Guarda Térmica ESC/POS");
    expect(beforeSend).not.toHaveBeenCalled();
    expect(onSending).not.toHaveBeenCalled();
    expect(mocks.qz.configs.create).not.toHaveBeenCalled();
    expect(mocks.qz.print).not.toHaveBeenCalled();
  });

  it("checks only the selected driver's compatibility, not its name or another printer", async () => {
    mocks.qz.printers.details.mockResolvedValue([
      { name: "POS-80", driver: "Generic / Text Only" },
      { name: "Generic / Text Only", driver: "Thermal raster driver" },
    ]);
    const { qzBridge } = await import("./qz-tray");
    await qzBridge.dispatch({ branchId: 7, printerName: "Generic / Text Only", paperWidth: 80, copies: 1, printLanguage: "pixel", html: "<p>Raster</p>", jobName: "Ticket", signal: new AbortController().signal, beforeSend: vi.fn(), onSending: vi.fn() });
    expect(mocks.qz.configs.create).toHaveBeenCalledWith("Generic / Text Only", expect.anything());
    expect(mocks.qz.print).toHaveBeenCalledOnce();
    expect(mocks.qz.print.mock.calls[0][1][0]).toMatchObject({ type: "pixel" });
  });

  it("does not bypass a failed driver lookup by falling back to printer names", async () => {
    mocks.qz.printers.details.mockRejectedValue(new Error("Driver lookup denied"));
    const { qzBridge } = await import("./qz-tray");
    const beforeSend = vi.fn(), onSending = vi.fn();
    await expect(qzBridge.dispatch({ branchId: 7, printerName: "POS-80", paperWidth: 80, copies: 1, html: "<p>Ticket</p>", jobName: "Ticket", signal: new AbortController().signal, beforeSend, onSending })).rejects.toThrow("Driver lookup denied");
    expect(mocks.qz.printers.find).not.toHaveBeenCalled();
    expect(beforeSend).not.toHaveBeenCalled();
    expect(onSending).not.toHaveBeenCalled();
    expect(mocks.qz.print).not.toHaveBeenCalled();
  });

  it("never falls back to unsigned requests on signing failure", async () => {
    mocks.api.mockResolvedValueOnce({ mode: "signed", certificate: "public-certificate" });
    mocks.api.mockRejectedValueOnce(new Error("Signer unavailable"));
    mocks.qz.printers.details.mockImplementationOnce(() => signRequest('{"call":"printers.detail"}'));
    const { qzBridge } = await import("./qz-tray");
    await expect(qzBridge.printers(7, new AbortController().signal, vi.fn())).rejects.toThrow("Signer unavailable");
    expect(mocks.api).toHaveBeenCalledTimes(2);
    expect(mocks.qz.websocket.disconnect).toHaveBeenCalledOnce();
  });

  it("does not contact the native service if the API rejects access", async () => {
    mocks.api.mockRejectedValueOnce(new Error("Permission denied"));
    const { qzBridge } = await import("./qz-tray");
    await expect(qzBridge.printers(7, new AbortController().signal, vi.fn())).rejects.toThrow();
    expect(mocks.qz.websocket.connect).not.toHaveBeenCalled();
  });

  it("renews the handshake after enabling signing or rotating the certificate, not for every print", async () => {
    const { qzBridge } = await import("./qz-tray");
    const discover = () => qzBridge.printers(7, new AbortController().signal, vi.fn());
    await discover();
    mocks.api.mockResolvedValue({ mode: "signed", certificate: "identity-A" });
    await discover();
    await discover();
    expect(mocks.qz.websocket.disconnect).toHaveBeenCalledOnce();
    expect(mocks.qz.websocket.connect).toHaveBeenCalledTimes(2);
    mocks.api.mockResolvedValue({ mode: "signed", certificate: "identity-B" });
    await discover();
    expect(mocks.qz.websocket.disconnect).toHaveBeenCalledTimes(2);
    expect(mocks.qz.websocket.connect).toHaveBeenCalledTimes(3);
    const resolve = vi.fn();
    mocks.qz.security.setCertificatePromise.mock.calls.at(-1)![0](resolve);
    expect(resolve).toHaveBeenCalledWith("identity-B");
  });

  it("does not send with a changed identity if the old socket cannot close", async () => {
    const { qzBridge } = await import("./qz-tray");
    await qzBridge.printers(7, new AbortController().signal, vi.fn());
    mocks.api.mockResolvedValue({ mode: "signed", certificate: "identity" });
    mocks.qz.websocket.disconnect.mockRejectedValueOnce(new Error("Busy"));
    const beforeSend = vi.fn();
    await expect(qzBridge.dispatch({ branchId: 7, printerName: "POS-80", paperWidth: 80, copies: 1, html: "Ticket", jobName: "Ticket", signal: new AbortController().signal, beforeSend, onSending: vi.fn() })).rejects.toThrow("renovar la identidad");
    expect(beforeSend).not.toHaveBeenCalled();
    expect(mocks.qz.print).not.toHaveBeenCalled();
  });

  it.each([undefined, "", "  ", "not-a-signature", null])("rejects invalid signatures without unsigned fallback: %s", async (signature) => {
    mocks.api.mockResolvedValueOnce({ mode: "signed", certificate: "identity" });
    mocks.api.mockResolvedValueOnce({ signature });
    mocks.qz.printers.details.mockImplementationOnce(() => signRequest('{"call":"printers.detail"}'));
    const { qzBridge } = await import("./qz-tray");
    await expect(qzBridge.printers(7, new AbortController().signal, vi.fn())).rejects.toThrow("firma válida");
  });

  it("signs discovery and both documents, reusing the identified socket and current branch scope", async () => {
    const signature = btoa("signed payload");
    mocks.api.mockImplementation(async (path: string) => path.includes("/qz/sign?") ? { signature } : { mode: "signed", certificate: "identity" });
    mocks.qz.printers.details.mockImplementation(async () => {
      expect(await signRequest('{"call":"printers.detail"}')).toBe(signature);
      return [{ name: "POS-80", driver: "Generic / Text Only" }];
    });
    mocks.qz.print.mockImplementation(async () => { expect(await signRequest('{"call":"print"}')).toBe(signature); });
    const { qzBridge } = await import("./qz-tray");
    const discovery = new AbortController();
    await qzBridge.printers(7, discovery.signal, vi.fn());
    discovery.abort();
    for (const name of ["Ticket", "Comanda"]) {
      await qzBridge.dispatch({ branchId: 8, orderId: 15, printerName: "POS-80", paperWidth: 80, copies: 1, printLanguage: "escpos", html: name, jobName: name, signal: new AbortController().signal, beforeSend: vi.fn(), onSending: vi.fn() });
    }
    expect(mocks.qz.websocket.connect).toHaveBeenCalledOnce();
    expect(mocks.qz.print).toHaveBeenCalledTimes(2);
    const requests = mocks.api.mock.calls.filter(([path]) => path.includes("/qz/sign?"));
    expect(requests.map(([path]) => path)).toEqual([
      "/settings/printing/qz/sign?branch_id=7",
      ...Array(4).fill("/settings/printing/qz/sign?branch_id=8"),
    ]);
    for (const [, options] of requests) {
      const body = JSON.parse(options.body);
      expect(body.payload).toBe(createHash("sha256").update(body.request).digest("hex"));
    }
    expect(mocks.qz.security.setSignatureAlgorithm).toHaveBeenCalledWith("SHA512");
  });

  it.each(["hook", "crypto"])("fails closed before connecting when signed hosts lack %s", async (missing) => {
    mocks.api.mockResolvedValue({ mode: "signed", certificate: "identity" });
    if (missing === "hook") vi.stubGlobal("qz", { ...mocks.qz, api: undefined });
    else vi.stubGlobal("crypto", { randomUUID: webcrypto.randomUUID.bind(webcrypto) });
    const { qzBridge } = await import("./qz-tray");
    await expect(qzBridge.printers(7, new AbortController().signal, vi.fn())).rejects.toThrow("verificar solicitudes firmadas");
    expect(mocks.qz.websocket.connect).not.toHaveBeenCalled();
    expect(mocks.api).toHaveBeenCalledOnce();
  });

  it("rejects unknown and consumed digests, bounds stored requests, and clears the operation", async () => {
    mocks.api.mockImplementation(async (path: string) => path.includes("/qz/sign?") ? { signature: btoa("signature") } : { mode: "signed", certificate: "identity" });
    let savedHash = "";
    mocks.qz.printers.details.mockImplementationOnce(async () => {
      const raw = '{ "call": "printers.detail", "params": {"name":"Cocina \\u00f1"}, "timestamp":123 }';
      savedHash = await hashRequest(raw);
      expect(savedHash).toBe(createHash("sha256").update(raw).digest("hex"));
      await expect(signHash("f".repeat(64))).rejects.toThrow("verificar el contenido");
      await expect(signHash(savedHash)).resolves.toBe(btoa("signature"));
      await expect(signHash(savedHash)).rejects.toThrow("verificar el contenido");
      for (let index = 0; index < 16; index++) await hashRequest(`${raw}${index}`);
      await expect(hashRequest("overflow")).rejects.toThrow("demasiadas");
      return [];
    });
    const { qzBridge } = await import("./qz-tray");
    await qzBridge.printers(7, new AbortController().signal, vi.fn());
    await expect(signHash(savedHash)).rejects.toThrow("ya no esta activa");
    await expect(hashRequest("late")).rejects.toThrow("ya no esta activa");
    expect(mocks.api).toHaveBeenCalledTimes(2);
    mocks.qz.printers.details.mockImplementationOnce(async () => {
      await expect(signHash(savedHash)).rejects.toThrow("verificar el contenido");
      return [];
    });
    await qzBridge.printers(8, new AbortController().signal, vi.fn());
  });

  it("does not resolve a late signature after cancellation or leak it into the next operation", async () => {
    let respond!: (value: { signature: string }) => void;
    let signing!: Promise<string>;
    mocks.api.mockResolvedValueOnce({ mode: "signed", certificate: "identity" });
    mocks.api.mockImplementationOnce(() => new Promise((resolve) => { respond = resolve; }));
    mocks.qz.printers.details.mockImplementationOnce(() => {
      signing = signRequest('{"call":"printers.detail"}');
      return signing;
    });
    const { qzBridge } = await import("./qz-tray");
    const controller = new AbortController();
    const work = qzBridge.printers(7, controller.signal, vi.fn());
    await vi.waitFor(() => expect(respond).toBeTypeOf("function"));
    controller.abort();
    await expect(work).rejects.toMatchObject({ name: "AbortError" });
    respond({ signature: btoa("late signature") });
    await expect(signing).rejects.toMatchObject({ name: "AbortError" });
    await expect(qzBridge.printers(8, new AbortController().signal, vi.fn())).resolves.toMatchObject({ mode: "manual-approval" });
  });

  it("clears unconsumed requests and rejects late signing after authorization times out", async () => {
    vi.useFakeTimers();
    let hash = "";
    mocks.api.mockResolvedValue({ mode: "signed", certificate: "identity" });
    mocks.qz.printers.details.mockImplementationOnce(async () => {
      hash = await hashRequest('{"call":"printers.detail"}');
      return new Promise(() => {});
    });
    const { qzBridge } = await import("./qz-tray");
    const work = qzBridge.printers(7, new AbortController().signal, vi.fn());
    const failed = expect(work).rejects.toThrow("tardó demasiado");
    await vi.waitFor(() => expect(hash).toHaveLength(64));
    await vi.advanceTimersByTimeAsync(60_000);
    await failed;
    await expect(signHash(hash)).rejects.toThrow("ya no esta activa");
    expect(mocks.api).toHaveBeenCalledOnce();
  });

  it("does not hash oversized signed requests or fall back after Web Crypto failure", async () => {
    mocks.api.mockResolvedValue({ mode: "signed", certificate: "identity" });
    const digest = vi.fn().mockRejectedValue(new Error("Hash unavailable"));
    vi.stubGlobal("crypto", { subtle: { digest } });
    mocks.qz.printers.details.mockImplementationOnce(async () => {
      await expect(hashRequest("x".repeat(200_001))).rejects.toThrow("no es valida");
      expect(digest).not.toHaveBeenCalled();
      await expect(hashRequest('{"call":"printers.detail"}')).rejects.toThrow("Hash unavailable");
      await expect(signHash("0".repeat(64))).rejects.toThrow("verificar el contenido");
      return [];
    });
    const { qzBridge } = await import("./qz-tray");
    await qzBridge.printers(7, new AbortController().signal, vi.fn());
    expect(mocks.api).toHaveBeenCalledOnce();
  });

  it("allows retry after connection failure and cancels a pending discovery", async () => {
    const { qzBridge } = await import("./qz-tray");
    mocks.qz.websocket.connect.mockRejectedValueOnce(new Error("Unable to establish connection"));
    await expect(qzBridge.printers(7, new AbortController().signal, vi.fn())).rejects.toThrow();
    expect((await qzBridge.printers(7, new AbortController().signal, vi.fn())).printers).toEqual(["POS-80"]);
    mocks.qz.printers.details.mockImplementationOnce(() => new Promise(() => {}));
    const controller = new AbortController();
    const request = qzBridge.printers(7, controller.signal, vi.fn());
    await vi.waitFor(() => expect(mocks.qz.printers.details).toHaveBeenCalledTimes(2));
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    await qzBridge.disconnect();
    expect(mocks.active).toBe(false);
  });

  it.each([58, 80] as const)("renders %s mm HTML through explicit ESC/POS, with feed and cut but no drawer pulse", async (paperWidth) => {
    mocks.qz.printers.details.mockResolvedValue([{ name: "POS-80", driver: "Generic / Text Only" }]);
    const { qzBridge } = await import("./qz-tray");
    const rasterWidth = paperWidth === 58 ? 384 : 576;
    await qzBridge.dispatch({ branchId: 7, orderId: 12, printerName: "POS-80", paperWidth, copies: 2, printLanguage: "escpos", html: "<p>Ticket</p>", jobName: "Ticket", signal: new AbortController().signal, beforeSend: vi.fn(), onSending: vi.fn() });
    expect(mocks.qz.print.mock.calls[0][1]).toEqual([
      { type: "raw", format: "command", flavor: "hex", data: "1B40" },
      { type: "raw", format: "html", flavor: "plain", data: "<p>Ticket</p>", options: { language: "ESCPOS", pageWidth: rasterWidth, pageHeight: 955, dotDensity: "double" } },
      { type: "raw", format: "command", flavor: "hex", data: "0A1D564100" },
    ]);
    expect(mocks.qz.print).toHaveBeenCalledOnce();
    expect(mocks.measure).toHaveBeenCalledWith("<p>Ticket</p>", paperWidth, expect.any(AbortSignal));
    expect(mocks.qz.configs.create).toHaveBeenCalledWith("POS-80", expect.objectContaining({ copies: 2, units: "mm", density: rasterWidth / paperWidth }));
    // PrintHTML first yields 72/in points; WebAppModel then converts them to 96/in CSS pixels.
    const options = mocks.qz.configs.create.mock.calls[0][1];
    const widthPoints = rasterWidth / (options.density * 25.4) * 72;
    expect(widthPoints * 96 / 72).toBeCloseTo(paperWidth * 96 / 25.4);
  });

  it("keeps copies in separate raw jobs, each with its own initialization and final cut", async () => {
    const { qzBridge } = await import("./qz-tray");
    mocks.qz.configs.create.mockImplementation((printer, options) => ({ printer, options }));
    const documents = [{ html: "<p>Ticket</p>", jobName: "Ticket", copies: 2, pageHeight: 1200 }, { html: "<p>Comanda</p>", jobName: "Comanda", copies: 3, pageHeight: 350 }];
    for (const document of documents) {
      mocks.measure.mockResolvedValueOnce({ pageHeightDots: document.pageHeight });
      await qzBridge.dispatch({ branchId: 7, orderId: 12, printerName: "POS-80", paperWidth: 80, printLanguage: "escpos", ...document, signal: new AbortController().signal, beforeSend: vi.fn(), onSending: vi.fn() });
    }
    expect(mocks.qz.print).toHaveBeenCalledTimes(2);
    for (const [index, document] of documents.entries()) {
      expect(mocks.qz.print.mock.calls[index]).toEqual([
        { printer: "POS-80", options: expect.objectContaining({ copies: document.copies, jobName: document.jobName }) },
        [
          { type: "raw", format: "command", flavor: "hex", data: "1B40" },
          { type: "raw", format: "html", flavor: "plain", data: document.html, options: { language: "ESCPOS", pageWidth: 576, pageHeight: document.pageHeight, dotDensity: "double" } },
          { type: "raw", format: "command", flavor: "hex", data: "0A1D564100" },
        ],
      ]);
    }
  });

  it("never invokes QZ if the claim fails", async () => {
    const { qzBridge } = await import("./qz-tray");
    const beforeSend = vi.fn().mockRejectedValue(new Error("Claim denied")), onSending = vi.fn();
    await expect(qzBridge.dispatch({ branchId: 7, orderId: 12, printerName: "POS-80", paperWidth: 80, copies: 1, printLanguage: "escpos", html: "<p>Ticket</p>", jobName: "Ticket", signal: new AbortController().signal, beforeSend, onSending })).rejects.toThrow("Claim denied");
    expect(beforeSend).toHaveBeenCalledOnce();
    expect(onSending).not.toHaveBeenCalled();
    expect(mocks.qz.print).not.toHaveBeenCalled();
  });

  it.each([new Error("Measurement timed out"), new DOMException("Cancelled", "AbortError")])("does not claim or send when measurement fails: %s", async (error) => {
    mocks.measure.mockRejectedValueOnce(error);
    const { qzBridge } = await import("./qz-tray");
    const beforeSend = vi.fn(), onSending = vi.fn();
    await expect(qzBridge.dispatch({ branchId: 7, printerName: "POS-80", paperWidth: 80, copies: 1, printLanguage: "escpos", html: "exact HTML", jobName: "Ticket", signal: new AbortController().signal, beforeSend, onSending })).rejects.toBe(error);
    expect(beforeSend).not.toHaveBeenCalled();
    expect(onSending).not.toHaveBeenCalled();
    expect(mocks.qz.print).not.toHaveBeenCalled();
  });

  it("waits for measurement before claiming and rechecks cancellation afterward", async () => {
    const { qzBridge } = await import("./qz-tray");
    let measured!: (value: { pageHeightDots: number }) => void;
    mocks.measure.mockImplementationOnce(() => new Promise((resolve) => { measured = resolve; }));
    const controller = new AbortController(), beforeSend = vi.fn(), onSending = vi.fn();
    const work = qzBridge.dispatch({ branchId: 7, printerName: "POS-80", paperWidth: 80, copies: 1, printLanguage: "escpos", html: "exact HTML", jobName: "Ticket", signal: controller.signal, beforeSend, onSending });
    await vi.waitFor(() => expect(mocks.measure).toHaveBeenCalledOnce());
    expect(beforeSend).not.toHaveBeenCalled();
    controller.abort(); measured({ pageHeightDots: 700 });
    await expect(work).rejects.toMatchObject({ name: "AbortError" });
    expect(beforeSend).not.toHaveBeenCalled();
    expect(mocks.qz.print).not.toHaveBeenCalled();
  });

  it("marks sending before invoking QZ and never retries a rejected native submission", async () => {
    const { qzBridge } = await import("./qz-tray");
    const beforeSend = vi.fn().mockResolvedValue(undefined), onSending = vi.fn();
    mocks.qz.print.mockRejectedValueOnce(new Error("Connection lost after submission"));
    await expect(qzBridge.dispatch({ branchId: 7, orderId: 12, printerName: "POS-80", paperWidth: 80, copies: 2, printLanguage: "escpos", html: "<p>Ticket</p>", jobName: "Ticket", signal: new AbortController().signal, beforeSend, onSending })).rejects.toThrow("Connection lost after submission");
    expect(beforeSend).toHaveBeenCalledOnce();
    expect(onSending).toHaveBeenCalledOnce();
    expect(beforeSend.mock.invocationCallOrder[0]).toBeLessThan(onSending.mock.invocationCallOrder[0]);
    expect(mocks.measure.mock.invocationCallOrder[0]).toBeLessThan(beforeSend.mock.invocationCallOrder[0]);
    expect(onSending.mock.invocationCallOrder[0]).toBeLessThan(mocks.qz.print.mock.invocationCallOrder[0]);
    expect(mocks.qz.print).toHaveBeenCalledOnce();
  });

  it("validates the exact printer before claiming, then dispatches only once", async () => {
    const { qzBridge } = await import("./qz-tray");
    const beforeSend = vi.fn().mockResolvedValue(undefined), onSending = vi.fn();
    const options = { branchId: 7, orderId: 12, printerName: "Missing", paperWidth: 80 as const, copies: 1, html: "<p>receipt</p>", jobName: "Pedido", signal: new AbortController().signal, beforeSend, onSending };
    await expect(qzBridge.dispatch(options)).rejects.toThrow("no está disponible");
    expect(beforeSend).not.toHaveBeenCalled();
    await qzBridge.dispatch({ ...options, printerName: "POS-80" });
    expect(beforeSend).toHaveBeenCalledOnce(); expect(onSending).toHaveBeenCalledOnce();
    expect(mocks.qz.print).toHaveBeenCalledOnce();
    expect(mocks.qz.print.mock.calls[0][1][0]).toMatchObject({ type: "pixel", format: "html", flavor: "plain", options: { pageWidth: 80 } });
    expect(mocks.measure).not.toHaveBeenCalled();
  });
});
