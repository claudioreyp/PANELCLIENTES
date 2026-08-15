import { Navigate, Route, Routes } from "react-router-dom";
import { Shell } from "./components/Shell";
import { ErrorState, LoadingState } from "./components/ui";
import { useAuth } from "./lib/auth";
import { TenantProvider, useTenant } from "./lib/tenant";
import { LoginPage } from "./pages/Login";
import { DashboardPage } from "./pages/Dashboard";
import { PosPage } from "./pages/Pos";
import { OrdersPage } from "./pages/Orders";
import { TablesPage } from "./pages/Tables";
import { KitchenPage } from "./pages/Kitchen";
import { CashPage, DeliveryPage, InventoryPage, ReservationsPage, SalesPage, SettingsPage } from "./pages/Operations";
import { PublicReservationPage, PublicStorePage } from "./pages/Public";
import { InvitationPage } from "./pages/Invitation";
import type { ReactNode } from "react";

function ModuleRoute({ module, children }: { module: string; children: ReactNode }) {
  const { context } = useTenant();
  return context?.business.modules[module] ? children : <Navigate to="/" replace />;
}

function ProtectedApp() {
  const { context, loading, error, refresh } = useTenant();
  if (loading) return <LoadingState label="Preparando la operación del restaurante..." />;
  if (error) return <main className="standalone-state"><ErrorState message={error} onRetry={() => void refresh()} /></main>;
  if (!context) return <Navigate to="/login" replace />;
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/pos" element={<ModuleRoute module="pos"><PosPage /></ModuleRoute>} />
        <Route path="/pedidos" element={<ModuleRoute module="pos"><OrdersPage /></ModuleRoute>} />
        <Route path="/mesas" element={<ModuleRoute module="tables"><TablesPage /></ModuleRoute>} />
        <Route path="/cocina" element={<ModuleRoute module="kds"><KitchenPage /></ModuleRoute>} />
        <Route path="/delivery" element={<ModuleRoute module="delivery"><DeliveryPage /></ModuleRoute>} />
        <Route path="/reservas" element={<ModuleRoute module="reservations"><ReservationsPage /></ModuleRoute>} />
        <Route path="/inventario" element={<ModuleRoute module="inventory"><InventoryPage /></ModuleRoute>} />
        <Route path="/caja" element={<ModuleRoute module="cash"><CashPage /></ModuleRoute>} />
        <Route path="/ventas" element={<ModuleRoute module="pos"><SalesPage /></ModuleRoute>} />
        <Route path="/configuracion" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}

export function App() {
  const { user, loading } = useAuth();
  if (loading) return <LoadingState label="Verificando tu sesión..." />;
  return (
    <Routes>
      <Route path="/tienda/:slug" element={<PublicStorePage />} />
      <Route path="/reservar/:slug" element={<PublicReservationPage />} />
      <Route path="/invitacion" element={<InvitationPage />} />
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route path="/*" element={user ? <TenantProvider><ProtectedApp /></TenantProvider> : <Navigate to="/login" replace />} />
    </Routes>
  );
}
