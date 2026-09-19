import { useEffect, useRef, useState } from "react";
import { Printer, X } from "lucide-react";
import { OrderPrinting, type PrintNotice } from "../lib/order-printing";
import { MANUAL_PRINT_EVENT, ORDER_PRINT_EVENT, type ManualPrintEvent, type OrderPrintEvent } from "../lib/print-events";
import "./print-notifications.css";

export function PrintNotifications({ branchId }: { branchId: number }) {
  const [notices, setNotices] = useState<PrintNotice[]>([]);
  const printer = useRef<OrderPrinting | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const printing = new OrderPrinting(branchId, controller.signal, (notice) => {
      setNotices((current) => [...current.filter((item) => item.orderId !== notice.orderId), notice]);
    });
    printer.current = printing;
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
    return () => { controller.abort(); window.removeEventListener(ORDER_PRINT_EVENT, onConfirmed); window.removeEventListener(MANUAL_PRINT_EVENT, onManual); printer.current = null; };
  }, [branchId]);

  return <aside className="print-notifications" aria-label="Estado de impresión">{notices.map((notice) => <section key={notice.orderId} className={`print-notification${notice.warning ? " is-warning" : ""}`}>
    <Printer aria-hidden="true" /><div><p role="status"><strong>{notice.folio == null ? "Impresión" : `Folio #${notice.folio}`}</strong>{notice.message}</p>{notice.retryable && <button type="button" className="button button-secondary" disabled={notice.busy} onClick={() => void printer.current?.run(notice.orderId, true)}>Reintentar impresión</button>}</div>
    {!notice.busy && <button type="button" className="icon-button" aria-label="Cerrar aviso de impresión" onClick={() => setNotices((current) => current.filter((item) => item.orderId !== notice.orderId))}><X /></button>}
  </section>)}</aside>;
}
