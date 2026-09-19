import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsStateProvider, useSettingsQuery, useSettingsResource } from "./SettingsState";

const loadMock = vi.hoisted(() => vi.fn());
const saveMock = vi.hoisted(() => vi.fn());
vi.mock("../../lib/settings", async (importOriginal) => ({ ...await importOriginal<typeof import("../../lib/settings")>(), loadSettings: loadMock, saveSettings: saveMock }));

type Data = { name: string; version: number; logo?: string };
const fallback: Data = { name: "", version: 0 };
const dataA: Data = { name: "Sucursal A", version: 1 };
const dataB: Data = { name: "Sucursal B", version: 5 };
const loaded = (data: Data) => ({ data, available: true, message: null });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function settle<T>(request: ReturnType<typeof deferred<T>>, value: T) {
  await act(async () => { request.resolve(value); await request.promise; });
}

beforeEach(() => { loadMock.mockReset(); saveMock.mockReset(); });
afterEach(cleanup);

describe.each(["resource", "query"] as const)("%s request identities", (kind) => {
  const useSubject = kind === "resource" ? useSettingsResource<Data> : useSettingsQuery<Data>;

  it("ignores path A when B has already resolved", async () => {
    const a = deferred<ReturnType<typeof loaded>>();
    const b = deferred<ReturnType<typeof loaded>>();
    loadMock.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const { result, rerender } = renderHook(({ path }) => useSubject(path, fallback), { initialProps: { path: "/a" } });
    rerender({ path: "/b" });
    await settle(b, loaded(dataB));
    await settle(a, loaded(dataA));
    expect(result.current.data).toEqual(dataB);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("does not let an obsolete error end the current loading state", async () => {
    const a = deferred<ReturnType<typeof loaded>>();
    const b = deferred<ReturnType<typeof loaded>>();
    loadMock.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const { result, rerender } = renderHook(({ path }) => useSubject(path, fallback), { initialProps: { path: "/a" } });
    rerender({ path: "/b" });
    await act(async () => { a.reject(new Error("Old request failed")); });
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();
    await settle(b, loaded(dataB));
    expect(result.current.data).toEqual(dataB);
  });

  it("uses the latest request even for the same path", async () => {
    loadMock.mockResolvedValueOnce(loaded(dataA));
    const { result } = renderHook(() => useSubject("/same", fallback));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const first = deferred<ReturnType<typeof loaded>>();
    const second = deferred<ReturnType<typeof loaded>>();
    loadMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    act(() => { void result.current.reload(); void result.current.reload(); });
    await settle(second, loaded(dataB));
    await settle(first, loaded(dataA));
    expect(result.current.data).toEqual(dataB);
  });

  it("isolates businesses even when the endpoint path is unchanged", async () => {
    let scopeKey = "business-A:7";
    const onRegistration = vi.fn();
    const wrapper = ({ children }: { children: ReactNode }) => <SettingsStateProvider scopeKey={scopeKey} onRegistration={onRegistration}>{children}</SettingsStateProvider>;
    const a = deferred<ReturnType<typeof loaded>>();
    const b = deferred<ReturnType<typeof loaded>>();
    loadMock.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const { result, rerender } = renderHook(() => useSubject("/settings/business", fallback), { wrapper });
    const obsoleteReload = result.current.reload;
    scopeKey = "business-B:7";
    rerender();
    await settle(b, loaded(dataB));
    await settle(a, loaded(dataA));
    await act(async () => { await obsoleteReload(); });
    expect(loadMock).toHaveBeenCalledTimes(2);
    expect(result.current.data).toEqual(dataB);
  });

  it("rejects the abandoned StrictMode mount's response", async () => {
    const first = deferred<ReturnType<typeof loaded>>();
    const current = deferred<ReturnType<typeof loaded>>();
    loadMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(current.promise);
    const { result } = renderHook(() => useSubject("/same", fallback), { reactStrictMode: true });
    expect(loadMock).toHaveBeenCalledTimes(2);
    await settle(current, loaded(dataB));
    await settle(first, loaded(dataA));
    expect(result.current.data).toEqual(dataB);
  });

  it("invalidates pending reads and captured callbacks on unmount", async () => {
    const pending = deferred<ReturnType<typeof loaded>>();
    loadMock.mockReturnValueOnce(pending.promise);
    const { result, unmount } = renderHook(() => useSubject("/a", fallback));
    const snapshot = result.current;
    unmount();
    await settle(pending, loaded(dataA));
    await act(async () => { await snapshot.reload(); snapshot.setData(dataB); });
    expect(result.current).toBe(snapshot);
    expect(loadMock).toHaveBeenCalledTimes(1);
  });
});

describe("resource drafts and mutations", () => {
  async function ready() {
    loadMock.mockResolvedValueOnce(loaded(dataA));
    const view = renderHook(({ path }) => useSettingsResource(path, fallback), { initialProps: { path: "/a" } });
    await waitFor(() => expect(view.result.current.available).toBe(true));
    return view;
  }

  it("preserves both draft and baseline when an earlier read arrives after editing", async () => {
    const { result } = await ready();
    const read = deferred<ReturnType<typeof loaded>>();
    loadMock.mockReturnValueOnce(read.promise);
    act(() => { void result.current.reload(); result.current.setData({ ...dataA, name: "Borrador" }); });
    await settle(read, loaded({ name: "Server update", version: 2 }));
    expect(result.current.data.name).toBe("Borrador");
    expect(result.current.dirty).toBe(true);
    act(() => result.current.reset());
    expect(result.current.data).toEqual(dataA);
  });

  it("preserves a dirty old path but refuses to write it to a new path until reset is explicit", async () => {
    const { result, rerender } = await ready();
    act(() => result.current.setData({ ...dataA, name: "Borrador A" }));
    const oldSave = result.current.save;
    rerender({ path: "/b" });
    expect(result.current.data.name).toBe("Borrador A");
    expect(result.current.available).toBe(false);
    expect(result.current.notice).toContain("borrador anterior");
    await act(async () => {
      expect(await result.current.save()).toBe(false);
      expect(await oldSave()).toBe(false);
      await result.current.reload();
    });
    expect(loadMock).toHaveBeenCalledTimes(1);
    expect(saveMock).not.toHaveBeenCalled();
    loadMock.mockResolvedValueOnce(loaded(dataB));
    act(() => result.current.reset());
    await waitFor(() => expect(result.current.data).toEqual(dataB));
    expect(result.current.dirty).toBe(false);
  });

  it("does not let a read overwrite a confirmed mutation or its version", async () => {
    const { result } = await ready();
    const read = deferred<ReturnType<typeof loaded>>();
    loadMock.mockReturnValueOnce(read.promise);
    act(() => { void result.current.reload(); result.current.setData({ ...dataA, name: "Guardado" }); });
    const saved = { name: "Guardado", version: 2 };
    saveMock.mockResolvedValueOnce(saved);
    await act(async () => { expect(await result.current.save()).toBe(true); });
    await settle(read, loaded(dataA));
    expect(result.current.data).toEqual(saved);
    expect(result.current.dirty).toBe(false);
    expect(result.current.savedMessage).not.toBeNull();
    loadMock.mockResolvedValueOnce(loaded(dataA));
    await act(async () => { await result.current.reload(); });
    expect(result.current.data).toEqual(saved);
    act(() => result.current.setData({ ...saved, name: "Otra edición" }));
    saveMock.mockResolvedValueOnce({ name: "Otra edición", version: 3 });
    await act(async () => { await result.current.save(); });
    expect(saveMock.mock.calls[1][1].expected_version).toBe(2);
  });

  it("does not issue reloads while dirty or saving, and does not discard edits made during a save", async () => {
    const { result } = await ready();
    const write = deferred<Data>();
    saveMock.mockReturnValueOnce(write.promise);
    act(() => result.current.setData({ ...dataA, name: "Primera edición" }));
    let saving!: Promise<boolean>;
    await act(async () => {
      await result.current.reload();
      saving = result.current.save();
      await result.current.reload();
      expect(await result.current.save()).toBe(false);
    });
    act(() => result.current.setData({ ...dataA, name: "Edición posterior" }));
    await settle(write, { name: "Primera edición", version: 2 });
    expect(await saving).toBe(false);
    expect(result.current.data).toEqual({ name: "Edición posterior", version: 2 });
    expect(result.current.dirty).toBe(true);
    expect(loadMock).toHaveBeenCalledTimes(1);
    expect(saveMock).toHaveBeenCalledTimes(1);
    act(() => result.current.reset());
    expect(result.current.data).toEqual({ name: "Primera edición", version: 2 });
  });

  it.each(["success", "failure"])("ignores a late mutation %s without releasing the new scope's saving lock", async (outcome) => {
    const { result, rerender } = await ready();
    const a = deferred<Data>();
    const b = deferred<Data>();
    saveMock.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    act(() => result.current.setData({ ...dataA, name: "Edición A" }));
    let saveA!: Promise<boolean>;
    act(() => { saveA = result.current.save(); });
    rerender({ path: "/b" });
    loadMock.mockResolvedValueOnce(loaded(dataB));
    act(() => result.current.reset());
    await waitFor(() => expect(result.current.data).toEqual(dataB));
    act(() => result.current.setData({ ...dataB, name: "Edición B" }));
    let saveB!: Promise<boolean>;
    act(() => { saveB = result.current.save(); });
    await act(async () => {
      if (outcome === "success") a.resolve({ name: "Edición A", version: 2 });
      else a.reject(new Error("Old write failed"));
      expect(await saveA).toBe(false);
    });
    expect(result.current.data.name).toBe("Edición B");
    expect(result.current.saving).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.savedMessage).toBeNull();
    await settle(b, { name: "Edición B", version: 6 });
    expect(await saveB).toBe(true);
    expect(result.current.data.version).toBe(6);
    expect(result.current.saving).toBe(false);
  });

  it("returns false for a mutation resolved after unmount", async () => {
    const { result, unmount } = await ready();
    const write = deferred<Data>();
    saveMock.mockReturnValueOnce(write.promise);
    act(() => result.current.setData({ ...dataA, name: "Edición A" }));
    let saving!: Promise<boolean>;
    act(() => { saving = result.current.save(); });
    unmount();
    await settle(write, { name: "Edición A", version: 2 });
    expect(await saving).toBe(false);
  });

  it("protects confirmed media fields from a pending read and from older media responses", async () => {
    const { result } = await ready();
    const read = deferred<ReturnType<typeof loaded>>();
    loadMock.mockReturnValueOnce(read.promise);
    act(() => { void result.current.reload(); result.current.acceptSavedFields({ ...dataA, logo: "new.png", version: 3 }, ["logo"]); });
    await settle(read, loaded({ ...dataA, logo: "old.png", version: 2 }));
    act(() => result.current.acceptSavedFields({ ...dataA, logo: "old.png", version: 2 }, ["logo"]));
    expect(result.current.data).toEqual({ ...dataA, logo: "new.png", version: 3 });
    expect(result.current.dirty).toBe(false);
  });
});

describe("query mutation refreshes", () => {
  it("does not overwrite a locally confirmed mutation with an older read", async () => {
    loadMock.mockResolvedValueOnce(loaded(dataA));
    const { result } = renderHook(() => useSettingsQuery("/a", fallback));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const old = deferred<ReturnType<typeof loaded>>();
    const latest = deferred<ReturnType<typeof loaded>>();
    loadMock.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
    act(() => { void result.current.reload(); result.current.setData(dataB); void result.current.reload(true); });
    await settle(latest, loaded(dataB));
    await settle(old, loaded(dataA));
    expect(result.current.data).toEqual(dataB);
  });
});
