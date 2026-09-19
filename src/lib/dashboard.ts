export type DateRange = { from: string; to: string; preset?: string };
export const DATE_PRESETS = ["Hoy", "Ayer", "Últimos 7 días", "Últimos 30 días", "Mes anterior", "6 meses anteriores"] as const;
export function limaToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  return ["year", "month", "day"].map((part) => parts.find((item) => item.type === part)?.value).join("-");
}
export function shiftDay(day: string, offset: number) {
  const value = new Date(`${day}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}
export function datePreset(preset: string, today: string): DateRange {
  if (preset === "Ayer") return { from: shiftDay(today, -1), to: shiftDay(today, -1), preset };
  if (preset === "Últimos 7 días" || preset === "Últimos 30 días") return { from: shiftDay(today, preset === "Últimos 7 días" ? -6 : -29), to: today, preset };
  if (preset === "Mes anterior" || preset === "6 meses anteriores") {
    const start = new Date(`${today.slice(0, 7)}-01T12:00:00Z`);
    start.setUTCMonth(start.getUTCMonth() - (preset === "Mes anterior" ? 1 : 6));
    return { from: start.toISOString().slice(0, 10), to: shiftDay(`${today.slice(0, 7)}-01`, -1), preset };
  }
  return { from: today, to: today, preset: "Hoy" };
}
export function shortDay(day: string) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("es-PE", { timeZone: "UTC", day: "numeric", month: "short" });
}
export function rangeLabel(range: DateRange) {
  return range.preset || (range.from === range.to ? shortDay(range.from) : `${shortDay(range.from)} - ${shortDay(range.to)}`);
}
export const dashboardMoney = (value: number, decimals = false) => `${Number(value).toLocaleString("es-PE", { minimumFractionDigits: decimals ? 2 : 0, maximumFractionDigits: 2 })} S/`;
export type DashboardReport = {
  branch_id: number; date_from: string; date_to: string; sales: number; orders: number; shipping: number; average_ticket: number;
  granularity: "hour" | "day";
  series: { key: string; sales: number; orders: number; shipping: number }[];
  channels: { name: string; sales: number; orders: number }[];
  services: { name: string; sales: number }[];
  payment_methods: { name: string; amount: number }[];
  weekdays: { name: string; sales: number | null }[];
  top_products: { name: string; quantity: number; sales: number }[];
  bottom_products: { name: string; quantity: number; sales: number }[];
};
