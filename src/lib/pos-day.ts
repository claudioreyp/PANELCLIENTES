import { parsePosDate } from "./pos-dates";

const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit",
});

export function posDayKey(now = Date.now()): string {
  const parts = dayFormatter.formatToParts(now);
  return ["year", "month", "day"].map(type => parts.find(part => part.type === type)!.value).join("-");
}

export function posTimestampDay(value?: string | null): string | null {
  if (!value?.trim()) return null;
  const timestamp = parsePosDate(value).getTime();
  return Number.isFinite(timestamp) ? posDayKey(timestamp) : null;
}

export function nextPosMidnight(now = Date.now()): number {
  const [year, month, day] = posDayKey(now).split("-").map(Number);
  // Lima uses UTC-5 year-round; calendar overflow also handles month/year changes.
  return Date.UTC(year, month - 1, day + 1, 5);
}
