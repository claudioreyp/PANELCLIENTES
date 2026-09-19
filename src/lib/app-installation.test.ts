import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAppInstallation, installationInstructions, type InstallPromptEvent } from "./app-installation";

function promptEvent(outcome: "accepted" | "dismissed" = "accepted") {
  return Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
    prompt: vi.fn(async () => {}), userChoice: Promise.resolve({ outcome }),
  }) as InstallPromptEvent & { prompt: ReturnType<typeof vi.fn> };
}

describe("page-lifetime app installation", () => {
  let store: ReturnType<typeof createAppInstallation>;
  let media: EventTarget & { matches: boolean };
  beforeEach(() => {
    media = Object.assign(new EventTarget(), { matches: false });
    vi.stubGlobal("matchMedia", vi.fn(() => media));
    store = createAppInstallation(window);
    store.start();
  });
  afterEach(() => { store.dispose(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("captures an event before a subscriber mounts and never prompts automatically", async () => {
    const event = promptEvent();
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(event.prompt).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toEqual({ status: "available", canPrompt: true });
    const subscriber = vi.fn();
    const unsubscribe = store.subscribe(subscriber);
    await store.install();
    expect(subscriber).toHaveBeenCalled();
    unsubscribe();
    expect(store.getSnapshot().status).toBe("accepted");
  });

  it("survives navigation/unsubscription and calls prompt synchronously only once", async () => {
    const event = promptEvent();
    window.dispatchEvent(event);
    store.subscribe(() => {})();
    const first = store.install();
    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toEqual({ status: "prompting", canPrompt: false });
    await store.install();
    await first;
    await store.install();
    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toEqual({ status: "accepted", canPrompt: false });
  });

  it("requires appinstalled rather than an accepted choice to confirm success", async () => {
    window.dispatchEvent(promptEvent());
    await store.install();
    expect(store.getSnapshot().status).toBe("accepted");
    window.dispatchEvent(new Event("appinstalled"));
    expect(store.getSnapshot()).toEqual({ status: "installed", canPrompt: false });
    window.dispatchEvent(promptEvent());
    expect(store.getSnapshot().status).toBe("installed");
  });

  it("consumes a dismissed event and allows a fresh browser event", async () => {
    const event = promptEvent("dismissed");
    window.dispatchEvent(event);
    await store.install();
    expect(store.getSnapshot()).toEqual({ status: "dismissed", canPrompt: false });
    await store.install();
    expect(event.prompt).toHaveBeenCalledTimes(1);
    const fresh = promptEvent();
    window.dispatchEvent(fresh);
    expect(store.getSnapshot().canPrompt).toBe(true);
    await store.install();
    expect(fresh.prompt).toHaveBeenCalledTimes(1);
  });

  it.each(["sync", "async", "choice"])("recovers after a %s failure without reusing its event", async (kind) => {
    const event = promptEvent();
    if (kind === "sync") event.prompt.mockImplementation(() => { throw Error("private internal details"); });
    if (kind === "async") event.prompt.mockRejectedValue(Error("not available"));
    if (kind === "choice") event.userChoice = Promise.reject(Error("choice failure"));
    window.dispatchEvent(event);
    await store.install();
    expect(store.getSnapshot()).toEqual({ status: "error", canPrompt: false });
    window.dispatchEvent(promptEvent());
    await store.install();
    expect(store.getSnapshot().status).toBe("accepted");
  });

  it("does not overwrite confirmation with a late choice", async () => {
    let choose!: (value: { outcome: "dismissed" }) => void;
    const event = promptEvent();
    event.userChoice = new Promise((resolve) => { choose = resolve; });
    window.dispatchEvent(event);
    const attempt = store.install();
    window.dispatchEvent(new Event("appinstalled"));
    choose({ outcome: "dismissed" });
    await attempt;
    expect(store.getSnapshot().status).toBe("installed");
  });

  it("retains a replacement event arriving during an in-flight request", async () => {
    let choose!: (value: { outcome: "dismissed" }) => void;
    const event = promptEvent();
    event.userChoice = new Promise((resolve) => { choose = resolve; });
    window.dispatchEvent(event);
    const attempt = store.install();
    const fresh = promptEvent();
    window.dispatchEvent(fresh);
    await store.install();
    expect(fresh.prompt).not.toHaveBeenCalled();
    choose({ outcome: "dismissed" });
    await attempt;
    expect(store.getSnapshot().canPrompt).toBe(true);
    await store.install();
    expect(fresh.prompt).toHaveBeenCalledTimes(1);
  });

  it("detects standalone on startup and mode changes without persistent flags", () => {
    const storage = vi.spyOn(Storage.prototype, "setItem");
    media.matches = true;
    media.dispatchEvent(new Event("change"));
    expect(store.getSnapshot().status).toBe("installed");
    const newStore = createAppInstallation(window);
    newStore.start();
    expect(newStore.getSnapshot().status).toBe("installed");
    newStore.dispose();
    media.matches = false;
    media.dispatchEvent(new Event("change"));
    expect(store.getSnapshot().status).toBe("unavailable");
    expect(storage).not.toHaveBeenCalled();
  });

  it("detects iOS standalone on pageshow", () => {
    Object.defineProperty(navigator, "standalone", { configurable: true, value: true });
    window.dispatchEvent(new Event("pageshow"));
    expect(store.getSnapshot().status).toBe("installed");
    Reflect.deleteProperty(navigator, "standalone");
  });

  it("starts idempotently and disposes listeners and late outcomes", async () => {
    let choose!: (value: { outcome: "accepted" }) => void;
    const event = promptEvent();
    event.userChoice = new Promise((resolve) => { choose = resolve; });
    store.start();
    window.dispatchEvent(event);
    const attempt = store.install();
    store.dispose();
    choose({ outcome: "accepted" });
    await attempt;
    window.dispatchEvent(promptEvent());
    window.dispatchEvent(new Event("appinstalled"));
    expect(store.getSnapshot()).toEqual({ status: "unavailable", canPrompt: false });
  });
});

describe("installation fallback instructions", () => {
  it.each([
    ["Mozilla Chrome/140 Edg/140", 0, "Microsoft Edge"],
    ["Mozilla Chrome/140", 0, "Google Chrome"],
    ["Mozilla Android Chrome/140", 5, "Android"],
    ["Mozilla iPhone Safari", 5, "iPhone o iPad"],
    ["Mozilla Macintosh Safari", 5, "iPhone o iPad"],
    ["Mozilla Macintosh Safari", 0, "Dock en Safari"],
    ["Firefox/140", 0, "tu navegador"],
  ])("explains the fallback for %s", (userAgent, maxTouchPoints, title) => {
    expect(installationInstructions({ userAgent, maxTouchPoints, secure: true }).title).toContain(title);
  });
  it("does not advertise installation from insecure remote HTTP", () => {
    const instructions = installationInstructions({ userAgent: "Chrome Edg/140", maxTouchPoints: 0, secure: false });
    expect(instructions.title).toContain("conexión segura");
    expect(instructions.steps.join()).toContain("HTTPS");
  });
});
