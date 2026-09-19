import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsResource } from "./SettingsState";
import { ApiError } from "../../lib/api";

const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
vi.mock("../../lib/settings", async (original) => ({
  ...await original<typeof import("../../lib/settings")>(),
  loadSettings: mocks.load, saveSettings: mocks.save,
}));
type Data = { name: string; logo: string; version: number };
const initial: Data = { name: "Branch A", logo: "old.png", version: 1 };
const resultOf = (data: Data) => ({ data, available: true, message: null });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
async function ready() {
  mocks.load.mockResolvedValueOnce(resultOf(initial));
  const view = renderHook(({ path }) => useSettingsResource(path, initial), { initialProps: { path: "/branch/a" } });
  await waitFor(() => expect(view.result.current.available).toBe(true));
  return view;
}
beforeEach(() => { mocks.load.mockReset(); mocks.save.mockReset(); });
afterEach(cleanup);

describe("independent verified settings patches", () => {
  it("saves only its patch and keeps an unrelated draft and its baseline", async () => {
    const { result } = await ready();
    act(() => result.current.setData({ ...initial, name: "Unsaved name" }));
    const saved = { ...initial, logo: "new.png", version: 2 };
    mocks.save.mockResolvedValueOnce(saved);
    mocks.load.mockResolvedValueOnce(resultOf(saved));
    await act(async () => { expect(await result.current.savePatch({ logo: "new.png" })).toBe(true); });
    expect(mocks.save.mock.calls[0][1]).toEqual({ ...saved, version: 1, expected_version: 1 });
    expect(result.current.data).toEqual({ ...saved, name: "Unsaved name" });
    expect(result.current.dirty).toBe(true);
    act(() => result.current.reset());
    expect(result.current.data).toEqual(saved);
  });

  it("verifies an uncertain write without writing twice", async () => {
    const { result } = await ready();
    mocks.save.mockRejectedValueOnce(new Error("Connection lost"));
    const saved = { ...initial, name: "Confirmed", version: 2 };
    mocks.load.mockResolvedValueOnce(resultOf(saved));
    await act(async () => { expect(await result.current.savePatch({ name: "Confirmed" })).toBe(true); });
    expect(result.current.data).toEqual(saved);
    expect(result.current.error).toBeNull();
    expect(mocks.save).toHaveBeenCalledOnce();
  });

  it("retains the idempotency key while both write and verification are uncertain", async () => {
    const { result } = await ready();
    mocks.save.mockRejectedValueOnce(new Error("Connection lost"));
    mocks.load.mockRejectedValueOnce(new Error("Offline"));
    await act(async () => { expect(await result.current.savePatch({ name: "Updated" })).toBe(false); });
    const key = mocks.save.mock.calls[0][3];
    expect(typeof key).toBe("string");
    const saved = { ...initial, name: "Updated", version: 2 };
    mocks.save.mockResolvedValueOnce(saved);
    mocks.load.mockResolvedValueOnce(resultOf(saved));
    await act(async () => { expect(await result.current.savePatch({ name: "Updated" })).toBe(true); });
    expect(mocks.save.mock.calls[1][3]).toBe(key);
  });

  it("retries only verification after an acknowledged write", async () => {
    const { result } = await ready();
    const saved = { ...initial, name: "Updated", version: 2 };
    mocks.save.mockResolvedValueOnce(saved);
    mocks.load.mockRejectedValueOnce(new Error("Offline")).mockRejectedValueOnce(new Error("Offline"));
    await act(async () => { expect(await result.current.savePatch({ name: "Updated" })).toBe(false); });
    expect(result.current.data).toEqual(saved);
    expect(result.current.savedMessage).toBeNull();
    mocks.load.mockResolvedValueOnce(resultOf(saved));
    await act(async () => { expect(await result.current.savePatch({ name: "Updated" })).toBe(true); });
    expect(mocks.save).toHaveBeenCalledOnce();
  });

  it("does not claim success when the API drops requested fields", async () => {
    const { result } = await ready();
    mocks.save.mockResolvedValueOnce({ ...initial, version: 2 });
    mocks.load.mockResolvedValueOnce(resultOf({ ...initial, version: 2 }));
    await act(async () => { expect(await result.current.savePatch({ name: "Requested" })).toBe(false); });
    expect(result.current.data.name).toBe(initial.name);
    expect(result.current.error).toContain("API");
    expect(result.current.savedMessage).toBeNull();
  });

  it("keeps the last confirmed settings after a definite rejection", async () => {
    const { result } = await ready();
    mocks.save.mockRejectedValueOnce(new ApiError("Forbidden", 403));
    await act(async () => { expect(await result.current.savePatch({ name: "No access" })).toBe(false); });
    expect(result.current.data).toEqual(initial);
    expect(mocks.load).toHaveBeenCalledOnce();
  });

  it("ignores the old branch verification after a branch change", async () => {
    const { result, rerender } = await ready();
    const saved = { ...initial, name: "Updated A", version: 2 };
    const read = deferred<ReturnType<typeof resultOf>>();
    mocks.save.mockResolvedValueOnce(saved);
    mocks.load.mockReturnValueOnce(read.promise);
    let pending!: Promise<boolean>;
    await act(async () => { pending = result.current.savePatch({ name: "Updated A" }); });
    const other = { name: "Branch B", logo: "b.png", version: 4 };
    mocks.load.mockResolvedValueOnce(resultOf(other));
    rerender({ path: "/branch/b" });
    await waitFor(() => expect(result.current.data).toEqual(other));
    await act(async () => { read.resolve(resultOf(saved)); expect(await pending).toBe(false); });
    expect(result.current.data).toEqual(other);
    expect(result.current.error).toBeNull();
  });

  it("does not replace a confirmed baseline with an older verification", async () => {
    const { result } = await ready();
    mocks.load.mockResolvedValue(resultOf({ ...initial, version: 0 }));
    await act(async () => { expect(await result.current.savePatch({ name: initial.name })).toBe(false); });
    expect(result.current.data).toEqual(initial);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(result.current.savedMessage).toBeNull();
  });
});
