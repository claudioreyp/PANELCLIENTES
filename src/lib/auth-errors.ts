type AuthErrorDetails = { name?: unknown; message?: unknown; code?: unknown; status?: unknown };

function detailsOf(error: unknown): AuthErrorDetails {
  return error && typeof error === "object" ? error : { message: error };
}

export function isAuthServiceUnavailable(error: unknown): boolean {
  const { name, message, status } = detailsOf(error);
  return name === "AuthRetryableFetchError"
    || status === 0
    || (typeof status === "number" && status >= 500 && status < 600)
    || (typeof message === "string" && /failed to fetch|fetch failed|load failed|networkerror|network request failed/i.test(message));
}

export function friendlyAuthError(error: unknown): string {
  const details = detailsOf(error);
  const message = typeof details.message === "string" ? details.message : "";
  if (isAuthServiceUnavailable(error)) {
    return "No pudimos conectar con el servicio de acceso. Revisa tu conexión y, si continúa, contacta a Escalar AI para revisar el servicio.";
  }
  if (details.code === "invalid_credentials" || /invalid login credentials/i.test(message)) {
    return "Usuario o contraseña incorrectos.";
  }
  if (details.code === "email_not_confirmed" || /email not confirmed/i.test(message)) {
    return "Tu correo todavía no fue confirmado. Contacta a Escalar AI.";
  }
  if (details.status === 429 || /rate limit|too many requests/i.test(message)) {
    return "Hubo demasiados intentos. Espera un momento y vuelve a probar.";
  }
  return "No pudimos iniciar sesión. Inténtalo nuevamente.";
}
