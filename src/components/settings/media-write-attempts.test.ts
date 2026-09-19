import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../lib/api";
import { uploadSettingsMedia } from "../../lib/settings";
import { createMediaWriteAttempts } from "./media-write-attempts";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("../../lib/api", async (original) => ({ ...await original<typeof import("../../lib/api")>(), api: apiMock }));
const target = { scopeKey: "business:1:branch:7", path: "/settings/branches/7/profile", kind: "logo" as const, expectedVersion: 4 };
const removal = { ...target, path: "/settings/branches/7/media/logo" };
const image = (bytes = "crop-A", type = "image/webp") => new File([bytes], "logo.webp", { type });
const lostResponse = () => new ApiError("Response lost", 0, undefined, "NETWORK_UNREACHABLE");

beforeEach(() => { apiMock.mockReset(); vi.stubGlobal("crypto", webcrypto); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("media write attempts", () => {
  it("replays a lost successful upload with its original file, version and key", async () => {
    const attempts = createMediaWriteAttempts();
    const responses = new Map<string, object>();
    let commits = 0;
    apiMock.mockImplementation((_path, options) => {
      if (responses.has(options.idempotencyKey)) return Promise.resolve(responses.get(options.idempotencyKey));
      commits++;
      responses.set(options.idempotencyKey, { name: "Branch", logo_url: "/logo.webp", version: 5 });
      return Promise.reject(lostResponse());
    });
    const first = await attempts.prepareUpload({ ...target, file: image() });
    await uploadSettingsMedia(first.path, first.file, first.kind, first.expectedVersion, first.idempotencyKey).catch((error) => attempts.failed(first, error));
    const retry = await attempts.prepareUpload({ ...target, file: image(), expectedVersion: 99 });
    expect(retry).toBe(first);
    const saved = await uploadSettingsMedia(retry.path, retry.file, retry.kind, retry.expectedVersion, retry.idempotencyKey);
    expect(saved).toMatchObject({ logo_url: "/logo.webp", version: 5 });
    expect(commits).toBe(1);
    for (const [, options] of apiMock.mock.calls) {
      expect(options.idempotencyKey).toBe(first.idempotencyKey);
      expect(options.body.get("expected_version")).toBe("4");
      expect(options.body.get("file")).toBe(first.file);
    }
    attempts.succeeded(retry);
    expect((await attempts.prepareUpload({ ...target, file: image(), expectedVersion: 5 })).idempotencyKey).not.toBe(first.idempotencyKey);
  });

  it("replays DELETE with the original serialized body despite a newer local version", () => {
    const attempts = createMediaWriteAttempts();
    const first = attempts.prepareRemove(removal);
    attempts.failed(first, lostResponse());
    const retry = attempts.prepareRemove({ ...removal, expectedVersion: 17 });
    expect(retry).toBe(first);
    expect(retry.body).toBe('{"expected_version":4}');
    attempts.succeeded(retry);
    const next = attempts.prepareRemove({ ...removal, expectedVersion: 17 });
    expect(next.body).toBe('{"expected_version":17}');
    expect(next.idempotencyKey).not.toBe(first.idempotencyKey);
  });

  it("gives changed crop bytes or MIME a new key even with identical metadata", async () => {
    const attempts = createMediaWriteAttempts();
    const first = await attempts.prepareUpload({ ...target, file: image() });
    attempts.failed(first, lostResponse());
    const changed = await attempts.prepareUpload({ ...target, file: image("crop-B") });
    expect(changed.idempotencyKey).not.toBe(first.idempotencyKey);
    expect(changed.file.size).toBe(first.file.size);
    const png = await attempts.prepareUpload({ ...target, file: image("crop-B", "image/png") });
    expect(png.idempotencyKey).not.toBe(changed.idempotencyKey);
    attempts.succeeded(first);
    attempts.failed(changed, new ApiError("Rejected", 422));
    expect(await attempts.prepareUpload({ ...target, file: image("crop-B", "image/png") })).toBe(png);
  });

  it.each([401, 403, 409, 413, 415, 422])("releases a definitive %s rejection so refreshed data can start a new attempt", (status) => {
    const attempts = createMediaWriteAttempts();
    const first = attempts.prepareRemove(removal);
    attempts.failed(first, new ApiError("Rejected", status));
    const next = attempts.prepareRemove({ ...removal, expectedVersion: 5 });
    expect(next.idempotencyKey).not.toBe(first.idempotencyKey);
    expect(next.expectedVersion).toBe(5);
  });

  it.each([lostResponse(), new ApiError("Timeout", 408), new ApiError("Rate limited", 429), new ApiError("Proxy failed", 502), new SyntaxError("Truncated response")])("retains an uncertain failure: $message", (error) => {
    const attempts = createMediaWriteAttempts();
    const first = attempts.prepareRemove(removal);
    attempts.failed(first, error);
    expect(attempts.prepareRemove({ ...removal, expectedVersion: 5 })).toBe(first);
  });

  it("isolates scope, path, media kind and operation", async () => {
    const attempts = createMediaWriteAttempts();
    const first = await attempts.prepareUpload({ ...target, file: image() });
    const otherBusiness = await attempts.prepareUpload({ ...target, scopeKey: "business:2:branch:7", file: image() });
    const otherBranch = await attempts.prepareUpload({ ...target, path: "/settings/branches/8/profile", file: image() });
    const cover = await attempts.prepareUpload({ ...target, kind: "cover", file: image() });
    const remove = attempts.prepareRemove(removal);
    expect(new Set([first, otherBusiness, otherBranch, cover, remove].map((attempt) => attempt.idempotencyKey)).size).toBe(5);
    expect(await attempts.prepareUpload({ ...target, file: image() })).toBe(first);
  });

  it("clears memory on explicit discard and invalidates a pending file read", async () => {
    const attempts = createMediaWriteAttempts();
    const first = attempts.prepareRemove(removal);
    let finish!: (value: ArrayBuffer) => void;
    const file = image();
    Object.defineProperty(file, "arrayBuffer", { value: () => new Promise<ArrayBuffer>((resolve) => { finish = resolve; }) });
    const preparing = attempts.prepareUpload({ ...target, file });
    const rejection = expect(preparing).rejects.toThrow("contexto");
    attempts.clear();
    finish(new ArrayBuffer(2));
    await rejection;
    expect(attempts.prepareRemove(removal).idempotencyKey).not.toBe(first.idempotencyKey);
  });

  it("does not persist pending intents in browser storage", async () => {
    const local = vi.spyOn(Storage.prototype, "setItem");
    const attempts = createMediaWriteAttempts();
    const attempt = await attempts.prepareUpload({ ...target, file: image() });
    attempts.failed(attempt, lostResponse());
    expect(local).not.toHaveBeenCalled();
  });

  it("retains legacy random-key uploads when the optional key is omitted", async () => {
    apiMock.mockResolvedValue({ version: 5, name: "Branch" });
    const file = image();
    await uploadSettingsMedia(target.path, file, "logo", 4);
    await uploadSettingsMedia(target.path, file, "logo", 4);
    expect(apiMock.mock.calls[0][1].idempotencyKey).toBeTruthy();
    expect(apiMock.mock.calls[0][1].idempotencyKey).not.toBe(apiMock.mock.calls[1][1].idempotencyKey);
  });
});
