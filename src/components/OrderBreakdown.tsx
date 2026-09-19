import { MessageSquareText } from "lucide-react";
import { groupOrderModifiers, type BreakdownLine } from "../lib/order-presentation";
import { Money } from "./ui";
import "./order-details.css";

export function OrderBreakdown({ lines, showPrices = true, prepared = false }: { lines: BreakdownLine[]; showPrices?: boolean; prepared?: boolean }) {
  return <div className="order-breakdown">{lines.map((line) => {
    const groups = groupOrderModifiers(line.modifiers, line.quantity);
    const inactive = ["cancelled", "superseded"].includes(line.status || "");
    const removedGroups = groupOrderModifiers(line.removedModifiers || [], line.previous?.quantity ?? line.quantity);
    return <article key={line.key} className={inactive ? "is-inactive" : undefined}>
      {prepared && <span className="order-prepared-badge">Preparado</span>}
      {inactive && <span className="order-cancelled-badge" title={line.cancellationReason || undefined}>{line.status === "superseded" ? "Reemplazado" : "Cancelado"}</span>}
      <div className="order-breakdown-heading"><strong>{line.quantity} × {line.name}{line.variant ? ` - ${line.variant}` : ""}</strong>{showPrices && line.gross !== undefined && <span className="order-breakdown-price">{Number(line.discount) > 0 && <del><Money value={line.gross} /></del>}<span><Money value={Math.max(0, line.gross - Number(line.discount || 0))} /></span></span>}</div>
      {line.previous && <small className="order-previous-content">Antes: {line.previous.quantity} × {line.previous.name}{line.previous.variant ? ` - ${line.previous.variant}` : ""}</small>}
      {line.notes && <p className="order-breakdown-note"><MessageSquareText aria-hidden="true" /><span>{line.notes}</span></p>}
      {groups.length > 0 && <div className="order-breakdown-groups">{showPrices && line.gross !== undefined && <small className="order-breakdown-included">Opciones incluidas en el importe</small>}{groups.map((group) => <section key={group.key}><h4>{group.name}</h4>{group.options.map((option) => <div className="order-breakdown-option" key={option.key}><span>{option.quantity} × {option.name}</span>{showPrices && <span><Money value={option.amount} /></span>}</div>)}</section>)}</div>}
      {removedGroups.length > 0 && <div className="order-breakdown-groups order-removed-options" aria-label="Personalizaciones retiradas">{removedGroups.map((group) => <section key={group.key}><h4>{group.name} <small>Retirado</small></h4>{group.options.map((option) => <div className="order-breakdown-option" key={option.key}><del>{option.quantity} × {option.name}</del>{showPrices && <del><Money value={option.amount} /></del>}</div>)}</section>)}</div>}
      {!!line.comboComponents?.length && <div className="order-breakdown-groups"><h4>Incluye</h4>{line.comboComponents.map((component, index) => <div key={`${component.product_id}:${index}`}>{component.quantity * line.quantity} × {component.name}</div>)}</div>}
      {inactive && line.cancellationReason && <small className="order-cancellation-reason">Motivo: {line.cancellationReason}</small>}
    </article>;
  })}</div>;
}
