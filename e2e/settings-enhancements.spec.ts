import { resolve } from "node:path";
import { deflateSync } from "node:zlib";
import type { Locator, Page, Route, TestInfo } from "@playwright/test";
import { expect, test as parityTest } from "./helpers/parity-workspace";

type SettingsWrite = {
  path: string;
  method: string;
  body: Record<string, unknown>;
  idempotencyKey: string;
  image?: { bytes: Buffer; name: string; type: string };
};
type SettingsMock = { writes: SettingsWrite[]; failNextUpload: boolean };

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

// Synthetic color target: no real restaurant image, file, account or map is used.
function fixturePng() {
  function chunk(type: string, data: Buffer) {
    const content = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of content) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    const size = Buffer.alloc(4);
    const checksum = Buffer.alloc(4);
    size.writeUInt32BE(data.length);
    checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([size, content, checksum]);
  }
  const width = 96;
  const height = 64;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const pixels = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = y * (1 + width * 3) + 1 + x * 3;
      pixels[offset] = Math.round(40 + x / width * 170);
      pixels[offset + 1] = Math.round(60 + y / height * 160);
      pixels[offset + 2] = (Math.floor(x / 16) + Math.floor(y / 16)) % 2 ? 190 : 90;
    }
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
}

// Reuse parity's isolated auth, context, websocket and deny-by-default network guard.
// Only the settings writes exercised below are intercepted, never forwarded.
const test = parityTest.extend<{ settingsMock: SettingsMock }>({
  settingsMock: [async ({ page, parityMock }, use) => {
    const state: SettingsMock = { writes: [], failNextUpload: false };
    const media = new Map<string, { bytes: Buffer; type: string }>();
    const mediaResponses = new Map<string, { write: SettingsWrite; response: Record<string, unknown> }>();
    let profile: Record<string, unknown> = {
      id: 1, business_id: 1, name: "Matriz", address: "Direcci\u00f3n de prueba 123", maps_url: "", google_place_id: "",
      latitude: null, longitude: null, logo_url: null, cover_url: null, active: true, version: 4,
    };
    let delivery: Record<string, unknown> = {
      branch_id: 1, version: 3, delivery_mode: "fixed", fixed_delivery_fee: 8,
      distance_base_fee: 0, distance_fee_per_km: 0, distance_max_km: 10,
      free_delivery_threshold: null, minimum_order_amount: null, bands: [],
      google_routes_configured: false, delivery_policy_supported: true,
      delivery_policy: { neighborhoods: [], origin: null, outside_band_mode: "reject" },
    };
    const members: Record<string, unknown>[] = [];
    await page.route("**/api/v1/settings/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname.slice("/api/v1".length);
      const method = request.method();
      if (method === "OPTIONS") return route.fulfill({ status: 204 });
      if (method === "GET") {
        if (path === "/settings/branches/1/profile") return json(route, profile);
        if (path === "/settings/branches/1/delivery") return json(route, {
          ...delivery,
          branch_origin: typeof profile.latitude === "number" && typeof profile.longitude === "number"
            ? { latitude: profile.latitude, longitude: profile.longitude, maps_url: profile.maps_url } : null,
        });
        if (path === "/settings/members") return json(route, {
          items: members, total: members.length, page: 1, page_size: 10,
          capabilities: { assignable_roles: ["cashier"], can_manage_admins: false },
        });
        if (path === "/settings/devices") return json(route, []);
        if (path === "/settings/places/autocomplete") return json(route, { detail: "Google Places no est\u00e1 configurado en esta prueba." }, 503);
        return route.fallback();
      }
      const allowed = (path === "/settings/branches/1/profile" && ["POST", "PATCH"].includes(method))
        || (path === "/settings/branches/1/delivery" && method === "PATCH")
        || (/^\/settings\/branches\/1\/media\/(logo|cover)$/.test(path) && method === "DELETE")
        || (path === "/settings/members" && method === "POST");
      if (!allowed) return route.fallback();
      const idempotencyKey = request.headers()["idempotency-key"] || "";
      if (!idempotencyKey) return json(route, { detail: "Falta Idempotency-Key en la escritura de prueba." }, 400);
      if (path.endsWith("/profile") && method === "POST") {
        const form = await new Response(new Uint8Array(request.postDataBuffer()!), { headers: { "content-type": request.headers()["content-type"] } }).formData();
        const file = form.get("file");
        const kind = form.get("media_kind");
        if (!file || typeof file === "string" || !["logo", "cover"].includes(String(kind))) return json(route, { detail: "Archivo o modalidad de imagen incorrectos." }, 422);
        const image = { bytes: Buffer.from(await file.arrayBuffer()), type: file.type, name: file.name };
        const body = { media_kind: kind, expected_version: Number(form.get("expected_version")) };
        const write = { path, method, body, idempotencyKey, image };
        state.writes.push(write);
        const previous = mediaResponses.get(idempotencyKey);
        if (previous) {
          expect(write).toEqual(previous.write);
          return json(route, previous.response);
        }
        if (body.expected_version !== profile.version) return json(route, { detail: "La versi\u00f3n de imagen de prueba cambi\u00f3." }, 409);
        const asset = `/uploads/settings-enhancements-${kind}.webp`;
        media.set(asset, image);
        profile = { ...profile, [`${kind}_url`]: asset, version: Number(profile.version) + 1 };
        mediaResponses.set(idempotencyKey, { write, response: { ...profile } });
        if (state.failNextUpload) {
          state.failNextUpload = false;
          return route.abort("failed");
        }
        return json(route, profile);
      }
      const body = request.postDataJSON() as Record<string, unknown>;
      state.writes.push({ path, method, body, idempotencyKey });
      if (path === "/settings/members") {
        // The API response/list never echoes a PIN, even for synthetic fixtures.
        const member = {
          id: 21 + members.length, first_name: body.first_name, last_name: body.last_name,
          email: null, email_access: false, roles: body.roles, branch_ids: body.branch_ids,
          all_branches: false, active: true, version: 1, capabilities: { can_edit: true, can_archive: true },
        };
        members.push(member);
        return json(route, member);
      }
      if (path.endsWith("/delivery")) {
        if (body.expected_version !== delivery.version) return json(route, { detail: "La versi\u00f3n de env\u00edos de prueba cambi\u00f3." }, 409);
        delivery = { ...delivery, ...body, version: Number(delivery.version) + 1 };
        return json(route, delivery);
      }
      if (body.expected_version !== profile.version) return json(route, { detail: "La versi\u00f3n de sucursal de prueba cambi\u00f3." }, 409);
      profile = method === "DELETE"
        ? { ...profile, [`${path.split("/").at(-1)}_url`]: null, version: Number(profile.version) + 1 }
        : { ...profile, ...body, version: Number(profile.version) + 1 };
      return json(route, profile);
    });
    await page.route("**/uploads/settings-enhancements-*", (route) => {
      const image = media.get(new URL(route.request().url()).pathname);
      return image ? route.fulfill({ contentType: image.type, body: image.bytes }) : route.fulfill({ status: 404 });
    });
    // An absent browser key uses the app's real missing-key error. If a local key
    // exists, block the script and exercise the equally honest load-error fallback.
    // Never inject a fake successful Google Map, request geolocation or call Places.
    await page.route(/^https:\/\/([^/]+\.)?(googleapis\.com|gstatic\.com|google\.com)\//, (route) => route.abort("blockedbyclient"));
    await use(state);
    expect(parityMock.violations).toEqual([]);
    expect(state.writes.every((write) => write.idempotencyKey.length > 0)).toBe(true);
    // The single lost upload response must replay, not become a second mutation.
    expect(new Set(state.writes.map((write) => write.idempotencyKey)).size).toBe(state.writes.length - 1);
  }, { auto: true }],
});

test.use({
  storageState: { cookies: [], origins: [] }, serviceWorkers: "block",
  locale: "es-PE", timezoneId: "America/Lima", colorScheme: "light",
  contextOptions: { reducedMotion: "reduce" },
});

async function chooseSection(page: Page, label: string) {
  const selector = page.getByRole("combobox", { name: "Secci\u00f3n", exact: true });
  if (await selector.isVisible()) await selector.selectOption({ label });
  else await page.getByRole("button", { name: label, exact: true }).click();
}

async function capture(page: Page, testInfo: TestInfo, surface: Locator, name: string) {
  await expect(surface).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(Array.from(document.images, (image) => image.decode().catch(() => undefined)));
  });
  const box = await surface.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  expect(await surface.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  const crop = page.locator(".branch-media-cropper .cropper-dialog");
  if (await crop.isVisible()) {
    const frame = await crop.locator(".cropper-frame").boundingBox();
    const zoom = await crop.locator(".cropper-zoom").boundingBox();
    expect(zoom!.y, "Zoom must remain below the crop, including short viewports").toBeGreaterThanOrEqual(frame!.y + frame!.height);
  }
  const path = resolve(testInfo.config.rootDir, "test-output", `settings-enhancements-${testInfo.project.name}-${name}.png`);
  await page.screenshot({ path, fullPage: true, animations: "disabled", scale: "css" });
  await testInfo.attach(`settings-enhancements-${testInfo.project.name}-${name}`, { path, contentType: "image/png" });
}

async function checkExport(page: Page, image: NonNullable<SettingsWrite["image"]>, height: number) {
  expect(image.type).toBe("image/webp");
  const dimensions = await page.evaluate(async ({ encoded, type }) => {
    const data = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([data], { type }));
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  }, { encoded: image.bytes.toString("base64"), type: image.type });
  expect(dimensions).toEqual({ width: 1024, height });
}

test("configuration enhancements: PIN, cropped media, manual map fallback and five shipping modes", async ({ page, settingsMock }, testInfo) => {
  test.setTimeout(90000);
  const workspace = page.getByRole("dialog", { name: "Configuraci\u00f3n", exact: true });

  await test.step("PIN stays masked and is only written with the member", async () => {
    await page.goto("/configuracion/miembros");
    await expect(workspace).toBeVisible();
    await page.getByRole("button", { name: "Nuevo miembro", exact: true }).click();
    const drawer = page.getByRole("dialog", { name: "Agrega un miembro", exact: true });
    await drawer.getByLabel("Nombre(s)", { exact: true }).fill("Persona de prueba");
    await drawer.getByRole("checkbox", { name: /Cajero/ }).check();
    await drawer.getByRole("button", { name: "Agregar PIN", exact: true }).click();
    const pin = page.getByRole("dialog", { name: "Editar PIN de acceso", exact: true });
    await expect(pin.getByRole("group", { name: "PIN del miembro", exact: true })).toBeFocused();
    await page.keyboard.type("083");
    await expect(drawer.getByRole("button", { name: "Agregar miembro", exact: true })).toBeDisabled();
    await pin.getByRole("button", { name: "6", exact: true }).click();
    await expect(pin.getByRole("status")).toContainText("4 de 4");
    expect(await pin.innerHTML()).not.toContain("0836");
    expect(settingsMock.writes).toHaveLength(0);
    await capture(page, testInfo, pin, "pin");
    await page.keyboard.press("Escape");
    await expect(pin).toBeHidden();
    await expect(drawer.getByRole("button", { name: "Editar PIN", exact: true })).toBeFocused();
    await drawer.getByRole("button", { name: "Agregar miembro", exact: true }).click();
    await expect(drawer).toBeHidden();
    expect(settingsMock.writes[0]).toMatchObject({ path: "/settings/members", method: "POST", body: { pin: "0836", roles: ["cashier"], branch_ids: [1] } });
    await expect(page.getByRole("button", { name: "Vincular dispositivo", exact: true })).toBeDisabled();
  });

  await test.step("crop upload retry, cover ratio, discard guard and removal", async () => {
    await chooseSection(page, "Datos de sucursal");
    const alias = page.getByLabel("Alias de sucursal");
    await alias.fill("Matriz de prueba editada");
    const logo = page.locator(".branch-media-card").filter({ hasText: "Logotipo de la tienda" });
    const cover = page.locator(".branch-media-card").filter({ hasText: "Portada de la tienda" });
    const crop = page.getByRole("dialog", { name: "Recortar imagen", exact: true });
    const source = { name: "fixture.png", mimeType: "image/png", buffer: fixturePng() };
    const writesBefore = settingsMock.writes.length;
    await logo.locator('input[type="file"]').setInputFiles(source);
    await expect(crop.getByRole("button", { name: "Guardar", exact: true })).toBeEnabled();
    expect(settingsMock.writes.length).toBe(writesBefore);
    await crop.getByRole("button", { name: "Aumentar zoom", exact: true }).click();
    const frame = crop.getByRole("group", { name: "Encuadre de imagen", exact: true });
    const box = (await frame.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2 + 12, { steps: 4 });
    await page.mouse.up();
    await frame.press("ArrowRight");
    await capture(page, testInfo, crop, "logo-crop");
    const transform = await crop.getByAltText("Vista para recortar").evaluate((image) => (image as HTMLElement).style.transform);
    settingsMock.failNextUpload = true;
    await crop.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect(crop.getByRole("alert")).toContainText("Conservamos tu recorte");
    await expect(crop.getByRole("slider")).toHaveValue("1.1");
    expect(await crop.getByAltText("Vista para recortar").evaluate((image) => (image as HTMLElement).style.transform)).toBe(transform);
    await capture(page, testInfo, crop, "crop-error");
    await crop.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect(crop).toBeHidden();
    await expect(logo.getByRole("button", { name: "Cargar imagen", exact: true })).toBeFocused();
    const uploads = settingsMock.writes.filter((write) => write.image);
    expect(uploads).toHaveLength(2);
    expect(uploads[1].idempotencyKey).toBe(uploads[0].idempotencyKey);
    expect(uploads[0].image!.bytes.equals(uploads[1].image!.bytes)).toBe(true);
    await checkExport(page, uploads[1].image!, 1024);
    await expect(alias).toHaveValue("Matriz de prueba editada");

    await cover.locator('input[type="file"]').setInputFiles(source);
    await expect(crop.getByRole("button", { name: "Guardar", exact: true })).toBeEnabled();
    await capture(page, testInfo, crop, "cover-crop");
    await page.keyboard.press("Escape");
    const discard = page.getByRole("alertdialog", { name: "Descartar recorte", exact: true });
    await expect(discard).toBeVisible();
    expect(Number(await discard.locator("..").evaluate((element) => getComputedStyle(element).zIndex))).toBeGreaterThan(Number(await crop.locator("..").evaluate((element) => getComputedStyle(element).zIndex)));
    await capture(page, testInfo, discard, "crop-discard");
    await page.keyboard.press("Escape");
    await expect(discard).toBeHidden();
    await expect(crop).toBeVisible();
    await crop.getByRole("button", { name: "Cancelar", exact: true }).click();
    await discard.getByRole("button", { name: "Descartar recorte", exact: true }).click();
    await expect(cover.getByRole("button", { name: "Cargar imagen", exact: true })).toBeFocused();
    expect(settingsMock.writes.filter((write) => write.image)).toHaveLength(2);

    await cover.locator('input[type="file"]').setInputFiles(source);
    await crop.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect(crop).toBeHidden();
    const lastUpload = settingsMock.writes.filter((write) => write.image).at(-1)!;
    expect(lastUpload.body.media_kind).toBe("cover");
    await checkExport(page, lastUpload.image!, 576);
    await cover.getByRole("button", { name: "Quitar imagen", exact: true }).click();
    await page.getByRole("alertdialog", { name: "Quitar imagen", exact: true }).getByRole("button", { name: "Quitar imagen", exact: true }).click();
    await expect(cover.getByRole("img", { name: "Portada de la tienda", exact: true })).toHaveCount(0);
    expect(settingsMock.writes.at(-1)).toMatchObject({ path: "/settings/branches/1/media/cover", method: "DELETE" });
    await workspace.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect(workspace.getByRole("button", { name: "Guardar", exact: true })).toBeDisabled();
    expect(settingsMock.writes.at(-1)).toMatchObject({ path: "/settings/branches/1/profile", method: "PATCH", body: { name: "Matriz de prueba editada" } });
    await capture(page, testInfo, workspace, "branch-media");
  });

  await test.step("honest unavailable map allows explicit manual coordinates, not a fake map", async () => {
    const writesBefore = settingsMock.writes.length;
    await page.getByRole("button", { name: "Agregar ubicaci\u00f3n", exact: true }).click();
    const location = page.getByRole("dialog", { name: "Agregar ubicaci\u00f3n", exact: true });
    await expect(location.getByRole("alert")).toContainText(/Google Maps|mapa/i);
    await expect(location.getByLabel("Mapa de Google para seleccionar ubicaci\u00f3n")).toBeHidden();
    await expect(location.getByRole("button", { name: "Agregar ubicaci\u00f3n", exact: true })).toBeDisabled();
    await location.getByLabel("Latitud", { exact: true }).fill("-12.05");
    await location.getByLabel("Longitud", { exact: true }).fill("-77.04");
    await location.getByRole("button", { name: "Usar coordenadas", exact: true }).click();
    await expect(location.getByText("Punto seleccionado: -12.05, -77.04", { exact: true })).toBeVisible();
    await capture(page, testInfo, location, "location-manual-error");
    await location.getByRole("button", { name: "Agregar ubicaci\u00f3n", exact: true }).click();
    await expect(location).toBeHidden();
    expect(settingsMock.writes.length).toBe(writesBefore);
    await expect(page.getByLabel("Enlace de Google Maps", { exact: true })).toHaveValue("https://www.google.com/maps/search/?api=1&query=-12.05,-77.04");
    await workspace.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect(workspace.getByRole("button", { name: "Guardar", exact: true })).toBeDisabled();
    expect(settingsMock.writes.at(-1)).toMatchObject({ body: { latitude: -12.05, longitude: -77.04 } });
  });

  await test.step("all five shipping modes save through the versioned settings contract", async () => {
    await chooseSection(page, "Costos de env\u00edo");
    const mode = page.getByRole("combobox", { name: "Tipo de costo de env\u00edo" });
    await expect(mode).toHaveValue("fixed");
    await expect(mode.locator("option")).toHaveText(["Sin costo", "Precio fijo", "Por colonias", "Por distancia", "Por cotizar"]);
    for (const value of ["free", "fixed", "neighborhoods", "radius", "quote"]) {
      await mode.selectOption(value);
      if (value === "free") {
        await expect(page.getByRole("switch", { name: "Env\u00edo gratis si se alcanza una compra m\u00ednima" })).toHaveCount(0);
        await page.getByRole("switch", { name: "Se requiere una compra m\u00ednima para habilitar env\u00edos" }).click();
        await page.getByLabel("Compra m\u00ednima", { exact: true }).fill("20");
      } else if (value === "fixed") {
        await page.getByLabel("Precio fijo de env\u00edo", { exact: true }).fill("7");
        await page.getByRole("switch", { name: "Env\u00edo gratis si se alcanza una compra m\u00ednima" }).click();
        await page.getByLabel("Monto para env\u00edo gratis", { exact: true }).fill("60");
      } else if (value === "neighborhoods") {
        await page.getByLabel("Nombre de colonia 1", { exact: true }).fill("Zona A de prueba");
        await page.getByLabel("Costo de env\u00edo 1", { exact: true }).fill("4");
        await page.getByRole("button", { name: "Agregar otra colonia", exact: true }).click();
        await page.getByLabel("Nombre de colonia 2", { exact: true }).fill("Zona B de prueba");
        await page.getByLabel("Costo de env\u00edo 2", { exact: true }).fill("6");
      } else if (value === "radius") {
        await page.getByLabel("Hasta nivel 1", { exact: true }).fill("2.5");
        await page.getByLabel("Costo de nivel 1", { exact: true }).fill("4");
        await page.getByRole("button", { name: "Agregar otro nivel", exact: true }).click();
        await expect(page.getByLabel("Desde nivel 2", { exact: true })).toHaveValue("2.5");
        await page.getByLabel("Hasta nivel 2", { exact: true }).fill("5");
        await page.getByLabel("Costo de nivel 2", { exact: true }).fill("8");
        await page.getByRole("combobox", { name: "Costo de env\u00edo", exact: true }).selectOption("quote");
        await expect(page.getByText(/Google Routes est\u00e9 configurado/)).toBeVisible();
      } else {
        await expect(page.getByText("El precio de env\u00edo no ser\u00e1 calculado autom\u00e1ticamente.", { exact: true })).toBeVisible();
      }
      await workspace.getByRole("button", { name: "Guardar", exact: true }).click();
      await expect(workspace.getByRole("button", { name: "Guardar", exact: true })).toBeDisabled();
      const write = settingsMock.writes.at(-1)!;
      expect(write).toMatchObject({ path: "/settings/branches/1/delivery", method: "PATCH", body: { delivery_mode: value === "radius" ? "bands" : value, minimum_order_amount: 20 } });
      if (value === "fixed") expect(write.body).toMatchObject({ fixed_delivery_fee: 7, free_delivery_threshold: 60 });
      if (value === "neighborhoods") expect(write.body.delivery_policy).toMatchObject({ neighborhoods: [{ name: "Zona A de prueba", fee: 4 }, { name: "Zona B de prueba", fee: 6 }] });
      if (value === "radius") {
        expect(write.body.bands).toEqual([{ minimum_km: 0, maximum_km: 2.5, fee: 4, sort_order: 0 }, { minimum_km: 2.5, maximum_km: 5, fee: 8, sort_order: 1 }]);
        expect(write.body.delivery_policy).toMatchObject({ outside_band_mode: "quote" });
      }
      await expect(mode).toHaveValue(value);
      await page.locator(".settings-workspace-content").evaluate((element) => { element.scrollTop = 0; });
      await capture(page, testInfo, workspace, `shipping-${value}`);
    }
    expect(settingsMock.writes.filter((write) => write.path.endsWith("/delivery"))).toHaveLength(5);
  });
});
