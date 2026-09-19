import { expect, test, type Page, type Route } from "@playwright/test";

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function mockWorkspace(page: Page) {
  const branch = { id: 1, business_id: 1, name: "Sucursal principal", slug: "principal", active: true, opening_hours: {}, accepted_payment_methods: ["cash", "card"], delivery_enabled: true, takeaway_enabled: true, dine_in_enabled: true, delivery_fee: 5 };
  const groups = [
    { id: 1, branch_id: 1, name: "Elige las salsas", minimum: 1, maximum: 1, required: true, sort_order: 0, modifiers: [
      { id: 1, name: "BBQ", price_delta: 0, available: true, active: true },
      { id: 2, name: "Búfalo", price_delta: 0, available: false, active: true },
      { id: 3, name: "Mango habanero", price_delta: 0, available: false, active: true },
      { id: 4, name: "Opción archivada", price_delta: 0, available: false, active: false },
    ] },
    { id: 2, branch_id: 1, name: "Extras", minimum: 0, maximum: 5, required: false, sort_order: 1, modifiers: [
      { id: 5, name: "Aderezo Ranch", price_delta: 3, available: true, active: true },
      { id: 6, name: "Pepino", price_delta: 2, available: true, active: true },
      { id: 7, name: "Zanahoria", price_delta: 2, available: true, active: true },
    ] },
  ];
  const variants = [
    { id: 1, name: "Chico", active: true, available: true, price_delta: 0 },
    { id: 2, name: "Grande", active: true, available: true, price_delta: 25 },
    { id: 3, name: "Mediano", active: true, available: false, price_delta: 15 },
    { id: 4, name: "Archivada", active: false, available: false, price_delta: 0 },
  ];
  const product = { id: 1, name: "Alitas", category_id: 1, available: true, price: 25, variants, modifier_groups: groups, product_type: "standard", service_channels: ["pos_takeaway", "pos_counter", "pos_delivery", "pos_tables"], recipe: [], combo_components: [] };
  const catalog = { branch, categories: [{ id: 1, name: "Alitas y boneless", active: true, sort_order: 0 }], products: [product], modifier_groups: groups, ingredients: [], promotions: [] };
  const state = { failCatalog: false, failReport: false, failNextSwitch: false, reportQueries: [] as string[], writes: [] as string[] };
  await page.clock.setFixedTime(new Date("2026-09-08T23:00:00Z"));
  await page.addInitScript(() => {
    localStorage.setItem("impulsa.authMode", "dev"); localStorage.setItem("impulsa.businessId", "1"); localStorage.setItem("impulsa.branchId", "1");
  });
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request(); const url = new URL(request.url()); const path = url.pathname.replace("/api/v1", "");
    if (path === "/context") return json(route, { role: "owner", business: { id: 1, slug: "restaurante", name: "Restaurante de prueba", status: "active", plan: "pro", currency: "PEN", timezone: "America/Lima", modules: { pos: true, inventory: true, cash: true } }, branches: [branch] });
    if (path === "/catalog") return state.failCatalog ? json(route, { detail: "Lectura temporalmente no disponible" }, 422) : json(route, catalog);
    if (path === "/reports/dashboard") {
      state.reportQueries.push(url.search);
      if (state.failReport) return json(route, { detail: "Reporte temporalmente no disponible" }, 422);
      const hourly = url.searchParams.get("date_from") === url.searchParams.get("date_to");
      return json(route, {
        sales: 135, orders: 2, shipping: 10, average_ticket: 67.5, granularity: hourly ? "hour" : "day",
        series: Array.from({ length: hourly ? 19 : 7 }, (_, index) => ({ key: hourly ? `${String(index).padStart(2, "0")}:00` : `2026-09-0${index + 2}`, sales: index === (hourly ? 15 : 3) ? 66 : index === (hourly ? 17 : 5) ? 69 : 0, orders: [hourly ? 15 : 3, hourly ? 17 : 5].includes(index) ? 1 : 0, shipping: index === (hourly ? 15 : 3) ? 10 : 0 })),
        weekdays: hourly ? [] : ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"].map((name, index) => ({ name, sales: index === 1 ? 135 : 0 })),
        channels: [{ name: "Punto de venta", sales: 66, orders: 1 }, { name: "Menú digital", sales: 0, orders: 0 }, { name: "WhatsApp", sales: 69, orders: 1 }],
        services: [{ name: "Para llevar / Para recoger", sales: 66 }, { name: "En el local", sales: 69 }], payment_methods: [{ name: "card", amount: 69 }],
        top_products: [{ name: "Alitas", quantity: 2, sales: 135 }], bottom_products: [{ name: "Alitas", quantity: 2, sales: 135 }],
      });
    }
    if (request.method() === "PATCH" && path.endsWith("/availability")) {
      state.writes.push(path);
      if (state.failNextSwitch) { state.failNextSwitch = false; return json(route, { detail: "No se pudo guardar" }, 422); }
      const id = Number(path.split("/")[3]); const { available } = request.postDataJSON();
      if (path.includes("/variants/")) {
        variants.find((variant) => variant.id === id)!.available = available;
        product.available = variants.some((variant) => variant.active && variant.available);
      } else groups.flatMap((group) => group.modifiers).find((option) => option.id === id)!.available = available;
      return json(route, { id, available, product_available: product.available });
    }
    if (path === "/orders" || path === "/tables" || path === "/kitchen/commands") return json(route, []);
    if (path === "/orders/workspace") return json(route, { items: [], page: 1, page_size: 12, total: 0, review_count: 0, period: url.searchParams.get("period") || "day", view: url.searchParams.get("view") || "orders" });
    return json(route, { detail: `Ruta de prueba no simulada: ${path}` }, 404);
  });
  return state;
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

test("mixed availability, confirmed writes, retry and required option restrictions", async ({ page }, testInfo) => {
  const state = await mockWorkspace(page);
  await page.goto("/disponibilidad");
  await expect(page.getByText("1 - 9 de 9 items")).toBeVisible();
  await expect(page.getByText("Opción archivada")).toHaveCount(0);
  await expect(page.getByText("Alitas - Archivada")).toHaveCount(0);
  await expect(page.getByRole("row").filter({ hasText: "BBQ" }).locator("img")).toHaveCount(0);
  await noOverflow(page);
  if (process.env.IMPECCABLE_REVIEW === "1") await page.screenshot({ path: `.impeccable/review/complete-availability-${testInfo.project.name}.png`, fullPage: true });
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  const search = page.getByRole("textbox", { name: "Buscar productos" });
  await search.fill("bufalo"); await expect(page.getByText("1 - 1 de 1 items")).toBeVisible();
  await search.press("Escape"); await expect(page.getByRole("button", { name: "Buscar", exact: true })).toBeFocused();
  state.failNextSwitch = true;
  await page.getByRole("switch", { name: "Desactivar Alitas - Chico" }).click();
  await expect(page.getByRole("alert")).toContainText("No se pudo confirmar");
  await expect(page.getByRole("switch", { name: "Desactivar Alitas - Chico" })).toBeEnabled();
  state.failCatalog = true;
  await page.getByRole("switch", { name: "Desactivar Alitas - Chico" }).click();
  await expect(page.getByRole("switch", { name: "Activar Alitas - Chico" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("desactivado");
  await expect(page.getByRole("alert")).toContainText("Conservamos");
  state.failCatalog = false; await page.getByRole("button", { name: "Reintentar" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("switch", { name: "Desactivar BBQ" }).click();
  await expect(page.getByRole("switch", { name: "Activar BBQ" })).toBeVisible();
  await page.goto("/pedidos");
  await page.getByRole("button", { name: "Nuevo pedido" }).click();
  await page.getByRole("dialog", { name: "Agrega un pedido" }).getByRole("button", { name: "Agregar productos" }).click();
  const picker = page.getByRole("dialog", { name: "Agregar productos", exact: true });
  await expect(picker.getByRole("button", { name: /Alitas.*No hay opciones suficientes/ })).toBeDisabled();
  expect(state.writes.every((path) => path.includes("/catalog/") && path.endsWith("/availability"))).toBe(true);
});

test("home charts, provisional calendar dates, recovery and accessible layouts", async ({ page }, testInfo) => {
  const state = await mockWorkspace(page);
  await page.goto("/");
  await expect(page.getByText("67.50 S/", { exact: true })).toBeVisible();
  await expect(page.getByText("Propinas", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Personalizaciones agotadas", exact: true })).toContainText("Búfalo");
  await noOverflow(page);
  if (process.env.IMPECCABLE_REVIEW === "1") await page.screenshot({ path: `.impeccable/review/analytic-home-${testInfo.project.name}.png`, fullPage: true });
  const trigger = page.getByRole("button", { name: "Hoy", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Seleccionar período" });
  await expect(dialog.getByRole("button", { name: "Hoy", exact: true })).toBeFocused();
  await expect(dialog.locator('[data-day="2026-09-09"]')).toBeDisabled();
  await noOverflow(page);
  if (process.env.IMPECCABLE_REVIEW === "1") await page.screenshot({ path: `.impeccable/review/analytic-calendar-${testInfo.project.name}.png`, fullPage: false });
  await dialog.getByRole("button", { name: "Últimos 7 días" }).click();
  await page.keyboard.press("Escape"); await expect(trigger).toBeFocused();
  expect(state.reportQueries.every((query) => query.includes("date_from=2026-09-08"))).toBe(true);
  await trigger.click();
  await dialog.getByRole("button", { name: "Mes anterior", exact: true }).click();
  await dialog.getByRole("button", { name: "Cancelar" }).click(); await expect(trigger).toBeFocused();
  await trigger.click();
  await dialog.locator('[data-day="2026-09-08"]').focus(); await page.keyboard.press("ArrowLeft");
  await expect(dialog.locator('[data-day="2026-09-07"]')).toBeFocused();
  await page.keyboard.press("Enter"); await dialog.locator('[data-day="2026-09-08"]').click();
  await dialog.getByRole("button", { name: "Aplicar" }).click();
  await expect.poll(() => state.reportQueries.at(-1)).toContain("date_from=2026-09-07&date_to=2026-09-08");
  await expect(page.getByText("67.50 S/", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Personalizaciones agotadas", exact: true })).toContainText("Búfalo");
  const chart = page.getByRole("region", { name: "Total de ventas", exact: true });
  await chart.getByRole("group", { name: "Ventas por período" }).locator("circle").first().focus(); await page.keyboard.press("ArrowRight");
  await expect(chart.getByRole("tooltip")).toBeVisible();
  await page.getByRole("button", { name: /7.*8/ }).first().click();
  await dialog.getByRole("button", { name: "Ayer", exact: true }).click();
  state.failReport = true;
  await dialog.getByRole("button", { name: "Aplicar" }).click();
  await expect(page.getByRole("alert")).toContainText("No se pudo cargar");
  await expect(page.getByText("67.50 S/", { exact: true })).toHaveCount(0);
  state.failReport = false; await page.getByRole("button", { name: "Reintentar" }).click();
  await expect(page.getByText("67.50 S/", { exact: true })).toBeVisible();
  await noOverflow(page);
});
