import { productUnavailableReason } from "../lib/availability";
import { ArrowRight, ChevronDown, Minus, Plus, Search, ShoppingCart, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ModifierGroupSelector } from "../components/ModifierGroupSelector";
import { api } from "../lib/api";
import { normalizeCatalogPayload, validateProductSelection } from "../lib/catalog";
import { usePolling } from "../lib/hooks";
import {
  addOrderLine,
  changeOrderLineQuantity,
  configureOrderLine,
  modifierSelectionLabel,
  orderCartSubtotal,
  orderModifierGroupSelection,
  replaceOrderModifierGroupSelection,
  serializeOrderCart,
  type OrderCartLine,
} from "../lib/order-builder";
import { useTenant } from "../lib/tenant";
import type { Catalog, Product, RestaurantTable } from "../types";
import { NewOrderPaymentModal, type NewOrderCheckoutSelection } from "../components/NewOrderPaymentModal";
import { ErrorState, LoadingState, Modal, Money, PageHeader, Toast } from "../components/ui";

const channels = [
  { value: "dine_in", label: "Salón" },
  { value: "counter", label: "Mostrador" },
  { value: "takeaway", label: "Para llevar" },
  { value: "delivery", label: "Delivery" },
];

export function PosPage() {
  const { branch } = useTenant();
  const [searchParams] = useSearchParams();
  const [category, setCategory] = useState<number | "all">("all");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<OrderCartLine[]>([]);
  const [channel, setChannel] = useState("dine_in");
  const [tableId, setTableId] = useState<number | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [address, setAddress] = useState("");
  const [orderNotes, setOrderNotes] = useState("");
  const [discount, setDiscount] = useState(0);
  const [configuring, setConfiguring] = useState<Product | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<number | null>(null);
  const [selectedModifiers, setSelectedModifiers] = useState<number[]>([]);
  const [itemNotes, setItemNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);
  const saveIntent = useRef<{ signature: string; key: string } | null>(null);
  const paymentIntents = useRef(new Map<string, string>());
  const confirmationIntent = useRef<{ signature: string; key: string } | null>(null);

  useEffect(() => {
    const requestedTable = Number(searchParams.get("table"));
    if (requestedTable) {
      setChannel("dine_in");
      setTableId(requestedTable);
    }
  }, [searchParams]);

  const resource = usePolling(async () => {
    if (!branch) throw new Error("Selecciona una sucursal");
    const [catalog, tables] = await Promise.all([
      api<Catalog>(`/catalog?branch_id=${branch.id}`),
      api<RestaurantTable[]>(`/tables?branch_id=${branch.id}`),
    ]);
    return { catalog: normalizeCatalogPayload(catalog), tables };
  }, [branch?.id], 30000);

  if (resource.loading && !resource.data) return <LoadingState />;
  if (resource.error && !resource.data) return <ErrorState message={resource.error} onRetry={() => void resource.refresh()} />;
  const { catalog, tables } = resource.data!;
  const filtered = catalog.products.filter((product) => {
    const matchesCategory = category === "all" || product.category_id === category;
    const term = search.trim().toLowerCase();
    return matchesCategory && (!term || product.name.toLowerCase().includes(term) || product.sku.toLowerCase().includes(term));
  });
  const subtotal = orderCartSubtotal(cart);
  const deliveryFee = channel === "delivery" ? Number(branch?.delivery_fee || 0) : 0;
  const total = Math.max(0, subtotal - discount + deliveryFee);

  function beginProduct(product: Product) {
    const activeVariants = product.variants.filter((variant) => variant.active && variant.available !== false);
    const needsConfiguration = activeVariants.length > 0
      || product.modifier_groups.length > 0
      || product.combo_components.length > 0;
    if (needsConfiguration) {
      setConfiguring(product);
      setSelectedVariant(activeVariants[0]?.id || null);
      setSelectedModifiers([]);
      setItemNotes("");
    } else addConfigured(product, null, [], "");
  }

  function addConfigured(product: Product, variantId: number | null, modifierIds: number[], notes: string) {
    const configured = configureOrderLine(product, variantId, modifierIds, notes);
    if (!configured.line) {
      setToast({ message: configured.error || "Revisa las opciones del producto.", tone: "error" });
      return;
    }
    setCart((current) => addOrderLine(current, configured.line!));
    setConfiguring(null);
  }

  function setModifierGroupSelection(groupId: number, nextGroupSelection: number[]) {
    if (!configuring) return;
    setSelectedModifiers((current) => replaceOrderModifierGroupSelection(
      configuring,
      current,
      groupId,
      nextGroupSelection,
    ));
  }

  function quantity(key: string, delta: number) {
    setCart((current) => changeOrderLineQuantity(current, key, delta));
  }

  function validateOrder() {
    if (!branch || !cart.length) return;
    if (channel === "dine_in" && !tableId) {
      setToast({ message: "Selecciona una mesa para el pedido de salón.", tone: "error" });
      return false;
    }
    if (channel === "delivery" && (!customerName || !customerPhone || !address)) {
      setToast({ message: "Completa cliente, teléfono y dirección para delivery.", tone: "error" });
      return false;
    }
    return true;
  }

  function continueToCheckout() {
    if (!validateOrder()) return;
    setCheckoutOpen(true);
  }

  function clearOrder() {
    setCart([]);
    setTableId(null);
    setCustomerName("");
    setCustomerPhone("");
    setAddress("");
    setOrderNotes("");
    setDiscount(0);
    saveIntent.current = null;
    paymentIntents.current.clear();
    confirmationIntent.current = null;
  }

  async function completeOrder(selection: NewOrderCheckoutSelection) {
    if (!branch || !cart.length || !validateOrder()) return;
    setSaving(true);
    try {
      const body = JSON.stringify({
        branch_id: branch.id,
        channel,
        table_id: channel === "dine_in" ? tableId : null,
        customer_name: customerName || null,
        customer_phone: customerPhone || null,
        delivery_address: channel === "delivery" ? { address } : null,
        delivery_fee: deliveryFee,
        discount,
        notes: orderNotes || null,
        items: serializeOrderCart(cart),
      });
      if (!saveIntent.current || saveIntent.current.signature !== body) {
        saveIntent.current = { signature: body, key: crypto.randomUUID() };
      }
      const order = await api<{ id: number; total?: number; version?: number }>("/orders", {
        method: "POST",
        idempotencyKey: saveIntent.current.key,
        body,
      });
      if (selection.deferPayment) {
        clearOrder();
        setCheckoutOpen(false);
        setToast({ message: "Pedido guardado con pago pendiente.", tone: "success" });
        void resource.refresh();
        return;
      }

      const authoritativeTotal = Number(order.total ?? total);
      if (Math.abs(authoritativeTotal - total) > 0.009) {
        setCheckoutOpen(false);
        setToast({ message: "El total cambió al aplicar las reglas del pedido. Revísalo en el panel antes de cobrar.", tone: "error" });
        clearOrder();
        void resource.refresh();
        return;
      }

      let expectedVersion = Number(order.version || 1);
      for (const payment of selection.plan.payments) {
        const note = payment.method === "cash" && payment.cashReceived != null
          ? `Efectivo recibido: ${payment.cashReceived.toFixed(2)} PEN. Cambio: ${selection.plan.change.toFixed(2)} PEN.`
          : undefined;
        const paymentSignature = JSON.stringify({
          order_id: order.id,
          method: payment.method,
          amount: payment.amount,
          cash_session_id: payment.cashSessionId || null,
          note: note || null,
        });
        let idempotencyKey = paymentIntents.current.get(paymentSignature);
        if (!idempotencyKey) {
          idempotencyKey = crypto.randomUUID();
          paymentIntents.current.set(paymentSignature, idempotencyKey);
        }
        const response = await api<{ order?: { version?: number } }>(`/orders/${order.id}/payments`, {
          method: "POST",
          idempotencyKey,
          body: JSON.stringify({
            method: payment.method,
            amount: payment.amount,
            cash_session_id: payment.cashSessionId || null,
            note,
            expected_version: expectedVersion,
          }),
        });
        expectedVersion = Number(response.order?.version || expectedVersion + 1);
      }

      const confirmationSignature = `${order.id}:${expectedVersion}`;
      if (!confirmationIntent.current || confirmationIntent.current.signature !== confirmationSignature) {
        confirmationIntent.current = { signature: confirmationSignature, key: crypto.randomUUID() };
      }
      await api(`/orders/${order.id}/confirm-and-send`, {
        method: "POST",
        idempotencyKey: confirmationIntent.current.key,
        body: JSON.stringify({ expected_version: expectedVersion }),
      });

      clearOrder();
      setCheckoutOpen(false);
      setToast({ message: "Pedido pagado y enviado a cocina.", tone: "success" });
      void resource.refresh();
    } catch (caught) {
      setToast({ message: caught instanceof Error ? caught.message : "No se pudo completar el pedido", tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  const configurationValidation = configuring
    ? validateProductSelection(configuring, selectedVariant, selectedModifiers)
    : { valid: true };

  return (
    <div className="page-stack pos-page">
      <PageHeader eyebrow="Punto de venta" title="Tomar pedido" description="Carta, contexto y cuenta en una sola pantalla." />
      <div className="pos-layout">
        <section className="pos-catalog panel">
          <div className="pos-toolbar">
            <div className="search-field"><Search /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar producto o SKU" /></div>
            <div className="category-tabs">
              <button className={category === "all" ? "active" : ""} onClick={() => setCategory("all")}>Todos</button>
              {catalog.categories.map((item) => <button key={item.id} className={category === item.id ? "active" : ""} onClick={() => setCategory(item.id)}>{item.name}</button>)}
            </div>
          </div>
          <div className="product-grid">
            {filtered.map((product) => (
              <button key={product.id} className={`product-card ${!product.available ? "unavailable" : ""}`} onClick={() => beginProduct(product)} disabled={Boolean(productUnavailableReason(product))} title={productUnavailableReason(product) || undefined}>
                <div className="product-visual" style={product.image_url ? { backgroundImage: `url(${product.image_url})` } : undefined}><span>{product.name.slice(0, 2).toUpperCase()}</span>{product.track_stock && <small>stock</small>}</div>
                <div><strong>{product.name}</strong><p>{product.description || product.preparation_station}</p><span><Money value={product.price} /></span></div>
                <Plus className="product-add" />
              </button>
            ))}
          </div>
        </section>
        <aside className="order-builder panel">
          <div className="builder-header"><div><span className="eyebrow">Cuenta actual</span><h2><ShoppingCart /> Nuevo pedido</h2></div>{cart.length > 0 && <button className="icon-button danger" onClick={() => setCart([])} title="Vaciar"><Trash2 /></button>}</div>
          <div className="channel-switch">{channels.map((item) => <button key={item.value} className={channel === item.value ? "active" : ""} onClick={() => setChannel(item.value)}>{item.label}</button>)}</div>
          {channel === "dine_in" && <label className="select-field">Mesa<select value={tableId || ""} onChange={(event) => setTableId(Number(event.target.value) || null)}><option value="">Seleccionar mesa</option>{tables.filter((table) => table.status === "available" || table.id === tableId).map((table) => <option key={table.id} value={table.id}>{table.name} · {table.capacity} personas</option>)}</select><ChevronDown /></label>}
          {(channel === "delivery" || channel === "takeaway") && <div className="customer-fields"><input value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder="Nombre del cliente" /><input value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} placeholder="Teléfono" />{channel === "delivery" && <textarea value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Dirección y referencia" rows={2} />}</div>}
          <div className="cart-lines">
            {cart.length ? cart.map((item) => (
              <article className="cart-line" key={item.key}>
                <div><strong>{item.name}{item.variantName ? ` · ${item.variantName}` : ""}</strong>{item.modifiers.length > 0 && <small>{modifierSelectionLabel(item.modifiers)}</small>}{item.notes && <small className="note">“{item.notes}”</small>}<span><Money value={item.unitPrice * item.quantity} /></span></div>
                <div className="quantity-control"><button onClick={() => quantity(item.key, -1)}>{item.quantity === 1 ? <Trash2 /> : <Minus />}</button><strong>{item.quantity}</strong><button onClick={() => quantity(item.key, 1)}><Plus /></button></div>
              </article>
            )) : <div className="empty-cart"><ShoppingCart /><strong>La cuenta está vacía</strong><span>Toca un producto para agregarlo.</span></div>}
          </div>
          <div className="builder-extras"><textarea value={orderNotes} onChange={(event) => setOrderNotes(event.target.value)} placeholder="Observación general para cocina o atención" rows={2} /><label>Descuento autorizado <input type="number" min="0" step="0.5" value={discount} onChange={(event) => setDiscount(Number(event.target.value))} /></label></div>
          <div className="totals"><div><span>Subtotal</span><strong><Money value={subtotal} /></strong></div>{deliveryFee > 0 && <div><span>Delivery</span><strong><Money value={deliveryFee} /></strong></div>}{discount > 0 && <div><span>Descuento</span><strong>-<Money value={discount} /></strong></div>}<div className="grand-total"><span>Total</span><strong><Money value={total} /></strong></div></div>
          <div className="builder-actions"><button className="button button-primary" disabled={!cart.length || saving} onClick={continueToCheckout}>{saving ? "Procesando..." : <>Continuar <ArrowRight /></>}</button></div>
        </aside>
      </div>
      {configuring && <Modal title={configuring.name} onClose={() => setConfiguring(null)}>
        <div className="product-config">
          <p>{configuring.description}</p>
          {configuring.combo_components.length > 0 && <section className="combo-summary"><strong>Este combo incluye</strong>{configuring.combo_components.map((component) => <span key={component.product_id}>{component.quantity}× {component.name}</span>)}</section>}
          {configuring.variants.some((variant) => variant.active) && (
            <ModifierGroupSelector
              groupId={`pos-variants-${configuring.id}`}
              name="Precios"
              priceDisplay="absolute"
              options={configuring.variants.filter((variant) => variant.active && variant.available !== false).map((variant) => ({
                id: variant.id,
                name: variant.name,
                priceDelta: Number(configuring.price) + Number(variant.price_delta),
              }))}
              minimum={1}
              maximum={1}
              allowRepeats={false}
              selected={selectedVariant === null ? [] : [selectedVariant]}
              onChange={(selected) => setSelectedVariant(selected[0] ?? null)}
            />
          )}
          {configuring.modifier_groups.map((group) => {
            const activeModifiers = group.modifiers.filter((modifier) => modifier.active && modifier.available !== false);
            const minimum = Math.max(group.minimum, group.required ? 1 : 0);
            return (
              <ModifierGroupSelector
                key={group.id}
                groupId={group.id}
                name={group.name}
                options={activeModifiers.map((modifier) => ({
                  id: modifier.id,
                  name: modifier.name,
                  priceDelta: modifier.price_delta,
                }))}
                minimum={minimum}
                maximum={group.maximum}
                allowRepeats={group.allow_repeats}
                maxPerOption={group.max_per_option}
                selected={orderModifierGroupSelection(configuring, selectedModifiers, group.id)}
                onChange={(next) => setModifierGroupSelection(group.id, next)}
                emptyMessage="Este grupo no tiene opciones activas. Corrígelo en Catálogo."
              />
            );
          })}
          <label>Nota para cocina<textarea rows={2} value={itemNotes} onChange={(event) => setItemNotes(event.target.value)} placeholder="Ej. sin cebolla, bien cocida" /></label>
          <button className="button button-primary button-large" disabled={!configurationValidation.valid} onClick={() => addConfigured(configuring, selectedVariant, selectedModifiers, itemNotes)}><Plus /> Agregar a la cuenta</button>
          {!configurationValidation.valid && <small className="configuration-warning">{configurationValidation.message}</small>}
        </div>
      </Modal>}
      {checkoutOpen && branch && <NewOrderPaymentModal branch={branch} total={total} busy={saving} onClose={() => !saving && setCheckoutOpen(false)} onConfirm={(selection) => void completeOrder(selection)} />}
      {toast && <Toast {...toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
