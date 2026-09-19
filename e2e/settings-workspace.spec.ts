import { expect, test, type Page, type Route } from "@playwright/test";

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

const branch = {
  id: 1,
  business_id: 1,
  slug: "matriz",
  name: "Sucursal principal",
  address: "Av. Principal 123",
  maps_url: "",
  opening_hours: {},
  accepted_payment_methods: ["cash", "card"],
  delivery_enabled: true,
  takeaway_enabled: true,
  delivery_fee: 0,
  active: true,
};

async function mockSettingsApi(page: Page) {
  const writes: { path: string; method: string; body: unknown; idempotencyKey: string }[] = [];
  let business = { id: 1, name: "Pizza House", currency: "PEN", country_code: "PE", timezone: "America/Lima", version: 2 };
  let services = {
    branch_id: 1,
    pos_tables: true,
    pos_counter: true,
    pos_takeaway: true,
    pos_delivery: true,
    digital_tables: false,
    digital_takeaway: true,
    digital_delivery: true,
    version: 3,
  };

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^.*\/api\/v1/, "");
    const method = request.method();
    if (method === "GET" && path === "/context") {
      return json(route, {
        role: "owner",
        roles: ["owner", "manager"],
        business: { id: 1, slug: "pizza-house", name: "Pizza House", status: "active", plan: "pro", currency: "PEN", timezone: "America/Lima", modules: { pos: true, cash: true, inventory: true } },
        branches: [branch],
      });
    }
    if (path === "/settings/business") {
      if (method === "GET") return json(route, business);
      const payload = request.postDataJSON() as typeof business;
      writes.push({ path, method, body: payload, idempotencyKey: request.headers()["idempotency-key"] || "" });
      business = { ...business, ...payload, version: business.version + 1 };
      return json(route, business);
    }
    if (path === "/settings/branches/1/services") {
      if (method === "GET") return json(route, services);
      const payload = request.postDataJSON() as typeof services;
      writes.push({ path, method, body: payload, idempotencyKey: request.headers()["idempotency-key"] || "" });
      services = { ...services, ...payload, version: services.version + 1 };
      return json(route, services);
    }
    return json(route, { detail: `Ruta no simulada: ${method} ${path}` }, 404);
  });
  return writes;
}

async function chooseSection(page: Page, label: string) {
  const mobileSelect = page.getByLabel("Sección");
  if (await mobileSelect.isVisible()) await mobileSelect.selectOption({ label });
  else await page.getByRole("button", { name: label, exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("impulsa.authMode", "dev");
    localStorage.setItem("impulsa.businessId", "1");
    localStorage.setItem("impulsa.branchId", "1");
  });
});

test("settings navigation, drafts and responsive layout work end to end", async ({ page }, testInfo) => {
  const writes = await mockSettingsApi(page);
  await page.goto("/configuracion/general");

  const workspace = page.getByRole("dialog", { name: "Configuración" });
  await expect(workspace).toBeVisible();
  await expect(page.getByRole("heading", { name: "General", exact: true })).toBeVisible();
  const name = page.getByLabel("Nombre de empresa");
  await name.fill("Pizza House Norte");
  await chooseSection(page, "Opciones de servicio");
  const guard = page.getByRole("alertdialog", { name: "Tienes cambios sin guardar" });
  await expect(guard).toBeVisible();
  await guard.getByRole("button", { name: "Guardar y continuar" }).click();
  await expect(page.getByRole("heading", { name: "Opciones de servicio" })).toBeVisible();
  expect(writes[0]).toMatchObject({ path: "/settings/business", method: "PATCH" });
  expect(writes[0].idempotencyKey).not.toBe("");

  const deliverySwitch = page.getByRole("switch", { name: "Domicilio", exact: true }).first();
  await deliverySwitch.click();
  const servicesSaved = page.waitForResponse((response) =>
    response.request().method() === "PATCH"
      && new URL(response.url()).pathname.endsWith("/settings/branches/1/services"),
  );
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await servicesSaved;
  await expect(page.getByRole("status")).toContainText("Las opciones de servicio se actualizaron.");
  await expect.poll(() => writes.filter((entry) => entry.path.endsWith("/services")).length).toBe(1);

  const callsBeforeNavigation = writes.length;
  await expect(workspace.getByRole("button", { name: "Suscripción", exact: true })).toHaveCount(0);
  await expect(workspace.getByRole("option", { name: "Suscripción", exact: true })).toHaveCount(0);
  await chooseSection(page, "General");
  await expect(page.getByRole("heading", { name: "General", exact: true })).toBeVisible();
  expect(writes.length).toBe(callsBeforeNavigation);

  const viewport = page.viewportSize();
  const box = await workspace.boundingBox();
  expect(box).not.toBeNull();
  expect((box?.x || 0) + (box?.width || 0)).toBeLessThanOrEqual((viewport?.width || 0) + 1);
  expect(await workspace.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);

  if (process.env.IMPECCABLE_REVIEW === "1") {
    await page.screenshot({ path: `.impeccable/review/settings-${testInfo.project.name}.png`, fullPage: true });
  }
});
