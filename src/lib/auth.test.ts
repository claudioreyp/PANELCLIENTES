import { describe, expect, it } from "vitest";
import { friendlyAuthError } from "./auth";
import { isAuthServiceUnavailable } from "./auth-errors";

describe("friendlyAuthError", () => {
  it("does not expose Supabase's technical invalid-credentials message", () => {
    expect(friendlyAuthError(new Error("Invalid login credentials"))).toBe(
      "Usuario o contraseña incorrectos.",
    );
  });

  it("uses a safe fallback for unexpected auth errors", () => {
    expect(friendlyAuthError(new Error("internal auth detail"))).toBe(
      "No pudimos iniciar sesión. Inténtalo nuevamente.",
    );
  });

  it.each([
    new TypeError("Failed to fetch"),
    new TypeError("Load failed"),
    new TypeError("NetworkError when attempting to fetch resource."),
    { name: "AuthRetryableFetchError", message: "provider unavailable", status: 0 },
    { message: "provider unavailable", status: 503 },
  ])("distinguishes an unavailable provider from invalid credentials: %o", (error) => {
    expect(isAuthServiceUnavailable(error)).toBe(true);
    expect(friendlyAuthError(error)).toContain("No pudimos conectar con el servicio de acceso.");
    expect(friendlyAuthError(error)).not.toContain("contraseña incorrectos");
  });

  it.each([
    [{ code: "invalid_credentials", status: 400 }, "Usuario o contraseña incorrectos."],
    [{ code: "email_not_confirmed", status: 400 }, "Tu correo todavía no fue confirmado. Contacta a Escalar AI."],
    [{ status: 429 }, "Hubo demasiados intentos. Espera un momento y vuelve a probar."],
  ])("preserves the meaning of explicit provider errors: %o", (error, message) => {
    expect(isAuthServiceUnavailable(error)).toBe(false);
    expect(friendlyAuthError(error)).toBe(message);
  });

  it.each([undefined, null, {}, new Error("internal auth detail")])("does not guess outage status for %o", (error) => {
    expect(isAuthServiceUnavailable(error)).toBe(false);
    expect(friendlyAuthError(error)).toBe("No pudimos iniciar sesión. Inténtalo nuevamente.");
  });
});
