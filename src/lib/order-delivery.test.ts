import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "./api";
import {
  emptyDeliveryAddress, loadPosDeliveryPolicy, parseManualDeliveryFee, parseOrderDeliveryQuote,
  requestOrderDeliveryQuote, serializeDeliveryAddress, type DeliveryQuoteAttempt,
} from "./order-delivery";

vi.mock("./api", async (original) => ({ ...await original<typeof import("./api")>(), api: vi.fn() }));
afterEach(() => { vi.resetAllMocks(); vi.useRealTimers(); });

const destination = serializeDeliveryAddress({ ...emptyDeliveryAddress, street: " Calle Uno ", reference: " Puerta azul " });
const payload = { subtotal: 20, destination, expected_configuration_version: 3 };
const quote = () => ({ id: "quote-1", fee: 15, requires_quote: false, configuration_version: 3, expires_at: new Date(Date.now() + 60000).toISOString(), fee_status: "final" });

describe("POS delivery contracts", () => {
  it("serializes one complete destination with nullable optional fields and real selected coordinates", () => {
    expect(destination).toEqual({ address: "Calle Uno", street: "Calle Uno", number: null, neighborhood: null, cross_streets: null, reference: "Puerta azul", maps_url: null });
    expect(serializeDeliveryAddress({ ...emptyDeliveryAddress, street: " Norte ", number: " 12-A ", neighborhood: " Centro ", crossStreets: " Sur y Este ", reference: " Puerta azul ", mapsUrl: " https://maps.google.com/?q=0,0 ", point: { latitude: 0, longitude: 0, maps_url: "https://maps.google.com/?q=0,0" } })).toEqual({ address: "Norte 12-A, Centro, Entre Sur y Este", street: "Norte", number: "12-A", neighborhood: "Centro", cross_streets: "Sur y Este", reference: "Puerta azul", maps_url: "https://maps.google.com/?q=0,0", latitude: 0, longitude: 0 });
  });

  it.each(["", " ", "-1", "Infinity", "NaN", "1e3", "1.001", "1,2,3", "10000000000"])("rejects invalid manual fee %j", (input) => {
    expect(parseManualDeliveryFee(input)).toBeNull();
  });
  it.each([["0", 0], [" 15.20 ", 15.2], ["1,25", 1.25]])("accepts explicit manual fee %j", (input, expected) => {
    expect(parseManualDeliveryFee(String(input))).toBe(expected);
  });

  it("loads only supported policy versions and never normalizes a missing fixed fee to free shipping", async () => {
    vi.mocked(api).mockResolvedValueOnce({ version: 3, delivery_mode: "fixed", fixed_delivery_fee: 15, pos_quotes_supported: true, delivery_policy: { neighborhoods: [{ name: "Centro", fee: 9 }] } });
    expect(await loadPosDeliveryPolicy(1)).toEqual({ version: 3, mode: "fixed", fixedFee: 15, neighborhoods: ["Centro"] });
    vi.mocked(api).mockResolvedValueOnce({ version: 3, delivery_mode: "fixed", fixed_delivery_fee: 0 });
    await expect(loadPosDeliveryPolicy(1)).rejects.toThrow("no admite cotizaciones");
    vi.mocked(api).mockResolvedValueOnce({ version: 3, delivery_mode: "fixed", pos_quotes_supported: true });
    await expect(loadPosDeliveryPolicy(1)).rejects.toThrow("costo fijo válido");
  });

  it("requires a coherent nullable fee, version and expiration in quote responses", () => {
    for (const patch of [{ fee: null }, { fee: 0, requires_quote: true }, { fee: -1 }, { fee: "15" }, { fee: NaN }, { configuration_version: 2 }, { expires_at: "invalid" }, { id: "" }]) {
      expect(() => parseOrderDeliveryQuote({ ...quote(), ...patch }, 3)).toThrow("incompatible");
    }
    expect(parseOrderDeliveryQuote({ ...quote(), fee: 0 }, 3).fee).toBe(0);
    expect(parseOrderDeliveryQuote({ ...quote(), fee: null, requires_quote: true, fee_status: "pending_quote" }, 3).fee).toBeNull();
  });

  it("deduplicates a pending exact attempt and retries transport failures with the same body/key", async () => {
    const attempts = new Map<string, DeliveryQuoteAttempt>();
    vi.mocked(api).mockRejectedValueOnce(new ApiError("Lost", 0, undefined, "NETWORK_UNREACHABLE")).mockResolvedValueOnce(quote());
    await expect(requestOrderDeliveryQuote(1, payload, attempts)).rejects.toThrow("Lost");
    const [a, b] = await Promise.all([requestOrderDeliveryQuote(1, payload, attempts), requestOrderDeliveryQuote(1, payload, attempts)]);
    expect(a).toEqual(b);
    expect(api).toHaveBeenCalledTimes(2);
    expect(vi.mocked(api).mock.calls[0]).toEqual(vi.mocked(api).mock.calls[1]);
    await requestOrderDeliveryQuote(1, payload, attempts);
    expect(api).toHaveBeenCalledTimes(2);
  });

  it("renews expired quotes and uses different keys for branch, destination, subtotal, version and manual confirmation", async () => {
    vi.useFakeTimers();
    const attempts = new Map<string, DeliveryQuoteAttempt>();
    vi.mocked(api).mockImplementation(async (_path, options) => ({ ...quote(), configuration_version: JSON.parse(String(options?.body)).expected_configuration_version }));
    await requestOrderDeliveryQuote(1, payload, attempts);
    vi.advanceTimersByTime(61000);
    await requestOrderDeliveryQuote(1, payload, attempts);
    await requestOrderDeliveryQuote(2, payload, attempts);
    await requestOrderDeliveryQuote(1, { ...payload, destination: { ...destination, reference: "Otra puerta" } }, attempts);
    await requestOrderDeliveryQuote(1, { ...payload, subtotal: 21 }, attempts);
    await requestOrderDeliveryQuote(1, { ...payload, expected_configuration_version: 4 }, attempts);
    await requestOrderDeliveryQuote(1, { ...payload, confirmed_fee: 0 }, attempts);
    expect(new Set(vi.mocked(api).mock.calls.map(([, options]) => options?.idempotencyKey)).size).toBe(7);
  });

  it("reports incompatible quote endpoints instead of supplying a fee", async () => {
    vi.mocked(api).mockRejectedValueOnce(new ApiError("Unsupported", 404));
    await expect(requestOrderDeliveryQuote(1, payload, new Map())).rejects.toThrow("no se usará una tarifa fija");
  });
});
