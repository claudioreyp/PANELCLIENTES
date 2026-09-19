import { ChevronLeft } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import "../components/settings/security-audit.css";

export function positiveRouteId(value: string | null): number | null {
  if (!value || !/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

export function auditReturnPath(state: unknown): string | null {
  if (!state || typeof state !== "object" || !("auditReturnTo" in state) || typeof state.auditReturnTo !== "string") return null;
  const path = state.auditReturnTo;
  return /^\/configuracion\/seguridad(?:\?[^#]*)?$/.test(path) ? path : null;
}

export function AuditReturnLink() {
  const { state } = useLocation();
  const path = auditReturnPath(state);
  return path ? <Link className="audit-navigation-link" to={path}><ChevronLeft />Regresar al historial de seguridad</Link> : null;
}
