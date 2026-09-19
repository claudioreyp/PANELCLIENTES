export const ORDER_PRINT_EVENT = "pos:print-confirmed-order";
export const MANUAL_PRINT_EVENT = "pos:print-document";
export type OrderPrintEvent = { orderId: number; branchId: number; version?: number; review?: boolean };
export type ManualPrintRequest = { orderId: number; branchId: number; orderVersion: number; ticketId?: number; ticketVersion?: number };
export type ManualPrintEvent = ManualPrintRequest & { done: () => void };

export function requestOrderPrinting(detail: OrderPrintEvent) {
  window.dispatchEvent(new CustomEvent(ORDER_PRINT_EVENT, { detail }));
}

export function requestManualPrinting(request: ManualPrintRequest): Promise<void> {
  return new Promise((resolve, reject) => {
    const event = new CustomEvent<ManualPrintEvent>(MANUAL_PRINT_EVENT, { cancelable: true, detail: { ...request, done: resolve } });
    if (window.dispatchEvent(event)) reject(new Error("La impresión no está disponible en esta sesión. Recarga el POS e inténtalo otra vez."));
  });
}
