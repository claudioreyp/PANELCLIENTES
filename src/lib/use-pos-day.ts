import { useEffect, useState } from "react";
import { nextPosMidnight, posDayKey } from "./pos-day";

export function usePosDay(): string {
  const [day, setDay] = useState(() => posDayKey());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    function schedule() {
      clearTimeout(timer);
      timer = setTimeout(sync, Math.max(1, nextPosMidnight() - Date.now()));
    }
    function sync() { setDay(posDayKey()); schedule(); }
    function onVisible() { if (document.visibilityState === "visible") sync(); }
    sync();
    window.addEventListener("focus", sync);
    window.addEventListener("pageshow", sync);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", sync);
      window.removeEventListener("pageshow", sync);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return day;
}
