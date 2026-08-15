import {
  Archive,
  Banknote,
  CalendarDays,
  ChefHat,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Menu,
  PackageOpen,
  PanelsTopLeft,
  Settings,
  ShoppingBasket,
  Store,
  TableProperties,
  Truck,
  X,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useTenant } from "../lib/tenant";

const navigation = [
  { to: "/", label: "Inicio", icon: LayoutDashboard, end: true, module: null },
  { to: "/pos", label: "POS", icon: ShoppingBasket, module: "pos" },
  { to: "/pedidos", label: "Pedidos", icon: ClipboardList, module: "pos" },
  { to: "/mesas", label: "Mesas", icon: TableProperties, module: "tables" },
  { to: "/cocina", label: "Cocina", icon: ChefHat, module: "kds" },
  { to: "/delivery", label: "Delivery", icon: Truck, module: "delivery" },
  { to: "/reservas", label: "Reservas", icon: CalendarDays, module: "reservations" },
  { to: "/inventario", label: "Inventario", icon: Archive, module: "inventory" },
  { to: "/caja", label: "Caja", icon: Banknote, module: "cash" },
  { to: "/ventas", label: "Ventas", icon: PanelsTopLeft, module: "pos" },
  { to: "/configuracion", label: "Configuración", icon: Settings, module: null },
];

export function Shell({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { signOut, user } = useAuth();
  const { context, branch, selectBranch } = useTenant();

  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? "sidebar-open" : ""}`}>
        <div className="brand-block">
          <div className="brand-mark"><Store /></div>
          <div><strong>Escalar AI</strong><span>POS gastronómico</span></div>
          <button className="icon-button sidebar-close" onClick={() => setMenuOpen(false)}><X /></button>
        </div>
        <nav>
          {navigation.filter((item) => !item.module || context?.business.modules[item.module]).map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} onClick={() => setMenuOpen(false)}>
              <Icon /><span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="user-chip"><span>{user?.email?.slice(0, 1).toUpperCase()}</span><div><strong>{user?.email}</strong><small>Sesión segura</small></div></div>
          <button className="logout-button" onClick={() => void signOut()}><LogOut /> Salir</button>
        </div>
      </aside>
      {menuOpen && <button className="sidebar-scrim" onClick={() => setMenuOpen(false)} aria-label="Cerrar menú" />}
      <div className="workspace">
        <header className="topbar">
          <button className="icon-button mobile-menu" onClick={() => setMenuOpen(true)}><Menu /></button>
          <div className="restaurant-title">
            <span className="live-dot" />
            <div><strong>{context?.business.name || "Restaurante"}</strong><small>Operación en tiempo real</small></div>
          </div>
          <label className="branch-picker">
            <PackageOpen />
            <select value={branch?.id || ""} onChange={(event) => selectBranch(Number(event.target.value))}>
              {context?.branches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
        </header>
        <main className="main-content">{children}</main>
      </div>
    </div>
  );
}
