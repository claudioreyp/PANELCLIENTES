import { Bell, BellOff, CheckCircle2, ChefHat, Clock3, Flame, Printer, RefreshCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useBranchRealtime, usePolling } from "../lib/hooks";
import { useTenant } from "../lib/tenant";
import type { KitchenTicket } from "../types";
import { EmptyState, ErrorState, LoadingState, PageHeader, StatusPill, Toast } from "../components/ui";

const columns = [
  { status: "queued", label: "En cola", icon: Clock3, next: "preparing", action: "Empezar" },
  { status: "preparing", label: "Preparando", icon: Flame, next: "ready", action: "Marcar listo" },
  { status: "ready", label: "Listo", icon: CheckCircle2, next: "served", action: "Entregado" },
] as const;

function elapsed(createdAt: string, now: number) {
  const minutes = Math.max(0, Math.floor((now - new Date(createdAt).getTime()) / 60000));
  return `${minutes} min`;
}

export function KitchenPage() {
  const { branch } = useTenant();
  const [now, setNow] = useState(Date.now());
  const [sound, setSound] = useState(false);
  const [station, setStation] = useState("");
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);
  const previousQueued = useRef(0);
  const resource = usePolling(async () => {
    if (!branch) throw new Error("Selecciona una sucursal");
    const params = new URLSearchParams({ branch_id: String(branch.id) });
    if (station) params.set("station", station);
    return api<KitchenTicket[]>(`/kitchen/tickets?${params}`);
  }, [branch?.id, station], 8000);
  useBranchRealtime(branch?.id, resource.refresh);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const count = resource.data?.filter((ticket) => ticket.status === "queued").length || 0;
    if (sound && count > previousQueued.current) {
      try {
        const context = new AudioContext();
        const oscillator = context.createOscillator();
        oscillator.frequency.value = 880;
        oscillator.connect(context.destination);
        oscillator.start();
        oscillator.stop(context.currentTime + 0.18);
      } catch { /* Audio is optional and can be blocked by the browser. */ }
    }
    previousQueued.current = count;
  }, [resource.data, sound]);

  async function transition(ticket: KitchenTicket, status: string) {
    try {
      await api(`/kitchen/tickets/${ticket.id}/transition`, { method: "POST", body: JSON.stringify({ status }) });
      await resource.refresh();
    } catch (caught) { setToast({ message: caught instanceof Error ? caught.message : "No se pudo actualizar", tone: "error" }); }
  }

  async function printTicket(ticket: KitchenTicket) {
    try {
      await api(`/kitchen/tickets/${ticket.id}/print`, { method: "POST" });
      window.print();
    } catch (caught) { setToast({ message: caught instanceof Error ? caught.message : "No se pudo registrar la impresión", tone: "error" }); }
  }

  if (resource.loading && !resource.data) return <LoadingState label="Abriendo la cocina..." />;
  if (resource.error && !resource.data) return <ErrorState message={resource.error} />;
  const tickets = resource.data || [];
  const stations = [...new Set(tickets.map((ticket) => ticket.station))];

  return (
    <div className="page-stack kitchen-page">
      <PageHeader eyebrow="Kitchen display system" title="Cocina" description="Las comandas aparecen y cambian para todo el equipo en tiempo real." actions={<><select value={station} onChange={(event) => setStation(event.target.value)}><option value="">Todas las estaciones</option>{stations.map((value) => <option key={value} value={value}>{value}</option>)}</select><button className={`button ${sound ? "button-primary" : "button-secondary"}`} onClick={() => setSound(!sound)}>{sound ? <Bell /> : <BellOff />}{sound ? "Alertas activas" : "Activar alertas"}</button><button className="icon-button" onClick={() => void resource.refresh()}><RefreshCcw /></button></>} />
      <section className="kds-board">
        {columns.map((column) => {
          const ColumnIcon = column.icon;
          const columnTickets = tickets.filter((ticket) => ticket.status === column.status);
          return <div className={`kds-column kds-${column.status}`} key={column.status}><header><div><ColumnIcon /><h2>{column.label}</h2></div><span>{columnTickets.length}</span></header><div className="kds-list">{columnTickets.length ? columnTickets.map((ticket) => {
            const minutes = Math.floor((now - new Date(ticket.created_at).getTime()) / 60000);
            return <article className={`kds-ticket ${minutes >= 20 ? "late" : minutes >= 10 ? "warning" : ""}`} key={ticket.id}><header><div><strong>Orden #{ticket.order_id}</strong><StatusPill value={ticket.station} /></div><span><Clock3 /> {elapsed(ticket.created_at, now)}</span></header><div className="kds-items">{ticket.items.map((item) => <div key={item.item_id}><strong>{item.quantity}×</strong><span>{item.name}{item.notes && <small>{item.notes}</small>}</span></div>)}</div><footer><button className="icon-button" onClick={() => void printTicket(ticket)}><Printer /></button><button className="button button-primary" onClick={() => void transition(ticket, column.next)}>{column.action}</button></footer></article>;
          }) : <EmptyState title="Columna despejada" detail="No hay comandas en este estado." />}</div></div>;
        })}
      </section>
      <div className="kds-legend"><ChefHat /><span>Los colores de tiempo avisan: ámbar desde 10 minutos y rojo desde 20.</span></div>
      {toast && <Toast {...toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
