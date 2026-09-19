import {
  Banknote,
  Building2,
  CalendarClock,
  Clock3,
  CreditCard,
  History,
  MapPinned,
  MessageSquareText,
  PackageCheck,
  Printer,
  Settings,
  Store,
  Truck,
  Users,
  X,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type ComponentType } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { DialogPortal, useDialogSurface } from "../lib/dialog";
import { useTenant } from "../lib/tenant";
import type { SettingsSectionSlug } from "../types/settings";
import { DeliverySettingsSection, DeliveryTimesSettings, PaymentMethodsSettings, ServiceOptionsSettings, WhatsAppSettingsSection } from "./settings/CommerceSettings";
import { BranchSettings, GeneralSettings } from "./settings/GeneralAndBranchSettings";
import { PrintingSettings } from "./settings/PrintingSettings";
import { RegistersSettings, ZonesAndTablesSettings } from "./settings/ResourceSettings";
import { SchedulesSettings } from "./settings/ScheduleSettings";
import { SettingsConfirmDialog } from "./settings/SettingsPrimitives";
import { SettingsStateProvider, type DirtyRegistration } from "./settings/SettingsState";
import { MembersSettings } from "./settings/TeamAndAuditSettings";
import { AgentSettings } from "./settings/AgentSettings";
import { SecurityAuditSettings } from "./settings/SecurityAuditSettings";

type SectionDefinition = {
  slug: SettingsSectionSlug;
  label: string;
  icon: ComponentType<{ className?: string }>;
  group?: string;
};

const sections: SectionDefinition[] = [
  { slug: "general", label: "General", icon: Settings },
  { slug: "sucursal", label: "Datos de sucursal", icon: Store },
  { slug: "servicios", label: "Opciones de servicio", icon: PackageCheck },
  { slug: "delivery", label: "Costos de envío", icon: Truck },
  { slug: "miembros", label: "Miembros y permisos", icon: Users },
  { slug: "seguridad", label: "Historial de seguridad", icon: History },
  { slug: "zonas", label: "Zonas y mesas", icon: MapPinned },
  { slug: "cajas", label: "Cajas", icon: Banknote },
  { slug: "impresion", label: "Impresión", icon: Printer },
  { slug: "agente", label: "Perfil del agente", icon: MessageSquareText, group: "Agente de Whatsapp" },
  { slug: "metodos-de-pago", label: "Métodos de pago", icon: CreditCard },
  { slug: "tiempos-de-entrega", label: "Tiempos de entrega", icon: Clock3 },
  { slug: "horarios", label: "Horarios", icon: CalendarClock },
  { slug: "whatsapp", label: "WhatsApp vinculado", icon: MessageSquareText },
];

type PendingNavigation = { type: "close" } | { type: "section"; slug: SettingsSectionSlug };

function SettingsContextChangeDialog({ dirty, previousBranch, onRestore, onReload, onClose }: {
  dirty: boolean;
  previousBranch: string;
  onRestore?: () => void;
  onReload: () => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const surfaceRef = useDialogSurface(() => { onRestore?.(); });
  return <DialogPortal><div className="settings-confirm-backdrop" role="presentation">
    <section ref={surfaceRef} className="settings-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <h2 id={titleId}>Cambió el contexto de configuración</h2>
      <p>{dirty ? `El borrador de ${previousBranch} se conserva, pero no se puede guardar en otra sucursal o empresa.` : "La sucursal o empresa activa cambió. Confirma antes de cargar sus ajustes."} Si había un guardado en curso, revisa su resultado al volver.</p>
      <footer>
        {onRestore && <button className="button button-secondary" type="button" onClick={onRestore}>Volver sin descartar</button>}
        <button className="button button-secondary" type="button" onClick={onClose}>{dirty ? "Descartar y cerrar" : "Cerrar configuración"}</button>
        <button className={`button ${dirty ? "button-danger" : "button-primary"}`} type="button" onClick={onReload}>{dirty ? "Descartar y cargar ajustes actuales" : "Cargar ajustes actuales"}</button>
      </footer>
    </section>
  </div></DialogPortal>;
}

export function SettingsWorkspace() {
  const { seccion } = useParams<{ seccion?: string }>();
  const { branch, context, selectBranch } = useTenant();
  const scopeKey = `${context?.business.id || 0}:${branch?.id || 0}`;
  const [workspaceScope, setWorkspaceScope] = useState(() => ({ key: scopeKey, businessId: context?.business.id, branchId: branch?.id, branchName: branch?.name || "la sucursal anterior" }));
  const scopeChanged = workspaceScope.key !== scopeKey;
  const latestScopeKey = useRef(scopeKey);
  latestScopeKey.current = scopeKey;
  const location = useLocation();
  const navigate = useNavigate();
  const titleId = useId();
  const active = sections.some((section) => section.slug === seccion) ? seccion as SettingsSectionSlug : "general";
  const [registration, setRegistration] = useState<DirtyRegistration>({ dirty: false, saving: false, save: null });
  const [pending, setPending] = useState<PendingNavigation | null>(null);

  const returnTo = useMemo(() => {
    const state = location.state as { settingsFrom?: string } | null;
    return state?.settingsFrom && !state.settingsFrom.startsWith("/configuracion") ? state.settingsFrom : "/";
  }, [location.state]);

  function performNavigation(target: PendingNavigation) {
    setPending(null);
    if (target.type === "close") navigate(returnTo, { replace: true });
    else navigate(`/configuracion/${target.slug}`, { state: location.state, replace: true });
  }

  function requestNavigation(target: PendingNavigation) {
    if (registration.saving || scopeChanged) return;
    if (registration.dirty) setPending(target);
    else performNavigation(target);
  }

  const surfaceRef = useDialogSurface(() => requestNavigation({ type: "close" }));

  useEffect(() => {
    if (seccion && !sections.some((section) => section.slug === seccion)) {
      navigate("/configuracion/general", { replace: true, state: location.state });
    }
  }, [location.state, navigate, seccion]);

  useEffect(() => {
    if (!registration.dirty && !registration.saving) return;
    const protect = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [registration.dirty, registration.saving]);

  const content = (() => {
    switch (active) {
      case "general": return <GeneralSettings />;
      case "agente": return <AgentSettings />;
      case "sucursal": return <BranchSettings />;
      case "servicios": return <ServiceOptionsSettings />;
      case "delivery": return <DeliverySettingsSection />;
      case "miembros": return <MembersSettings />;
      case "seguridad": return <SecurityAuditSettings />;
      case "zonas": return <ZonesAndTablesSettings branchId={branch?.id || 0} />;
      case "cajas": return <RegistersSettings branchId={branch?.id || 0} />;
      case "impresion": return <PrintingSettings branchId={branch?.id || 0} businessName={context?.business.name} branchName={branch?.name} />;
      case "metodos-de-pago": return <PaymentMethodsSettings />;
      case "tiempos-de-entrega": return <DeliveryTimesSettings />;
      case "horarios": return <SchedulesSettings branchId={branch?.id || 0} />;
      case "whatsapp": return <WhatsAppSettingsSection />;
    }
  })();

  return <DialogPortal>
    <section ref={surfaceRef} className="settings-workspace" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <header className="settings-workspace-header"><div><Building2 /><h1 id={titleId}>Configuración</h1></div><button className="icon-button" type="button" aria-label="Cerrar configuración" onClick={() => requestNavigation({ type: "close" })}><X /></button></header>
      <div className="settings-mobile-navigation">
        <label htmlFor="settings-section-select">Sección</label>
        <select id="settings-section-select" value={active} onChange={(event) => requestNavigation({ type: "section", slug: event.target.value as SettingsSectionSlug })}>{sections.map((section) => <option key={section.slug} value={section.slug}>{section.label}</option>)}</select>
      </div>
      <div className="settings-workspace-layout">
        <nav className="settings-navigation" aria-label="Secciones de configuración">
          {sections.map((section, index) => {
            const Icon = section.icon;
            const previousGroup = sections[index - 1]?.group;
            return <div key={section.slug}>{section.group && section.group !== previousGroup && <span className="settings-navigation-group">{section.group}</span>}<button type="button" className={active === section.slug ? "is-active" : ""} aria-current={active === section.slug ? "page" : undefined} onClick={() => active !== section.slug && requestNavigation({ type: "section", slug: section.slug })}><Icon /><span>{section.label}</span></button></div>;
          })}
        </nav>
        <SettingsStateProvider onRegistration={setRegistration} scopeKey={scopeKey} enabled={!scopeChanged}><main className="settings-workspace-content" key={`${workspaceScope.key}:${active}`} inert={registration.saving || scopeChanged || undefined}>{content}</main></SettingsStateProvider>
      </div>
    </section>
    {pending && !scopeChanged && <SettingsConfirmDialog
      title="Tienes cambios sin guardar"
      detail="Guarda o descarta los cambios antes de continuar. Así evitamos perder ajustes por accidente."
      confirmLabel="Descartar cambios"
      danger
      busy={registration.saving}
      onCancel={() => setPending(null)}
      onConfirm={() => performNavigation(pending)}
      extraAction={<button className="button button-primary" type="button" disabled={registration.saving || !registration.save} onClick={() => void registration.save?.().then((saved) => {
        if (latestScopeKey.current !== scopeKey) return;
        if (saved) performNavigation(pending);
        else setPending(null);
      })}>{registration.saving ? "Guardando..." : "Guardar y continuar"}</button>}
    />}
    {scopeChanged && <SettingsContextChangeDialog
      dirty={registration.dirty}
      previousBranch={workspaceScope.branchName}
      onRestore={context?.business.id === workspaceScope.businessId && context?.branches.some((item) => item.id === workspaceScope.branchId) ? () => selectBranch(workspaceScope.branchId!) : undefined}
      onReload={() => {
        setPending(null);
        setWorkspaceScope({ key: scopeKey, businessId: context?.business.id, branchId: branch?.id, branchName: branch?.name || "la sucursal anterior" });
      }}
      onClose={() => performNavigation({ type: "close" })}
    />}
  </DialogPortal>;
}
