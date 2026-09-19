import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Expand,
  History,
  Minimize,
  RotateCcw,
  TriangleAlert,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../lib/api";
import { useBranchRealtime } from "../lib/hooks";
import { useQuery } from "../lib/query-session";
import { commandModifiedAt, modificationLabel as modifiedLabel } from "../lib/order-presentation";
import { formatPosDate, parsePosDate } from "../lib/pos-dates";
import type { KitchenCommandResponse, KitchenTicket } from "../types";
import { EmptyState, ErrorState, LoadingState } from "./ui";
import { OrderBreakdown } from "./OrderBreakdown";
import { commandBreakdown } from "./OrderCommands";
import { OrderIdentity } from "./OrderIdentity";
import "./digital-command-board.css";

type CommandView = "active" | "history";
type TimerTone = "normal" | "warning" | "critical";

export type DigitalCommandBoardProps = {
  branchId?: number;
  pollIntervalMs?: number;
  className?: string;
};

type CommandResource = {
  branchId: number;
  page: number;
  view: CommandView;
  response: KitchenCommandResponse;
};

const PAGE_SIZE = 12;

function errorMessage(caught: unknown, fallback: string) {
  return caught instanceof Error && caught.message ? caught.message : fallback;
}

export function elapsedSeconds(createdAt: string, endAt: number) {
  const startedAt = parsePosDate(createdAt).getTime();
  if (!Number.isFinite(startedAt) || !Number.isFinite(endAt)) return null;
  return Math.max(0, Math.floor((endAt - startedAt) / 1000));
}

export function formatCommandElapsed(totalSeconds: number | null) {
  if (totalSeconds == null) return "--:--";
  if (totalSeconds >= 100 * 60) return "+99 mins";
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  return `${totalMinutes}:${String(seconds).padStart(2, "0")}`;
}

export function commandTimerTone(totalSeconds: number | null): TimerTone {
  if (totalSeconds != null && totalSeconds >= 20 * 60) return "critical";
  if (totalSeconds != null && totalSeconds >= 10 * 60) return "warning";
  return "normal";
}

function sourceLabel(source?: string | null) {
  const labels: Record<string, string> = {
    pos: "punto de venta",
    manual: "punto de venta",
    whatsapp: "WhatsApp",
    digital_menu: "menú digital",
    online: "menú digital",
    public_store: "menú digital",
    agent: "WhatsApp",
    whatsapp_agent: "WhatsApp",
    integration: "integración",
    n8n: "WhatsApp",
  };
  return labels[source || ""] || "punto de venta";
}

function ticketContext(ticket: KitchenTicket) {
  if (ticket.table_name) {
    return /^mesa\s/i.test(ticket.table_name) ? ticket.table_name : `Mesa ${ticket.table_name}`;
  }
  const channels: Record<string, string> = {
    counter: "En el local",
    takeaway: "Para llevar",
    delivery: "Domicilio",
    dine_in: "Mesa",
    online: "Menú digital",
  };
  return channels[ticket.channel || ""] || "Punto de venta";
}

function formatCreatedAt(value: string) {
  return formatPosDate(value, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function CommandToast({
  message,
  tone,
  onDismiss,
}: {
  message: string;
  tone: "success" | "error";
  onDismiss: () => void;
}) {
  return (
    <div className={`toast toast-${tone}`} role={tone === "error" ? "alert" : "status"}>
      <span>{message}</span>
      <button type="button" onClick={onDismiss} aria-label="Cerrar notificación">
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}

export function CommandCard({
  ticket,
  view,
  now,
  pending,
  blocked = false,
  onAction,
}: {
  ticket: KitchenTicket;
  view: CommandView;
  now: number;
  pending: boolean;
  blocked?: boolean;
  onAction: (ticket: KitchenTicket) => void;
}) {
  const timerEnd = view === "history" && ticket.ready_at
    ? parsePosDate(ticket.ready_at).getTime()
    : now;
  const seconds = elapsedSeconds(ticket.created_at || ticket.fired_at || "", timerEnd);
  const formattedTimer = formatCommandElapsed(seconds);
  const tone = commandTimerTone(seconds);
  const modifiedAt = commandModifiedAt(ticket);
  const corrected = Boolean(modifiedAt);

  return (
    <article className={`command-card command-card-${tone} ${corrected ? "command-card-corrected" : ""}`}>
      <header className="command-card-heading">
        <div className="command-card-reference">
          <OrderIdentity folio={ticket.order_folio} number={ticket.order_number} mode="folio" />
          <span>Comanda #{ticket.sequence || 1}</span>
        </div>
        <span className={`command-card-context context-${ticket.channel || "counter"}`}>{ticketContext(ticket)}</span>
      </header>

      <div className="command-card-customer">
        <strong>{ticket.customer_name || "Sin nombre"}</strong>
        <small>{ticket.created_by_name ? `Tomado por ${ticket.created_by_name}` : `Origen: ${sourceLabel(ticket.source)}`}</small>
      </div>

      <div className="command-card-clock">
        <time dateTime={ticket.created_at}>{formatCreatedAt(ticket.created_at)}</time>
        <span
          className={`command-timer command-timer-${tone}`}
          role="timer"
          data-urgency={tone}
          aria-label={seconds == null ? "Tiempo de preparación no disponible" : `Tiempo de preparación: ${Math.floor(seconds / 60)} minutos y ${seconds % 60} segundos`}
        >
          {formattedTimer}
        </span>
      </div>

      {corrected && (
        <div className="command-card-modified">
          <TriangleAlert aria-hidden="true" />
          <span>{modifiedAt && modifiedLabel(modifiedAt, now)}</span>
        </div>
      )}

      <div className="command-card-items">
        <OrderBreakdown lines={commandBreakdown(ticket)} showPrices={false} />
      </div>

      <button
        className={view === "active" ? "button button-primary command-card-action" : "button button-secondary command-card-action"}
        type="button"
        data-command-action
        disabled={pending || blocked}
        onClick={() => onAction(ticket)}
      >
        {view === "history" && <RotateCcw aria-hidden="true" />}
        {pending ? "Guardando..." : view === "active" ? "Completar comanda" : "Devolver a preparación"}
      </button>
    </article>
  );
}

export function DigitalCommandBoard(props: DigitalCommandBoardProps) {
  return <BranchCommandBoard key={props.branchId ?? "no-branch"} {...props} />;
}

function BranchCommandBoard({
  branchId,
  pollIntervalMs = 8000,
  className = "",
}: DigitalCommandBoardProps) {
  const boardRef = useRef<HTMLElement | null>(null);
  const actionIntents = useRef(new Map<string, string>());
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const [view, setView] = useState<CommandView>("active");
  const [page, setPage] = useState(1);
  const [now, setNow] = useState(Date.now());
  const [pendingTicket, setPendingTicket] = useState<number | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);

  const resource = useQuery<CommandResource>(["commands", branchId, view, page], async () => {
    if (!branchId) throw new Error("Selecciona una sucursal para ver sus comandas.");
    const response = await api<KitchenCommandResponse>(
      `/kitchen/commands?branch_id=${branchId}&view=${view}&page=${page}&page_size=${PAGE_SIZE}`,
    );
    return { branchId, view, page, response };
  }, pollIntervalMs);

  useBranchRealtime(branchId, resource.refresh);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (toast?.tone !== "success") return;
    const timer = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    function syncFullscreen() {
      setFullscreen(document.fullscreenElement === boardRef.current);
    }
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);

  const hasCurrentData = resource.data?.branchId === branchId
    && resource.data?.view === view
    && resource.data?.page === page;
  const response = hasCurrentData ? resource.data?.response : null;
  const totalPages = Math.max(1, Math.ceil((response?.total || 0) / PAGE_SIZE));

  function changeView(nextView: CommandView) {
    setView(nextView);
    setPage(1);
    setToast(null);
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await boardRef.current?.requestFullscreen();
      }
    } catch (caught) {
      setToast({ message: errorMessage(caught, "No se pudo cambiar a pantalla completa."), tone: "error" });
    }
  }

  async function runAction(ticket: KitchenTicket) {
    if (inFlight.current) return;
    inFlight.current = true;
    const action = view === "active" ? "complete" : "reopen";
    const signature = `${action}:${ticket.id}:${ticket.status}:${ticket.version ?? 1}`;
    let key = actionIntents.current.get(signature);
    if (!key) {
      key = crypto.randomUUID();
      actionIntents.current.set(signature, key);
    }
    setPendingTicket(ticket.id);
    setToast(null);
    try {
      await api(`/kitchen/commands/${ticket.id}/${action}`, {
        method: "POST",
        idempotencyKey: key,
        body: JSON.stringify({ expected_status: ticket.status, expected_version: ticket.version ?? 1 }),
      });
      if (!mounted.current) return;
      actionIntents.current.delete(signature);
      // The confirmed mutation wins over reads already in flight, including realtime.
      resource.setData((current) => {
        if (!current || current.view !== view || current.branchId !== branchId) return current;
        return { ...current, response: { ...current.response,
          items: current.response.items.filter((item) => item.id !== ticket.id),
          total: Math.max(0, current.response.total - 1),
          active_count: Math.max(0, current.response.active_count + (action === "complete" ? -1 : 1)),
        } };
      });
      setToast({
        message: action === "complete"
          ? "Comanda completada y guardada en el historial."
          : "Comanda devuelta a preparación.",
        tone: "success",
      });
      void resource.refresh();
      requestAnimationFrame(() => {
        if (mounted.current) boardRef.current?.querySelector<HTMLButtonElement>("[data-command-action]:not(:disabled), .command-board-toolbar button")?.focus();
      });
    } catch (caught) {
      if (!mounted.current) return;
      if (caught instanceof ApiError && caught.status === 409) {
        actionIntents.current.delete(signature);
        void resource.refresh();
      }
      setToast({
        message: errorMessage(caught, action === "complete" ? "No se pudo completar la comanda." : "No se pudo reabrir la comanda."),
        tone: "error",
      });
    } finally {
      inFlight.current = false;
      if (mounted.current) setPendingTicket(null);
    }
  }

  if (!hasCurrentData && !resource.error) {
    return <LoadingState label="Cargando comandas digitales..." />;
  }
  if (!hasCurrentData && resource.error) {
    return <ErrorState message={resource.error} onRetry={() => void resource.refresh()} />;
  }

  return (
    <section
      ref={boardRef}
      className={`digital-command-board ${fullscreen ? "is-fullscreen" : ""} ${className}`.trim()}
      aria-label={view === "active" ? "Comandas digitales activas" : "Historial de comandas"}
    >
      {resource.error && <div className="orders-sync-warning" role="note" aria-label="Estado de actualización">No se pudo actualizar. Se muestra la última consulta. {resource.error}<button className="button button-secondary" onClick={() => void resource.refresh()}>Reintentar</button></div>}
      <header className="command-board-toolbar">
        {view === "history" ? (
          <button className="command-board-back" type="button" onClick={() => changeView("active")}>
            <ChevronLeft /> Regresar a comandas digitales
          </button>
        ) : <span />}
        <div>
          {view === "active" && (
            <button className="button button-secondary" type="button" onClick={() => changeView("history")}>
              <History /> Ver historial
            </button>
          )}
          <button className="button button-secondary" type="button" onClick={() => void toggleFullscreen()}>
            {fullscreen ? <Minimize /> : <Expand />}
            {fullscreen ? "Salir de pantalla completa" : "Ver en pantalla completa"}
          </button>
        </div>
      </header>

      <div className="command-board-summary">
        <span><CalendarDays /> Hoy</span>
        <strong>
          {view === "active"
            ? `${response?.active_count || 0} ${(response?.active_count || 0) === 1 ? "comanda" : "comandas"} por preparar`
            : `${response?.total || 0} ${(response?.total || 0) === 1 ? "comanda completada" : "comandas completadas"} hoy`}
        </strong>
      </div>

      <div className="command-board-canvas" aria-busy={resource.loading}>
        {response?.items.length ? (
          <div className="command-card-grid">
            {response.items.map((ticket) => (
              <CommandCard
                key={ticket.id}
                ticket={ticket}
                view={view}
                now={now}
                pending={pendingTicket === ticket.id}
                blocked={pendingTicket !== null}
                onAction={(selected) => void runAction(selected)}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            title={page > 1 ? "No hay más comandas en esta página" : view === "active" ? "No hay comandas por preparar" : "No hay comandas en el historial de hoy"}
            detail={page > 1 ? "Vuelve a la página anterior para ver las demás comandas." : view === "active" ? "Las nuevas comandas aparecerán aquí automáticamente." : "Las comandas completadas hoy aparecerán en este espacio."}
          />
        )}

        <footer className="command-board-pagination">
          <button className="icon-button" type="button" aria-label="Página anterior" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}><ChevronLeft /></button>
          <span>Página {page} de {Math.max(page, totalPages)}</span>
          <button className="icon-button" type="button" aria-label="Página siguiente" disabled={page >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}><ChevronRight /></button>
        </footer>
      </div>

      {toast && <CommandToast {...toast} onDismiss={() => setToast(null)} />}
    </section>
  );
}
