import { UserPlus } from "lucide-react";
import { useMemo, useState } from "react";
import { archiveSettingsResource, memberInvitationFeedback, saveSettings, settingsErrorMessage } from "../../lib/settings";
import { useTenant } from "../../lib/tenant";
import type {
  PosDevice,
  SettingsMember,
  SettingsMembers,
  MemberSaveResult,
  StaffRole,
} from "../../types/settings";
import {
  SettingsActionMenu,
  SettingsCard,
  SettingsConfirmDialog,
  SettingsDrawer,
  SettingsFeedback,
  SettingsPagination,
  SettingsSectionHeader,
  SettingsSkeleton,
  SettingsSwitch,
  SettingsTable,
} from "./SettingsPrimitives";
import { useDirtyRegistration, useSettingsDraft, useSettingsQuery } from "./SettingsState";
import { PinEditor } from "./PinEditor";
import { DeviceSettings } from "./DeviceSettings";

const roleOptions: { value: StaffRole; label: string; detail: string }[] = [
  { value: "owner", label: "Administrador", detail: "Puede ver y controlar toda la operación y configuración." },
  { value: "members_manager", label: "Administrador de miembros y permisos", detail: "Administra al equipo sin modificar administradores." },
  { value: "manager", label: "Gestor de sucursal", detail: "Configura las sucursales a las que tiene acceso." },
  { value: "menu_manager", label: "Gestor de menú", detail: "Administra productos, personalizaciones y promociones." },
  { value: "cashier", label: "Cajero", detail: "Opera pedidos, cobros y disponibilidad." },
  { value: "waiter", label: "Mesero", detail: "Opera mesas, comandas y disponibilidad." },
  { value: "kitchen", label: "Cocinero", detail: "Atiende comandas digitales y disponibilidad." },
  { value: "dispatcher", label: "Repartidor", detail: "Consulta y actualiza entregas asignadas." },
];

type MemberDraft = Omit<SettingsMember, "id" | "version" | "capabilities"> & { id?: number; version?: number; pin: string };

function blankMember(branchId: number): MemberDraft {
  return {
    first_name: "",
    last_name: "",
    email: null,
    email_access: false,
    roles: [],
    branch_ids: branchId ? [branchId] : [],
    all_branches: false,
    active: true,
    pin: "",
  };
}

function roleLabel(role: StaffRole) {
  return roleOptions.find((option) => option.value === role)?.label || role;
}

export function MembersSettings() {
  const { branch, context } = useTenant();
  const [page, setPage] = useState(1);
  const members = useSettingsQuery<SettingsMembers>(`/settings/members?branch_id=${branch?.id || 0}&page=${page}&page_size=10`, { items: [], page, page_size: 10, total: 0 });
  const devices = useSettingsQuery<PosDevice[]>(`/settings/devices?branch_id=${branch?.id || 0}`, []);
  const { draft, setDraft, openDraft, dirty } = useSettingsDraft<MemberDraft>();
  const [saving, setSaving] = useState(false);
  useDirtyRegistration({ dirty: false, saving, save: null });
  const [formError, setFormError] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<SettingsMember | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [invitationFeedback, setInvitationFeedback] = useState<{ success: string | null; notice: string | null }>({ success: null, notice: null });
  const capabilities = members.data.capabilities;
  const assignableRoles = roleOptions.filter((role) => capabilities?.assignable_roles.includes(role.value) && (role.value !== "owner" || capabilities.can_manage_admins));
  const editingMember = members.data.items.find((member) => member.id === draft?.id);
  const canSaveMember = members.available && !members.loading && (draft?.id ? editingMember?.capabilities?.can_edit === true : assignableRoles.length > 0);

  const invalidDraft = useMemo(() => {
    if (!draft) return true;
    if (!draft.first_name.trim() || !draft.roles.length || (!draft.all_branches && !draft.branch_ids.length)) return true;
    if ((!draft.id || draft.pin) && !/^\d{4}$/.test(draft.pin)) return true;
    if (draft.email_access && !draft.email?.trim()) return true;
    return false;
  }, [draft]);

  async function persistMember() {
    if (!draft || invalidDraft || !canSaveMember || saving) return;
    setSaving(true);
    setFormError(null);
    setSavedMessage(null);
    setInvitationFeedback({ success: null, notice: null });
    try {
      const path = draft.id ? `/settings/members/${draft.id}` : "/settings/members";
      const branchIds = draft.all_branches ? (context?.branches.map((item) => item.id) || []) : draft.branch_ids;
      const payload = {
        first_name: draft.first_name.trim(),
        last_name: draft.last_name.trim(),
        email: draft.email?.trim() || null,
        email_access: draft.email_access,
        roles: draft.roles,
        branch_ids: branchIds,
        ...(draft.pin ? { pin: draft.pin } : {}),
        ...(draft.id ? { expected_version: draft.version || 1 } : {}),
      };
      const saved = await saveSettings<typeof payload, MemberSaveResult>(path, payload, draft.id ? "PATCH" : "POST");
      setSavedMessage(draft.id ? "Los cambios del miembro se guardaron." : "El miembro se guardó correctamente.");
      setInvitationFeedback(memberInvitationFeedback(saved, draft.email_access));
      setDraft(null);
      await members.reload(true);
    } catch (caught) {
      setFormError(settingsErrorMessage(caught, "No se pudo guardar el miembro."));
    } finally {
      setSaving(false);
    }
  }

  async function archiveMember() {
    if (!archiveTarget || archiveTarget.capabilities?.can_archive !== true || saving) return;
    setSaving(true);
    setFormError(null);
    setSavedMessage(null);
    setInvitationFeedback({ success: null, notice: null });
    try {
      await archiveSettingsResource(`/settings/members/${archiveTarget.id}`, archiveTarget.version);
      setArchiveTarget(null);
      setSavedMessage("El miembro se archivó. Su historial se conserva.");
      setInvitationFeedback({ success: null, notice: null });
      await members.reload(true);
    } catch (caught) {
      setFormError(settingsErrorMessage(caught, "No se pudo archivar el miembro."));
    } finally {
      setSaving(false);
    }
  }

  if (members.loading && !members.data.items.length) return <><SettingsSectionHeader title="Miembros y permisos" /><SettingsSkeleton rows={5} /></>;
  return (
    <div className="settings-section-stack">
      <SettingsSectionHeader title="Miembros y permisos" />
      <SettingsFeedback notice={members.notice || devices.notice} error={members.error || devices.error || formError} success={savedMessage} />
      <SettingsFeedback {...invitationFeedback} />
      {!capabilities && <SettingsFeedback notice="No se pudieron verificar los permisos para administrar miembros. Actualiza la sección cuando la API esté disponible." />}
      <SettingsCard>
        <div className="settings-card-toolbar"><div><h3>Miembros</h3><p>Agrega y administra a tu equipo y sus permisos.</p></div><button className="button button-primary" type="button" disabled={!members.available || members.loading || !assignableRoles.length} onClick={() => { setFormError(null); openDraft(blankMember(branch?.id || 0)); }}><UserPlus />Nuevo miembro</button></div>
        {members.data.items.length ? <><SettingsTable label="Miembros y permisos"><thead><tr><th>Nombre de miembro</th><th>Sucursales</th><th>Roles</th><th>Correo</th><th aria-label="Acciones" /></tr></thead><tbody>{members.data.items.map((member) => {
          const allBranches = Boolean(context?.branches.length && member.branch_ids.length === context.branches.length);
          return <tr key={member.id}><td data-label="Miembro"><strong>{member.first_name} {member.last_name}</strong>{member.is_current_user && <span className="settings-you-chip">Tú</span>}</td><td data-label="Sucursales">{allBranches ? "Todas" : member.branch_ids.length}</td><td data-label="Roles">{member.roles.map(roleLabel).join(", ")}</td><td data-label="Correo">{member.email || "Sin correo"}</td><td><SettingsActionMenu editDisabled={member.capabilities?.can_edit !== true || members.loading} editHelp="El servidor no permite editar este miembro." archiveDisabled={member.capabilities?.can_archive !== true || members.loading} archiveHelp={member.is_current_user ? "No puedes archivarte a ti mismo." : "El servidor no permite archivar este miembro."} onEdit={() => { setFormError(null); openDraft({ ...member, all_branches: allBranches, pin: "" }); }} onArchive={() => setArchiveTarget(member)} /></td></tr>;
        })}</tbody></SettingsTable><SettingsPagination page={members.data.page || page} pageSize={members.data.page_size || 10} total={members.data.total} onPage={setPage} noun="miembros" /></> : <div className="settings-inline-empty">Aún no hay miembros disponibles en este contrato.</div>}
      </SettingsCard>
      <DeviceSettings branchId={branch?.id || 0} devices={devices.data} canManage={members.available && devices.available && Boolean(capabilities)} onChange={() => void devices.reload(true)} />
      {draft && <SettingsDrawer title={draft.id ? "Editar miembro" : "Agrega un miembro"} dirty={dirty} busy={saving} onClose={() => setDraft(null)} footer={(requestClose) => <><button className="button button-secondary" type="button" disabled={saving} onClick={requestClose}>Cancelar</button><button className="button button-primary" type="button" disabled={invalidDraft || saving || !canSaveMember} onClick={() => void persistMember()}>{saving ? "Guardando..." : draft.id ? "Guardar cambios" : "Agregar miembro"}</button></>}>
        <div className="settings-drawer-form">
          <div className="settings-form-grid"><label>Nombre(s)<input data-dialog-initial-focus value={draft.first_name} onChange={(event) => setDraft({ ...draft, first_name: event.target.value })} /></label><label>Apellidos<input value={draft.last_name} onChange={(event) => setDraft({ ...draft, last_name: event.target.value })} /></label></div>
          <PinEditor value={draft.pin} onChange={(pin) => setDraft({ ...draft, pin })} preserveExisting={Boolean(draft.id)} disabled={saving || !canSaveMember} />
          <SettingsSwitch checked={draft.email_access} onChange={(email_access) => setDraft({ ...draft, email_access })} label="Acceso con correo electrónico" description="Solicita acceso por correo. Al guardar se mostrará si la API confirmó el envío de una invitación." />
          {draft.email_access && <label>Correo electrónico<input type="email" value={draft.email || ""} onChange={(event) => setDraft({ ...draft, email: event.target.value })} /></label>}
          <div className="settings-divider" />
          <fieldset className="settings-role-list"><legend>Roles</legend><p>Solo puedes asignar los roles permitidos por el servidor.</p>{roleOptions.filter((role) => assignableRoles.includes(role) || draft.roles.includes(role.value)).map((role) => {
            const allowed = assignableRoles.includes(role) && (!editingMember?.is_current_user || capabilities?.can_manage_admins || editingMember.roles.includes(role.value));
            return <label key={role.value}><input type="checkbox" disabled={!allowed} checked={draft.roles.includes(role.value)} onChange={() => setDraft({ ...draft, roles: draft.roles.includes(role.value) ? draft.roles.filter((value) => value !== role.value) : [...draft.roles, role.value] })} /><span><strong>{role.label}</strong><small>{role.detail}</small></span></label>;
          })}</fieldset>
          <div className="settings-divider" />
          <fieldset className="settings-branch-access"><legend>Sucursales con acceso</legend>
            <label><input type="checkbox" checked={draft.all_branches} disabled={Boolean(editingMember?.is_current_user && !capabilities?.can_manage_admins && context?.branches.some((item) => !editingMember.branch_ids.includes(item.id)))} onChange={(event) => setDraft({ ...draft, all_branches: event.target.checked })} />Todas las sucursales</label>
            {!draft.all_branches && context?.branches.map((item) => <label key={item.id}><input type="checkbox" checked={draft.branch_ids.includes(item.id)} disabled={Boolean(editingMember?.is_current_user && !capabilities?.can_manage_admins && !editingMember.branch_ids.includes(item.id))} onChange={() => setDraft({ ...draft, branch_ids: draft.branch_ids.includes(item.id) ? draft.branch_ids.filter((id) => id !== item.id) : [...draft.branch_ids, item.id] })} />{item.name}</label>)}
          </fieldset>
          {formError && <SettingsFeedback error={formError} />}
        </div>
      </SettingsDrawer>}
      {archiveTarget && <SettingsConfirmDialog title="Archivar miembro" detail={`${archiveTarget.first_name} perderá acceso por PIN y correo. Su historial permanecerá intacto.`} confirmLabel="Archivar miembro" danger busy={saving} onCancel={() => setArchiveTarget(null)} onConfirm={() => void archiveMember()} />}
    </div>
  );
}

export { SecurityAuditSettings } from "./SecurityAuditSettings";
