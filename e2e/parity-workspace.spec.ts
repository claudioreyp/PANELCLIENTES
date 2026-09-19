import { resolve } from "node:path";
import type { Locator, Page, TestInfo } from "@playwright/test";
import { expect, PARITY_DAY, PARITY_ORDER, test } from "./helpers/parity-workspace";

test.use({
  storageState: { cookies: [], origins: [] }, serviceWorkers: "block",
  locale: "es-PE", timezoneId: "America/Lima", colorScheme: "light",
  contextOptions: { reducedMotion: "reduce" },
});

type Surface = "inicio" | "pedidos" | "pedidos-comandas" | "menu" | "caja" | "disponibilidad" | "settings";
const surfaces: Surface[] = ["inicio", "pedidos", "pedidos-comandas", "menu", "caja", "disponibilidad", "settings"];

async function openSurface(page: Page, surface: Surface) {
  const paths: Record<Surface, string> = {
    inicio: "/", pedidos: "/pedidos", "pedidos-comandas": "/pedidos", menu: "/catalogo",
    caja: "/caja", disponibilidad: "/disponibilidad", settings: "/configuracion/general",
  };
  await page.goto(paths[surface]);
  if (surface === "inicio") {
    await expect(page.getByRole("region", { name: "Pedidos", exact: true }).locator(".dashboard-metric")).toHaveText(/^[01]$/);
    await expect(page.getByRole("region", { name: "Productos agotados", exact: true })).not.toContainText(/Cargando/);
  } else if (surface === "pedidos" || surface === "pedidos-comandas") {
    await expect(page.getByRole("button", { name: PARITY_ORDER, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Nuevo pedido", exact: true })).toBeEnabled();
    if (surface === "pedidos-comandas") {
      await page.getByRole("tab", { name: "Comandas digitales", exact: true }).click();
      await expect(page.getByRole("tabpanel", { name: "Comandas digitales", exact: true }).locator(".command-card-grid > article")).toHaveCount(2);
      await expect(page.getByText("Comanda #2", { exact: true })).toBeVisible();
    }
  } else if (surface === "menu") {
    await expect(page.getByRole("tab", { name: "Productos", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("Pizza cl\u00e1sica", { exact: true })).toBeVisible();
  } else if (surface === "caja") {
    await expect(page.getByRole("button", { name: "Abrir corte #3741", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Nuevo corte de caja", exact: true })).toBeEnabled();
  } else if (surface === "disponibilidad") {
    await expect(page.getByRole("switch", { name: "Desactivar Limonada", exact: true })).toBeVisible();
  } else {
    await expect(page.getByRole("dialog", { name: "Configuraci\u00f3n", exact: true })).toBeVisible();
    await expect(page.getByLabel("Nombre de empresa", { exact: true })).toHaveValue("Restaurante de prueba");
  }
  await expect(page.getByRole("alert")).toHaveCount(0);
}

async function expectNoOverflow(page: Page, surface?: Locator) {
  expect(await page.evaluate(() => ({
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.documentElement.clientWidth,
  }))).toEqual({ document: 0, body: 0 });
  const container = surface || page.locator(".main-content");
  const box = await container.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(0);
  expect(box!.x).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  expect(await container.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
}

async function screenshot(page: Page, testInfo: TestInfo, surface: string) {
  if (["cancel-only", "none"].includes(process.env.E2E_CAPTURE_MODE || "")) return;
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(Array.from(document.images, (image) => image.decode().catch(() => undefined)));
  });
  const path = resolve(testInfo.config.rootDir, "test-output", "parity-visuals", testInfo.project.name, `${surface}.png`);
  // Evidence of the actual render, not a comparison against nonexistent image baselines.
  await page.screenshot({ path, fullPage: true, animations: "disabled", scale: "css" });
  await testInfo.attach(`parity-${testInfo.project.name}-${surface}`, { path, contentType: "image/png" });
}

async function expectTheme(page: Page) {
  for (const locator of [page.locator("html"), page.locator("body")]) {
    await expect(locator).toHaveCSS("font-size", "16px");
  }
  // The operational theme may be scoped to body without restyling the public store.
  expect(await page.locator("body").evaluate((element) => getComputedStyle(element).fontFamily.split(",")[0].replace(/["']/g, "").trim())).toBe("Inter");
  for (const selector of ["body", ".sidebar", ".topbar"]) {
    const channels = await page.locator(selector).evaluate((element) => {
      const color = getComputedStyle(element).backgroundColor;
      return { color, values: (color.match(/[\d.]+/g) || []).map(Number) };
    });
    const [red, green, blue, alpha = 1] = channels.values;
    expect(alpha, `${selector}: opaque neutral surface (${channels.color})`).toBeGreaterThanOrEqual(0.9);
    expect(Math.min(red, green, blue), `${selector}: light background`).toBeGreaterThanOrEqual(235);
    expect(Math.max(red, green, blue) - Math.min(red, green, blue), `${selector}: neutral, not cream or green`).toBeLessThanOrEqual(8);
  }
  const heading = page.getByRole("heading", { level: 1 }).filter({ visible: true }).first();
  await expect(heading).toHaveCSS("font-family", /Inter/);
}

async function expectNativeButton(button: Locator) {
  await expect(button).toBeVisible();
  expect(await button.evaluate((element) => element.tagName)).toBe("BUTTON");
  await expect(button).toHaveAttribute("type", "button");
  await expect(button).toHaveAccessibleName(/\S/);
}

async function expectFocusIndicator(button: Locator) {
  await expect(button).toBeFocused();
  expect(await button.evaluate((element) => {
    if (!element.matches(":focus-visible")) return false;
    const candidates = [element, element.closest("tr")].filter((candidate) => candidate !== null);
    return candidates.some((candidate) => {
      const style = getComputedStyle(candidate);
      return (parseFloat(style.outlineWidth) > 0 && style.outlineStyle !== "none" && style.outlineColor !== "transparent" && style.outlineColor !== "rgba(0, 0, 0, 0)")
        || (style.boxShadow !== "none" && !/^rgba\(0, 0, 0, 0\) 0px 0px 0px 0px$/.test(style.boxShadow));
    });
  }), "Keyboard focus must have a visible outline or ring").toBe(true);
}

test("@parity-readonly fixtures load every surface without API writes", async ({ page, parityMock }) => {
  for (const surface of surfaces) {
    await test.step(surface, async () => { await openSurface(page, surface); });
  }
  for (const path of ["/context", "/reports/dashboard", "/orders/workspace", "/catalog", "/kitchen/commands", "/cash/cuts", "/settings/business"]) {
    expect(parityMock.reads.some((request) => request.path === path), path).toBe(true);
  }
  expect(parityMock.violations).toEqual([]);
});

test.describe("@parity-shots grouped rendered evidence", () => {
  for (const surface of surfaces) {
    test(`${surface}: Inter 16, neutral theme and bounded width`, async ({ page, parityMock }, testInfo) => {
      if (surface === "inicio") parityMock.emptyDay = true;
      await openSurface(page, surface);
      await screenshot(page, testInfo, surface);
      await expectNoOverflow(page, surface === "settings" ? page.getByRole("dialog", { name: "Configuraci\u00f3n" }) : undefined);
      await expectTheme(page);
    });
  }

  test("884px desktop viewport: settings general and menu editor", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "The 884px user viewport is an additional desktop-only check.");
    await page.setViewportSize({ width: 884, height: page.viewportSize()!.height });

    await test.step("Settings / General at 884px", async () => {
      await openSurface(page, "settings");
      const settings = page.getByRole("dialog", { name: "Configuraci\u00f3n", exact: true });
      await screenshot(page, testInfo, "settings-general-884");
      await expectNoOverflow(page, settings);
      await expect(settings.getByRole("combobox", { name: "Secci\u00f3n", exact: true })).toBeInViewport();
      await expect(settings.getByLabel("Nombre de empresa", { exact: true })).toBeInViewport();
    });

    await test.step("Existing menu product editor at 884px", async () => {
      await openSurface(page, "menu");
      const product = page.getByRole("button").filter({ has: page.getByText("Pizza cl\u00e1sica", { exact: true }) });
      await expectNativeButton(product);
      await product.focus();
      await page.keyboard.press("Enter");
      const editor = page.getByRole("dialog", { name: "Pizza cl\u00e1sica", exact: true });
      await expect(editor).toBeVisible();
      await expect(editor.getByLabel("Nombre del producto", { exact: true })).toHaveValue("Pizza cl\u00e1sica");
      await expect(editor.getByText("Sin cambios pendientes", { exact: true })).toBeVisible();
      await screenshot(page, testInfo, "menu-editor-884");
      await expectNoOverflow(page, editor);
      await expect(editor.getByLabel("Nombre del producto", { exact: true })).toBeInViewport();
      await expect(editor.getByRole("button", { name: "Cerrar editor", exact: true })).toBeInViewport();
      await expect(editor.getByRole("button", { name: "Guardar cambios", exact: true })).toBeInViewport();
      await page.keyboard.press("Escape");
      await expect(editor).toBeHidden();
      await expect(product).toBeFocused();
    });
  });
});

test("closed compact navigation is inert; keyboard open, Escape and route change preserve focus", async ({ page }, testInfo) => {
  await openSurface(page, "inicio");
  const sidebar = page.locator(".sidebar");
  const trigger = page.getByRole("button", { name: "Abrir men\u00fa", exact: true, includeHidden: true });
  if (testInfo.project.name === "desktop") {
    await expect(trigger).toBeHidden();
    expect(await sidebar.evaluate((element) => (element as HTMLElement).inert)).toBe(false);
    const orders = sidebar.getByRole("link", { name: "Pedidos", exact: true });
    await orders.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/pedidos$/);
    await expectNoOverflow(page);
    return;
  }

  async function expectClosedMenu() {
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(await sidebar.evaluate((element) => (element as HTMLElement).inert)).toBe(true);
    await expect(sidebar.getByRole("link")).toHaveCount(0);
    await trigger.focus();
    // A full bounded tab walk catches offscreen links that only look hidden.
    for (let index = 0; index < 24; index += 1) {
      await page.keyboard.press("Tab");
      expect(await sidebar.evaluate((element) => element.contains(document.activeElement))).toBe(false);
    }
    await trigger.focus();
    await sidebar.locator('a[href="/pedidos"]').evaluate((element) => (element as HTMLElement).focus());
    await expect(trigger).toBeFocused();
  }

  await expectClosedMenu();
  await page.keyboard.press("Enter");
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  expect(await sidebar.evaluate((element) => (element as HTMLElement).inert)).toBe(false);
  await expect.poll(() => sidebar.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expectClosedMenu();
  await page.keyboard.press("Space");
  const orders = sidebar.getByRole("link", { name: "Pedidos", exact: true });
  await orders.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/pedidos$/);
  await expect(page.getByRole("heading", { name: "Pedidos", exact: true })).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(await sidebar.evaluate((element) => (element as HTMLElement).inert)).toBe(true);
  expect(await sidebar.evaluate((element) => element.contains(document.activeElement))).toBe(false);
  await expectNoOverflow(page);
});

test("navigation has no inaccessible gap at 900, 901, 920 and 921px", async ({ page }) => {
  for (const width of [900, 901, 920, 921]) {
    await page.setViewportSize({ width, height: 900 });
    await openSurface(page, "pedidos");
    const sidebar = page.locator(".sidebar");
    const trigger = page.getByRole("button", { name: "Abrir menú", exact: true, includeHidden: true });
    if (width <= 900) {
      await expect(trigger).toBeVisible();
      await expect(sidebar).toHaveAttribute("inert", "");
      await trigger.click();
      await expect(sidebar.getByRole("link", { name: "Pedidos", exact: true })).toBeInViewport();
      await page.keyboard.press("Escape");
      await expect(trigger).toBeFocused();
    } else {
      await expect(trigger).toBeHidden();
      await expect(sidebar).not.toHaveAttribute("inert", "");
      const orders = sidebar.getByRole("link", { name: "Pedidos", exact: true });
      await expect(orders).toBeInViewport();
      await orders.focus();
      await expect(orders).toBeFocused();
    }
    await expectNoOverflow(page);
  }
});

test("search text clears its icon and compact controls retain touch hit areas", async ({ page }) => {
  await openSurface(page, "pedidos");
  const touch = await page.evaluate(() => matchMedia("(pointer: coarse), (max-width: 900px)").matches);
  if (touch) {
    for (const name of ["Nuevo pedido", "Actualizar pedidos"]) {
      const box = await page.getByRole("button", { name, exact: true }).boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);
    }
  }
  await openSurface(page, "disponibilidad");
  if (touch) {
    const box = await page.getByRole("switch").first().boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);
  }
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  const field = page.locator(".availability-search-field");
  expect(await field.evaluate((element) => {
    const input = element.querySelector("input")!;
    const icon = element.querySelector("svg")!.getBoundingClientRect();
    const start = input.getBoundingClientRect().left + parseFloat(getComputedStyle(input).paddingLeft);
    return start - icon.right;
  })).toBeGreaterThanOrEqual(8);
});

test("zero-order dashboard shows empty states instead of zero charts for daily and multi-day ranges", async ({ page, parityMock }, testInfo) => {
  parityMock.emptyDay = true;
  await openSurface(page, "inicio");
  async function expectEmptyDashboard() {
    await expect(page.getByRole("region", { name: "Pedidos", exact: true }).locator(".dashboard-metric")).toHaveText("0");
    for (const title of ["Total de ventas", "Pedidos", "Env\u00edos", "Ventas por canal de venta", "Pedidos por canal de venta", "M\u00e9todos de pago m\u00e1s usados", "Total de ventas por opci\u00f3n de servicio"]) {
      const card = page.getByRole("region", { name: title, exact: true });
      await expect(card.getByText("No hay datos para mostrar", { exact: true })).toBeVisible();
      await expect(card.locator(".dashboard-line-chart, .dashboard-bars, .dashboard-distribution, svg[role='group'], svg[role='img'], canvas")).toHaveCount(0);
    }
    await expect(page.getByRole("region", { name: "Total de ventas", exact: true }).locator(".dashboard-metric")).toHaveText("0 S/");
    await expect(page.getByRole("region", { name: "Ticket promedio", exact: true })).toContainText("0.00 S/");
    await expectNoOverflow(page);
  }
  await expectEmptyDashboard();
  await page.getByRole("button", { name: "Hoy", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "Seleccionar per\u00edodo", exact: true });
  await picker.getByRole("button", { name: "\u00daltimos 7 d\u00edas", exact: true }).click();
  await picker.getByRole("button", { name: "Aplicar", exact: true }).click();
  await expect.poll(() => parityMock.reads.filter((request) => request.path === "/reports/dashboard").at(-1)?.query).toContain(`date_from=2026-09-03&date_to=${PARITY_DAY}`);
  await expectEmptyDashboard();
  await expect(page.getByRole("region", { name: "Ventas promedio por d\u00eda de semana" }).getByText("No hay datos para mostrar", { exact: true })).toBeVisible();
  await screenshot(page, testInfo, "inicio-vacio-semana");
});

test("dashboard information helpers work with keyboard and dismiss without stealing focus", async ({ page }) => {
  await openSurface(page, "inicio");
  for (const title of ["Productos agotados", "Personalizaciones agotadas", "Total de ventas", "M\u00e9todos de pago m\u00e1s usados", "Productos con m\u00e1s ventas", "Productos menos vendidos"]) {
    await test.step(title, async () => {
      const card = page.getByRole("region", { name: title, exact: true });
      const helper = card.getByRole("button", { name: /informaci[o\u00f3]n|ayuda|detalle|acerca/i });
      await expectNativeButton(helper);
      const id = await helper.getAttribute("aria-controls");
      expect(id, "Help text must be associated with its trigger").toBeTruthy();
      const content = page.locator(`[id=${JSON.stringify(id)}]`);
      await expect(helper).toHaveAttribute("aria-expanded", "false");
      await expect(content).toBeHidden();
      await helper.focus();
      await page.keyboard.press("Enter");
      await expect(helper).toHaveAttribute("aria-expanded", "true");
      await expect(content).toBeVisible();
      await expect(content).toContainText(/\S/);
      await expectFocusIndicator(helper);
      await expectNoOverflow(page, content);
      await page.keyboard.press("Escape");
      await expect(content).toBeHidden();
      await expect(helper).toHaveAttribute("aria-expanded", "false");
      await expect(helper).toBeFocused();
      await page.keyboard.press("Space");
      await expect(content).toBeVisible();
      await page.keyboard.press("Tab");
      await expect(content).toBeHidden();
      await expect(helper).toHaveAttribute("aria-expanded", "false");
      await expect(helper).not.toBeFocused();
    });
  }
});

test("orders retain row semantics and native keyboard actions, search and command details", async ({ page, parityMock }, testInfo) => {
  await openSurface(page, "pedidos");
  const list = page.getByRole("region", { name: "Lista de pedidos", exact: true });
  const trigger = list.getByRole("button", { name: PARITY_ORDER, exact: true });
  await expectNativeButton(trigger);
  await expect(list.locator('tr[role="button"]')).toHaveCount(0);
  const table = list.getByRole("table");
  if (testInfo.project.name === "desktop") {
    await expect(table).toBeVisible();
    await expect(table.getByRole("columnheader")).toHaveText(["Pedido", "Nombre", "Tipo", "Fecha", "Estado de pago", "Total"]);
    const row = table.getByRole("row").filter({ has: page.getByRole("button", { name: PARITY_ORDER, exact: true }) });
    await expect(row.getByRole("cell")).toHaveCount(6);
  } else {
    await expect(table).toBeHidden();
  }
  const search = page.getByRole("textbox", { name: "Buscar pedidos", exact: true });
  await search.fill("sin-coincidencias");
  await expect(list.getByText("No hay pedidos", { exact: true })).toBeVisible();
  await search.fill("Cliente de prueba");
  await expect(trigger).toBeVisible();
  await expect(page.getByText("Todo el historial", { exact: true })).toBeVisible();
  await expect(page.locator('input[type="date"]')).toHaveCount(0);
  const queries = parityMock.reads.filter((read) => read.path === "/orders/workspace").map((read) => new URLSearchParams(read.query));
  expect(queries.length).toBeGreaterThan(0);
  expect(queries.every((query) => query.get("period") === "all" && query.get("view") === "orders" && !query.has("day"))).toBe(true);
  for (const key of ["Enter", "Space"]) {
    await trigger.focus();
    await expectFocusIndicator(trigger);
    await page.keyboard.press(key);
    const detail = page.getByRole("dialog", { name: "Pedido #7 \u00b7 #0008", exact: true });
    await expect(detail).toBeVisible();
    const commands = detail.getByRole("region", { name: "Comandas del pedido", exact: true });
    for (const sequence of [1, 2]) {
      const expand = commands.getByRole("button", { name: new RegExp(`Comanda #${sequence}`) });
      await expectNativeButton(expand);
      await expand.focus();
      await page.keyboard.press(key);
      await expect(expand).toHaveAttribute("aria-expanded", "true");
    }
    await expect(commands.getByText("1 \u00d7 Pizza cl\u00e1sica", { exact: true })).toBeVisible();
    await expect(commands.getByText("1 \u00d7 Limonada", { exact: true })).toBeVisible();
    await expect(detail.getByText("Pago pendiente", { exact: true })).toBeVisible();
    await expect(detail.getByText(/todav\u00eda no se enviaron a cocina/)).toHaveCount(0);
    await expectNoOverflow(page, detail);
    if (key === "Enter") await screenshot(page, testInfo, "pedidos-detalle-comandas");
    await page.keyboard.press("Escape");
    await expect(detail).toBeHidden();
    await expect(trigger).toBeFocused();
  }
  await expectNoOverflow(page);
});

test("catalog and cash tables keep cells with native buttons and keyboard return focus", async ({ page }) => {
  await openSurface(page, "menu");
  await page.getByRole("tab", { name: "Productos", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  const customizations = page.getByRole("tab", { name: "Personalizaciones", exact: true });
  await expect(customizations).toBeFocused();
  await expect(customizations).toHaveAttribute("aria-selected", "true");
  const table = page.getByRole("tabpanel", { name: "Personalizaciones", exact: true }).getByRole("table");
  const edit = table.getByRole("button", { name: "Extras", exact: true });
  await expectNativeButton(edit);
  await expect(table.locator('tr[role="button"]')).toHaveCount(0);
  await expect(table.getByRole("row").filter({ has: page.getByRole("button", { name: "Extras", exact: true }) }).getByRole("cell")).toHaveCount(3);
  for (const key of ["Enter", "Space"]) {
    await edit.focus();
    await page.keyboard.press(key);
    const dialog = page.getByRole("dialog", { name: "Editar personalizaci\u00f3n", exact: true });
    await expect(dialog).toBeVisible();
    await expectNoOverflow(page, dialog);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(edit).toBeFocused();
  }
  await openSurface(page, "caja");
  const history = page.getByRole("region", { name: "Historial de cortes desplazable", exact: true });
  const cut = history.getByRole("button", { name: "Abrir corte #3741", exact: true });
  await expectNativeButton(cut);
  await expect(history.getByRole("row").filter({ has: page.getByRole("button", { name: "Abrir corte #3741", exact: true }) }).getByRole("cell")).toHaveCount(6);
  await expect(history.locator('tr[role="button"]')).toHaveCount(0);
  // The cash table may scroll internally; none of its six columns may disappear.
  await expect(history.getByRole("columnheader")).toHaveText(["Corte", "Fecha", "Caja", "Creado por", "Resultado", "Total esperado"]);
  for (const key of ["Enter", "Space"]) {
    await cut.focus();
    await page.keyboard.press(key);
    const dialog = page.getByRole("dialog", { name: "#3741 en Caja Principal", exact: true });
    await expect(dialog).toBeVisible();
    await expectNoOverflow(page, dialog);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(cut).toBeFocused();
  }
  await expectNoOverflow(page);
});

test("availability search restores keyboard focus without changing availability", async ({ page }, testInfo) => {
  await openSurface(page, "disponibilidad");
  const switches = page.getByRole("switch");
  const before = await switches.evaluateAll((elements) => elements.map((element) => element.getAttribute("aria-checked")));
  const searchButton = page.getByRole("button", { name: "Buscar", exact: true });
  await searchButton.focus();
  await page.keyboard.press("Enter");
  const search = page.getByRole("textbox", { name: "Buscar productos", exact: true });
  await expect(search).toBeFocused();
  await search.fill("limonada");
  await expect(switches).toHaveCount(1);
  await expect(page.getByRole("switch", { name: "Desactivar Limonada", exact: true })).toBeVisible();
  await expectNoOverflow(page);
  await screenshot(page, testInfo, "disponibilidad-busqueda");
  await page.keyboard.press("Escape");
  await expect(searchButton).toBeFocused();
  await expect(switches).toHaveCount(before.length);
  expect(await switches.evaluateAll((elements) => elements.map((element) => element.getAttribute("aria-checked")))).toEqual(before);
});

test("settings omit Subscription in every navigation and safely redirect its former URL", async ({ page }) => {
  await openSurface(page, "settings");
  const dialog = page.getByRole("dialog", { name: "Configuraci\u00f3n", exact: true });
  await expect(dialog.getByText(/Suscripci[o\u00f3]n/i, { exact: true })).toHaveCount(0);
  await expect(dialog.locator('button, a, option').filter({ hasText: /Suscripci[o\u00f3]n/i })).toHaveCount(0);
  const select = dialog.getByRole("combobox", { name: "Secci\u00f3n", exact: true });
  if (await select.isVisible()) await select.selectOption({ label: "Opciones de servicio" });
  else {
    await dialog.getByRole("button", { name: "Opciones de servicio", exact: true }).focus();
    await page.keyboard.press("Enter");
  }
  await expect(page).toHaveURL(/\/configuracion\/servicios$/);
  await expect(dialog.getByRole("heading", { name: "Opciones de servicio", exact: true })).toBeVisible();
  await expect(dialog.getByRole("switch", { name: "Domicilio", exact: true }).first()).toBeEnabled();
  await expectNoOverflow(page, dialog);
  await page.goto("/configuracion/suscripcion");
  await expect(page).toHaveURL(/\/configuracion\/general$/);
  await expect(page.getByLabel("Nombre de empresa", { exact: true })).toHaveValue("Restaurante de prueba");
  await expect(dialog.getByText(/Suscripci[o\u00f3]n/i, { exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/$/);
});
