// SQLite's timezone-less API timestamps still represent UTC, not browser time.
export function parsePosDate(value: string): Date {
  const timestamp = value.trim();
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(timestamp);
  return new Date(timestamp && !hasZone ? `${timestamp}Z` : timestamp);
}

export function formatPosDate(value: string, options: Intl.DateTimeFormatOptions) {
  const date = parsePosDate(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString("es-PE", { ...options, timeZone: "America/Lima" })
    : "Fecha no disponible";
}
