import { createPortal } from "react-dom";
import { renderThermalBody, thermalPrintCss, type ThermalDocumentOptions } from "../lib/thermal-print";
import { useTenant } from "../lib/tenant";
import "./order-print-document.css";

type Props = Omit<ThermalDocumentOptions, "paperWidth"> & { paperWidth?: 58 | 80 };

export function OrderPrintDocument({ order, ticket, businessName, branchName, paperWidth = 80, template }: Props) {
  const { context } = useTenant();
  const matchingBusiness = context?.business.id === order.business_id ? context : null;
  const options = {
    order, ticket, paperWidth, template,
    businessName: businessName ?? matchingBusiness?.business.name,
    branchName: branchName ?? matchingBusiness?.branches.find((branch) => branch.id === order.branch_id)?.name,
  };
  return createPortal(<section className={`order-print-document order-print-${paperWidth}`} aria-label={ticket ? "Comanda para imprimir" : "Pedido para imprimir"}>
    <style>{thermalPrintCss}</style>
    {/* Only the pure renderer's text-escaped markup may enter this print-only surface. */}
    <div dangerouslySetInnerHTML={{ __html: renderThermalBody(options) }} />
  </section>, document.body);
}
