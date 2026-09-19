import { afterEach, describe, expect, it, vi } from "vitest";
import { subscribeBranch } from "./branch-realtime";
const mocks = vi.hoisted(() => ({ getSession: vi.fn(async () => ({ data: { session: { access_token: "test-session" } } })), unsubscribe: vi.fn() }));
vi.mock("./supabase", () => ({ supabase: { auth: { getSession: mocks.getSession, onAuthStateChange: () => ({ data: { subscription: { unsubscribe: mocks.unsubscribe } } }) } } }));
class FakeSocket {
  static sockets: FakeSocket[] = [];
  onmessage?: (message: { data: string }) => void;
  onclose?: (event: { code: number }) => void;
  close = vi.fn();
  constructor(public url: string) { FakeSocket.sockets.push(this); }
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); FakeSocket.sockets = []; });
describe("branch realtime connections", () => {
  it.each([1008, 1013])("only confirmed revocation invalidates access (socket %i)", async (code) => {
    vi.useFakeTimers(); vi.stubGlobal("WebSocket", FakeSocket);
    const invalidated = vi.fn();
    window.addEventListener("pos:access-invalidated", invalidated);
    const off = subscribeBranch({}, 1, vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    FakeSocket.sockets[0].onclose?.({ code });
    expect(invalidated).toHaveBeenCalledTimes(code === 1008 ? 1 : 0);
    off(); await vi.advanceTimersByTimeAsync(0);
    window.removeEventListener("pos:access-invalidated", invalidated);
  });
  it("shares one connection per session and branch and closes after the last subscriber", async () => {
    vi.useFakeTimers(); vi.stubGlobal("WebSocket", FakeSocket);
    const scope = {}; const one = vi.fn(); const two = vi.fn();
    const off1 = subscribeBranch(scope, 1, one);
    const off2 = subscribeBranch(scope, 1, two);
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeSocket.sockets).toHaveLength(1);
    FakeSocket.sockets[0].onmessage?.({ data: '{"event":"connected"}' });
    expect(one).not.toHaveBeenCalled();
    FakeSocket.sockets[0].onmessage?.({ data: '{"event":"order.updated"}' });
    expect(one).toHaveBeenCalledTimes(1); expect(two).toHaveBeenCalledTimes(1);
    off1(); await vi.advanceTimersByTimeAsync(0); expect(FakeSocket.sockets[0].close).not.toHaveBeenCalled();
    off2(); await vi.advanceTimersByTimeAsync(0); expect(FakeSocket.sockets[0].close).toHaveBeenCalledTimes(1);
  });
  it("never shares sessions or branches and ignores notifications after teardown", async () => {
    vi.useFakeTimers(); vi.stubGlobal("WebSocket", FakeSocket);
    const scope = {}; const callback = vi.fn();
    const off1 = subscribeBranch(scope, 1, callback);
    const off2 = subscribeBranch(scope, 2, vi.fn());
    const off3 = subscribeBranch({}, 1, vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeSocket.sockets).toHaveLength(3);
    off1(); off2(); off3(); await vi.advanceTimersByTimeAsync(0);
    FakeSocket.sockets[0].onmessage?.({ data: '{"event":"order.updated"}' });
    expect(callback).not.toHaveBeenCalled();
  });
});
