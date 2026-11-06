import { api } from "./api";
import { posTimestampDay } from "./pos-day";
import type { KitchenCommandResponse, KitchenTicket } from "../types";

export type CommandPeriod = "today" | "previous";
export const COMMAND_PAGE_SIZE = 12;
export const ACTIVE_COMMAND_PAGE_SIZE = 100;

export function commandsForPeriod(items: KitchenTicket[], day: string, period: CommandPeriod) {
  return items.filter((ticket) => {
    const sentDay = posTimestampDay(ticket.fired_at || ticket.created_at);
    // Unknown and future dates stay visible rather than hiding a pending command.
    const previous = sentDay !== null && sentDay < day;
    return period === "previous" ? previous : !previous;
  });
}

export async function loadActiveCommands(branchId: number): Promise<KitchenCommandResponse> {
  const readPage = (page: number) => api<KitchenCommandResponse>(
    `/kitchen/commands?branch_id=${branchId}&view=active&page=${page}&page_size=${ACTIVE_COMMAND_PAGE_SIZE}`,
  );
  const first = await readPage(1);
  const changed = () => new Error("Las comandas cambiaron durante la consulta. Vuelve a actualizar para ver la lista completa.");
  const validPage = (result: KitchenCommandResponse, expectedPage: number) => result.view === "active"
    && result.page === expectedPage && result.page_size === ACTIVE_COMMAND_PAGE_SIZE
    && Number.isSafeInteger(result.total) && result.total >= 0 && Array.isArray(result.items)
    && result.items.length === Math.min(ACTIVE_COMMAND_PAGE_SIZE, Math.max(0, result.total - (expectedPage - 1) * ACTIVE_COMMAND_PAGE_SIZE));
  if (!validPage(first, 1)) throw changed();
  const items = new Map(first.items.map((ticket) => [ticket.id, ticket]));
  const pages = Math.ceil(first.total / ACTIVE_COMMAND_PAGE_SIZE);
  for (let page = 2; page <= pages; page++) {
    const result = await readPage(page);
    if (!validPage(result, page) || result.total !== first.total) throw changed();
    for (const ticket of result.items) items.set(ticket.id, ticket);
  }
  // Publish only once every page succeeds; the query cache retains its previous
  // complete snapshot if any read above fails.
  const complete = [...items.values()];
  if (complete.length !== first.total) throw changed();
  return { ...first, items: complete, total: complete.length, active_count: complete.length };
}
