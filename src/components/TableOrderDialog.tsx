import {
  ArrowRightLeft,
  ChevronDown,
  ChevronRight,
  CircleX,
  MoreHorizontal,
  Pencil,
  Plus,
  Printer,
  ReceiptText,
  RotateCcw,
  TriangleAlert,
} from "lucide-react";
import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { DialogPortal, useDialogSurface } from "../lib/dialog";
import type { KitchenTicket, OrderDetail, RestaurantTable } from "../types";
import { Money } from "./ui";
import { OrderIdentity } from "./OrderIdentity";
import { OrderBreakdown } from "./OrderBreakdown";
import { commandBreakdown } from "./OrderCommands";
import { commandModifiedAt, modificationLabel } from "../lib/order-presentation";
import { formatPosDate } from "../lib/pos-dates";

type TableOrderDialogProps = {
  order: OrderDetail;
  table: RestaurantTable;
  checkoutMode: boolean;
  working: boolean;
  onClose: () => void;
  onStartCheckout: () => void;
  onReopenCheckout: () => void;
  onAppend: () => void;
  onEditTicket: (ticket: KitchenTicket) => void;
  onPrintAccount: () => void;
  onPrintTicket: (ticket: KitchenTicket) => void;
  onPayment: () => void;
  onTransfer: () => void;
  onCancel: (confirmed?: boolean) => void;
};

function EmptyTableWarning({
  titleId,
  working,
  onBack,
  onCancel,
}: {
  titleId: string;
  working: boolean;
  onBack: () => void;
  onCancel: () => void;
}) {
  const surfaceRef = useDialogSurface(onBack);
  return <div className="table-empty-warning-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onBack()}>
    <section ref={surfaceRef} className="table-empty-warning" role="alertdialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <h2 id={titleId}>Esta mesa no tiene productos</h2>
      <p>No hay productos por cobrar, por lo que la mesa no puede cerrarse como una venta. Cancela el pedido para liberarla.</p>
      <footer><button className="button button-secondary" data-dialog-initial-focus type="button" onClick={onBack}>Regresar</button><button className="button button-danger" type="button" disabled={working} onClick={onCancel}>Cancelar pedido</button></footer>
    </section>
  </div>;
}

function itemCount(order: OrderDetail) {
  return order.items
    .filter((item) => !["cancelled", "superseded"].includes(item.status))
    .reduce((sum, item) => sum + item.quantity, 0);
}

function tableLabel(table: RestaurantTable) {
  return /^mesa\s/i.test(table.name) ? table.name : `Mesa ${table.name}`;
}

export function TableOrderDialog({
  order,
  table,
  checkoutMode,
  working,
  onClose,
  onStartCheckout,
  onReopenCheckout,
  onAppend,
  onEditTicket,
  onPrintAccount,
  onPrintTicket,
  onPayment,
  onTransfer,
  onCancel,
}: TableOrderDialogProps) {
  const titleId = useId();
  const emptyTitleId = useId();
  const surfaceRef = useDialogSurface(onClose);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [menu, setMenu] = useState<"order" | number | null>(null);
  const [emptyWarningOpen, setEmptyWarningOpen] = useState(false);
  const [expandedTickets, setExpandedTickets] = useState<Set<number>>(
    () => new Set(checkoutMode ? order.kitchen_tickets.map((ticket) => ticket.id) : []),
  );
  const totalItems = itemCount(order);
  const paymentPending = order.payment_status !== "paid" && order.remaining_amount > 0;

  useEffect(() => {
    if (menu === null) return;

    function closeMenu(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenu(null);
    }
    document.addEventListener("mousedown", closeMenu);
    return () => document.removeEventListener("mousedown", closeMenu);
  }, [menu]);

  useEffect(() => {
    if (menu === null) return;
    const frame = window.requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
    });

    function closeMenuBeforeDialog(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      const trigger = menuTriggerRef.current;
      setMenu(null);
      window.requestAnimationFrame(() => trigger?.focus());
    }

    document.addEventListener("keydown", closeMenuBeforeDialog, true);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", closeMenuBeforeDialog, true);
    };
  }, [menu]);

  useEffect(() => {
    if (!checkoutMode) return;
    setExpandedTickets(new Set(order.kitchen_tickets.map((ticket) => ticket.id)));
  }, [checkoutMode, order.kitchen_tickets]);

  function requestCheckout() {
    setMenu(null);
    if (!totalItems) {
      setEmptyWarningOpen(true);
      return;
    }
    onStartCheckout();
  }

  function toggleTicket(ticketId: number) {
    setExpandedTickets((current) => {
      const next = new Set(current);
      if (next.has(ticketId)) next.delete(ticketId);
      else next.add(ticketId);
      return next;
    });
  }

  function toggleMenu(nextMenu: "order" | number, trigger: HTMLButtonElement) {
    menuTriggerRef.current = trigger;
    setMenu((current) => current === nextMenu ? null : nextMenu);
  }

  function handleMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'));
    if (!items.length) return;
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex: number | null = null;
    if (event.key === "ArrowDown") nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
    if (event.key === "ArrowUp") nextIndex = currentIndex < 0 ? items.length - 1 : (currentIndex - 1 + items.length) % items.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = items.length - 1;
    if (event.key === "Tab") setMenu(null);
    if (nextIndex === null) return;
    event.preventDefault();
    items[nextIndex]?.focus();
  }

  const formattedDate = formatPosDate(order.created_at, {
    day: "2-digit",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <DialogPortal>
      <div className="table-order-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !working && onClose()}>
        <section
          ref={surfaceRef}
          className={`table-order-dialog ${checkoutMode ? "checkout-mode" : ""}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-busy={working}
          aria-hidden={emptyWarningOpen || undefined}
          inert={emptyWarningOpen || undefined}
          tabIndex={-1}
        >
          <h2 id={titleId} className="visually-hidden">Cuenta de {tableLabel(table)}</h2>

          <header className="table-order-heading">
            <div className="table-order-identity">
              <span>{formattedDate}</span>
              <OrderIdentity {...order} />
            </div>
            <div className="table-order-primary-actions">
              {checkoutMode && <button className="button button-secondary" type="button" onClick={onPrintAccount} disabled={working}><Printer /> Imprimir cuenta</button>}
              <button
                className="button button-primary"
                type="button"
                data-dialog-initial-focus
                onClick={checkoutMode ? onPayment : requestCheckout}
                disabled={working || (checkoutMode && !paymentPending)}
              >
                {checkoutMode ? (paymentPending ? "Cobrar mesa" : "Mesa pagada") : "Cerrar mesa"}
              </button>
              <div className="table-order-menu-wrap" ref={menu === "order" ? menuRef : undefined}>
                <button
                  className="icon-button"
                  type="button"
                  aria-label="Acciones de la mesa"
                  aria-haspopup="menu"
                  aria-controls={`${titleId}-order-actions`}
                  aria-expanded={menu === "order"}
                  onClick={(event) => toggleMenu("order", event.currentTarget)}
                ><MoreHorizontal /></button>
                {menu === "order" && <div id={`${titleId}-order-actions`} className="table-order-menu order-actions" role="menu" aria-label="Acciones del pedido" onKeyDown={handleMenuKeyDown}>
                  <button type="button" role="menuitem" disabled={!checkoutMode || working || order.paid_amount > 0} onClick={() => { setMenu(null); onReopenCheckout(); }}><RotateCcw /> Reabrir mesa</button>
                  <button type="button" role="menuitem" disabled={working} onClick={() => { setMenu(null); onTransfer(); }}><ArrowRightLeft /> Transferir pedido</button>
                  <button className="danger" type="button" role="menuitem" disabled={working} onClick={() => { setMenu(null); onCancel(false); }}><CircleX /> Cancelar pedido</button>
                </div>}
              </div>
            </div>
          </header>

          <div className="table-order-meta">
            <strong>{totalItems} {totalItems === 1 ? "producto" : "productos"}</strong>
            <span>{tableLabel(table)}</span>
            <span>Punto de venta</span>
          </div>

          {!totalItems ? <div className="table-order-empty">
            <span><ReceiptText /></span>
            <strong>No se han agregado productos</strong>
            <p>Agrega platos para crear la primera comanda de esta mesa.</p>
            <button className="button button-secondary" type="button" onClick={onAppend} disabled={working}><Plus /> Agregar productos</button>
          </div> : <div className="table-order-ticket-list">
            {order.kitchen_tickets.map((ticket, index) => {
              const expanded = expandedTickets.has(ticket.id);
              return <article key={ticket.id} className={`table-order-ticket ${expanded ? "expanded" : ""}`}>
                <header>
                  <button type="button" className="table-order-ticket-toggle" aria-expanded={expanded} onClick={() => toggleTicket(ticket.id)}>
                    {expanded ? <ChevronDown /> : <ChevronRight />}
                    <span><strong>Comanda #{ticket.sequence ?? index + 1}</strong><small>{formatPosDate(ticket.created_at, { hour: "numeric", minute: "2-digit" })} · {ticket.created_by_name ? `Por ${ticket.created_by_name}` : "Punto de venta"}</small></span>
                  </button>
                  <div className="table-order-menu-wrap" ref={menu === ticket.id ? menuRef : undefined}>
                    <button
                      className="icon-button"
                      type="button"
                      aria-label={`Acciones de la comanda ${ticket.sequence ?? index + 1}`}
                      aria-haspopup="menu"
                      aria-controls={`${titleId}-ticket-${ticket.id}-actions`}
                      aria-expanded={menu === ticket.id}
                      onClick={(event) => toggleMenu(ticket.id, event.currentTarget)}
                    ><MoreHorizontal /></button>
                    {menu === ticket.id && <div id={`${titleId}-ticket-${ticket.id}-actions`} className="table-order-menu command-actions" role="menu" aria-label={`Acciones de la comanda ${ticket.sequence ?? index + 1}`} onKeyDown={handleMenuKeyDown}>
                      <strong className="table-order-menu-title">Acciones</strong>
                      <button type="button" role="menuitem" disabled={working || checkoutMode} onClick={() => { setMenu(null); onEditTicket(ticket); }}><Pencil /> Editar productos</button>
                      <button type="button" role="menuitem" disabled={working} onClick={() => { setMenu(null); onPrintTicket(ticket); }}><Printer /> Imprimir comanda</button>
                    </div>}
                  </div>
                </header>
                {expanded && <div className="table-order-ticket-items">
                  {ticket.status === "ready" && <span className="table-order-ticket-status">Preparado</span>}
                  {commandModifiedAt(ticket) && <p className="command-card-modified"><TriangleAlert aria-hidden="true" />{modificationLabel(commandModifiedAt(ticket)!)}</p>}
                  <OrderBreakdown lines={commandBreakdown(ticket, order.items)} />
                </div>}
              </article>;
            })}
            {!order.kitchen_tickets.length && <div className="table-order-ticket-pending"><span><ReceiptText /></span><strong>Preparando la comanda...</strong><p>Estamos sincronizando el pedido con cocina.</p></div>}
          </div>}

          {!checkoutMode && totalItems > 0 && <button className="button button-secondary table-order-add" type="button" onClick={onAppend} disabled={working}><Plus /> Agregar productos</button>}

          {checkoutMode && <footer className="table-order-total"><span>Total:</span><strong><Money value={order.total} /></strong></footer>}
        </section>
      </div>

      {emptyWarningOpen && <EmptyTableWarning titleId={emptyTitleId} working={working} onBack={() => setEmptyWarningOpen(false)} onCancel={() => { setEmptyWarningOpen(false); onCancel(true); }} />}
    </DialogPortal>
  );
}
