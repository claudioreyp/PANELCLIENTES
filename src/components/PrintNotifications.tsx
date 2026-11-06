import { useEffect, useRef, useState } from "react";
import { Check, LoaderCircle, Printer, X } from "lucide-react";
import { OrderPrinting, type PrintNotice } from "../lib/order-printing";
import { MANUAL_PRINT_EVENT, ORDER_PRINT_EVENT, type ManualPrintEvent, type OrderPrintEvent } from "../lib/print-events";
import { subscribeBranch, defaultRealtimeScope } from "../lib/branch-realtime";
import { useQuerySession } from "../lib/query-session";
import "./print-notifications.css";

export function PrintNotifications({ branchId, businessId, automatic = false }: { branchId: number; businessId?: number; automatic?: boolean }) {
  const [notices, setNotices] = useState<PrintNotice[]>([]);
  const printer = useRef<OrderPrinting | null>(null);
  const cache = useQuerySession();
  useEffect(() => {
    const controller = new AbortController();
    const printing = new OrderPrinting(branchId, controller.signal, (notice) => {
      setNotices((current) => [...current.filter((item) => item.orderId !== notice.orderId), notice]);
    }, businessId);
    printer.current = printing;
    const discover = () => { void printing.discover(); };
    const onVisible = () => { if (document.visibilityState === "visible") discover(); };
    const unsubscribe = automatic ? subscribeBranch(cache || defaultRealtimeScope, branchId, discover, true) : () => {};
    if (automatic) {
      window.addEventListener("online", discover);
      document.addEventListener("visibilitychange", onVisible);
      discover();
    }
    function onConfirmed(event: Event) {
      const detail = (event as CustomEvent<OrderPrintEvent>).detail;
      if (detail?.branchId === branchId && Number.isInteger(detail.orderId)) void printing.run(detail.orderId, detail.review, detail.version);
    }
    window.addEventListener(ORDER_PRINT_EVENT, onConfirmed);
    function onManual(event: Event) {
      const detail = (event as CustomEvent<ManualPrintEvent>).detail;
      if (detail?.branchId !== branchId) return;
      event.preventDefault();
      void printing.manual(detail).finally(detail.done);
    }
    window.addEventListener(MANUAL_PRINT_EVENT, onManual);
    return () => { controller.abort(); unsubscribe(); window.removeEventListener("online", discover); document.removeEventListener("visibilitychange", onVisible); window.removeEventListener(ORDER_PRINT_EVENT, onConfirmed); window.removeEventListener(MANUAL_PRINT_EVENT, onManual); printer.current = null; };
  }, [branchId, businessId, cache, automatic]);

  return <aside className="print-notifications" aria-label="Estado de impresión">{notices.map((notice) => <section key={notice.orderId} className={`print-notification${notice.warning ? " is-warning" : ""}`}>
    <span className="print-notification-icon"><Printer aria-hidden="true" /></span><div>
      <div className="print-notification-heading"><strong>{notice.folio == null ? "Impresión" : `Folio #${notice.folio}`}</strong><span className="print-notification-state">{notice.busy ? <LoaderCircle className="spin" aria-hidden="true" /> : !notice.warning ? <Check aria-hidden="true" /> : null}{notice.busy ? "En proceso" : notice.warning ? "Pendiente" : "Actualizado"}</span></div>
      <p role="status">{notice.message}</p>{notice.retryable && <button type="button" className="button button-secondary" disabled={notice.busy} onClick={() => void (notice.orderId ? printer.current?.run(notice.orderId, true) : printer.current?.discover())}>Reintentar impresión</button>}
    </div>
    {!notice.busy && <button type="button" className="icon-button print-notification-close" aria-label="Cerrar aviso de impresión" onClick={() => { printer.current?.dismiss(notice); setNotices((current) => current.filter((item) => item.orderId !== notice.orderId)); }}><X aria-hidden="true" /></button>}
  </section>)}</aside>;
}
