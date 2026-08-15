import { CalendarDays, CheckCircle2, ChefHat, Clock3, MapPin, Minus, Phone, Plus, ShoppingBag, ShoppingCart, Store, Truck, Users, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { publicApi } from "../lib/api";
import type { Branch, Category } from "../types";
import { ErrorState, LoadingState, Modal, Money } from "../components/ui";

type PublicProduct = { id: number; category_id: number | null; name: string; description?: string | null; price: number; image_url?: string | null };
type PublicMenu = { business: { id: number; slug: string; name: string; logo_url?: string | null }; branch: Branch; categories: Category[]; products: PublicProduct[] };
type CartItem = PublicProduct & { quantity: number };

export function PublicStorePage() {
  const { slug = "" } = useParams();
  const [menu, setMenu] = useState<PublicMenu | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<number | "all">("all");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkout, setCheckout] = useState(false);
  const [fulfillment, setFulfillment] = useState<"takeaway" | "delivery">("takeaway");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmation, setConfirmation] = useState<{ number: string; total: number } | null>(null);

  useEffect(() => {
    publicApi<PublicMenu>(`/public/${slug}/menu`).then(setMenu).catch((caught) => setError(caught instanceof Error ? caught.message : "No se encontró la tienda"));
  }, [slug]);

  function change(product: PublicProduct, delta: number) {
    setCart((current) => {
      const existing = current.find((item) => item.id === product.id);
      if (!existing && delta > 0) return [...current, { ...product, quantity: 1 }];
      return current.flatMap((item) => item.id !== product.id ? [item] : item.quantity + delta <= 0 ? [] : [{ ...item, quantity: item.quantity + delta }]);
    });
  }

  async function placeOrder() {
    if (!menu || !name || !phone || !cart.length || (fulfillment === "delivery" && !address)) return;
    setSubmitting(true);
    try {
      const order = await publicApi<{ number: string; total: number }>(`/public/${slug}/orders`, { method: "POST", idempotencyKey: crypto.randomUUID(), body: JSON.stringify({ branch_id: menu.branch.id, fulfillment, customer_name: name, customer_phone: phone, delivery_address: fulfillment === "delivery" ? { address } : null, notes: notes || null, items: cart.map((item) => ({ product_id: item.id, quantity: item.quantity })) }) });
      setConfirmation(order); setCart([]); setCheckout(false); setCartOpen(false);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudo enviar el pedido"); }
    finally { setSubmitting(false); }
  }

  if (error && !menu) return <main className="public-state"><ErrorState message={error} /></main>;
  if (!menu) return <LoadingState label="Abriendo la carta..." />;
  const products = menu.products.filter((product) => category === "all" || product.category_id === category);
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const total = subtotal + (fulfillment === "delivery" ? menu.branch.delivery_fee : 0);
  const count = cart.reduce((sum, item) => sum + item.quantity, 0);

  return <main className="public-store">
    <header className="store-header"><div className="store-brand">{menu.business.logo_url ? <img src={menu.business.logo_url} alt="" /> : <Store />}<div><strong>{menu.business.name}</strong><span>{menu.branch.name}</span></div></div><div className="store-actions"><Link to={`/reservar/${slug}`}><CalendarDays /> Reservar</Link><button onClick={() => setCartOpen(true)}><ShoppingCart /><span>{count}</span></button></div></header>
    <section className="store-hero"><div><span className="eyebrow light">Carta digital</span><h1>Hoy se come bien.</h1><p>Elige, confirma y el restaurante recibe tu pedido directamente.</p><div><span><Clock3 /> {String(menu.branch.opening_hours?.legacy_text || "Consulta el horario por WhatsApp")}</span><span><MapPin /> {menu.branch.address || "Sucursal principal"}</span></div></div><div className="hero-stamp"><ChefHat /><strong>Preparado al momento</strong></div></section>
    <section className="store-content"><div className="store-categories"><button className={category === "all" ? "active" : ""} onClick={() => setCategory("all")}>Todo</button>{menu.categories.map((item) => <button key={item.id} className={category === item.id ? "active" : ""} onClick={() => setCategory(item.id)}>{item.name}</button>)}</div><div className="store-product-grid">{products.map((product) => { const inCart = cart.find((item) => item.id === product.id); return <article key={product.id}><div className="store-product-image" style={product.image_url ? { backgroundImage: `url(${product.image_url})` } : undefined}>{!product.image_url && <ChefHat />}</div><div><span className="eyebrow">Hecho en casa</span><h2>{product.name}</h2><p>{product.description || "Preparado con ingredientes frescos."}</p><footer><strong><Money value={product.price} /></strong>{inCart ? <div className="public-qty"><button onClick={() => change(product, -1)}><Minus /></button><span>{inCart.quantity}</span><button onClick={() => change(product, 1)}><Plus /></button></div> : <button className="public-add" onClick={() => change(product, 1)}><Plus /> Agregar</button>}</footer></div></article>})}</div></section>
    {count > 0 && <button className="floating-cart" onClick={() => setCartOpen(true)}><span><ShoppingBag /> {count} producto(s)</span><strong>Ver pedido · <Money value={subtotal} /></strong></button>}
    {cartOpen && <div className="public-drawer-backdrop" onClick={(event) => event.target === event.currentTarget && setCartOpen(false)}><aside className="public-cart"><header><div><span className="eyebrow">Tu pedido</span><h2>Revisa antes de enviar</h2></div><button onClick={() => setCartOpen(false)}><X /></button></header><div className="public-cart-lines">{cart.map((item) => <div key={item.id}><div><strong>{item.name}</strong><span><Money value={item.price * item.quantity} /></span></div><div className="public-qty"><button onClick={() => change(item, -1)}><Minus /></button><span>{item.quantity}</span><button onClick={() => change(item, 1)}><Plus /></button></div></div>)}</div><div className="public-total"><span>Subtotal</span><strong><Money value={subtotal} /></strong></div><button className="public-primary" onClick={() => setCheckout(true)}>Continuar <Plus /></button></aside></div>}
    {checkout && <Modal title="Datos del pedido" onClose={() => setCheckout(false)}><div className="form-stack public-checkout"><div className="channel-switch"><button className={fulfillment === "takeaway" ? "active" : ""} onClick={() => setFulfillment("takeaway")}><ShoppingBag /> Recoger</button>{menu.branch.delivery_enabled && <button className={fulfillment === "delivery" ? "active" : ""} onClick={() => setFulfillment("delivery")}><Truck /> Delivery</button>}</div><label>Nombre<input value={name} onChange={(event) => setName(event.target.value)} /></label><label>WhatsApp<input value={phone} onChange={(event) => setPhone(event.target.value)} /></label>{fulfillment === "delivery" && <label>Dirección y referencia<textarea value={address} onChange={(event) => setAddress(event.target.value)} /></label>}<label>Indicaciones<textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Ej. sin cubiertos" /></label><div className="public-total"><span>Total estimado</span><strong><Money value={total} /></strong></div><button className="public-primary" onClick={() => void placeOrder()} disabled={submitting}>{submitting ? "Enviando..." : "Enviar pedido al restaurante"}</button><small>El restaurante confirmará disponibilidad y pago antes de preparar.</small></div></Modal>}
    {confirmation && <Modal title="Pedido recibido" onClose={() => setConfirmation(null)}><div className="public-confirmation"><CheckCircle2 /><h2>¡Gracias, {name}!</h2><p>Tu pedido <strong>#{confirmation.number}</strong> quedó pendiente de confirmación.</p><strong><Money value={confirmation.total} /></strong><button className="public-primary" onClick={() => setConfirmation(null)}>Volver a la carta</button></div></Modal>}
  </main>;
}

export function PublicReservationPage() {
  const { slug = "" } = useParams();
  const [menu, setMenu] = useState<PublicMenu | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [partySize, setPartySize] = useState(2);
  const tomorrow = new Date(Date.now() + 86400000);
  const [startAt, setStartAt] = useState(new Date(tomorrow.getTime() - tomorrow.getTimezoneOffset() * 60000).toISOString().slice(0, 16));
  const [notes, setNotes] = useState("");
  const [availability, setAvailability] = useState<boolean | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { publicApi<PublicMenu>(`/public/${slug}/menu`).then(setMenu).catch((caught) => setError(caught instanceof Error ? caught.message : "No se encontró el restaurante")); }, [slug]);
  async function check() { if (!menu) return; try { const result = await publicApi<{ available: boolean }>(`/public/${slug}/reservations/availability?branch_id=${menu.branch.id}&start_at=${encodeURIComponent(new Date(startAt).toISOString())}&party_size=${partySize}`); setAvailability(result.available); } catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudo consultar"); } }
  async function reserve() { if (!menu || !name || !phone || !availability) return; try { await publicApi(`/public/${slug}/reservations`, { method: "POST", idempotencyKey: crypto.randomUUID(), body: JSON.stringify({ branch_id: menu.branch.id, customer_name: name, customer_phone: phone, party_size: partySize, start_at: new Date(startAt).toISOString(), notes: notes || null }) }); setConfirmed(true); } catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudo reservar"); } }
  if (error && !menu) return <main className="public-state"><ErrorState message={error} /></main>;
  if (!menu) return <LoadingState label="Consultando el salón..." />;
  return <main className="public-reservation"><header><Link to={`/tienda/${slug}`}><Store /> {menu.business.name}</Link><span>Reservas online</span></header><div className="reservation-public-grid"><section className="reservation-public-story"><span className="eyebrow light">Tu mesa te espera</span><h1>Reserva un momento, no solo una mesa.</h1><p>Elige fecha y hora. Confirmaremos la capacidad real del salón antes de registrar.</p><div><MapPin /><span><strong>{menu.branch.name}</strong><small>{menu.branch.address}</small></span></div><div><Phone /><span><strong>Contacto</strong><small>{menu.branch.phone || "Por WhatsApp"}</small></span></div></section><section className="reservation-public-form">{confirmed ? <div className="public-confirmation"><CheckCircle2 /><h2>Reserva confirmada</h2><p>Te esperamos el {new Date(startAt).toLocaleString("es-PE", { dateStyle: "long", timeStyle: "short" })}.</p><Link className="public-primary" to={`/tienda/${slug}`}>Ver la carta</Link></div> : <div className="form-stack"><span className="eyebrow">Disponibilidad en vivo</span><h2>Cuéntanos cuándo vienes</h2><label>Nombre<input value={name} onChange={(event) => setName(event.target.value)} /></label><label>WhatsApp<input value={phone} onChange={(event) => setPhone(event.target.value)} /></label><div className="form-grid"><label>Fecha y hora<input type="datetime-local" value={startAt} onChange={(event) => { setStartAt(event.target.value); setAvailability(null); }} /></label><label>Personas<div className="party-picker"><button onClick={() => setPartySize(Math.max(1, partySize - 1))}><Minus /></button><span><Users /> {partySize}</span><button onClick={() => setPartySize(Math.min(30, partySize + 1))}><Plus /></button></div></label></div><label>Comentario<textarea value={notes} onChange={(event) => setNotes(event.target.value)} /></label>{availability === null ? <button className="public-primary" onClick={() => void check()}><CalendarDays /> Consultar disponibilidad</button> : availability ? <><div className="availability-ok"><CheckCircle2 /> Hay una mesa disponible.</div><button className="public-primary" onClick={() => void reserve()}>Confirmar reserva</button></> : <div className="availability-no">No hay capacidad para ese horario. Prueba otra hora.</div>}{error && <p className="form-error">{error}</p>}</div>}</section></div></main>;
}
