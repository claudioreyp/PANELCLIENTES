import "./order-details.css";

export function OrderIdentity({ folio, number, mode = "full" }: { folio?: number | null; number?: string; mode?: "full" | "folio" }) {
  if (mode === "folio") {
    return <span className="order-identity"><span className="order-folio">{folio != null ? `#${folio}` : "Sin folio"}</span></span>;
  }
  return <span className="order-identity">
    {folio != null && <span className="order-folio">#{folio}</span>}
    {folio != null && number && <span className="order-identity-separator" aria-hidden="true"> · </span>}
    {number && <span className="order-code">#{number}</span>}
  </span>;
}
