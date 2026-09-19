import { test, expect, type Page } from "@playwright/test";
import QRCode from "qrcode";

const apiBase = "http://127.0.0.1:8009/api/v1";
const headers = { "X-Dev-Auth": "isolated-agent-e2e-only", "X-Dev-Role": "owner", "X-Dev-User": "isolated-owner", "X-Business-Id": "1", "X-Branch-Id": "1" };
test.beforeEach(async ({ context, baseURL }) => {
  test.skip(baseURL !== "http://127.0.0.1:5176", "Requires the disposable API and dedicated agent config");
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (["http://127.0.0.1:5176", "http://127.0.0.1:8009"].includes(url.origin) || ["data:", "blob:"].includes(url.protocol)) await route.continue();
    else await route.abort();
  });
  await context.addInitScript(() => { localStorage.setItem("impulsa.authMode", "dev"); localStorage.setItem("impulsa.businessId", "1"); localStorage.setItem("impulsa.branchId", "1"); });
});

async function screenshot(page: Page, path: string) {
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path, fullPage: true });
}

test("pairs a second browser, selects a member, authenticates with PIN and revokes access", async ({ page, browser }, info) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/configuracion/miembros");
  await page.getByRole("button", { name: "Vincular dispositivo", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Vincular dispositivo", exact: true });
  await expect(dialog.getByAltText("Código QR para vincular dispositivo")).toBeVisible();
  const url = await dialog.getByLabel("Enlace de vinculación").inputValue();
  expect(url).toMatch(/^http:\/\/127\.0\.0\.1:5176\/activar-dispositivo#token=/);
  // Do not retain a usable enrollment secret in screenshot artifacts.
  await dialog.screenshot({ path: info.outputPath("pairing.png"), mask: [dialog.getByLabel("Enlace de vinculación"), dialog.getByAltText("Código QR para vincular dispositivo")] });
  const second = await browser.newContext({ viewport: page.viewportSize()!, baseURL: "http://127.0.0.1:5176" });
  try {
    const device = await second.newPage(); device.on("pageerror", (error) => errors.push(error.message));
    await device.goto(url);
    await expect(device.getByText("Este dispositivo quedará vinculado a Sucursal de prueba.")).toBeVisible();
    const name = `Tablet ${info.project.name}`;
    await device.getByLabel("Nombre del dispositivo").fill(name);
    await device.getByRole("button", { name: "Activar", exact: true }).click();
    await expect(device.getByRole("heading", { name: "Selecciona tu nombre" })).toBeVisible();
    await expect(dialog.getByText(/Dispositivo vinculado/)).toBeVisible();
    await dialog.getByRole("button", { name: "Cerrar", exact: true }).click();
    await device.getByRole("button", { name: "Cajera Prueba" }).click();
    const pad = device.getByRole("group", { name: "Teclado PIN de cuatro dígitos" });
    await pad.press("8"); await pad.press("0"); await pad.press("6"); await pad.press("2");
    await screenshot(device, info.outputPath("pin.png"));
    await pad.press("Escape");
    await expect(device.getByRole("button", { name: "Cajera Prueba" })).toBeFocused();
    await device.getByRole("button", { name: "Cajera Prueba" }).click();
    for (const digit of "8062") await pad.press(digit);
    await device.getByRole("button", { name: "Ingresar", exact: true }).click();
    await expect(device).toHaveURL("http://127.0.0.1:5176/");
    const cookies = await second.cookies(apiBase);
    expect(cookies.filter((cookie) => cookie.name.startsWith("pos_")).every((cookie) => cookie.httpOnly)).toBe(true);
    expect(await device.evaluate(() => JSON.stringify(localStorage))).not.toContain("8062");
    expect((await second.request.get(`${apiBase}/settings/branches/1/agent`)).status()).toBe(403);
    const session = await (await second.request.get(`${apiBase}/auth/devices/session`)).json();
    await second.request.post(`${apiBase}/auth/devices/logout`, { headers: { Origin: "http://127.0.0.1:5176", "X-CSRF-Token": session.csrf_token }, data: {} });
    await device.goto("/acceso-pin");
    await device.getByRole("button", { name: "Responsable Prueba" }).click();
    for (const digit of "8062") await device.getByRole("group", { name: /Teclado PIN/ }).press(digit);
    await device.getByRole("button", { name: "Ingresar", exact: true }).click();
    await expect(device).toHaveURL("http://127.0.0.1:5176/");
    expect((await second.request.get(`${apiBase}/settings/branches/1/agent`)).status()).toBe(200);
    await page.getByRole("button", { name: `Desvincular ${name}` }).click();
    await page.getByRole("alertdialog", { name: "Desvincular dispositivo" }).getByRole("button", { name: "Desvincular", exact: true }).click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    expect((await second.request.get(`${apiBase}/settings/branches/1/agent`)).status()).toBe(401);
    await device.reload();
    await expect(device.getByText(/Este navegador no está vinculado/)).toBeVisible();
    expect(errors).toEqual([]);
  } finally { await second.close(); }
});

test("updates profile, crops multiple menus, preserves full Yape QR and recovers map errors", async ({ page, request }, info) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  // Reset only this disposable test tenant's agent images between viewport runs.
  let profile = await (await request.get(`${apiBase}/settings/branches/1/agent`, { headers })).json();
  for (const image of profile.images) {
    profile = await (await request.delete(`${apiBase}/settings/branches/1/agent/images/${image.id}`, { headers: { ...headers, "Idempotency-Key": crypto.randomUUID() }, data: { expected_version: profile.version } })).json();
  }
  await page.goto("/configuracion/agente");
  await page.getByLabel("Nombre (opcional)").fill(`Ana ${info.project.name} ${Date.now().toString().slice(-5)}`);
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page.getByText("Los cambios se guardaron correctamente.")).toBeVisible();
  const qr = await QRCode.toBuffer("isolated-image-fixture-not-a-payment", { margin: 4 });
  const menu = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 360; canvas.height = 540;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#fff"; context.fillRect(0, 0, 360, 540);
    context.fillStyle = "#25824f"; context.fillRect(0, 0, 360, 140);
    context.fillStyle = "#fff"; context.font = "24px sans-serif"; context.fillText("CARTA DE PRUEBA", 30, 80);
    context.fillStyle = "#262626"; context.font = "18px sans-serif";
    context.fillText("Datos aislados", 30, 200); context.fillText("Imagen vertical de prueba", 30, 250);
    return canvas.toDataURL("image/png").split(",")[1];
  }), "base64");
  for (let index = 0; index < 2; index++) {
    await page.getByLabel("Archivo del agente").setInputFiles({ name: "menu.png", mimeType: "image/png", buffer: menu });
    const crop = page.getByRole("dialog", { name: "Recortar imagen del menú" });
    await expect(crop.getByRole("button", { name: "Guardar", exact: true })).toBeEnabled();
    await crop.getByRole("button", { name: "Aumentar zoom" }).click();
    if (index === 0) await screenshot(page, info.outputPath("menu-crop.png"));
    await crop.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect(crop).toHaveCount(0);
  }
  await expect(page.locator(".agent-gallery > li")).toHaveCount(2);
  for (const image of await page.locator(".agent-gallery-preview img").all()) {
    await expect(image).toBeVisible();
    expect(await image.evaluate((node) => node.getBoundingClientRect().height <= node.parentElement!.getBoundingClientRect().height)).toBe(true);
    expect(await image.evaluate((node) => (node as HTMLImageElement).naturalWidth < (node as HTMLImageElement).naturalHeight)).toBe(true);
  }
  await page.getByRole("button", { name: "Subir imagen 2" }).click();
  await expect(page.getByRole("button", { name: "Subir imagen 2" })).toBeEnabled();
  await screenshot(page, info.outputPath("menu-gallery.png"));
  await page.getByRole("button", { name: /Subir QR de Yape|Reemplazar QR/ }).click();
  await page.getByLabel("Archivo del agente").setInputFiles({ name: "qr.png", mimeType: "image/png", buffer: qr });
  const preview = page.getByRole("dialog", { name: "QR de Yape", exact: true });
  await expect(preview.getByRole("slider")).toHaveCount(0);
  await preview.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(preview).toHaveCount(0);
  await expect(page.getByAltText("QR de Yape guardado")).toBeVisible();
  await screenshot(page, info.outputPath("yape-qr.png"));
  await page.getByRole("heading", { name: "Perfil del agente", exact: true }).scrollIntoViewIfNeeded();
  await screenshot(page, info.outputPath("agent-profile.png"));
  await page.goto("/configuracion/sucursal");
  await page.getByRole("button", { name: /Agregar ubicación|Cambiar ubicación/, exact: true }).click();
  const map = page.getByRole("dialog", { name: /ubicación/ });
  await expect(map.getByText(/Falta configurar Google Maps/)).toBeVisible();
  await map.getByRole("button", { name: "Reintentar", exact: true }).click();
  await expect(map.getByText(/Falta configurar Google Maps/)).toBeVisible();
  await screenshot(page, info.outputPath("map-missing-key.png"));
  await map.getByRole("button", { name: "Cancelar", exact: true }).click();
  expect(errors).toEqual([]);
});
