import { Check, ChevronDown, CircleMinus, CirclePlus, ClipboardCheck, Minus, Plus, Search, Send, ShoppingCart, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { usePolling } from "../lib/hooks";
import { useTenant } from "../lib/tenant";
import type { Catalog, Product, RestaurantTable } from "../types";
import { ErrorState, LoadingState, Modal, Money, PageHeader, Toast } from "../components/ui";

type CartLine = {
  key: string;
  productId: number;
  name: string;
  variantName?: string;
  quantity: number;
  unitPrice: number;
  modifiers: { modifier_id: number; name: string; price_delta: number }[];
  notes?: string;
};

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
  const [cart, setCart] = useState<CartLine[]>([]);
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
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);

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
    return { catalog, tables };
  }, [branch?.id], 30000);

  if (resource.loading && !resource.data) return <LoadingState />;
  if (resource.error && !resource.data) return <ErrorState message={resource.error} onRetry={() => void resource.refresh()} />;
  const { catalog, tables } = resource.data!;
  const filtered = catalog.products.filter((product) => {
    const matchesCategory = category === "all" || product.category_id === category;
    const term = search.trim().toLowerCase();
    return matchesCategory && (!term || product.name.toLowerCase().includes(term) || product.sku.toLowerCase().includes(term));
  });
  const subtotal = cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const deliveryFee = channel === "delivery" ? Number(branch?.delivery_fee || 0) : 0;
  const total = Math.max(0, subtotal - discount + deliveryFee);

  function beginProduct(product: Product) {
    if (product.variants.length || product.modifier_groups.length) {
      setConfiguring(product);
      setSelectedVariant(product.variants[0]?.id || null);
      setSelectedModifiers([]);
      setItemNotes("");
    } else addConfigured(product, null, [], "");
  }

  function addConfigured(product: Product, variantId: number | null, modifierIds: number[], notes: string) {
    const variant = product.variants.find((item) => item.id === variantId);
    const modifiers = product.modifier_groups.flatMap((group) => group.modifiers).filter((item) => modifierIds.includes(item.id));
    const unitPrice = product.price + (variant?.price_delta || 0) + modifiers.reduce((sum, item) => sum + item.price_delta, 0);
    const signature = `${product.id}:${variantId || ""}:${[...modifierIds].sort().join(",")}:${notes}`;
    setCart((current) => {
      const existing = current.find((item) => item.key === signature);
      if (existing) return current.map((item) => item.key === signature ? { ...item, quantity: item.quantity + 1 } : item);
      return [...current, {
        key: signature,
        productId: product.id,
        name: product.name,
        variantName: variant?.name,
        quantity: 1,
        unitPrice,
        modifiers: modifiers.map((item) => ({ modifier_id: item.id, name: item.name, price_delta: item.price_delta })),
        notes,
      }];
    });
    setConfiguring(null);
  }

  function quantity(key: string, delta: number) {
    setCart((current) => current.flatMap((item) => item.key !== key ? [item] : item.quantity + delta <= 0 ? [] : [{ ...item, quantity: item.quantity + delta }]));
  }

  async function saveOrder(sendToKitchen: boolean) {
    if (!branch || !cart.length) return;
    if (channel === "dine_in" && !tableId) {
      setToast({ message: "Selecciona una mesa para el pedido de salón.", tone: "error" });
      return;
    }
    if (channel === "delivery" && (!customerName || !customerPhone || !address)) {
      setToast({ message: "Completa cliente, teléfono y dirección para delivery.", tone: "error" });
      return;
    }
    setSaving(true);
    try {
      const order = await api<{ id: number }>("/orders", {
        method: "POST",
        idempotencyKey: crypto.randomUUID(),
        body: JSON.stringify({
          branch_id: branch.id,
          channel,
          table_id: channel === "dine_in" ? tableId : null,
          customer_name: customerName || null,
          customer_phone: customerPhone || null,
          delivery_address: channel === "delivery" ? { address } : null,
          delivery_fee: deliveryFee,
          discount,
          notes: orderNotes || null,
          items: cart.map((item) => ({
            product_id: item.productId,
            variant_name: item.variantName,
            quantity: item.quantity,
            modifiers: item.modifiers,
            notes: item.notes || null,
          })),
        }),
      });
      if (sendToKitchen) {
        await api(`/orders/${order.id}/confirm`, { method: "POST", idempotencyKey: `confirm-${order.id}` });
        await api(`/orders/${order.id}/send-to-kitchen`, { method: "POST", idempotencyKey: `kitchen-${order.id}` });
      }
      setCart([]);
      setTableId(null);
      setCustomerName("");
      setCustomerPhone("");
      setAddress("");
      setOrderNotes("");
      setDiscount(0);
      setToast({ message: sendToKitchen ? "Pedido confirmado y enviado a cocina." : "Borrador guardado correctamente.", tone: "success" });
      void resource.refresh();
    } catch (caught) {
      setToast({ message: caught instanceof Error ? caught.message : "No se pudo registrar el pedido", tone: "error" });
    } finally {
      setSaving(false);
    }
  }

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
              <button key={product.id} className={`product-card ${!product.available ? "unavailable" : ""}`} onClick={() => beginProduct(product)} disabled={!product.available}>
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
                <div><strong>{item.name}{item.variantName ? ` · ${item.variantName}` : ""}</strong>{item.modifiers.length > 0 && <small>{item.modifiers.map((modifier) => modifier.name).join(", ")}</small>}{item.notes && <small className="note">“{item.notes}”</small>}<span><Money value={item.unitPrice * item.quantity} /></span></div>
                <div className="quantity-control"><button onClick={() => quantity(item.key, -1)}>{item.quantity === 1 ? <Trash2 /> : <Minus />}</button><strong>{item.quantity}</strong><button onClick={() => quantity(item.key, 1)}><Plus /></button></div>
              </article>
            )) : <div className="empty-cart"><ShoppingCart /><strong>La cuenta está vacía</strong><span>Toca un producto para agregarlo.</span></div>}
          </div>
          <div className="builder-extras"><textarea value={orderNotes} onChange={(event) => setOrderNotes(event.target.value)} placeholder="Observación general para cocina o atención" rows={2} /><label>Descuento autorizado <input type="number" min="0" step="0.5" value={discount} onChange={(event) => setDiscount(Number(event.target.value))} /></label></div>
          <div className="totals"><div><span>Subtotal</span><strong><Money value={subtotal} /></strong></div>{deliveryFee > 0 && <div><span>Delivery</span><strong><Money value={deliveryFee} /></strong></div>}{discount > 0 && <div><span>Descuento</span><strong>-<Money value={discount} /></strong></div>}<div className="grand-total"><span>Total</span><strong><Money value={total} /></strong></div></div>
          <div className="builder-actions"><button className="button button-secondary" disabled={!cart.length || saving} onClick={() => void saveOrder(false)}><ClipboardCheck /> Guardar borrador</button><button className="button button-primary" disabled={!cart.length || saving} onClick={() => void saveOrder(true)}>{saving ? "Procesando..." : <><Send /> Confirmar y enviar</>}</button></div>
        </aside>
      </div>
      {configuring && <Modal title={configuring.name} onClose={() => setConfiguring(null)}>
        <div className="product-config">
          <p>{configuring.description}</p>
          {configuring.variants.length > 0 && <fieldset><legend>Elige una variante</legend>{configuring.variants.map((variant) => <label className="choice-row" key={variant.id}><input type="radio" name="variant" checked={selectedVariant === variant.id} onChange={() => setSelectedVariant(variant.id)} /><span><strong>{variant.name}</strong><small>+ <Money value={variant.price_delta} /></small></span><Check /></label>)}</fieldset>}
          {configuring.modifier_groups.map((group) => <fieldset key={group.id}><legend>{group.name} {group.required && <small>obligatorio</small>}</legend>{group.modifiers.map((modifier) => <label className="choice-row" key={modifier.id}><input type="checkbox" checked={selectedModifiers.includes(modifier.id)} onChange={() => setSelectedModifiers((current) => current.includes(modifier.id) ? current.filter((id) => id !== modifier.id) : [...current, modifier.id])} /><span><strong>{modifier.name}</strong><small>+ <Money value={modifier.price_delta} /></small></span>{selectedModifiers.includes(modifier.id) ? <CircleMinus /> : <CirclePlus />}</label>)}</fieldset>)}
          <label>Nota para cocina<textarea rows={2} value={itemNotes} onChange={(event) => setItemNotes(event.target.value)} placeholder="Ej. sin cebolla, bien cocida" /></label>
          <button className="button button-primary button-large" onClick={() => addConfigured(configuring, selectedVariant, selectedModifiers, itemNotes)}><Plus /> Agregar a la cuenta</button>
        </div>
      </Modal>}
      {toast && <Toast {...toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
