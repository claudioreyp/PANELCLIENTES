import {
  Archive,
  Banknote,
  BookOpenText,
  ClipboardList,
  Download,
  Home,
  MessageSquareText,
  LayoutDashboard,
  LogOut,
  Menu,
  PackageOpen,
  Settings,
  Store,
  X,
} from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useTenant } from "../lib/tenant";
import { useDialogSurface } from "../lib/dialog";
import { PrintNotifications } from "./PrintNotifications";
import { useAppInstallation } from "../lib/use-app-installation";
import { preloadRoute } from "../lib/route-chunks";
import "../pages/download-app.css";

const MOBILE_NAV_QUERY = "(max-width: 900px)";

const navigation = [
  { to: "/", label: "Inicio", icon: Home, end: true, module: null },
  { to: "/pedidos", label: "Pedidos", icon: ClipboardList, module: "pos" },
  { to: "/catalogo", label: "Menú", icon: BookOpenText, module: "pos", roles: ["superadmin", "owner", "manager"] },
  { to: "/caja", label: "Caja", icon: Banknote, module: "cash" },
  { to: "/disponibilidad", label: "Disponibilidad", icon: Archive, module: "inventory" },
];

export function Shell({ children }: { children: ReactNode }) {
  const installation = useAppInstallation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(MOBILE_NAV_QUERY).matches);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarId = useId();
  const { signOut, user } = useAuth();
  const { context, branch, selectBranch } = useTenant();
  const location = useLocation();
  const [menuLocation, setMenuLocation] = useState(location.key);
  const mobileMenuOpen = isMobile && menuOpen && menuLocation === location.key;
  const sidebarRef = useDialogSurface(() => setMenuOpen(false), { enabled: mobileMenuOpen });
  const assignedRoles = context?.roles?.length ? context.roles : context?.role ? [context.role] : [];

  useEffect(() => {
    document.body.classList.add("pos-operational");
    return () => document.body.classList.remove("pos-operational");
  }, []);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.key]);

  useEffect(() => {
    const media = window.matchMedia(MOBILE_NAV_QUERY);
    function updateViewport() {
      setIsMobile(media.matches);
      setMenuOpen(false);
      const active = document.activeElement;
      if (media.matches && sidebarRef.current?.contains(active)) menuButtonRef.current?.focus();
      else if (!media.matches && (active === menuButtonRef.current || active?.matches(".sidebar-close"))) {
        const navigationTarget = sidebarRef.current?.querySelector<HTMLElement>("nav a.active") || sidebarRef.current?.querySelector<HTMLElement>("nav a");
        navigationTarget?.focus();
      }
    }
    media.addEventListener("change", updateViewport);
    return () => media.removeEventListener("change", updateViewport);
  }, [sidebarRef]);

  return (
    <div className="app-shell">
      <aside ref={sidebarRef} id={sidebarId} className={`sidebar ${mobileMenuOpen ? "sidebar-open" : ""}`} inert={isMobile && !mobileMenuOpen} aria-hidden={isMobile && !mobileMenuOpen ? true : undefined} role={mobileMenuOpen ? "dialog" : undefined} aria-modal={mobileMenuOpen ? true : undefined} aria-label={mobileMenuOpen ? "Menú principal" : undefined} tabIndex={-1}>
        <div className="brand-block">
          <div className="brand-mark"><Store /></div>
          <div><strong>Escalar AI POS</strong><span>{context?.business.name || "Restaurante"}</span></div>
          <button className="icon-button sidebar-close" data-dialog-initial-focus aria-label="Cerrar menú" onClick={() => setMenuOpen(false)}><X /></button>
        </div>
        <label className="sidebar-branch-picker">
          <span>Sucursal</span>
          <div><PackageOpen /><select value={branch?.id || ""} onChange={(event) => selectBranch(Number(event.target.value))}>
            {context?.branches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></div>
        </label>
        <nav>
          {navigation.filter((item) => {
            if (item.module && !context?.business.modules[item.module]) return false;
            if ("roles" in item && item.roles && assignedRoles.length && !assignedRoles.some((role) => item.roles?.includes(role))) return false;
            return true;
          }).map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} onMouseEnter={() => preloadRoute(to)} onFocus={() => preloadRoute(to)} onClick={() => setMenuOpen(false)}>
              <Icon /><span>{label}</span>
            </NavLink>
          ))}
          {(!assignedRoles.length || assignedRoles.some((role) => ["superadmin", "owner", "manager", "members_manager"].includes(role))) && <NavLink to="/configuracion/agente" state={{ settingsFrom: `${location.pathname}${location.search}${location.hash}` }} onClick={() => setMenuOpen(false)}><MessageSquareText /><span>Agente de Whatsapp</span></NavLink>}
        </nav>
        <div className="sidebar-footer">
          {(!assignedRoles.length || assignedRoles.some((role) => ["superadmin", "owner", "manager", "members_manager", "menu_manager"].includes(role))) && <NavLink className="settings-launch-button" to="/configuracion/general" state={{ settingsFrom: `${location.pathname}${location.search}${location.hash}` }} onClick={() => setMenuOpen(false)}><Settings /><span>Configuración</span></NavLink>}
          <div className="user-chip"><span>{user?.email?.slice(0, 1).toUpperCase()}</span><div><strong>{user?.email}</strong><small>Sesión segura</small></div></div>
          <button className="logout-button" onClick={() => void signOut()}><LogOut /> Salir</button>
        </div>
      </aside>
      {mobileMenuOpen && <button className="sidebar-scrim" tabIndex={-1} onClick={() => setMenuOpen(false)} aria-label="Cerrar menú" />}
      <div className="workspace" inert={mobileMenuOpen}>
        <header className="topbar">
          <button ref={menuButtonRef} className="icon-button mobile-menu" aria-label="Abrir menú" aria-expanded={mobileMenuOpen} aria-controls={sidebarId} onClick={(event) => { event.currentTarget.focus(); setMenuLocation(location.key); setMenuOpen(true); }}><Menu /></button>
          <div className="restaurant-title">
            <span className="live-dot" />
            <div><strong>{context?.business.name || "Restaurante"}</strong><small>{branch?.name || "Sucursal"}</small></div>
          </div>
          <div className="topbar-actions">
            <div className="topbar-product"><LayoutDashboard /><span>Operación en línea</span></div>
            {installation.status !== "installed" && <NavLink className="install-app-link" to="/descargar-app"><span>Instalar app</span><Download aria-hidden="true" /></NavLink>}
          </div>
        </header>
        <main className="main-content">{children}</main>
      </div>
      {branch && user && <PrintNotifications key={`${user.id}:${context?.business.id}:${branch.id}`} branchId={branch.id} />}
    </div>
  );
}
