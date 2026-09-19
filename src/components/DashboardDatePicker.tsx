import { CalendarDays, ChevronLeft, ChevronRight, ChevronsUpDown } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { DATE_PRESETS, datePreset, rangeLabel, shiftDay, shortDay, type DateRange } from "../lib/dashboard";
import { useDialogSurface } from "../lib/dialog";

export function DashboardDatePicker({ value, today, onChange }: { value: DateRange; today: string; onChange: (range: DateRange) => void }) {
  const [open, setOpen] = useState(false);
  return <div className="dashboard-date-picker">
    <button className="dashboard-button" type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}><CalendarDays aria-hidden="true" />{rangeLabel(value)}<ChevronsUpDown aria-hidden="true" /></button>
    {open && <DateSelection value={value} today={today} onClose={() => setOpen(false)} onApply={(range) => { onChange(range); setOpen(false); }} />}
  </div>;
}

function DateSelection({ value, today, onClose, onApply }: { value: DateRange; today: string; onClose: () => void; onApply: (range: DateRange) => void }) {
  const [draft, setDraft] = useState(value);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [month, setMonth] = useState(`${value.to.slice(0, 7)}-01`);
  const [focused, setFocused] = useState(value.to);
  const focusAfterMonth = useRef(false);
  const ref = useDialogSurface(onClose);
  const start = new Date(`${month}T12:00:00Z`);
  const offset = (start.getUTCDay() + 6) % 7;
  const nextMonth = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1, 12)).toISOString().slice(0, 10);
  const length = Math.round((new Date(`${nextMonth}T12:00:00Z`).getTime() - start.getTime()) / 86400000);
  const invalid = (new Date(draft.to).getTime() - new Date(draft.from).getTime()) / 86400000 >= 366;
  useEffect(() => {
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !ref.current?.contains(event.target)) onClose();
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [onClose, ref]);
  useEffect(() => {
    if (focusAfterMonth.current) {
      ref.current?.querySelector<HTMLButtonElement>(`[data-day="${focused}"]`)?.focus();
      focusAfterMonth.current = false;
    }
  }, [month, focused, ref]);
  function changeMonth(delta: number) {
    const next = new Date(`${month}T12:00:00Z`);
    next.setUTCMonth(next.getUTCMonth() + delta);
    const day = next.toISOString().slice(0, 10);
    if (day <= today) { setMonth(day); setFocused(day); }
  }
  function selectDay(day: string) {
    setFocused(day);
    if (anchor) {
      setDraft({ from: day < anchor ? day : anchor, to: day < anchor ? anchor : day });
      setAnchor(null);
    } else { setDraft({ from: day, to: day }); setAnchor(day); }
  }
  function calendarKey(event: KeyboardEvent<HTMLButtonElement>, day: string) {
    const weekday = (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7;
    const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -weekday, End: 6 - weekday };
    if (event.key === "PageUp" || event.key === "PageDown") { event.preventDefault(); focusAfterMonth.current = true; changeMonth(event.key === "PageUp" ? -1 : 1); return; }
    if (!(event.key in offsets)) return;
    event.preventDefault();
    const next = shiftDay(day, offsets[event.key]);
    if (next > today) return;
    setFocused(next); focusAfterMonth.current = true; setMonth(`${next.slice(0, 7)}-01`);
  }
  return <section ref={ref} role="dialog" aria-modal="true" aria-label="Seleccionar período" className="dashboard-date-popover" tabIndex={-1}>
    <div className="dashboard-date-presets" role="group" aria-label="Períodos frecuentes">{DATE_PRESETS.map((preset) => <button key={preset} type="button" aria-pressed={draft.preset === preset} onClick={() => {
      const next = datePreset(preset, today); setDraft(next); setAnchor(null); setFocused(next.to); setMonth(`${next.to.slice(0, 7)}-01`);
    }}>{preset}</button>)}</div>
    <div className="dashboard-calendar">
      <header><button className="dashboard-button" type="button" aria-label="Ir al mes anterior" onClick={() => changeMonth(-1)}><ChevronLeft /></button><strong aria-live="polite">{start.toLocaleDateString("es-PE", { timeZone: "UTC", month: "long", year: "numeric" })}</strong><button className="dashboard-button" type="button" aria-label="Ir al mes siguiente" disabled={nextMonth > today} onClick={() => changeMonth(1)}><ChevronRight /></button></header>
      <div className="dashboard-calendar-grid" role="group" aria-label="Días del mes">
        {["lu", "ma", "mi", "ju", "vi", "sá", "do"].map((day) => <span className="calendar-weekday" key={day}>{day}</span>)}
        {Array.from({ length: offset }, (_, index) => <span aria-hidden="true" key={`empty-${index}`} />)}
        {Array.from({ length }, (_, index) => {
          const day = shiftDay(month, index);
          return <button type="button" key={day} data-day={day} tabIndex={day === focused ? 0 : -1} aria-label={new Date(`${day}T12:00:00Z`).toLocaleDateString("es-PE", { timeZone: "UTC", dateStyle: "full" })} aria-pressed={day >= draft.from && day <= draft.to} aria-current={day === today ? "date" : undefined} disabled={day > today} className={`${day >= draft.from && day <= draft.to ? "in-range" : ""} ${day === draft.from || day === draft.to ? "range-end" : ""}`} onKeyDown={(event) => calendarKey(event, day)} onClick={() => selectDay(day)}>{index + 1}</button>;
        })}
      </div>
    </div>
    <footer><span aria-live="polite">{draft.from === draft.to ? shortDay(draft.from) : `${shortDay(draft.from)} - ${shortDay(draft.to)}`}</span><button type="button" className="dashboard-button" onClick={onClose}>Cancelar</button><button type="button" className="dashboard-button primary" disabled={invalid} onClick={() => onApply(draft)}>Aplicar</button>{invalid && <small role="alert">Selecciona hasta 366 días.</small>}</footer>
  </section>;
}
