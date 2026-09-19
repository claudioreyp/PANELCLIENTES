import { OrderDetailContent } from "../components/OrderDetailContent";
import { nextAction } from "../lib/order-detail-model";
import {
  ChevronRight,
  History,
} from "lucide-react";
import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { AuditReturnLink, positiveRouteId } from "../lib/audit-navigation";
import { NewOrderDrawer } from "../components/NewOrderDrawer";
import { NewOrderPaymentModal, type NewOrderCheckoutSelection } from "../components/NewOrderPaymentModal";
import { OrderCommandEditor } from "../components/OrderCommandEditor";
import { OrderProductPicker } from "../components/OrderProductPicker";
import { TableOrderDialog } from "../components/TableOrderDialog";
import { TablesWorkspace } from "../components/TablesWorkspace";
import { HistoricalOrderContent, TableHistory } from "../components/TableHistory";
import { DigitalCommandBoard } from "../components/DigitalCommandBoard";
import { OrderListPanel } from "../components/OrderListPanel";
import { OrderEditDrawer } from "../components/OrderEditDrawer";
import { activeCommandItems, CANCEL_ALL_ITEMS_MESSAGE, orderIdentityText, isActiveOrderItem, orderClipboardText, orderServiceChannel } from "../lib/order-presentation";
import { EmptyState, ErrorState, LoadingState, Modal, Toast } from "../components/ui";
import { api, apiBlob } from "../lib/api";
import { requestManualPrinting } from "../lib/print-events";
import { normalizeCatalogPayload } from "../lib/catalog";
import { useBranchRealtime } from "../lib/hooks";
import { useQuery } from "../lib/query-session";
import {
  serializeOrderCart,
  type OrderCartLine,
  type OrderDraftChannel,
} from "../lib/order-builder";
import {
  loadOrderDetail,
  mergeOrderItemsMutation,
  loadOrdersWorkspace,
  resolveIdempotentIntent,
  type IdempotentIntent,
} from "../lib/orders";
import { useTenant } from "../lib/tenant";
import type { Catalog, KitchenTicket, Order, OrderDetail, OrderItemsMutationResponse, OrderItemRevisionOperation, OrderWorkspaceItem, RestaurantTable } from "../types";

type ToastState = { message: string; tone: "success" | "error" } | null;
type OrdersTab = "orders" | "tables" | "commands";
type CheckoutResponse = Partial<Order> & { order?: Partial<Order> };
function isDefinitiveClientError(value: unknown) {
  if (!value || typeof value !== "object" || !("status" in value)) return false;
  const status = Number((value as { status?: unknown }).status);
  return status >= 400 && status < 500;
}
type EvidenceReviewResult = {
  notification?: {
    event_id?: string | null;
    recipient_available: boolean;
    queued: boolean;
    acknowledged: boolean;
  };
};

const PAGE_SIZE = 12;

function editableTicketItems(order: OrderDetail, ticket: KitchenTicket) {
  return activeCommandItems(order, ticket);
}

function orderChannelForPicker(channel: string): OrderDraftChannel {
  if (channel === "dine_in") return "dine_in";
  if (channel === "delivery") return "delivery";
  if (channel === "takeaway") return "takeaway";
  return "counter";
}

export function OrdersPage() {
  const [routeParams, setRouteParams] = useSearchParams();
  const routeLocation = useLocation();
  const routeOrderId = positiveRouteId(routeParams.get("order_id"));
  const { branch, context } = useTenant();
  const timezone = context?.business.timezone || "America/Lima";
  const [activeTab, setActiveTab] = useState<OrdersTab>("orders");
  const [tableHistoryOpen, setTableHistoryOpen] = useState(false);
  const [historicalSelection, setHistoricalSelection] = useState(false);
  const historyTriggerRef = useRef<HTMLButtonElement>(null);
  const [cancelReasonOpen, setCancelReasonOpen] = useState(false);
  const [cancellationReason, setCancellationReason] = useState("");
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailSyncError, setDetailSyncError] = useState<string | null>(null);
  const [deliveryExpanded, setDeliveryExpanded] = useState(false);
  const [newOrderOpen, setNewOrderOpen] = useState(false);
  const [newOrderTable, setNewOrderTable] = useState<RestaurantTable | null>(null);
  const [appendProductsOpen, setAppendProductsOpen] = useState(false);
  const [editingTicket, setEditingTicket] = useState<KitchenTicket | null>(null);
  const [editingOrder, setEditingOrder] = useState<OrderDetail | null>(null);
  const [working, setWorking] = useState(false);
  const printBusy = useRef(false);
  const [toast, setToast] = useState<ToastState>(null);
  const [evidenceImage, setEvidenceImage] = useState<string | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [selectedTable, setSelectedTable] = useState<RestaurantTable | null>(null);
  const [tableCheckoutMode, setTableCheckoutMode] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferTables, setTransferTables] = useState<RestaurantTable[]>([]);
  const [transferLoading, setTransferLoading] = useState(false);
  const selectedIdRef = useRef<number | null>(selectedId);
  const branchIdRef = useRef<number | undefined>(branch?.id);
  const mounted = useRef(true);
  const branchScopeRef = useRef({ id: branch?.id });
  // A callback belongs to one visit, not a later return to the same branch.
  if (branchScopeRef.current.id !== branch?.id) branchScopeRef.current = { id: branch?.id };
  const branchScope = branchScopeRef.current;
  const isCurrentBranch = useCallback(() => mounted.current && branchScopeRef.current === branchScope, [branchScope]);
  const detailRequest = useRef(0);
  const detailRef = useRef<OrderDetail | null>(detail);
  detailRef.current = detail;
  const canEditOrders = [context?.role, ...(context?.roles || [])].some((role) => ["superadmin", "owner", "manager", "cashier", "waiter"].includes(role || ""));
  const confirmIntent = useRef<IdempotentIntent | null>(null);
  const appendIntent = useRef<IdempotentIntent | null>(null);
  const revisionIntent = useRef<IdempotentIntent | null>(null);
  const checkoutIntent = useRef<IdempotentIntent | null>(null);
  const reopenCheckoutIntent = useRef<IdempotentIntent | null>(null);
  const tablePaymentIntent = useRef<IdempotentIntent | null>(null);
  const paymentIntents = useRef(new Map<string, string>());
  const openTableIntents = useRef(new Map<number, IdempotentIntent>());
  selectedIdRef.current = selectedId;
  branchIdRef.current = branch?.id;

  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  function isCurrentSelection(order: Pick<Order, "id" | "branch_id">) {
    return isCurrentBranch() && branchIdRef.current === order.branch_id && selectedIdRef.current === order.id;
  }

  const workspace = useQuery(["orders", branch?.id, deferredSearch, page, timezone], async () => {
    if (!branch) throw new Error("Selecciona una sucursal");
    return loadOrdersWorkspace({
      branchId: branch.id,
      period: "all",
      search: deferredSearch,
      page,
      pageSize: PAGE_SIZE,
      timezone,
    });
  }, 15000, activeTab === "orders");

  const catalogResource = useQuery(["catalog", branch?.id], async () => {
    if (!branch) throw new Error("Selecciona una sucursal");
    return normalizeCatalogPayload(await api<Catalog>(`/catalog?branch_id=${branch.id}`));
  }, 30000, activeTab !== "commands");

  const refreshDetail = useCallback(async (orderId: number) => {
    if (!branch || !isCurrentBranch() || selectedIdRef.current !== orderId) return;
    const requestedBranchId = branch.id;
    const requestId = ++detailRequest.current;
    setDetailLoading(true);
    try {
      const next = await loadOrderDetail(orderId, requestedBranchId, historicalSelection);
      if (
        !isCurrentBranch() || requestId !== detailRequest.current
        || selectedIdRef.current !== orderId
        || branchIdRef.current !== requestedBranchId
      ) return;
      if (detailRef.current?.id === next.id && detailRef.current.version > next.version) return;
      detailRef.current = next;
      setDetail(next);
      setDetailError(null);
      setDetailSyncError(null);
    } catch (caught) {
      if (
        !isCurrentBranch() || requestId !== detailRequest.current
        || selectedIdRef.current !== orderId
        || branchIdRef.current !== requestedBranchId
      ) return;
      if (detailRef.current?.id !== orderId || detailRef.current.branch_id !== requestedBranchId) {
        setDetail(null);
        setDetailError(caught instanceof Error ? caught.message : "No se pudo abrir el pedido.");
      } else {
        setDetailSyncError(caught instanceof Error ? caught.message : "No se pudo actualizar el pedido.");
      }
    } finally {
      if (isCurrentBranch() && requestId === detailRequest.current) setDetailLoading(false);
    }
  }, [branch, isCurrentBranch, historicalSelection]);

  useEffect(() => setPage(1), [deferredSearch, branch?.id]);

  useEffect(() => {
    setDetailSyncError(null);
    if (!selectedId) {
      detailRequest.current += 1;
      setDetail(null);
      setDetailError(null);
      setSelectedTable(null);
      setTableCheckoutMode(false);
      setEditingTicket(null);
      setEditingOrder(null);
      setTransferOpen(false);
      return;
    }
    setDeliveryExpanded(false);
    void refreshDetail(selectedId);
  }, [refreshDetail, selectedId]);

  useLayoutEffect(() => {
    selectedIdRef.current = null;
    detailRef.current = null;
    detailRequest.current += 1;
    setSelectedId(null);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(false);
    setTableHistoryOpen(false);
    setHistoricalSelection(false);
    setCancelReasonOpen(false);
    setCancellationReason("");
    setCancelError(null);
    setSelectedTable(null);
    setTableCheckoutMode(false);
    setPaymentOpen(false);
    setNewOrderOpen(false);
    setNewOrderTable(null);
    setAppendProductsOpen(false);
    setTransferOpen(false);
    setTransferTables([]);
    setTransferLoading(false);
    setWorking(false);
    setToast(null);
    setEditingOrder(null);
    setEditingTicket(null);
  }, [branch?.id]);

  useEffect(() => {
    if (!routeOrderId || !branch?.id) return;
    setActiveTab("orders");
    setHistoricalSelection(false);
    setSelectedTable(null);
    selectedIdRef.current = routeOrderId;
    setSelectedId(routeOrderId);
  }, [routeOrderId, branch?.id]);

  useEffect(() => {
    confirmIntent.current = null;
    appendIntent.current = null;
    revisionIntent.current = null;
    checkoutIntent.current = null;
    reopenCheckoutIntent.current = null;
    tablePaymentIntent.current = null;
    paymentIntents.current.clear();
  }, [selectedId, branch?.id]);

  useEffect(() => {
    if (!selectedTable || !detail || detail.id !== selectedId) return;
    setTableCheckoutMode(Boolean(detail.checkout_started_at && !detail.table_released_at));
  }, [detail, selectedId, selectedTable]);

  useBranchRealtime(branch?.id, () => {
    if (activeTab === "orders") void workspace.refresh();
    if (selectedId) void refreshDetail(selectedId);
  });

  const selectedEvidence = detail?.payment_evidence || null;
  const selectedEvidenceId = selectedEvidence?.id;
  const selectedEvidenceUrl = selectedEvidence?.image_url;

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setEvidenceImage(null);
    if (!selectedEvidenceId || !selectedEvidenceUrl) return;
    void apiBlob(selectedEvidenceUrl)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setEvidenceImage(objectUrl);
      })
      .catch(() => setEvidenceImage(null));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [selectedEvidenceId, selectedEvidenceUrl]);

  async function refreshOrder(orderId = selectedId) {
    if (!isCurrentBranch()) return;
    await workspace.refresh();
    if (isCurrentBranch() && orderId) await refreshDetail(orderId);
  }

  async function advance(order: OrderDetail) {
    if (!isCurrentSelection(order)) return;
    const action = nextAction(order);
    if (!action) return;
    setWorking(true);
    try {
      if (action.kind === "kitchen") {
        const body = JSON.stringify({ expected_version: order.version });
        confirmIntent.current = resolveIdempotentIntent(confirmIntent.current, `${order.id}:confirm:${order.version}`, body);
        await api(`/orders/${order.id}/confirm-and-send`, { method: "POST", idempotencyKey: confirmIntent.current.key, body: confirmIntent.current.body });
        if (!isCurrentSelection(order)) return;
        confirmIntent.current = null;
      } else {
        await api(`/orders/${order.id}/transition`, {
          method: "POST",
          body: JSON.stringify({ status: action.kind, expected_version: order.version }),
        });
      }
      await refreshOrder(order.id);
      if (!isCurrentSelection(order)) return;
      setToast({ message: `${action.label}: operación completada.`, tone: "success" });
    } catch (caught) {
      if (!isCurrentSelection(order)) return;
      if (isDefinitiveClientError(caught)) confirmIntent.current = null;
      setToast({ message: caught instanceof Error ? caught.message : "No se pudo actualizar el pedido.", tone: "error" });
    } finally {
      if (isCurrentSelection(order)) setWorking(false);
    }
  }

  async function appendProducts(lines: OrderCartLine[]) {
    if (!detail || !isCurrentSelection(detail) || !lines.length) return;
    setWorking(true);
    let appendCompleted = false;
    try {
      const items = serializeOrderCart(lines);
      const signature = `${detail.id}:append:${JSON.stringify(items)}`;
      appendIntent.current = resolveIdempotentIntent(
        appendIntent.current,
        signature,
        JSON.stringify({ expected_version: detail.version, items }),
      );
      let response = await api<OrderItemsMutationResponse>(`/orders/${detail.id}/item-batches`, {
        method: "POST",
        idempotencyKey: appendIntent.current.key,
        body: appendIntent.current.body,
      });
      if (!isCurrentSelection(detail)) return;
      appendCompleted = true;

      const shouldSendToKitchen = ["draft", "pending_confirmation"].includes(detail.status);
      if (shouldSendToKitchen) {
        const expectedVersion = Number(response.order?.version || detail.version + 1);
        const body = JSON.stringify({ expected_version: expectedVersion });
        confirmIntent.current = resolveIdempotentIntent(confirmIntent.current, `${detail.id}:confirm:${expectedVersion}`, body);
        response = await api<OrderItemsMutationResponse>(`/orders/${detail.id}/confirm-and-send`, {
          method: "POST",
          idempotencyKey: confirmIntent.current.key,
          body: confirmIntent.current.body,
        });
        if (!isCurrentSelection(detail)) return;
        confirmIntent.current = null;
      }

      if (!applyItemsResponse(response)) return;
      appendIntent.current = null;
      setAppendProductsOpen(false);
      setToast({ message: shouldSendToKitchen ? "Productos agregados y comanda enviada a cocina." : "Productos agregados y nueva comanda generada.", tone: "success" });
      void refreshOrder(detail.id).catch(() => undefined);
    } catch (caught) {
      if (!isCurrentSelection(detail)) return;
      if (isDefinitiveClientError(caught) && !appendCompleted) appendIntent.current = null;
      setToast({ message: caught instanceof Error ? caught.message : "No se pudieron agregar los productos.", tone: "error" });
    } finally {
      if (isCurrentSelection(detail)) setWorking(false);
    }
  }

  function openTicketEditor(ticket: KitchenTicket) {
    if (!detail) return;
    const editableItems = activeCommandItems(detail, ticket);
    if (!editableItems.length) {
      setToast({ message: "Esta comanda ya no tiene productos activos para editar.", tone: "error" });
      return;
    }
    setToast(null);
    setEditingTicket(ticket);
  }

  function applyItemsResponse(response: OrderItemsMutationResponse) {
    const current = detailRef.current;
    if (!current || !isCurrentSelection(response.order)) return false;
    detailRequest.current += 1;
    const updated = mergeOrderItemsMutation(current, response);
    detailRef.current = updated;
    setDetail(updated);
    setDetailError(null);
    setDetailLoading(false);
    return true;
  }

  async function saveItemRevisions(operations: OrderItemRevisionOperation[]) {
    if (!detail || !isCurrentSelection(detail) || !editingTicket || !operations.length) return;
    const cancelled = new Set(operations.filter((operation) => operation.type === "cancel").map((operation) => operation.item_id));
    if (!detail.items.some((item) => isActiveOrderItem(item) && !cancelled.has(item.id))) {
      setToast({ message: CANCEL_ALL_ITEMS_MESSAGE, tone: "error" });
      return;
    }
    setWorking(true);
    try {
      const body = JSON.stringify({ operations, expected_version: detail.version });
      const signature = `${detail.id}:revision:${JSON.stringify(operations)}`;
      revisionIntent.current = resolveIdempotentIntent(revisionIntent.current, signature, body);
      const response = await api<OrderItemsMutationResponse>(`/orders/${detail.id}/item-revisions`, {
        method: "POST",
        idempotencyKey: revisionIntent.current.key,
        body: revisionIntent.current.body,
      });
      if (!applyItemsResponse(response)) return;
      revisionIntent.current = null;
      setEditingTicket(null);
      setToast({ message: response.created_ticket_ids?.length ? "Corrección enviada en una nueva comanda." : "Comanda actualizada en cocina.", tone: "success" });
      void refreshOrder(detail.id).catch(() => undefined);
    } catch (caught) {
      if (!isCurrentSelection(detail)) return;
      if (isDefinitiveClientError(caught)) revisionIntent.current = null;
      setToast({ message: caught instanceof Error ? caught.message : "No se pudieron guardar las correcciones.", tone: "error" });
    } finally {
      if (isCurrentSelection(detail)) setWorking(false);
    }
  }

  function applyCheckoutResponse(response: CheckoutResponse, target: OrderDetail, checkoutMode: boolean) {
    if (!isCurrentSelection(target)) return false;
    const current = detailRef.current;
    const saved = response.order ?? response;
    if (!current || current.id !== target.id || current.branch_id !== target.branch_id
      || (saved.id != null && saved.id !== target.id)
      || (saved.branch_id != null && saved.branch_id !== target.branch_id)) return false;
    const newerRead = saved.version != null && current.version > saved.version;
    const updated = newerRead ? current : { ...current, ...saved, remaining_amount: Math.max(0, (saved.total ?? current.total) - current.paid_amount) };
    detailRequest.current += 1;
    detailRef.current = updated;
    setDetail(updated);
    setDetailError(null);
    setDetailLoading(false);
    setTableCheckoutMode(newerRead || saved.checkout_started_at !== undefined
      ? Boolean(updated.checkout_started_at && !updated.table_released_at)
      : checkoutMode);
    return true;
  }

  async function startTableCheckout() {
    if (!detail || !isCurrentSelection(detail) || working) return;
    setWorking(true);
    try {
      const body = JSON.stringify({ expected_version: detail.version });
      checkoutIntent.current = resolveIdempotentIntent(checkoutIntent.current, `${detail.id}:table-checkout:start:${detail.version}`, body);
      const response = await api<CheckoutResponse>(`/orders/${detail.id}/table-checkout/start`, {
        method: "POST",
        idempotencyKey: checkoutIntent.current.key,
        body: checkoutIntent.current.body,
      });
      if (!applyCheckoutResponse(response, detail, true)) return;
      checkoutIntent.current = null;
      setToast({ message: "Mesa cerrada para cobro.", tone: "success" });
      void refreshOrder(detail.id);
    } catch (caught) {
      if (!isCurrentSelection(detail)) return;
      if (isDefinitiveClientError(caught)) checkoutIntent.current = null;
      setToast({ message: caught instanceof Error ? caught.message : "No se pudo cerrar la mesa.", tone: "error" });
    } finally {
      if (isCurrentSelection(detail)) setWorking(false);
    }
  }

  async function reopenTableCheckout() {
    if (!detail || !isCurrentSelection(detail) || working) return;
    setWorking(true);
    try {
      const body = JSON.stringify({ expected_version: detail.version });
      reopenCheckoutIntent.current = resolveIdempotentIntent(reopenCheckoutIntent.current, `${detail.id}:table-checkout:reopen:${detail.version}`, body);
      const response = await api<CheckoutResponse>(`/orders/${detail.id}/table-checkout/reopen`, {
        method: "POST",
        idempotencyKey: reopenCheckoutIntent.current.key,
        body: reopenCheckoutIntent.current.body,
      });
      if (!applyCheckoutResponse(response, detail, false)) return;
      reopenCheckoutIntent.current = null;
      setToast({ message: "Mesa reabierta para editar el pedido.", tone: "success" });
      void refreshOrder(detail.id);
    } catch (caught) {
      if (!isCurrentSelection(detail)) return;
      if (isDefinitiveClientError(caught)) reopenCheckoutIntent.current = null;
      setToast({ message: caught instanceof Error ? caught.message : "No se pudo reabrir la mesa.", tone: "error" });
    } finally {
      if (isCurrentSelection(detail)) setWorking(false);
    }
  }

  async function reviewEvidence(approve: boolean) {
    if (!detail || !isCurrentSelection(detail) || !selectedEvidence) return;
    const question = approve
      ? "¿Confirmas que el monto y los datos del comprobante son correctos? El pedido pasará a cocina."
      : "¿Rechazar este comprobante? El pedido se cancelará y el stock reservado será revertido.";
    if (!window.confirm(question)) return;
    setWorking(true);
    try {
      const result = await api<EvidenceReviewResult>(`/payment-evidence/${selectedEvidence.id}/review`, {
        method: "POST",
        body: JSON.stringify({ approve }),
      });
      await refreshOrder(detail.id);
      if (!isCurrentSelection(detail)) return;
      const approvalMessage = !result.notification
        ? "Pago aprobado y pedido enviado a preparación. El aviso será procesado por WhatsApp."
        : !result.notification.recipient_available
          ? "Pago aprobado y pedido enviado a preparación. No existe un chat de WhatsApp asociado para avisar al cliente."
          : result.notification.queued
            ? "Pago aprobado, pedido enviado a preparación y aviso al cliente en cola."
            : result.notification.acknowledged
              ? "Pago aprobado y aviso entregado al canal de WhatsApp."
              : "Pago aprobado y pedido enviado a preparación; el aviso quedó pendiente.";
      setToast({ message: approve ? approvalMessage : "Comprobante rechazado y stock liberado.", tone: "success" });
    } catch (caught) {
      if (!isCurrentSelection(detail)) return;
      setToast({ message: caught instanceof Error ? caught.message : "No se pudo revisar el comprobante.", tone: "error" });
    } finally {
      if (isCurrentSelection(detail)) setWorking(false);
    }
  }

  async function cancelOrder(order: OrderDetail, reason?: string) {
    if (!isCurrentSelection(order)) return;
    if (reason === undefined) {
      setCancellationReason("");
      setCancelError(null);
      setCancelReasonOpen(true);
      return;
    }
    if (working || !reason.trim()) return;
    setWorking(true);
    setCancelError(null);
    try {
      const saved = await api<Order>(`/orders/${order.id}/transition`, {
        method: "POST",
        body: JSON.stringify({ status: "cancelled", expected_version: order.version, reason: reason.trim() }),
      });
      if (!isCurrentSelection(order)) return;
      setCancelReasonOpen(false);
      setCancellationReason("");
      const updated = { ...order, ...saved, cancellation_reason: reason.trim(), kitchen_tickets: order.kitchen_tickets.map((ticket) => ["queued", "preparing"].includes(ticket.status) ? { ...ticket, status: "cancelled" as const } : ticket) };
      detailRef.current = updated;
      setDetail(updated);
      workspace.setData((current) => current ? { ...current, items: current.items.map((item) => item.id === order.id ? { ...item, status: saved.status, payment_status: saved.payment_status, version: saved.version, total: saved.total, requires_review: false } : item) } : current);
      setWorking(false);
      if (selectedTable) {
        setSelectedId(null);
        setSelectedTable(null);
        setTableCheckoutMode(false);
      } else {
        void refreshDetail(order.id);
      }
      void workspace.refresh();
      setToast({ message: "Pedido cancelado y stock revertido.", tone: "success" });
    } catch (caught) {
      if (!isCurrentSelection(order)) return;
      setCancelError(caught instanceof Error ? caught.message : "No se pudo cancelar el pedido.");
    } finally {
      if (isCurrentSelection(order)) setWorking(false);
    }
  }

  function openPayment() {
    if (!branch) return;
    setToast(null);
    setPaymentOpen(true);
  }

  async function createPayment(selection: NewOrderCheckoutSelection) {
    if (!detail || !isCurrentSelection(detail) || selection.deferPayment || working) return;
    const orderId = detail.id;
    const isTablePayment = Boolean(selectedTable && tableCheckoutMode);
    const shouldSendToKitchen = ["draft", "pending_confirmation"].includes(detail.status);
    setWorking(true);
    try {
      if (isTablePayment) {
        const payments = selection.plan.payments.map((payment) => ({
          method: payment.method,
          amount: payment.amount,
          cash_session_id: payment.cashSessionId || null,
          note: payment.method === "cash" && payment.cashReceived != null
            ? `Efectivo recibido: ${payment.cashReceived.toFixed(2)} PEN. Cambio: ${selection.plan.change.toFixed(2)} PEN.`
            : null,
        }));
        const body = JSON.stringify({ expected_version: detail.version, payments });
        const signature = `${orderId}:table-checkout:pay:${body}`;
        tablePaymentIntent.current = resolveIdempotentIntent(tablePaymentIntent.current, signature, body);
        await api(`/orders/${orderId}/table-checkout/pay`, {
          method: "POST",
          idempotencyKey: tablePaymentIntent.current.key,
          body: tablePaymentIntent.current.body,
        });
        if (!isCurrentSelection(detail)) return;
        tablePaymentIntent.current = null;
        setWorking(false);
        setPaymentOpen(false);
        setSelectedId(null);
        setSelectedTable(null);
        setTableCheckoutMode(false);
        setDetail(null);
        void workspace.refresh();
        setToast({ message: "Mesa cobrada y liberada. Cocina continuará con las comandas pendientes.", tone: "success" });
        return;
      }

      let expectedVersion = detail.version;
      for (const payment of selection.plan.payments) {
        const note = payment.method === "cash" && payment.cashReceived != null
          ? `Efectivo recibido: ${payment.cashReceived.toFixed(2)} PEN. Cambio: ${selection.plan.change.toFixed(2)} PEN.`
          : undefined;
        const body = JSON.stringify({
          method: payment.method,
          amount: payment.amount,
          cash_session_id: payment.cashSessionId || null,
          note,
          expected_version: expectedVersion,
        });
        const signature = `${orderId}:payment:${body}`;
        let idempotencyKey = paymentIntents.current.get(signature);
        if (!idempotencyKey) {
          idempotencyKey = crypto.randomUUID();
          paymentIntents.current.set(signature, idempotencyKey);
        }
        const response = await api<{ order?: { version?: number } }>(`/orders/${orderId}/payments`, {
          method: "POST",
          idempotencyKey,
          body,
        });
        if (!isCurrentSelection(detail)) return;
        expectedVersion = Number(response.order?.version || expectedVersion + 1);
      }

      if (shouldSendToKitchen) {
        const body = JSON.stringify({ expected_version: expectedVersion });
        confirmIntent.current = resolveIdempotentIntent(confirmIntent.current, `${orderId}:confirm`, body);
        await api(`/orders/${orderId}/confirm-and-send`, {
          method: "POST",
          idempotencyKey: confirmIntent.current.key,
          body: confirmIntent.current.body,
        });
        if (!isCurrentSelection(detail)) return;
        confirmIntent.current = null;
      }

      paymentIntents.current.clear();
      setPaymentOpen(false);
      await refreshOrder(orderId);
      if (!isCurrentSelection(detail)) return;
      setToast({ message: shouldSendToKitchen ? "Pago registrado y pedido enviado a cocina." : "Pago registrado correctamente.", tone: "success" });
    } catch (caught) {
      if (!isCurrentSelection(detail)) return;
      if (isDefinitiveClientError(caught)) {
        paymentIntents.current.clear();
        confirmIntent.current = null;
        if (isTablePayment) tablePaymentIntent.current = null;
      }
      setPaymentOpen(false);
      await refreshOrder(orderId);
      if (!isCurrentSelection(detail)) return;
      setToast({
        message: isTablePayment
          ? caught instanceof Error ? caught.message : "No se pudo cobrar y liberar la mesa."
          : shouldSendToKitchen
          ? "No pudimos completar toda la operación. Revisa el pago y el estado de cocina antes de reintentar."
          : caught instanceof Error ? caught.message : "No se pudo registrar el pago.",
        tone: "error",
      });
    } finally {
      if (isCurrentSelection(detail)) setWorking(false);
    }
  }

  const data = workspace.data?.branch_id === branch?.id ? workspace.data : null;

  function openOrder(order: OrderWorkspaceItem, historical = false) {
    setHistoricalSelection(historical);
    setSelectedTable(null);
    setTableCheckoutMode(false);
    setDetail(null);
    setDetailError(null);
    setSelectedId(order.id);
  }

  async function openTableOrder(table: RestaurantTable) {
    if (!branch || !isCurrentBranch() || table.branch_id !== branch.id) throw new Error("Selecciona una sucursal antes de abrir la mesa.");
    const payload = JSON.stringify({
      branch_id: branch.id,
      channel: "dine_in",
      table_id: table.id,
      customer_name: null,
      customer_phone: null,
      delivery_address: null,
      delivery_fee: 0,
      discount: 0,
      notes: null,
      items: [],
    });
    const intent = resolveIdempotentIntent(
      openTableIntents.current.get(table.id) || null,
      `${branch.id}:table:${table.id}:open`,
      payload,
    );
    openTableIntents.current.set(table.id, intent);
    try {
      const order = await api<{ id: number }>("/orders", {
        method: "POST",
        idempotencyKey: intent.key,
        body: intent.body,
      });
      if (!isCurrentBranch()) return;
      openTableIntents.current.delete(table.id);
      setSelectedTable({ ...table, status: "occupied", active_order_id: order.id });
      setTableCheckoutMode(false);
      setDetail(null);
      setDetailError(null);
      setSelectedId(order.id);
      void workspace.refresh();
    } catch (caught) {
      if (!isCurrentBranch()) return;
      if (isDefinitiveClientError(caught)) openTableIntents.current.delete(table.id);
      throw caught;
    }
  }

  function openExistingTableOrder(orderId: number, table: RestaurantTable) {
    if (!isCurrentBranch() || table.branch_id !== branch?.id) return;
    setSelectedTable(table);
    setTableCheckoutMode(false);
    setDetail(null);
    setDetailError(null);
    setSelectedId(orderId);
  }

  function closeSelectedOrder() {
    if (routeParams.has("order_id")) {
      const next = new URLSearchParams(routeParams);
      next.delete("order_id");
      setRouteParams(next, { replace: true, state: routeLocation.state });
    }
    selectedIdRef.current = null;
    setWorking(false);
    setSelectedId(null);
    setSelectedTable(null);
    setHistoricalSelection(false);
    setCancelReasonOpen(false);
    setTableCheckoutMode(false);
    setEditingTicket(null);
    setAppendProductsOpen(false);
    setTransferOpen(false);
  }

  async function printOrderDocument(ticket?: KitchenTicket) {
    if (!detail || !isCurrentSelection(detail) || working || printBusy.current) return;
    const target = detail;
    printBusy.current = true;
    setWorking(true);
    try {
      await requestManualPrinting({ orderId: target.id, branchId: target.branch_id, orderVersion: target.version, ticketId: ticket?.id, ticketVersion: ticket?.version });
    } catch (caught) {
      if (!isCurrentSelection(target)) return;
      setToast({ message: caught instanceof Error ? caught.message : "No se pudo imprimir el documento.", tone: "error" });
    } finally {
      printBusy.current = false;
      if (isCurrentSelection(target)) setWorking(false);
    }
  }

  async function copyOrder() {
    if (!detail || !isCurrentSelection(detail)) return;
    try {
      await navigator.clipboard.writeText(orderClipboardText(detail));
      if (!isCurrentSelection(detail)) return;
      setToast({ message: "Resumen del pedido copiado.", tone: "success" });
    } catch {
      if (!isCurrentSelection(detail)) return;
      setToast({ message: "El navegador no permitió copiar el resumen. Habilita el permiso del portapapeles e inténtalo nuevamente.", tone: "error" });
    }
  }

  function finishOrderEdit(saved: Order) {
    if (!isCurrentSelection(saved)) return;
    detailRequest.current += 1;
    setDetail((current) => current?.id === saved.id && current.version <= saved.version ? { ...current, ...saved, remaining_amount: Math.max(0, saved.total - current.paid_amount) } : current);
    setDetailError(null);
    setDetailLoading(false);
    setEditingOrder(null);
    setToast({ message: "Cambios del pedido guardados.", tone: "success" });
    void workspace.refresh();
    void loadOrderDetail(saved.id, saved.branch_id).then((fresh) => {
      if (!isCurrentSelection(saved)) return;
      setDetail((current) => current?.id === fresh.id && current.version <= fresh.version ? fresh : current);
    }).catch(() => { /* A confirmed edit remains successful when the refresh is unavailable. */ });
  }

  async function openTransfer() {
    if (!branch || !detail || !isCurrentSelection(detail)) return;
    setTransferOpen(true);
    setTransferLoading(true);
    try {
      const tables = await api<RestaurantTable[]>(`/tables?branch_id=${branch.id}`);
      if (!isCurrentSelection(detail)) return;
      setTransferTables(tables.filter((table) => table.id !== selectedTable?.id && table.status === "available" && table.active_order_id == null));
    } catch (caught) {
      if (!isCurrentSelection(detail)) return;
      setTransferOpen(false);
      setToast({ message: caught instanceof Error ? caught.message : "No se pudieron consultar las mesas disponibles.", tone: "error" });
    } finally {
      if (isCurrentSelection(detail)) setTransferLoading(false);
    }
  }

  async function transferOrder(target: RestaurantTable) {
    if (!detail || !isCurrentSelection(detail) || target.branch_id !== detail.branch_id) return;
    setWorking(true);
    try {
      await api(`/orders/${detail.id}`, {
        method: "PATCH",
        body: JSON.stringify({ table_id: target.id, expected_version: detail.version }),
      });
      if (!isCurrentSelection(detail)) return;
      setSelectedTable({ ...target, status: "occupied", active_order_id: detail.id });
      setTransferOpen(false);
      await refreshOrder(detail.id);
      if (!isCurrentSelection(detail)) return;
      setToast({ message: `Pedido transferido a ${target.name}.`, tone: "success" });
    } catch (caught) {
      if (!isCurrentSelection(detail)) return;
      setToast({ message: caught instanceof Error ? caught.message : "No se pudo transferir el pedido.", tone: "error" });
    } finally {
      if (isCurrentSelection(detail)) setWorking(false);
    }
  }

  function openNewOrder(table: RestaurantTable | null = null) {
    if (!catalogResource.data) {
      setToast({ message: "El menú todavía se está cargando. Inténtalo nuevamente en unos segundos.", tone: "error" });
      return;
    }
    setNewOrderTable(table);
    setNewOrderOpen(true);
  }

  const tabs: { value: OrdersTab; label: string }[] = [
    { value: "orders", label: "Panel de pedidos" },
    { value: "tables", label: "Panel de mesas" },
    { value: "commands", label: "Comandas digitales" },
  ];

  return (
    <div className="orders-page">
      <h1 className="orders-heading">Pedidos</h1>

      <nav className="orders-tabs" role="tablist" aria-label="Secciones de pedidos">{tabs.map((tab) => <button key={tab.value} type="button" role="tab" id={`orders-tab-${tab.value}`} aria-controls={`orders-panel-${tab.value}`} aria-selected={activeTab === tab.value} tabIndex={activeTab === tab.value ? 0 : -1} className={activeTab === tab.value ? "active" : ""} onClick={() => setActiveTab(tab.value)} onKeyDown={(event) => { if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return; event.preventDefault(); const buttons = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role='tab']") || []); const current = buttons.indexOf(event.currentTarget); const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (current + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length; buttons[next]?.focus(); buttons[next]?.click(); }}>{tab.label}</button>)}</nav>

      {activeTab === "orders" && <div id="orders-panel-orders" role="tabpanel" aria-labelledby="orders-tab-orders" className="orders-tab-panel">
        {!selectedId && <AuditReturnLink />}
        {routeParams.has("order_id") && !routeOrderId && <ErrorState message="El enlace del pedido no es válido." />}
        {workspace.error && data && <div className="orders-sync-warning" role="alert"><span>No se pudo actualizar el listado. Conservamos la última consulta. {workspace.error}</span><button className="button button-secondary" type="button" onClick={() => void workspace.refresh()}>Reintentar</button></div>}
        {workspace.loading && !data ? <LoadingState label="Abriendo pedidos..." /> : workspace.error && !data ? <ErrorState message={workspace.error} onRetry={() => void workspace.refresh()} /> : <>
          <OrderListPanel items={data?.items || []} total={data?.total || 0} reviewCount={data?.review_count || 0}
            page={data?.page || page} pageSize={PAGE_SIZE} allDates search={search}
            loading={workspace.loading} canCreate={Boolean(catalogResource.data)}
            onPage={setPage} onSearch={setSearch}
            onRefresh={() => void workspace.refresh()} onCreate={() => openNewOrder()} onOpen={openOrder} />
        </>}
      </div>}
      {activeTab === "tables" && <div id="orders-panel-tables" role="tabpanel" aria-labelledby="orders-tab-tables" className="orders-tab-panel">{tableHistoryOpen && branch ? <TableHistory key={branch.id} branchId={branch.id} onBack={() => { setTableHistoryOpen(false); window.requestAnimationFrame(() => historyTriggerRef.current?.focus()); }} onOpen={(order) => openOrder(order, true)} /> : <><div className="tables-history-actions"><button ref={historyTriggerRef} className="button button-secondary" type="button" onClick={() => setTableHistoryOpen(true)}><History aria-hidden="true" /> Ver historial</button></div><TablesWorkspace onStartOrder={openTableOrder} onOpenOrder={openExistingTableOrder} /></>}</div>}
      {activeTab === "commands" && <div id="orders-panel-commands" role="tabpanel" aria-labelledby="orders-tab-commands" className="orders-tab-panel"><DigitalCommandBoard branchId={branch?.id} /></div>}

      {selectedId && selectedTable && !paymentOpen && !transferOpen && (detail?.id === selectedId && detail.branch_id === branch?.id
        ? <TableOrderDialog order={detail} table={selectedTable} checkoutMode={tableCheckoutMode} working={working} onClose={closeSelectedOrder} onStartCheckout={() => void startTableCheckout()} onReopenCheckout={() => void reopenTableCheckout()} onAppend={() => setAppendProductsOpen(true)} onEditTicket={openTicketEditor} onPrintAccount={() => void printOrderDocument()} onPrintTicket={(ticket) => void printOrderDocument(ticket)} onPayment={openPayment} onTransfer={() => void openTransfer()} onCancel={() => void cancelOrder(detail)} />
        : <Modal title={`Cuenta de ${selectedTable.name}`} onClose={closeSelectedOrder}>{detailLoading ? <LoadingState label="Abriendo la mesa..." /> : detailError ? <ErrorState message={detailError} onRetry={() => void refreshDetail(selectedId)} /> : <LoadingState label="Sincronizando la cuenta..." />}</Modal>)}

      {selectedId && !selectedTable && !paymentOpen && !editingOrder && !editingTicket && !appendProductsOpen && <Modal
        title={detail?.id === selectedId ? `Pedido ${orderIdentityText(detail)}` : "Detalle del pedido"}
        onClose={closeSelectedOrder} wide={!historicalSelection} className={historicalSelection ? "history-order-modal" : "order-detail-modal"}
      >
        <AuditReturnLink />
        {detailSyncError && <div className="orders-sync-warning" role="alert"><span>Conservamos el último detalle confirmado. {detailSyncError}</span><button className="button button-secondary" type="button" onClick={() => void refreshDetail(selectedId)}>Reintentar</button></div>}
        {detailLoading && detail?.id !== selectedId ? <LoadingState label="Cargando detalle..." />
          : detailError ? <ErrorState message={detailError} onRetry={() => void refreshDetail(selectedId)} />
            : detail?.id === selectedId && detail.branch_id === branch?.id && (historicalSelection
              ? <HistoricalOrderContent key={detail.id} order={detail} busy={working} onPrint={() => void printOrderDocument()} onPrintTicket={(ticket) => void printOrderDocument(ticket)} />
              : <OrderDetailContent key={detail.id} order={detail} evidenceImage={evidenceImage} deliveryExpanded={deliveryExpanded} working={working} canEdit={canEditOrders} onEdit={() => setEditingOrder(detail)} onCopy={() => void copyOrder()} onEditTicket={openTicketEditor} onPrintTicket={(ticket) => void printOrderDocument(ticket)} onDeliveryToggle={() => setDeliveryExpanded((current) => !current)} onPrint={() => void printOrderDocument()} onPayment={openPayment} onAppend={() => setAppendProductsOpen(true)} onReview={reviewEvidence} onAdvance={() => void advance(detail)} onCancel={() => void cancelOrder(detail)} />)}
      </Modal>}

      {cancelReasonOpen && detail && <Modal title="Cancelar pedido" className="order-cancel-modal" onClose={() => { if (!working && (!cancellationReason.trim() || window.confirm("¿Descartar el motivo y volver al pedido?"))) setCancelReasonOpen(false); }}><form className="form-stack" onSubmit={(event) => { event.preventDefault(); void cancelOrder(detail, cancellationReason); }}><p>El stock reservado será revertido y la acción quedará auditada. Los cobros confirmados no se anulan automáticamente.</p><label>Motivo de cancelación<textarea value={cancellationReason} maxLength={1000} required disabled={working} aria-describedby={cancelError ? "cancel-order-error" : undefined} onChange={(event) => setCancellationReason(event.target.value)} /></label>{cancelError && <p id="cancel-order-error" role="alert">{cancelError}</p>}<div className="modal-form-actions"><button className="button button-secondary" type="button" disabled={working} onClick={() => setCancelReasonOpen(false)}>Volver al pedido</button><button className="button button-primary" type="submit" disabled={working || !cancellationReason.trim()}>{working ? "Cancelando..." : "Confirmar cancelación"}</button></div></form></Modal>}

      {newOrderOpen && branch && catalogResource.data && <NewOrderDrawer branch={branch} catalog={catalogResource.data} initialChannel={newOrderTable ? "dine_in" : "counter"} table={newOrderTable} onClose={() => { if (!isCurrentBranch()) return; setNewOrderOpen(false); setNewOrderTable(null); }} onError={(message) => { if (isCurrentBranch()) setToast({ message, tone: "error" }); }} onCreated={(completion) => {
        if (!isCurrentBranch()) return;
        const wasTableOrder = Boolean(newOrderTable);
        setNewOrderOpen(false);
        setNewOrderTable(null);
        const messages = {
          pending_and_sent: wasTableOrder ? "Comanda enviada a cocina. La cuenta de mesa queda pendiente de pago." : "Comanda enviada a cocina. Pago pendiente.",
          paid_and_sent: "Pedido pagado y enviado a cocina.",
          payment_failed: completion.message || "El pedido se guardó, pero no se pudo completar el cobro.",
          confirmation_failed: completion.message || "El pago se registró, pero no pudimos verificar el envío a cocina.",
          total_changed: completion.message || "El total cambió. Revisa el pedido antes de cobrar.",
        };
        setToast({
          message: messages[completion.outcome],
          tone: completion.outcome === "pending_and_sent" || completion.outcome === "paid_and_sent" ? "success" : "error",
        });
        void workspace.refresh();
        setSelectedId(completion.orderId);
      }} />}
      {appendProductsOpen && detail && catalogResource.data && <OrderProductPicker title={selectedTable ? `Agregar productos a ${selectedTable.name}` : "Agregar productos al pedido"} catalog={catalogResource.data} channel={orderChannelForPicker(detail.channel)} onClose={() => setAppendProductsOpen(false)} onSave={(lines) => void appendProducts(lines)} />}
      {editingTicket && detail && catalogResource.data && <OrderCommandEditor ticket={editingTicket} items={editableTicketItems(detail, editingTicket)} activeItemCount={detail.items.filter(isActiveOrderItem).length} catalog={catalogResource.data} serviceChannel={orderServiceChannel(detail)} busy={working} onClose={() => setEditingTicket(null)} onSave={(operations) => void saveItemRevisions(operations)} />}
      {editingOrder && branch && editingOrder.branch_id === branch.id && <OrderEditDrawer key={`${branch.id}:${editingOrder.id}`} order={editingOrder} branch={branch} onClose={() => setEditingOrder(null)} onSaved={finishOrderEdit} />}
      {paymentOpen && detail && branch && <NewOrderPaymentModal branch={branch} total={detail.remaining_amount > 0 ? detail.remaining_amount : detail.total} busy={working} allowDeferredPayment={false} helperText={selectedTable && tableCheckoutMode ? "Al cobrar, la mesa quedará libre de inmediato aunque cocina siga preparando sus comandas." : ["draft", "pending_confirmation"].includes(detail.status) ? "Al registrar el pago, el pedido se enviará directamente a cocina." : "El pago quedará registrado en este pedido."} onClose={() => setPaymentOpen(false)} onConfirm={(selection) => void createPayment(selection)} />}
      {transferOpen && <Modal title="Transferir pedido" className="table-transfer-modal" onClose={() => !working && setTransferOpen(false)}>{transferLoading ? <LoadingState label="Buscando mesas libres..." /> : transferTables.length ? <div className="table-transfer-options"><p>Selecciona la mesa libre que recibirá esta cuenta.</p>{transferTables.map((table) => <button key={table.id} type="button" disabled={working} onClick={() => void transferOrder(table)}><span><strong>{table.name}</strong><small>Capacidad para {table.capacity} personas</small></span><ChevronRight /></button>)}</div> : <EmptyState title="No hay mesas libres" detail="Libera otra mesa o vuelve a intentarlo cuando esté disponible." />}</Modal>}
      {toast && <Toast {...toast} durationMs={toast.tone === "success" ? 4500 : undefined} onDismiss={() => setToast(null)} />}
    </div>
  );
}
