import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type TestWindow = Window & { google?: unknown; __posGoogleMapsReady?: () => void; gm_authFailure?: () => void };
const host = window as TestWindow;
describe("Google Maps loader", () => {
  beforeEach(() => { vi.resetModules(); vi.stubEnv("VITE_GOOGLE_MAPS_BROWSER_KEY", "test-browser-key"); });
  afterEach(() => {
    document.querySelectorAll('script[src^="https://maps.googleapis.com/maps/api/js"]').forEach((script) => script.remove());
    delete host.google; delete host.__posGoogleMapsReady; delete host.gm_authFailure;
    vi.unstubAllEnvs(); vi.useRealTimers();
  });
  it("does not request a fake map when no key is configured", async () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_BROWSER_KEY", "");
    const { loadGoogleMaps } = await import("./google-map");
    await expect(loadGoogleMaps()).rejects.toMatchObject({ kind: "missing-key" });
    expect(document.querySelector('script[src*="maps.googleapis.com"]')).toBeNull();
  });
  it("shares an asynchronous SDK request", async () => {
    const { loadGoogleMaps } = await import("./google-map");
    const first = loadGoogleMaps(); expect(loadGoogleMaps()).toBe(first);
    const maps = { Map: class {} }; host.google = { maps }; host.__posGoogleMapsReady?.();
    await expect(first).resolves.toBe(maps);
    expect(document.querySelectorAll('script[src*="maps.googleapis.com"]')).toHaveLength(1);
  });
  it("recovers from a failed download without hanging", async () => {
    const { loadGoogleMaps } = await import("./google-map");
    const first = loadGoogleMaps();
    const rejected = expect(first).rejects.toMatchObject({ kind: "connection" });
    document.querySelector('script[src*="maps.googleapis.com"]')!.dispatchEvent(new Event("error"));
    await rejected;
    const second = loadGoogleMaps();
    host.google = { maps: { Map: class {} } }; host.__posGoogleMapsReady?.();
    await expect(second).resolves.toHaveProperty("Map");
  });
  it("does not call an unauthorized cached SDK successful on retry", async () => {
    const { loadGoogleMaps } = await import("./google-map");
    const first = loadGoogleMaps(); host.google = { maps: { Map: class {} } }; host.__posGoogleMapsReady?.(); await first;
    host.gm_authFailure?.();
    await expect(loadGoogleMaps()).rejects.toMatchObject({ kind: "authorization" });
  });
  it("times out and clears the pending load", async () => {
    vi.useFakeTimers();
    const { loadGoogleMaps } = await import("./google-map");
    const rejected = expect(loadGoogleMaps()).rejects.toThrow("No se pudo cargar");
    await vi.advanceTimersByTimeAsync(15000); await rejected;
    expect(document.querySelector('script[src*="maps.googleapis.com"]')).toBeNull();
  });
});
