export const loadOrdersRoute = () => import("../pages/Orders");
export const loadCatalogRoute = () => import("../pages/Catalog");
export const loadDashboardRoute = () => import("../pages/Dashboard");
export const loadOperationsRoute = () => import("../pages/Operations");

export function preloadRoute(path: string) {
  const load = ({ "/": loadDashboardRoute, "/pedidos": loadOrdersRoute, "/catalogo": loadCatalogRoute, "/caja": loadOperationsRoute, "/disponibilidad": loadOperationsRoute } as Record<string, (() => Promise<unknown>) | undefined>)[path];
  if (load) void load().catch(() => { /* Normal navigation retains its own error handling. */ });
}
