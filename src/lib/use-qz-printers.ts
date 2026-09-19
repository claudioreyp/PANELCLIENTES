import { useEffect, useState } from "react";
import { qzBridge, qzFailure, type QzPrinters } from "./qz-tray";
import type { QzConnectionState } from "../types/settings";

export function useQzPrinters(branchId: number, enabled: boolean) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ branchId: number; state: QzConnectionState; detail: string | null; data: QzPrinters | null }>({ branchId, state: "idle", detail: null, data: null });
  useEffect(() => {
    if (!enabled || !branchId) return;
    const controller = new AbortController();
    let timer: number | undefined;
    let busy = false;
    let retries = 0;
    let state: QzConnectionState = "idle";
    function publish(next: QzConnectionState, detail: string | null = null, data?: QzPrinters) {
      if (controller.signal.aborted) return;
      state = next;
      setResult((current) => ({ branchId, state, detail, data: data ?? (current.branchId === branchId ? current.data : null) }));
    }
    async function scan() {
      if (busy || controller.signal.aborted) return;
      window.clearTimeout(timer);
      busy = true;
      try {
        const data = await qzBridge.printers(branchId, controller.signal, (next) => publish(next));
        publish("connected", null, data);
        retries = 0;
        timer = window.setTimeout(checkConnection, 3000);
      } catch (caught) {
        if (controller.signal.aborted) return;
        const error = await qzFailure(caught);
        if (controller.signal.aborted) return;
        publish(error.state, error.message);
        // Never keep reopening denied permission prompts. Only retry transport
        // failures, with backoff and a bounded number of attempts.
        if (error.state === "not-open" && retries < 6) {
          timer = window.setTimeout(() => void scan(), Math.min(5000 * 2 ** retries++, 30_000));
        }
      } finally { busy = false; }
    }
    function checkConnection() {
      if (controller.signal.aborted) return;
      if (!qzBridge.isActive()) void scan();
      else timer = window.setTimeout(checkConnection, 3000);
    }
    function onFocus() {
      if (state === "not-open" && retries < 6) void scan();
    }
    setResult({ branchId, state: "loading", detail: null, data: null });
    void scan();
    window.addEventListener("focus", onFocus);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
      void qzBridge.disconnect();
    };
  }, [branchId, enabled, attempt]);
  const visible = enabled && result.branchId === branchId ? result : { state: "idle" as const, detail: null, data: null };
  return { ...visible, retry: () => setAttempt((current) => current + 1), busy: ["loading", "permission", "connecting"].includes(visible.state) };
}
