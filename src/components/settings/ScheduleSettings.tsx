import { AlertTriangle, CalendarClock, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import type { ScheduleSettings, ServiceSchedule } from "../../types/settings";
import {
  SettingsCard,
  SettingsDrawer,
  SettingsFeedback,
  SettingsFormActions,
  SettingsSectionHeader,
  SettingsSkeleton,
  SettingsSwitch,
} from "./SettingsPrimitives";
import { useSettingsResource } from "./SettingsState";

const weekdays = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

const primarySchedule: ServiceSchedule = {
  id: 0,
  version: 0,
  name: "Horario principal",
  is_primary: true,
  active: true,
  shifts: [],
  product_ids: [],
  promotion_ids: [],
};

export function SchedulesSettings({ branchId }: { branchId: number }) {
  const resource = useSettingsResource<ScheduleSettings>(`/settings/branches/${branchId}/schedules`, { version: 0, schedules: [primarySchedule] }, "Los horarios se guardaron correctamente.");
  const [newScheduleName, setNewScheduleName] = useState<string | null>(null);

  function updateSchedule(id: number, update: (schedule: ServiceSchedule) => ServiceSchedule) {
    resource.setData((current) => ({ ...current, schedules: current.schedules.map((schedule) => schedule.id === id ? update(schedule) : schedule) }));
  }

  function addShift(scheduleId: number, weekday: number) {
    updateSchedule(scheduleId, (schedule) => ({
      ...schedule,
      shifts: [...schedule.shifts, { weekday, starts_at: "09:00", ends_at: "17:00" }],
    }));
  }

  function addSchedule() {
    const name = newScheduleName?.trim();
    if (!name) return;
    resource.setData((current) => ({
      ...current,
      schedules: [...current.schedules, {
        id: -Date.now(),
        version: 0,
        name,
        is_primary: false,
        active: true,
        shifts: [],
        product_ids: [],
        promotion_ids: [],
      }],
    }));
    setNewScheduleName(null);
  }

  if (resource.loading) return <><SettingsSectionHeader title="Horarios" /><SettingsSkeleton rows={6} /></>;
  const primary = resource.data.schedules.find((schedule) => schedule.is_primary);
  return (
    <div className="settings-section-stack">
      <SettingsSectionHeader title="Horarios" description="Define el horario principal y horarios especiales para productos o promociones." action={<button className="button button-primary" type="button" onClick={() => setNewScheduleName("")}><Plus />Nuevo horario</button>} />
      <SettingsFeedback notice={resource.notice} error={resource.error} success={resource.savedMessage} />
      {primary && !primary.shifts.length && <div className="settings-schedule-warning" role="status"><AlertTriangle /><span>El horario permanecerá abierto las 24 horas hasta que agregues un turno.</span></div>}
      {resource.data.schedules.map((schedule) => <SettingsCard key={schedule.id} className="settings-schedule-card">
        <div className="settings-schedule-title"><div><CalendarClock /><span><strong>{schedule.name}</strong><small>{schedule.is_primary ? "Horario de la sucursal" : "Horario adicional"}</small></span></div><SettingsSwitch label={`Activar ${schedule.name}`} checked={schedule.active} onChange={(active) => updateSchedule(schedule.id, (current) => ({ ...current, active }))} /></div>
        <div className="settings-week-list">{weekdays.map((day, weekday) => {
          const shifts = schedule.shifts.map((shift, index) => ({ shift, index })).filter(({ shift }) => shift.weekday === weekday);
          return <div className="settings-week-row" key={day}><strong>{day}</strong><div>{shifts.map(({ shift, index }) => <span className="settings-shift" key={`${weekday}-${index}`}><input aria-label={`Inicio ${day}`} type="time" value={shift.starts_at} onChange={(event) => updateSchedule(schedule.id, (current) => ({ ...current, shifts: current.shifts.map((item, itemIndex) => itemIndex === index ? { ...item, starts_at: event.target.value } : item) }))} /><span>a</span><input aria-label={`Fin ${day}`} type="time" value={shift.ends_at} onChange={(event) => updateSchedule(schedule.id, (current) => ({ ...current, shifts: current.shifts.map((item, itemIndex) => itemIndex === index ? { ...item, ends_at: event.target.value } : item) }))} /><button className="icon-button" type="button" aria-label={`Eliminar turno de ${day}`} onClick={() => updateSchedule(schedule.id, (current) => ({ ...current, shifts: current.shifts.filter((_, itemIndex) => itemIndex !== index) }))}><Trash2 /></button></span>)}<button className="button button-quiet" type="button" onClick={() => addShift(schedule.id, weekday)}><Plus />Nuevo turno</button></div></div>;
        })}</div>
        {!schedule.is_primary && <label className="settings-field settings-assignment-field">Productos asignados (IDs separados por comas)<input value={schedule.product_ids.join(", ")} onChange={(event) => updateSchedule(schedule.id, (current) => ({ ...current, product_ids: event.target.value.split(",").map(Number).filter((value) => Number.isInteger(value) && value > 0) }))} /><small>Sin asignaciones, el horario queda guardado pero no limita productos.</small></label>}
      </SettingsCard>)}
      <SettingsFormActions dirty={resource.dirty} saving={resource.saving} disabled={!resource.available} onCancel={resource.reset} onSave={() => void resource.save()} />
      {newScheduleName !== null && <SettingsDrawer title="Agregar un horario" dirty={Boolean(newScheduleName)} busy={resource.saving} onClose={() => setNewScheduleName(null)} footer={(requestClose) => <><button className="button button-secondary" type="button" disabled={resource.saving} onClick={requestClose}>Cancelar</button><button className="button button-primary" type="button" disabled={!newScheduleName.trim() || resource.saving} onClick={addSchedule}>Agregar horario</button></>}>
        <p className="settings-drawer-intro">Usa horarios adicionales para productos o promociones que solo están disponibles en determinados días.</p>
        <label className="settings-field">Nombre del horario<input autoFocus value={newScheduleName} onChange={(event) => setNewScheduleName(event.target.value)} /></label>
      </SettingsDrawer>}
    </div>
  );
}
