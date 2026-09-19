import { createHash, generateKeyPairSync, sign, verify, webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import qz from "qz-tray";
import type { QzRuntime } from "./qz-tray";

const mocks = vi.hoisted(() => ({ api: vi.fn(), measure: vi.fn() }));
vi.mock("./api", async (original) => ({ ...await original<typeof import("./api")>(), api: mocks.api }));
vi.mock("./thermal-measure", () => ({ measureThermalDocument: mocks.measure }));

type WireRequest = {
  call?: string; params?: unknown; timestamp: number; uid: string;
  certificate?: string | null; signature?: string; signAlgorithm?: string;
};
const connector = qz as QzRuntime & {
  version: string;
  api: NonNullable<QzRuntime["api"]> & { setWebSocketType: (socket: typeof TestWebSocket) => void };
};
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const sent: WireRequest[] = [];
const signBodies: { path: string; payload: string; request: string }[] = [];

// Only the transport is simulated. The installed QZ connector builds, hashes,
// signs and serializes every request through its real public API.
class TestWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;
  static instances: TestWebSocket[] = [];
  readyState = TestWebSocket.CONNECTING;
  interval?: ReturnType<typeof setInterval>;
  onopen?: (event: object) => void;
  onclose?: (event: object) => void;
  onmessage?: (event: { data: string }) => void;
  constructor() {
    TestWebSocket.instances.push(this);
    queueMicrotask(() => { this.readyState = TestWebSocket.OPEN; this.onopen?.({}); });
  }
  send(value: string) {
    if (value === "ping") return;
    const request: WireRequest = JSON.parse(value);
    sent.push(request);
    if (request.call && request.call !== "getVersion") {
      const raw = JSON.stringify({ call: request.call, params: request.params, timestamp: request.timestamp });
      const hash = createHash("sha256").update(raw).digest("hex");
      expect(request.signAlgorithm).toBe("SHA512");
      expect(request.signature).toBeTruthy();
      expect(verify("RSA-SHA512", Buffer.from(hash), keys.publicKey, Buffer.from(request.signature!, "base64"))).toBe(true);
    }
    const result = request.call === "getVersion" ? "2.2.6"
      : request.call === "printers.detail" ? [{ name: "POS-80", driver: "Thermal driver" }] : null;
    queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ uid: request.uid, result }) }));
  }
  close() {
    clearInterval(this.interval);
    this.readyState = TestWebSocket.CLOSED;
    this.onclose?.({});
  }
}

describe("actual bundled QZ 2.2.6 signing protocol", () => {
  beforeEach(() => {
    vi.resetModules(); vi.clearAllMocks();
    sent.length = 0; signBodies.length = 0; TestWebSocket.instances = [];
    vi.stubGlobal("crypto", webcrypto);
    vi.stubGlobal("qz", connector);
    connector.api.setWebSocketType(TestWebSocket);
    mocks.measure.mockResolvedValue({ pageHeightDots: 720 });
    mocks.api.mockImplementation(async (path: string, options: { body?: string }) => {
      if (!path.includes("/qz/sign?")) return { mode: "signed", certificate: "test-public-certificate" };
      const body = JSON.parse(options.body!);
      signBodies.push({ path, ...body });
      expect(body.request).toBeTypeOf("string");
      expect(body.payload).toMatch(/^[a-f0-9]{64}$/);
      expect(body.payload).toBe(createHash("sha256").update(body.request).digest("hex"));
      return { signature: sign("RSA-SHA512", Buffer.from(body.payload), keys.privateKey).toString("base64") };
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(async () => {
    if (connector.websocket.isActive()) await connector.websocket.disconnect();
    for (const socket of TestWebSocket.instances) clearInterval(socket.interval);
    vi.restoreAllMocks(); vi.unstubAllGlobals();
  });

  it("hashes exact JSON and signs the digest for two queued documents in separate branch scopes", async () => {
    expect(connector.version).toBe("2.2.6");
    const { qzBridge } = await import("./qz-tray");
    const beforeSend = vi.fn(), onSending = vi.fn();
    const jobs = [7, 8].map((branchId) => qzBridge.dispatch({
      branchId, orderId: branchId + 10, printerName: "POS-80", paperWidth: 80, copies: 1,
      printLanguage: "escpos", html: `<p>Comanda \u00f1 ${branchId}\n</p>`, jobName: `Job ${branchId}`,
      signal: new AbortController().signal, beforeSend, onSending,
    }));
    await Promise.all(jobs);
    expect(TestWebSocket.instances).toHaveLength(1);
    expect(sent.filter((request) => "certificate" in request)).toEqual([
      expect.objectContaining({ certificate: "test-public-certificate" }),
    ]);
    expect(signBodies.map(({ path }) => path)).toEqual([7, 7, 8, 8].map((branch) => `/settings/printing/qz/sign?branch_id=${branch}`));
    expect(signBodies.map(({ request }) => JSON.parse(request).call)).toEqual(["printers.detail", "print", "printers.detail", "print"]);
    const operations = sent.filter((request) => request.call && request.call !== "getVersion");
    expect(operations).toHaveLength(4);
    for (const [index, request] of operations.entries()) {
      expect(signBodies[index].request).toBe(JSON.stringify({ call: request.call, params: request.params, timestamp: request.timestamp }));
    }
    expect(beforeSend).toHaveBeenCalledTimes(2);
    expect(onSending).toHaveBeenCalledTimes(2);
  });

  it("never sends an unsigned operational request when the API refuses signing", async () => {
    const implementation = mocks.api.getMockImplementation()!;
    mocks.api.mockImplementation((path: string, options: { body?: string }) => {
      if (path.includes("/qz/sign?")) return Promise.reject(new Error("API 422: request rejected"));
      return implementation(path, options);
    });
    const { qzBridge } = await import("./qz-tray");
    await expect(qzBridge.printers(7, new AbortController().signal, vi.fn())).rejects.toThrow("Failed to sign request");
    expect(sent.some((request) => request.call === "printers.detail")).toBe(false);
    expect(sent.filter((request) => "certificate" in request).map((request) => request.certificate)).toEqual(["test-public-certificate"]);
    expect(connector.websocket.isActive()).toBe(false);
  });

  it("fails closed when the connector hands the signer an unrecognized hash", async () => {
    const setHash = connector.api.setSha256Type.bind(connector.api);
    vi.spyOn(connector.api, "setSha256Type").mockImplementation((hasher) => {
      setHash(async (raw) => { await hasher(raw); return "0".repeat(64); });
    });
    const { qzBridge } = await import("./qz-tray");
    await expect(qzBridge.printers(7, new AbortController().signal, vi.fn())).rejects.toThrow("Failed to sign request");
    expect(mocks.api).toHaveBeenCalledOnce();
    expect(sent.some((request) => request.call === "printers.detail")).toBe(false);
  });
});
