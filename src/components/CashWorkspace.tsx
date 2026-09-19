import {
  AlertCircle,
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  Calculator,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Filter,
  Landmark,
  Plus,
  Printer,
  X,
} from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { AuditReturnLink, positiveRouteId } from "../lib/audit-navigation";
import { ApiError, api } from "../lib/api";
import { DialogPortal, useDialogSurface } from "../lib/dialog";
import { useTenant } from "../lib/tenant";
import { EmptyState, ErrorState, LoadingState, Modal, Money, Toast } from "./ui";

const PAGE_SIZE = 10;
export const CASH_DENOMINATIONS = [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200] as const;

type CashTab = "cuts" | "movements";
type CashResult = "balanced" | "surplus" | "shortage" | string;
type ToastState = { message: string; tone: "success" | "error" } | null;
export type CashDenominationCounts = Record<string, number>;

type CashRegister = {
  id: number;
  name: string;
  active: boolean;
  is_default: boolean;
};

type PendingOrder = {
  id: number;
  number?: string | null;
  order_number?: string | null;
  remaining_amount?: number | null;
  balance?: number | null;
};

type CashCutSummary = {
  id: number;
  number?: string | number | null;
  register: Pick<CashRegister, "id" | "name">;
  closed_at: string;
  created_by?: string | null;
  retained_fund_amount: number;
  total_expected_amount: number;
  total_difference?: number | null;
  result: CashResult;
};

type CashCutPreview = {
  register: CashRegister;
  session_id: number | null;
  version: number;
  period_started_at?: string | null;
  opening_fund: number;
  has_card_activity: boolean;
  transfer_expected_amount: number;
  pending_orders: PendingOrder[];
  pending_order_count: number;
};

type CashTransaction = {
  id: number;
  created_at?: string | null;
  amount: number;
  order_number?: string | null;
  reference?: string | null;
  note?: string | null;
  created_by?: string | null;
};

type CashMethodGroup = {
  key: string;
  label: string;
  counted?: number | null;
  expected: number;
  difference?: number | null;
  transactions: CashTransaction[];
};

type CashCutDetail = CashCutSummary & {
  cash_withdrawn_amount: number;
  methods: CashMethodGroup[];
  notes?: string | null;
};

type CashMovement = {
  id: number;
  register_id?: number;
  movement_type: "income" | "withdrawal" | string;
  amount: number;
  note?: string | null;
  created_at: string;
  created_by?: string | null;
};

type PagedResponse<T> = {
  items: T[];
  total: number;
  page: number;
  page_size: number;
};

type CutFilters = {
  dateFrom: string;
  dateTo: string;
  registerId: string;
  result: string;
};

const emptyFilters: CutFilters = { dateFrom: "", dateTo: "", registerId: "", result: "" };

function formatMoney(value: number) {
  return new Intl.NumberFormat("es-PE", { style: "currency", currency: "PEN" }).format(Number(value || 0));
}

function formatDateTime(value?: string | null, timezone = "America/Lima") {
  if (!value) return "Sin fecha";
  return new Intl.DateTimeFormat("es-PE", {
    timeZone: timezone,
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function denominationKey(value: number) {
  return value.toFixed(2);
}

export function calculateDenominationTotal(counts: CashDenominationCounts) {
  const cents = CASH_DENOMINATIONS.reduce((total, denomination) => {
    const count = Math.max(0, Math.trunc(Number(counts[denominationKey(denomination)] || 0)));
    return total + Math.round(denomination * 100) * count;
  }, 0);
  return cents / 100;
}

function freshIdempotencyKey() {
  return globalThis.crypto?.randomUUID?.() || `cash-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizePage<T>(payload: PagedResponse<T> | T[], page: number): PagedResponse<T> {
  if (Array.isArray(payload)) return { items: payload, total: payload.length, page, page_size: PAGE_SIZE };
  return payload;
}

function cashErrorMessage(caught: unknown) {
  const code = caught instanceof ApiError ? caught.code?.toUpperCase() : undefined;
  if (code === "CASH_CUT_NO_ACTIVITY") {
    return "No se registraron ventas ni movimientos de efectivo en esta caja desde el último corte.";
  }
  if (code === "CASH_CUT_PENDING_ORDERS") {
    return "Cobra los pedidos pendientes o marca \"Omitir pagos pendientes\" para continuar con el corte.";
  }
  if (code === "CASH_CUT_STALE" || code === "CASH_CUT_STALE_SESSION" || code === "CASH_CUT_STALE_VERSION" || code === "STALE_VERSION") {
    return "La caja cambió mientras realizabas el conteo. Cierra este panel y vuelve a abrirlo para usar los datos actuales.";
  }
  return caught instanceof Error ? caught.message : "No pudimos completar la operación de caja.";
}

function resultLabel(result: CashResult) {
  if (["balanced", "without_difference", "no_difference"].includes(result)) return "Sin diferencia";
  if (["surplus", "overage"].includes(result)) return "Con sobrante";
  if (["shortage", "missing"].includes(result)) return "Con faltante";
  return result.replaceAll("_", " ");
}

function resultTone(result: CashResult) {
  if (["surplus", "overage"].includes(result)) return "surplus";
  if (["shortage", "missing"].includes(result)) return "shortage";
  return "balanced";
}

function registerName(cut: CashCutSummary) {
  return cut.register.name;
}

function cutNumber(cut: CashCutSummary) {
  return `#${cut.number || cut.id}`;
}

function orderNumber(order: PendingOrder) {
  return `#${order.order_number || order.number || order.id}`;
}

function buildCutQuery(branchId: number, page: number, filters: CutFilters) {
  const params = new URLSearchParams({
    branch_id: String(branchId),
    page: String(page),
    page_size: String(PAGE_SIZE),
  });
  if (filters.dateFrom) params.set("date_from", filters.dateFrom);
  if (filters.dateTo) params.set("date_to", filters.dateTo);
  if (filters.registerId) params.set("register_id", filters.registerId);
  if (filters.result) params.set("result", filters.result);
  return params.toString();
}

function ResultBadge({ result }: { result: CashResult }) {
  return <span className={`cash-result cash-result-${resultTone(result)}`}>{resultLabel(result)}</span>;
}

function Pagination({ page, total, onPage }: { page: number; total: number; onPage: (page: number) => void }) {
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const first = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const last = Math.min(total, page * PAGE_SIZE);
  return (
    <footer className="cash-pagination" aria-label="Paginación">
      <button className="icon-button" type="button" aria-label="Página anterior" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        <ChevronLeft />
      </button>
      <span>{first} - {last} de {total}</span>
      <button className="icon-button" type="button" aria-label="Página siguiente" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
        <ChevronRight />
      </button>
    </footer>
  );
}

function DenominationCalculator({
  initialCounts,
  onClose,
  onSave,
}: {
  initialCounts: CashDenominationCounts;
  onClose: () => void;
  onSave: (counts: CashDenominationCounts) => void;
}) {
  const [counts, setCounts] = useState<CashDenominationCounts>(() => ({ ...initialCounts }));
  const titleId = useId();
  const surfaceRef = useDialogSurface(onClose);
  const total = calculateDenominationTotal(counts);

  return (
    <DialogPortal>
      <div className="cash-calculator-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
        <section ref={surfaceRef} className="cash-calculator" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
          <header>
            <h2 id={titleId}>Calculadora de efectivo</h2>
            <button className="icon-button" type="button" onClick={onClose} aria-label="Cerrar calculadora"><X /></button>
          </header>
          <div className="cash-denomination-list">
            {CASH_DENOMINATIONS.map((denomination, index) => {
              const key = denominationKey(denomination);
              const count = counts[key] || 0;
              return (
                <label className="cash-denomination-row" key={key}>
                  <span className="sr-only">Cantidad de S/ {key}</span>
                  <input
                    data-dialog-initial-focus={index === 0 ? true : undefined}
                    type="number"
                    min="0"
                    step="1"
                    inputMode="numeric"
                    value={count}
                    aria-label={`Cantidad de S/ ${key}`}
                    onChange={(event) => {
                      const next = Math.max(0, Math.trunc(Number(event.target.value) || 0));
                      setCounts((current) => ({ ...current, [key]: next }));
                    }}
                  />
                  <span aria-hidden="true">x</span>
                  <strong>{denomination < 1 ? denomination.toFixed(2) : denomination.toFixed(0)} S/</strong>
                  <span aria-hidden="true">=</span>
                  <b>{formatMoney(count * denomination)}</b>
                </label>
              );
            })}
          </div>
          <footer>
            <strong aria-live="polite">Total&nbsp; {formatMoney(total)}</strong>
            <div>
              <button className="button button-secondary" type="button" onClick={onClose}>Cancelar</button>
              <button className="button button-primary" type="button" onClick={() => onSave(counts)}>Guardar</button>
            </div>
          </footer>
        </section>
      </div>
    </DialogPortal>
  );
}

function NewCutDrawer({
  preview,
  timezone,
  onClose,
  onSaved,
}: {
  preview: CashCutPreview;
  timezone: string;
  onClose: () => void;
  onSaved: (detail: CashCutDetail) => void;
}) {
  const titleId = useId();
  const surfaceRef = useDialogSurface(onClose);
  const [cashCounted, setCashCounted] = useState("0");
  const [cardCounted, setCardCounted] = useState("0");
  const [retainedFund, setRetainedFund] = useState(String(preview.opening_fund || 0));
  const [includeNote, setIncludeNote] = useState(false);
  const [note, setNote] = useState("");
  const [ignorePending, setIgnorePending] = useState(false);
  const [denominations, setDenominations] = useState<CashDenominationCounts | null>(null);
  const [calculatorOpen, setCalculatorOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const idempotencyKey = useRef(freshIdempotencyKey());

  const cash = Math.max(0, Number(cashCounted) || 0);
  const card = preview.has_card_activity ? Math.max(0, Number(cardCounted) || 0) : 0;
  const fund = Math.max(0, Number(retainedFund) || 0);
  const denominationTotal = denominations ? calculateDenominationTotal(denominations) : null;
  const pendingOrders = preview.pending_orders || [];
  const pendingOrderCount = preview.pending_order_count ?? pendingOrders.length;

  function validate() {
    if (fund > cash) return "El fondo de caja no puede ser mayor que el efectivo contado.";
    if (denominationTotal != null && Math.abs(denominationTotal - cash) > 0.005) {
      return `La calculadora suma ${formatMoney(denominationTotal)} y debe coincidir con el efectivo contado.`;
    }
    if (pendingOrderCount > 0 && !ignorePending) {
      return "Debes marcar \"Omitir pagos pendientes\" para guardar este corte.";
    }
    return null;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submittingRef.current) return;
    const validation = validate();
    if (validation) {
      setFormError(validation);
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    setFormError(null);
    try {
      const detail = await api<CashCutDetail>(`/cash/registers/${preview.register.id}/cuts`, {
        method: "POST",
        idempotencyKey: idempotencyKey.current,
        body: JSON.stringify({
          expected_version: preview.version,
          cash_counted: cash,
          card_counted: card,
          retained_fund: fund,
          denominations,
          note: includeNote && note.trim() ? note.trim() : null,
          ignore_pending_orders: ignorePending,
        }),
      });
      onSaved(detail);
    } catch (caught) {
      setFormError(cashErrorMessage(caught));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <DialogPortal>
      <div className="cash-drawer-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !calculatorOpen && onClose()}>
        <aside
          ref={surfaceRef}
          className="cash-cut-drawer"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-hidden={calculatorOpen ? "true" : undefined}
          inert={calculatorOpen ? true : undefined}
          tabIndex={-1}
        >
          <header className="cash-drawer-header">
            <h2 id={titleId}>Agregar un corte de caja</h2>
            <button className="icon-button" type="button" aria-label="Cerrar corte de caja" onClick={onClose}><X /></button>
          </header>
          <form className="cash-cut-form" onSubmit={(event) => void submit(event)}>
            <div className="cash-cut-fields">
              {pendingOrderCount > 0 && (
                <div className="cash-pending-alert" role="alert">
                  <AlertCircle />
                  <div>
                    <strong>Hay {pendingOrderCount} {pendingOrderCount === 1 ? "pedido" : "pedidos"} sin cobrar.</strong>
                    <p>Cobra los pedidos pendientes o marca "Omitir pagos pendientes" para continuar con el corte.</p>
                    <div className="cash-order-chips">
                      {pendingOrders.map((order) => <span key={order.id}>{orderNumber(order)}</span>)}
                    </div>
                    <label className="cash-checkbox">
                      <input type="checkbox" checked={ignorePending} onChange={(event) => setIgnorePending(event.target.checked)} />
                      Omitir pagos pendientes
                    </label>
                  </div>
                </div>
              )}

              <section className="cash-form-section">
                <label>Caja
                  <select disabled value={preview.register.id}>
                    <option value={preview.register.id}>{preview.register.name}</option>
                  </select>
                  <small>Selecciona la caja en la que harás el corte de caja.</small>
                </label>
              </section>

              <section className="cash-form-section">
                <label>Monto en efectivo
                  <div className="cash-input-action">
                    <span>S/</span>
                    <input
                      data-dialog-initial-focus
                      type="number"
                      aria-label="Monto en efectivo"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      value={cashCounted}
                      onChange={(event) => {
                        setCashCounted(event.target.value);
                        if (denominations) setDenominations(null);
                      }}
                    />
                    <button type="button" onClick={() => setCalculatorOpen(true)}><Banknote /> Contar efectivo</button>
                  </div>
                  <small>Ingresa la cantidad total que hay en efectivo.</small>
                </label>
                <label>Monto de pagos en tarjeta
                  <div className="cash-prefix-input"><span>S/</span><input aria-label="Monto de pagos en tarjeta" type="number" min="0" step="0.01" inputMode="decimal" disabled={!preview.has_card_activity} value={cardCounted} onChange={(event) => setCardCounted(event.target.value)} /></div>
                  {!preview.has_card_activity && <small>No hay movimientos con tarjeta que contabilizar.</small>}
                </label>
              </section>

              <section className="cash-form-section">
                <label>Fondo de caja
                  <div className="cash-prefix-input"><span>S/</span><input aria-label="Fondo de caja" type="number" min="0" step="0.01" inputMode="decimal" value={retainedFund} onChange={(event) => setRetainedFund(event.target.value)} /></div>
                  <small>Monto en efectivo que se reserva para contar con cambio y cubrir gastos menores al inicio del siguiente turno.</small>
                </label>
              </section>

              <section className="cash-form-section">
                <label className="cash-checkbox">
                  <input type="checkbox" checked={includeNote} onChange={(event) => setIncludeNote(event.target.checked)} />
                  Nota adicional
                </label>
                {includeNote && <label>Detalle de la nota<textarea rows={4} value={note} onChange={(event) => setNote(event.target.value)} /></label>}
              </section>
            </div>

            <aside className="cash-blind-summary" aria-label="Resumen del conteo">
              <h3>Resumen</h3>
              <p>
                Información contada en {preview.register.name}{preview.period_started_at
                  ? ` desde ${formatDateTime(preview.period_started_at, timezone)}`
                  : " desde el primer movimiento en esta caja"}.
              </p>
              <dl>
                <div><dt>Efectivo contado</dt><dd>{formatMoney(cash)}</dd></div>
                <div><dt>Tarjeta contada</dt><dd>{formatMoney(card)}</dd></div>
                <div><dt>Transferencias</dt><dd>{formatMoney(preview.transfer_expected_amount)}</dd></div>
              </dl>
              <div className="cash-summary-totals">
                <span>Fondo de caja <strong>{formatMoney(fund)}</strong></span>
                <span>Efectivo a retirar <strong>{formatMoney(Math.max(0, cash - fund))}</strong></span>
              </div>
              <small>Los montos esperados de efectivo y tarjeta se mostrarán después de guardar el corte.</small>
            </aside>

            <footer className="cash-drawer-footer">
              <div aria-live="assertive">{formError && <p className="cash-form-error" role="alert"><AlertCircle /> {formError}</p>}</div>
              <div>
                <button className="button button-secondary" type="button" disabled={submitting} onClick={onClose}>Cancelar</button>
                <button className="button button-primary" type="submit" disabled={submitting}>{submitting ? "Guardando..." : "Guardar"}</button>
              </div>
            </footer>
          </form>
        </aside>
      </div>
      {calculatorOpen && (
        <DenominationCalculator
          initialCounts={denominations || {}}
          onClose={() => setCalculatorOpen(false)}
          onSave={(counts) => {
            const total = calculateDenominationTotal(counts);
            setDenominations(counts);
            setCashCounted(total.toFixed(2));
            setCalculatorOpen(false);
            setFormError(null);
          }}
        />
      )}
    </DialogPortal>
  );
}

function CutDetailModal({ detail, timezone, onClose }: { detail: CashCutDetail; timezone: string; onClose: () => void }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const groups = detail.methods || [];

  return (
    <Modal title={`${cutNumber(detail)} en ${registerName(detail)}`} className="cash-detail-modal" onClose={onClose}>
      <article className="cash-cut-print-sheet">
        <header className="cash-detail-heading">
          <div>
            <span>{formatDateTime(detail.closed_at, timezone)}</span>
            <h3>{cutNumber(detail)} en {registerName(detail)}</h3>
            <p>Realizado por {detail.created_by || "el equipo"}</p>
          </div>
          <ResultBadge result={detail.result} />
        </header>

        <dl className="cash-detail-fund">
          <div><dt>Fondo de caja</dt><dd><Money value={detail.retained_fund_amount} /></dd></div>
          <div><dt>Efectivo retirado</dt><dd><Money value={detail.cash_withdrawn_amount} /></dd></div>
        </dl>

        <div className="cash-methods" role="table" aria-label="Conciliación por método">
          <div className="cash-method-head" role="row">
            <span role="columnheader">Método</span>
            <span role="columnheader">Contado</span>
            <span role="columnheader">Monto esperado</span>
            <span role="columnheader">Diferencia</span>
          </div>
          {groups.map((group) => {
            const isOpen = expanded === group.key;
            const transactionsId = `cash-method-${detail.id}-${group.key}`;
            return (
              <div className="cash-method-group" key={group.key}>
                <button type="button" className="cash-method-row" aria-expanded={isOpen} aria-controls={transactionsId} onClick={() => setExpanded(isOpen ? null : group.key)}>
                  <span><ChevronDown /> {group.label}</span>
                  <span>{group.counted == null ? "-" : formatMoney(group.counted)}</span>
                  <span>{formatMoney(group.expected)}</span>
                  <span>{group.difference == null ? "-" : <b className={group.difference < 0 ? "negative" : group.difference > 0 ? "positive" : ""}>{group.difference > 0 ? "+" : ""}{formatMoney(group.difference)}</b>}</span>
                </button>
                <div id={transactionsId} className={`cash-method-transactions${isOpen ? " is-open" : ""}`}>
                  {group.transactions.length ? group.transactions.map((transaction) => (
                    <div key={transaction.id}>
                      <span>{transaction.order_number ? `Pedido #${transaction.order_number}` : transaction.reference || transaction.note || "Movimiento"}<small>{formatDateTime(transaction.created_at, timezone)}</small></span>
                      <strong>{formatMoney(transaction.amount)}</strong>
                    </div>
                  )) : <p>No hay transacciones en este método.</p>}
                </div>
              </div>
            );
          })}
        </div>

        <footer className="cash-detail-footer">
          <div><span>Total esperado</span><strong>{formatMoney(detail.total_expected_amount)}</strong></div>
          <div><span>Diferencia total</span><strong>{detail.total_difference == null ? "-" : formatMoney(detail.total_difference)}</strong></div>
          {detail.notes && <p><strong>Nota:</strong> {detail.notes}</p>}
        </footer>
      </article>
      <div className="cash-detail-actions">
        <button className="button button-secondary" type="button" onClick={() => window.print()}><Printer /> Imprimir corte de caja</button>
      </div>
    </Modal>
  );
}

function MovementDialog({ register, expectedVersion, onClose, onSaved }: { register: CashRegister; expectedVersion: number; onClose: () => void; onSaved: () => void }) {
  const [movementType, setMovementType] = useState<"income" | "withdrawal">("income");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const idempotencyKey = useRef(freshIdempotencyKey());

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submittingRef.current) return;
    if ((Number(amount) || 0) <= 0) {
      setError("Ingresa una cantidad mayor que cero.");
      return;
    }
    if (!note.trim()) {
      setError("Explica el motivo de este movimiento.");
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      await api(`/cash/registers/${register.id}/movements`, {
        method: "POST",
        idempotencyKey: idempotencyKey.current,
        body: JSON.stringify({
          movement_type: movementType,
          amount: Number(amount),
          note: note.trim(),
          expected_version: expectedVersion,
        }),
      });
      onSaved();
    } catch (caught) {
      setError(cashErrorMessage(caught));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Agrega un movimiento" className="cash-movement-modal" onClose={onClose}>
      <form className="cash-movement-form" onSubmit={(event) => void submit(event)}>
        <label>Caja<select disabled value={register.id}><option value={register.id}>{register.name}</option></select></label>
        <label>Tipo de movimiento
          <select value={movementType} onChange={(event) => setMovementType(event.target.value as "income" | "withdrawal")}>
            <option value="income">Entrada de efectivo</option>
            <option value="withdrawal">Retiro de efectivo</option>
          </select>
        </label>
        <label>Cantidad<div className="cash-prefix-input"><span>S/</span><input aria-label="Cantidad" type="number" min="0.01" step="0.01" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></div></label>
        <label>Motivo<small>Explica la razón de este movimiento.</small><textarea aria-label="Motivo" rows={4} value={note} onChange={(event) => setNote(event.target.value)} /></label>
        {error && <p className="cash-form-error" role="alert"><AlertCircle /> {error}</p>}
        <footer>
          <button className="button button-secondary" type="button" disabled={submitting} onClick={onClose}>Cancelar</button>
          <button className="button button-primary" type="submit" disabled={submitting}>{submitting ? "Confirmando..." : "Confirmar"}</button>
        </footer>
      </form>
    </Modal>
  );
}

function CashWorkspaceContent() {
  const { branch, context } = useTenant();
  const [routeParams, setRouteParams] = useSearchParams();
  const location = useLocation();
  const routeRegisterId = positiveRouteId(routeParams.get("register_id"));
  const routeMovementId = positiveRouteId(routeParams.get("movement_id"));
  const hasMovementTarget = routeParams.has("movement_id") || routeParams.has("register_id");
  const invalidMovementTarget = hasMovementTarget && (!routeRegisterId || !routeMovementId);
  const [activeTab, setActiveTab] = useState<CashTab>(() => routeParams.get("tab") === "movements" || hasMovementTarget ? "movements" : "cuts");
  const [registers, setRegisters] = useState<CashRegister[]>([]);
  const [preview, setPreview] = useState<CashCutPreview | null>(null);
  const [cuts, setCuts] = useState<PagedResponse<CashCutSummary>>({ items: [], total: 0, page: 1, page_size: PAGE_SIZE });
  const [latestCut, setLatestCut] = useState<CashCutSummary | null>(null);
  const [movements, setMovements] = useState<PagedResponse<CashMovement>>({ items: [], total: 0, page: 1, page_size: PAGE_SIZE });
  const [cutPage, setCutPage] = useState(1);
  const [movementPage, setMovementPage] = useState(1);
  const [filters, setFilters] = useState<CutFilters>(emptyFilters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [loadingRegisters, setLoadingRegisters] = useState(true);
  const [loadingCuts, setLoadingCuts] = useState(true);
  const [loadingPreview, setLoadingPreview] = useState(true);
  const [loadingMovements, setLoadingMovements] = useState(false);
  const [movementError, setMovementError] = useState<string | null>(null);
  const [movementRegisterName, setMovementRegisterName] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [cutDrawerPreview, setCutDrawerPreview] = useState<CashCutPreview | null>(null);
  const [openingCut, setOpeningCut] = useState(false);
  const [detail, setDetail] = useState<CashCutDetail | null>(null);
  const [loadingDetailId, setLoadingDetailId] = useState<number | null>(null);
  const [movementOpen, setMovementOpen] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const cutReturnFocusRef = useRef<HTMLElement | null>(null);
  const detailReturnFocusRef = useRef<HTMLElement | null>(null);
  const tabRefs = useRef<Record<CashTab, HTMLButtonElement | null>>({ cuts: null, movements: null });
  const tabId = useId();
  const cutsTabId = `${tabId}-cuts-tab`;
  const movementsTabId = `${tabId}-movements-tab`;
  const cutsPanelId = `${tabId}-cuts-panel`;
  const movementsPanelId = `${tabId}-movements-panel`;
  const cutTableHintId = `${tabId}-cut-table-hint`;
  const movementTableHintId = `${tabId}-movement-table-hint`;

  const primaryRegister = registers.find((register) => register.active && register.is_default)
    || registers.find((register) => register.active)
    || null;
  const branchId = branch?.id;
  const primaryRegisterId = primaryRegister?.id;
  const movementRegisterId = hasMovementTarget ? routeRegisterId : primaryRegisterId;
  const movementScope = `${branchId}:${movementRegisterId}:${routeMovementId}:${movementPage}`;
  const [loadedMovementScope, setLoadedMovementScope] = useState("");
  const timezone = context?.business.timezone || "America/Lima";

  useEffect(() => {
    setMovementPage(1);
    if (hasMovementTarget || routeParams.get("tab") === "movements") setActiveTab("movements");
  }, [routeRegisterId, routeMovementId, hasMovementTarget, routeParams]);

  useEffect(() => {
    if (!branchId) return;
    let cancelled = false;
    setLoadingRegisters(true);
    api<CashRegister[]>(`/cash/registers?branch_id=${branchId}`)
      .then((data) => {
        if (cancelled) return;
        setRegisters(data);
        setLoadError(null);
      })
      .catch((caught) => {
        if (!cancelled) setLoadError(cashErrorMessage(caught));
      })
      .finally(() => {
        if (!cancelled) setLoadingRegisters(false);
      });
    return () => { cancelled = true; };
  }, [branchId, reloadToken]);

  useEffect(() => {
    if (!primaryRegisterId) {
      setPreview(null);
      setLoadingPreview(false);
      return;
    }
    let cancelled = false;
    setLoadingPreview(true);
    api<CashCutPreview>(`/cash/registers/${primaryRegisterId}/cut-preview`)
      .then((data) => {
        if (!cancelled) setPreview(data);
      })
      .catch((caught) => {
        if (!cancelled) setLoadError(cashErrorMessage(caught));
      })
      .finally(() => {
        if (!cancelled) setLoadingPreview(false);
      });
    return () => { cancelled = true; };
  }, [primaryRegisterId, reloadToken]);

  useEffect(() => {
    if (!branchId) return;
    let cancelled = false;
    setLoadingCuts(true);
    api<PagedResponse<CashCutSummary> | CashCutSummary[]>(`/cash/cuts?${buildCutQuery(branchId, cutPage, filters)}`)
      .then((data) => {
        if (!cancelled) {
          const normalized = normalizePage(data, cutPage);
          setCuts(normalized);
          if (cutPage === 1 && !filters.dateFrom && !filters.dateTo && !filters.registerId && !filters.result) {
            setLatestCut(normalized.items[0] || null);
          }
          setLoadError(null);
        }
      })
      .catch((caught) => {
        if (!cancelled) setLoadError(cashErrorMessage(caught));
      })
      .finally(() => {
        if (!cancelled) setLoadingCuts(false);
      });
    return () => { cancelled = true; };
  }, [branchId, cutPage, filters, reloadToken]);

  useEffect(() => {
    if (activeTab !== "movements" || !movementRegisterId || invalidMovementTarget) return;
    let cancelled = false;
    setLoadingMovements(true);
    setMovementError(null);
    const query = new URLSearchParams({ page: String(movementPage), page_size: String(PAGE_SIZE), branch_id: String(branchId) });
    if (routeMovementId) query.set("movement_id", String(routeMovementId));
    api<(PagedResponse<CashMovement> & { branch_id?: number; register?: { name?: string } }) | CashMovement[]>(`/cash/registers/${movementRegisterId}/movements?${query}`)
      .then((data) => {
        if (!cancelled) {
          if (hasMovementTarget && (Array.isArray(data) || data.branch_id !== branchId || data.items.some((item) => item.id !== routeMovementId || item.register_id !== movementRegisterId))) throw new Error("No se pudo verificar el movimiento en la sucursal actual. Actualiza la API e inténtalo nuevamente.");
          setMovements(normalizePage(data, movementPage));
          setLoadedMovementScope(movementScope);
          setMovementRegisterName(!Array.isArray(data) ? data.register?.name || null : null);
        }
      })
      .catch((caught) => {
        if (!cancelled) setMovementError(cashErrorMessage(caught));
      })
      .finally(() => {
        if (!cancelled) setLoadingMovements(false);
      });
    return () => { cancelled = true; };
  }, [activeTab, movementRegisterId, routeMovementId, hasMovementTarget, invalidMovementTarget, branchId, movementPage, movementScope, reloadToken]);

  function refresh() {
    setReloadToken((value) => value + 1);
  }

  async function openCutDrawer() {
    if (!primaryRegister || openingCut) return;
    cutReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpeningCut(true);
    try {
      const currentPreview = await api<CashCutPreview>(`/cash/registers/${primaryRegister.id}/cut-preview`);
      setPreview(currentPreview);
      setCutDrawerPreview(currentPreview);
    } catch (caught) {
      setToast({ message: cashErrorMessage(caught), tone: "error" });
    } finally {
      setOpeningCut(false);
    }
  }

  function closeCutDrawer() {
    const returnTarget = cutReturnFocusRef.current;
    setCutDrawerPreview(null);
    window.requestAnimationFrame(() => returnTarget?.isConnected && returnTarget.focus());
  }

  async function openDetail(cut: CashCutSummary, returnTarget?: HTMLElement | null) {
    if (loadingDetailId != null) return;
    detailReturnFocusRef.current = returnTarget
      || (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setLoadingDetailId(cut.id);
    try {
      const data = await api<CashCutDetail>(`/cash/cuts/${cut.id}`);
      setDetail(data);
    } catch (caught) {
      setToast({ message: cashErrorMessage(caught), tone: "error" });
      const focusTarget = detailReturnFocusRef.current;
      window.requestAnimationFrame(() => focusTarget?.isConnected && focusTarget.focus());
    } finally {
      setLoadingDetailId(null);
    }
  }

  function closeDetail() {
    const returnTarget = detailReturnFocusRef.current;
    setDetail(null);
    detailReturnFocusRef.current = null;
    window.requestAnimationFrame(() => returnTarget?.isConnected && returnTarget.focus());
  }

  function selectTab(tab: CashTab, moveFocus = false) {
    setActiveTab(tab);
    if (moveFocus) window.requestAnimationFrame(() => tabRefs.current[tab]?.focus());
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const tabs: CashTab[] = ["cuts", "movements"];
    const currentIndex = tabs.indexOf(activeTab);
    let nextTab: CashTab | null = null;
    if (event.key === "ArrowRight") nextTab = tabs[(currentIndex + 1) % tabs.length];
    if (event.key === "ArrowLeft") nextTab = tabs[(currentIndex - 1 + tabs.length) % tabs.length];
    if (event.key === "Home") nextTab = tabs[0];
    if (event.key === "End") nextTab = tabs[tabs.length - 1];
    if (!nextTab) return;
    event.preventDefault();
    selectTab(nextTab, true);
  }

  if (!branch) return <ErrorState message="Selecciona una sucursal para consultar Caja." />;
  if (loadingRegisters && registers.length === 0) return <LoadingState label="Preparando Caja..." />;
  if (loadError && registers.length === 0) return <ErrorState message={loadError} onRetry={refresh} />;

  const hasCutFilters = Boolean(filters.dateFrom || filters.dateTo || filters.registerId || filters.result);
  const firstCut = !latestCut && cuts.total === 0 && !hasCutFilters;
  const loadingInitialCut = loadingCuts && !latestCut && cuts.total === 0 && !hasCutFilters;

  return (
    <div className="page-stack cash-workspace">
      <AuditReturnLink />
      <header className="cash-workspace-header">
        <h1>Caja</h1>
        <div className="cash-tabs" role="tablist" aria-label="Secciones de Caja">
          <button ref={(node) => { tabRefs.current.cuts = node; }} id={cutsTabId} role="tab" type="button" aria-controls={cutsPanelId} aria-selected={activeTab === "cuts"} tabIndex={activeTab === "cuts" ? 0 : -1} onClick={() => selectTab("cuts")} onKeyDown={handleTabKeyDown}>Cortes de caja</button>
          <button ref={(node) => { tabRefs.current.movements = node; }} id={movementsTabId} role="tab" type="button" aria-controls={movementsPanelId} aria-selected={activeTab === "movements"} tabIndex={activeTab === "movements" ? 0 : -1} onClick={() => selectTab("movements")} onKeyDown={handleTabKeyDown}>Entradas y retiros de efectivo</button>
        </div>
      </header>

      {activeTab === "cuts" ? (
        <main id={cutsPanelId} className="cash-surface" role="tabpanel" aria-labelledby={cutsTabId} tabIndex={0}>
          {((loadingPreview && !preview) || loadingInitialCut) ? <LoadingState label="Cargando cortes de caja..." /> : firstCut ? (
            <section className="cash-first-cut panel">
              <span className="cash-empty-icon"><Calculator /></span>
              <h2>Realiza tu primer corte de caja a ciegas</h2>
              <p>Un corte de caja es un conteo a ciegas de los cobros registrados para detectar faltantes y prevenir robos.</p>
              <button className="button button-primary" type="button" disabled={!primaryRegister || openingCut} onClick={() => void openCutDrawer()}><Plus /> {openingCut ? "Preparando..." : "Nuevo corte de caja"}</button>
            </section>
          ) : (
            <>
              {latestCut && (
                <section className="cash-last-fund panel">
                  <header><h2>Último fondo de caja</h2><p>Saldo inicial de efectivo en caja. Valida que este monto coincida antes de comenzar a operar.</p></header>
                  <div><span>Fondo de caja registrado por <strong>{latestCut.created_by || "el equipo"}</strong></span><b><Money value={latestCut.retained_fund_amount} /></b></div>
                </section>
              )}

              <div className="cash-primary-action">
                <button className="button button-primary" type="button" disabled={!primaryRegister || openingCut} onClick={() => void openCutDrawer()}><Plus /> {openingCut ? "Preparando..." : "Nuevo corte de caja"}</button>
              </div>

              <section className="cash-history panel">
                <header className="cash-history-toolbar">
                  <div><h2>Historial de cortes</h2><p>Consulta diferencias y responsables de cada conteo.</p></div>
                  <button className="button button-secondary" type="button" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((value) => !value)}><Filter /> Filtros</button>
                </header>
                {filtersOpen && (
                  <div className="cash-filters">
                    <label>Desde<input type="date" value={filters.dateFrom} onChange={(event) => { setCutPage(1); setFilters((current) => ({ ...current, dateFrom: event.target.value })); }} /></label>
                    <label>Hasta<input type="date" value={filters.dateTo} onChange={(event) => { setCutPage(1); setFilters((current) => ({ ...current, dateTo: event.target.value })); }} /></label>
                    <label>Caja<select value={filters.registerId} onChange={(event) => { setCutPage(1); setFilters((current) => ({ ...current, registerId: event.target.value })); }}><option value="">Todas</option>{registers.map((register) => <option key={register.id} value={register.id}>{register.name}</option>)}</select></label>
                    <label>Resultado<select value={filters.result} onChange={(event) => { setCutPage(1); setFilters((current) => ({ ...current, result: event.target.value })); }}><option value="">Todos</option><option value="balanced">Sin diferencia</option><option value="surplus">Con sobrante</option><option value="shortage">Con faltante</option></select></label>
                    <button className="button button-ghost" type="button" onClick={() => { setCutPage(1); setFilters(emptyFilters); }}>Limpiar</button>
                  </div>
                )}

                <p id={cutTableHintId} className="cash-table-scroll-hint">En pantallas pequeñas, cada fila muestra todos sus datos.</p>
                <div className="cash-table-scroll" role="region" aria-label="Historial de cortes desplazable" aria-describedby={cutTableHintId} tabIndex={0}>
                  <table className="data-table cash-history-table">
                    <thead><tr><th>Corte</th><th>Fecha</th><th>Caja</th><th>Creado por</th><th>Resultado</th><th>Total esperado</th></tr></thead>
                    <tbody>
                      {cuts.items.map((cut) => (
                        <tr key={cut.id} onClick={(event) => void openDetail(cut, event.currentTarget.querySelector("button"))}>
                          <td data-label="Corte"><button type="button" disabled={loadingDetailId != null} aria-label={`Abrir corte ${cutNumber(cut)}`} onClick={(event) => { event.stopPropagation(); void openDetail(cut, event.currentTarget); }}>{loadingDetailId === cut.id ? "Abriendo..." : cutNumber(cut)}</button></td>
                          <td data-label="Fecha">{formatDateTime(cut.closed_at, timezone)}</td>
                          <td data-label="Caja">{registerName(cut)}</td>
                          <td data-label="Creado por">{cut.created_by || "Equipo"}</td>
                          <td data-label="Resultado"><ResultBadge result={cut.result} /></td>
                          <td data-label="Total esperado"><Money value={cut.total_expected_amount} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!loadingCuts && cuts.items.length === 0 && <EmptyState title="No hay cortes con estos filtros" detail="Ajusta los filtros para consultar otros períodos." />}
                </div>
                <Pagination page={cutPage} total={cuts.total} onPage={setCutPage} />
              </section>
            </>
          )}
        </main>
      ) : (
        <main id={movementsPanelId} className="cash-surface" role="tabpanel" aria-labelledby={movementsTabId} tabIndex={0}>
          <div className="cash-primary-action cash-movement-action">
            <div><h2>Movimientos de efectivo</h2><p>Registra entradas y retiros para mantener exacto el próximo corte.</p></div>
            {!hasMovementTarget && <button className="button button-primary" type="button" disabled={!primaryRegister} onClick={() => setMovementOpen(true)}><Plus /> Agregar movimiento</button>}
          </div>
          <section className="cash-history panel">
            {hasMovementTarget && <div className="cash-movement-target"><strong>Movimiento {routeMovementId ? `#${routeMovementId}` : "no válido"}</strong><button type="button" className="button button-secondary" onClick={() => { const next = new URLSearchParams(routeParams); next.delete("movement_id"); next.delete("register_id"); setMovementPage(1); setRouteParams(next, { replace: true, state: location.state }); }}>Quitar filtro</button></div>}
            {invalidMovementTarget ? <ErrorState message="El enlace del movimiento no es válido." /> : movementError && <ErrorState message={movementError} onRetry={refresh} />}
            {!invalidMovementTarget && (loadingMovements && loadedMovementScope !== movementScope ? <LoadingState label="Cargando movimientos..." /> : loadedMovementScope === movementScope && (
              <>
                <p id={movementTableHintId} className="cash-table-scroll-hint">En pantallas pequeñas, cada fila muestra todos sus datos.</p>
                <div className="cash-table-scroll" role="region" aria-label="Movimientos de efectivo desplazables" aria-describedby={movementTableHintId} tabIndex={0}>
                  <table className="data-table cash-movements-table">
                    <thead><tr><th>Fecha</th><th>Caja</th><th>Tipo</th><th>Cantidad</th><th>Motivo</th><th>Registrado por</th></tr></thead>
                    <tbody>{movements.items.map((movement) => (
                      <tr key={movement.id}>
                        <td data-label="Fecha"><span className="cash-movement-reference">#{movement.id}</span>{formatDateTime(movement.created_at, timezone)}</td>
                        <td data-label="Caja">{movementRegisterName || registers.find((register) => register.id === movementRegisterId)?.name || `Caja #${movementRegisterId}`}</td>
                        <td data-label="Tipo"><span className={`cash-movement-type ${movement.movement_type === "withdrawal" ? "withdrawal" : "income"}`}>{movement.movement_type === "withdrawal" ? <ArrowUpRight /> : <ArrowDownLeft />}{movement.movement_type === "withdrawal" ? "Retiro" : "Entrada"}</span></td>
                        <td data-label="Cantidad"><strong><Money value={movement.amount} /></strong></td>
                        <td data-label="Motivo">{movement.note || "Sin motivo"}</td>
                        <td data-label="Registrado por">{movement.created_by || "Equipo"}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                  {!loadingMovements && movements.items.length === 0 && (
                    <div className="cash-movements-empty"><CircleDollarSign /><h3>{hasMovementTarget ? "No se encontró el movimiento" : "Aún no hay movimientos de efectivo"}</h3><p>{hasMovementTarget ? "El movimiento no está disponible en esta caja y sucursal." : "Las entradas y retiros aparecerán aquí después de registrarlos."}</p></div>
                  )}
                </div>
                <Pagination page={movementPage} total={movements.total} onPage={setMovementPage} />
              </>
            ))}
          </section>
        </main>
      )}

      {!primaryRegister && !loadingRegisters && <div className="cash-inline-alert" role="alert"><Landmark /> No hay una caja activa configurada para esta sucursal.</div>}
      {loadError && registers.length > 0 && <div className="cash-inline-alert" role="alert"><AlertCircle /> {loadError}</div>}

      {cutDrawerPreview && (
        <NewCutDrawer
          preview={cutDrawerPreview}
          timezone={timezone}
          onClose={closeCutDrawer}
          onSaved={(saved) => {
            setCutDrawerPreview(null);
            setLatestCut(saved);
            detailReturnFocusRef.current = cutReturnFocusRef.current;
            setDetail(saved);
            setToast({ message: "Corte de caja guardado correctamente.", tone: "success" });
            refresh();
          }}
        />
      )}
      {detail && <CutDetailModal detail={detail} timezone={timezone} onClose={closeDetail} />}
      {movementOpen && primaryRegister && (
        <MovementDialog
          register={primaryRegister}
          expectedVersion={preview?.version ?? 0}
          onClose={() => setMovementOpen(false)}
          onSaved={() => {
            setMovementOpen(false);
            setToast({ message: "Movimiento de efectivo registrado.", tone: "success" });
            refresh();
          }}
        />
      )}
      {toast && <Toast {...toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}

export function CashWorkspace() {
  const { branch } = useTenant();
  return <CashWorkspaceContent key={branch?.id ?? "no-branch"} />;
}
