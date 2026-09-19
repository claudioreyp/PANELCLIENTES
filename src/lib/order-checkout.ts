export const checkoutPaymentMethods = ["cash", "card", "yape", "plin", "transfer", "online"] as const;

export type CheckoutPaymentMethod = (typeof checkoutPaymentMethods)[number];
export type CheckoutMode = CheckoutPaymentMethod | "multiple" | null;
export type CheckoutTenderValues = Partial<Record<CheckoutPaymentMethod, number>>;

export type CheckoutPayment = {
  method: CheckoutPaymentMethod;
  amount: number;
  cashReceived?: number;
  cashSessionId?: number;
};

export type CheckoutPaymentPlan = {
  payments: CheckoutPayment[];
  change: number;
  error: string | null;
};

const methodLabels: Record<CheckoutPaymentMethod, string> = {
  cash: "Efectivo",
  card: "Tarjeta",
  yape: "Yape",
  plin: "Plin",
  transfer: "Transferencia bancaria",
  online: "Pago en línea",
};

function toCents(value: number) {
  return Math.round((Number.isFinite(value) ? value : 0) * 100);
}

function fromCents(value: number) {
  return value / 100;
}

function money(value: number) {
  return new Intl.NumberFormat("es-PE", { style: "currency", currency: "PEN" }).format(value);
}

export function paymentMethodLabel(method: CheckoutPaymentMethod) {
  return methodLabels[method];
}

export function normalizeCheckoutPaymentMethods(methods: string[]): CheckoutPaymentMethod[] {
  const configured = new Set(methods.map((method) => method.trim().toLowerCase()));
  return checkoutPaymentMethods.filter((method) => configured.has(method));
}

export function buildCheckoutPaymentPlan({
  total,
  mode,
  tenders,
  cashSessionId,
  cashSessionRequired = false,
}: {
  total: number;
  mode: CheckoutMode;
  tenders: CheckoutTenderValues;
  cashSessionId: number | null;
  cashSessionRequired?: boolean;
}): CheckoutPaymentPlan {
  const totalCents = toCents(total);
  if (totalCents <= 0) return { payments: [], change: 0, error: "El total del pedido debe ser mayor que cero." };
  if (!mode) return { payments: [], change: 0, error: "Selecciona un método de pago." };

  if (mode !== "multiple") {
    if (mode !== "cash") {
      return {
        payments: [{
          method: mode,
          amount: fromCents(totalCents),
          ...(cashSessionId ? { cashSessionId } : {}),
        }],
        change: 0,
        error: null,
      };
    }

    const receivedCents = toCents(tenders.cash || 0);
    if (receivedCents <= 0) return { payments: [], change: 0, error: "Ingresa cuánto efectivo recibió el restaurante." };
    if (receivedCents < totalCents) {
      return {
        payments: [],
        change: 0,
        error: `Faltan ${money(fromCents(totalCents - receivedCents))} para completar el pago.`,
      };
    }
    if (cashSessionRequired && !cashSessionId) {
      return { payments: [], change: 0, error: "Selecciona la caja donde registrarás el cobro en efectivo." };
    }
    return {
      payments: [{
        method: "cash",
        amount: fromCents(totalCents),
        cashReceived: fromCents(receivedCents),
        ...(cashSessionId ? { cashSessionId } : {}),
      }],
      change: fromCents(receivedCents - totalCents),
      error: null,
    };
  }

  const negativeMethod = checkoutPaymentMethods.find((method) => Number(tenders[method] || 0) < 0);
  if (negativeMethod) return { payments: [], change: 0, error: "Los montos del cobro no pueden ser negativos." };

  const nonCashPayments = checkoutPaymentMethods
    .filter((method) => method !== "cash")
    .map((method) => ({ method, amountCents: toCents(tenders[method] || 0) }))
    .filter((payment) => payment.amountCents > 0);
  const nonCashCents = nonCashPayments.reduce((sum, payment) => sum + payment.amountCents, 0);
  if (nonCashCents > totalCents) {
    return {
      payments: [],
      change: 0,
      error: "Lo cobrado por medios distintos al efectivo no puede exceder el total.",
    };
  }

  const cashDueCents = totalCents - nonCashCents;
  const cashReceivedCents = toCents(tenders.cash || 0);
  if (cashDueCents === 0 && cashReceivedCents > 0) {
    return {
      payments: [],
      change: 0,
      error: "El pedido ya está cubierto por los otros métodos. Retira el monto en efectivo.",
    };
  }
  if (cashDueCents > 0 && cashReceivedCents < cashDueCents) {
    return {
      payments: [],
      change: 0,
      error: `Faltan ${money(fromCents(cashDueCents - cashReceivedCents))} para completar el pago.`,
    };
  }
  if (cashDueCents > 0 && cashSessionRequired && !cashSessionId) {
    return { payments: [], change: 0, error: "Selecciona la caja donde registrarás la parte pagada en efectivo." };
  }

  const payments: CheckoutPayment[] = nonCashPayments.map((payment) => ({
    method: payment.method,
    amount: fromCents(payment.amountCents),
    ...(cashSessionId ? { cashSessionId } : {}),
  }));
  if (cashDueCents > 0) {
    payments.unshift({
      method: "cash",
      amount: fromCents(cashDueCents),
      cashReceived: fromCents(cashReceivedCents),
      ...(cashSessionId ? { cashSessionId } : {}),
    });
  }
  if (!payments.length) return { payments: [], change: 0, error: "Distribuye el total entre al menos un método de pago." };

  return {
    payments,
    change: fromCents(Math.max(0, cashReceivedCents - cashDueCents)),
    error: null,
  };
}
