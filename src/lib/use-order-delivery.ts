import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  loadPosDeliveryPolicy, quoteIsCurrent, requestOrderDeliveryQuote,
  type DeliveryQuoteAttempt, type OrderDeliveryQuote, type PosDeliveryPolicy, type serializeDeliveryAddress,
} from "./order-delivery";

export type DeliveryFeeConfirmation = { identity: symbol; version: number; fee: number };

export function useOrderDelivery({ branchId, scope, enabled, subtotal, cartSignature, destination }: {
  branchId: number;
  scope: string;
  enabled: boolean;
  subtotal: number;
  cartSignature: string;
  destination: ReturnType<typeof serializeDeliveryAddress>;
}) {
  const contextKey = JSON.stringify([scope, enabled, subtotal, cartSignature, destination]);
  // Identity distinguishes A -> B -> A, including responses from the first A.
  const identity = useMemo(() => ({ contextKey, token: Symbol("delivery-draft") }), [contextKey]).token;
  const lifetime = useRef<{ identity: symbol; active: boolean; operation: number; attempts: Map<string, DeliveryQuoteAttempt> } | null>(null);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const policyRead = useRef(0);
  const [policyState, setPolicyState] = useState<{ scope: string; data: PosDeliveryPolicy | null; error: string | null; loading: boolean }>({ scope, data: null, error: null, loading: false });
  const [quoteState, setQuoteState] = useState<{ identity: symbol; quote: OrderDeliveryQuote } | null>(null);
  const [busyIdentity, setBusyIdentity] = useState<symbol | null>(null);
  const [, tick] = useState(0);

  useLayoutEffect(() => {
    const current = { identity, active: enabled, operation: 0, attempts: new Map<string, DeliveryQuoteAttempt>() };
    lifetime.current = current;
    return () => { current.active = false; };
  }, [identity, enabled]);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const read = ++policyRead.current;
    setPolicyState({ scope, data: null, error: null, loading: true });
    void loadPosDeliveryPolicy(branchId).then((data) => {
      if (active && read === policyRead.current) setPolicyState({ scope, data, error: null, loading: false });
    }).catch((error) => {
      if (active && read === policyRead.current) setPolicyState({ scope, data: null, error: error instanceof Error ? error.message : "No se pudo consultar el costo de envío.", loading: false });
    });
    return () => { active = false; };
  }, [branchId, scope, enabled]);

  useEffect(() => {
    if (!quoteState || quoteState.identity !== identity) return;
    const remaining = Date.parse(quoteState.quote.expires_at) - Date.now();
    if (remaining <= 0) return;
    const timer = window.setTimeout(() => tick((n) => n + 1), Math.min(remaining + 1, 2147483647));
    return () => window.clearTimeout(timer);
  }, [quoteState, identity]);

  const policy = enabled && policyState.scope === scope ? policyState.data : null;
  const quote = enabled && quoteState?.identity === identity && policy && quoteIsCurrent(quoteState.quote, policy.version) ? quoteState.quote : null;

  function cancel() {
    if (lifetime.current) lifetime.current.operation += 1;
    setBusyIdentity(null);
  }

  async function prepare(confirmation?: DeliveryFeeConfirmation | null) {
    const current = lifetime.current;
    if (!enabled || !current?.active || current.identity !== identity) return null;
    const operation = ++current.operation;
    const valid = () => current.active && lifetime.current === current && operation === current.operation && scopeRef.current === scope;
    setBusyIdentity(identity);
    const read = ++policyRead.current;
    let policyLoaded = false;
    try {
      const fresh = await loadPosDeliveryPolicy(branchId);
      if (!valid()) return null;
      policyLoaded = true;
      if (read === policyRead.current) setPolicyState({ scope, data: fresh, error: null, loading: false });
      const payload = { subtotal, destination, expected_configuration_version: fresh.version };
      let result = quote && quoteIsCurrent(quote, fresh.version) ? quote : await requestOrderDeliveryQuote(branchId, payload, current.attempts);
      if (!valid()) return null;
      if (result.requires_quote && confirmation?.identity === identity && confirmation.version === fresh.version) {
        result = await requestOrderDeliveryQuote(branchId, { ...payload, confirmed_fee: confirmation.fee }, current.attempts);
        if (!valid()) return null;
      }
      setQuoteState({ identity, quote: result });
      return result;
    } catch (error) {
      if (!valid()) return null;
      if (!policyLoaded && read === policyRead.current) setPolicyState({ scope, data: null, error: error instanceof Error ? error.message : "No se pudo consultar la política de delivery.", loading: false });
      setQuoteState(null);
      throw error;
    } finally {
      if (valid()) setBusyIdentity(null);
    }
  }

  return {
    identity, policy, quote, prepare, cancel, busy: busyIdentity === identity,
    loading: enabled && (policyState.scope !== scope || policyState.loading),
    error: enabled && policyState.scope === scope ? policyState.error : null,
  };
}
