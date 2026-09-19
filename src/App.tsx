import { Navigate, Route, Routes } from "react-router-dom";
import { Shell } from "./components/Shell";
import { ErrorState, LoadingState } from "./components/ui";
import { useAuth } from "./lib/auth";
import { TenantProvider, useTenant } from "./lib/tenant";
import { LoginPage } from "./pages/Login";
import { loadCatalogRoute, loadDashboardRoute, loadOperationsRoute, loadOrdersRoute } from "./lib/route-chunks";
import { lazy, Suspense, type ReactNode } from "react";

const PublicReservationPage = lazy(() => import("./pages/Public").then((module) => ({ default: module.PublicReservationPage })));
const PublicStorePage = lazy(() => import("./pages/Public").then((module) => ({ default: module.PublicStorePage })));
const InvitationPage = lazy(() => import("./pages/Invitation").then((module) => ({ default: module.InvitationPage })));
const ActivateDevicePage = lazy(() => import("./pages/DeviceAccess").then((module) => ({ default: module.ActivateDevicePage })));
const DevicePinPage = lazy(() => import("./pages/DeviceAccess").then((module) => ({ default: module.DevicePinPage })));
const DashboardPage = lazy(() => loadDashboardRoute().then((module) => ({ default: module.DashboardPage })));
const DownloadAppPage = lazy(() => import("./pages/DownloadApp").then((module) => ({ default: module.DownloadAppPage })));
const OrdersPage = lazy(() => loadOrdersRoute().then((module) => ({ default: module.OrdersPage })));
const CatalogPage = lazy(() => loadCatalogRoute().then((module) => ({ default: module.CatalogPage })));
const CashPage = lazy(() => loadOperationsRoute().then((module) => ({ default: module.CashPage })));
const InventoryPage = lazy(() => loadOperationsRoute().then((module) => ({ default: module.InventoryPage })));
const SettingsWorkspace = lazy(() => import("./components/SettingsWorkspace").then((module) => ({ default: module.SettingsWorkspace })));

function ModuleRoute({ module, roles, children }: { module: string; roles?: string[]; children: ReactNode }) {
  const { context } = useTenant();
  const moduleEnabled = Boolean(context?.business.modules[module]);
  const assignedRoles = context?.roles?.length ? context.roles : context?.role ? [context.role] : [];
  const roleAllowed = !roles || !assignedRoles.length || assignedRoles.some((role) => roles.includes(role));
  return moduleEnabled && roleAllowed ? children : <Navigate to="/" replace />;
}

function RoleRoute({ roles, children }: { roles: string[]; children: ReactNode }) {
  const { context } = useTenant();
  const assignedRoles = context?.roles?.length ? context.roles : context?.role ? [context.role] : [];
  return !assignedRoles.length || assignedRoles.some((role) => roles.includes(role)) ? children : <Navigate to="/" replace />;
}

function ProtectedApp() {
  const { context, loading, error, refresh } = useTenant();
  const { signOut } = useAuth();
  if (loading) return <LoadingState label="Preparando la operación del restaurante..." />;
  if (error) return (
    <main className="standalone-state">
      <ErrorState message={error} onRetry={() => void refresh()} />
      <button className="button button-ghost" onClick={() => void signOut()}>Cerrar sesión y volver al acceso</button>
    </main>
  );
  if (!context) return <Navigate to="/login" replace />;
  return (
    <Shell>
      <Suspense fallback={<LoadingState label="Abriendo el módulo..." />}>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/descargar-app" element={<DownloadAppPage />} />
          <Route path="/pedidos" element={<ModuleRoute module="pos"><OrdersPage /></ModuleRoute>} />
          <Route path="/catalogo" element={<ModuleRoute module="pos" roles={["superadmin", "owner", "manager"]}><CatalogPage /></ModuleRoute>} />
          <Route path="/disponibilidad" element={<ModuleRoute module="inventory"><InventoryPage /></ModuleRoute>} />
          <Route path="/inventario" element={<Navigate to="/disponibilidad" replace />} />
          <Route path="/caja" element={<ModuleRoute module="cash"><CashPage /></ModuleRoute>} />
          <Route path="/configuracion/:seccion?" element={<RoleRoute roles={["superadmin", "owner", "manager", "members_manager"]}><SettingsWorkspace /></RoleRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </Shell>
  );
}

export function App() {
  const { user, loading } = useAuth();
  if (loading) return <LoadingState label="Verificando tu sesión..." />;
  return (
    <Suspense fallback={<LoadingState label="Abriendo el módulo..." />}><Routes>
      <Route path="/tienda/:slug" element={<PublicStorePage />} />
      <Route path="/reservar/:slug" element={<PublicReservationPage />} />
      <Route path="/invitacion" element={<InvitationPage />} />
      <Route path="/activar-dispositivo" element={<ActivateDevicePage />} />
      <Route path="/acceso-pin" element={<DevicePinPage />} />
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route path="/*" element={user ? <TenantProvider key={user.id}><ProtectedApp /></TenantProvider> : <Navigate to={localStorage.getItem("impulsa.authMode") === "device" ? "/acceso-pin" : "/login"} replace />} />
    </Routes></Suspense>
  );
}
