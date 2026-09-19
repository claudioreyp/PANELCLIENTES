import { afterEach, describe, expect, it, vi } from "vitest";
import { publicApi } from "./api";

describe("API transport errors", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("retries safe reads before replacing Failed to fetch with an actionable error", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);

    const request = publicApi("/health");
    const assertion = expect(request).rejects.toMatchObject({
      status: 0,
      code: "NETWORK_UNREACHABLE",
      message: "No pudimos conectar con el servidor del POS. Espera unos segundos e inténtalo nuevamente.",
      details: {
        kind: "transport",
        method: "GET",
        path: "/api/v1/health",
        attempts: 5,
      },
    });
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("recovers a safe read after a brief API restart", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ status: "ok" }),
        { status: 200, headers: { "content-type": "application/json" } },
      ));
    vi.stubGlobal("fetch", fetchMock);

    const request = publicApi<{ status: string }>("/health");
    await vi.runAllTimersAsync();

    await expect(request).resolves.toEqual({ status: "ok" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry writes after a transport error", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(publicApi("/catalog/promotions", {
      method: "POST",
      body: JSON.stringify({ name: "Promoción" }),
    })).rejects.toMatchObject({ status: 0 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("identifies a generic router 404 as an unsupported API contract", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ detail: "Not Found" }),
      { status: 404, headers: { "content-type": "application/json" } },
    )));

    await expect(publicApi("/catalog/products/9/availability")).rejects.toMatchObject({
      status: 404,
      code: "API_CONTRACT_UNSUPPORTED",
      message: "La API del POS todavía no incluye esta operación. Actualiza el servicio de la API antes de intentarlo otra vez.",
    });
  });

  it("uses catalog error codes instead of exposing backend wording", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({
        detail: {
          code: "CATEGORY_LAST_VISIBLE_PRODUCTS",
          message: "internal catalog guard",
        },
      }),
      { status: 409, headers: { "content-type": "application/json" } },
    )));

    await expect(publicApi("/catalog/categories/3")).rejects.toMatchObject({
      status: 409,
      code: "CATEGORY_LAST_VISIBLE_PRODUCTS",
      message: "No puedes borrar esta categoría porque contiene los últimos productos visibles del restaurante.",
    });
  });
});
