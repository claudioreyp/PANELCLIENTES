import { expect, test, type Page } from "@playwright/test";

type QzSubmission = {
  config: { printer: string; options: { jobName: string; copies: number } };
  data: { type: string; format: string; flavor: string; data: string; options?: Record<string, unknown> }[];
};
type QzTestState = {
  active: boolean; allow: boolean; sent: QzSubmission[];
  holdNext: boolean; release: (() => void) | null;
};

async function sentJobs(page: Page): Promise<QzSubmission[]> {
  return page.evaluate(() => (window as unknown as { qzTest: QzTestState }).qzTest.sent);
}

function expectRawJobs(submissions: QzSubmission[], expected: { jobName: string; copies: number; paperWidth: 58 | 80 }[]) {
  expect(submissions).toHaveLength(expected.length);
  for (const [index, document] of expected.entries()) {
    const rasterWidth = document.paperWidth === 58 ? 384 : 576;
    expect(submissions[index].config).toEqual({ printer: "POS-80 de pruebas", options: expect.objectContaining({
      jobName: document.jobName, copies: document.copies, units: "mm", density: rasterWidth / document.paperWidth,
      size: { width: document.paperWidth, height: null },
    }) });
    expect(submissions[index].data).toEqual([
      { type: "raw", format: "command", flavor: "hex", data: "1B40" },
      { type: "raw", format: "html", flavor: "plain", data: expect.any(String), options: { language: "ESCPOS", pageWidth: rasterWidth, pageHeight: expect.any(Number), dotDensity: "double" } },
      { type: "raw", format: "command", flavor: "hex", data: "0A1D564100" },
    ]);
    expect(submissions[index].data[1].data).toContain(`data-paper-width="${document.paperWidth}"`);
    expect(Number(submissions[index].data[1].options?.pageHeight)).toBeGreaterThan(0);
  }
}

async function prepare(page: Page, connected = true, identity?: Record<string, unknown>) {
  const writes: unknown[] = [];
  const requests: { path: string; method: string }[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api/v1/")) requests.push({ path: path.replace("/api/v1", ""), method: request.method() });
  });
  await page.addInitScript(({ connected }) => {
    localStorage.setItem("impulsa.authMode", "dev");
    localStorage.setItem("impulsa.businessId", "1");
    localStorage.setItem("impulsa.branchId", "1");
    const state: QzTestState = { active: false, allow: connected, sent: [], holdNext: false, release: null };
    Object.assign(window, { qzTest: state, qz: {
      api: { setSha256Type: () => {} },
      websocket: {
        isActive: () => state.active,
        connect: async () => { if (!state.allow) throw new Error("Unable to establish connection"); state.active = true; },
        disconnect: async () => { state.active = false; },
      },
      printers: {
        find: async () => ["POS-80 de pruebas", "Impresora auxiliar"],
        details: async () => [{ name: "POS-80 de pruebas", driver: "Generic / Text Only" }, { name: "Impresora auxiliar", driver: "Graphical driver" }],
      },
      security: { setCertificatePromise: () => {}, setSignaturePromise: () => {}, setSignatureAlgorithm: () => {} },
      configs: { create: (printer: string, options: unknown) => ({ printer, options }) },
      print: async (config: QzSubmission["config"], data: QzSubmission["data"]) => {
        state.sent.push({ config, data });
        if (state.holdNext) {
          state.holdNext = false;
          await new Promise<void>((resolve) => { state.release = resolve; });
          state.release = null;
        }
      },
    } });
  }, { connected });
  let printing = { version: 2, advanced_printing: false, printer_config: { printer_name: "", operating_system: "windows", print_language: "escpos", paper_width_mm: 80, copies: 1, auto_print_kitchen: true, manual_customer_receipt: true }, customer_ticket_template: { fields: [] }, kitchen_ticket_template: { fields: [] } };
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    let body: unknown;
    if (path === "/context") body = { role: "owner", roles: ["owner"], business: { id: 1, name: "Restaurante de pruebas", slug: "isolated", currency: "PEN", modules: { pos: true } }, branches: [{ id: 1, business_id: 1, name: "Sucursal de pruebas", active: true }] };
    else if (path === "/settings/branches/1/printing") {
      if (route.request().method() === "PATCH") { const payload = route.request().postDataJSON(); writes.push(payload); printing = { ...printing, ...payload, version: printing.version + 1 }; }
      body = printing;
    } else if (path === "/settings/branches/1/printing/qz") body = identity ? { mode: "signed", certificate: "public-test-certificate", identity } : { mode: "manual-approval", certificate: null };
    else if (path === "/settings/branches/1/agent") body = { branch_id: 1, version: 1, name: null, images: [], yape_qr_url: null };
    else if (path === "/orders/workspace") body = { branch_id: 1, period: "all", view: "orders", items: [], total: 0, page: 1, page_size: 20, review_count: 0 };
    else if (path === "/catalog") body = { categories: [], products: [], modifier_groups: [], promotions: [] };
    else return route.fulfill({ status: 404, json: { detail: "No mock for this request" } });
    return route.fulfill({ json: body });
  });
  return { writes, requests };
}

test("official QZ guidance preserves settings and shows renewal without a self-signed installer", async ({ page }, info) => {
  const { writes } = await prepare(page, true, {
    subject: "CN=Escalar AI POS, O=Escalar AI", issuer: "CN=Fixture issuer - not a real certificate",
    fingerprint_sha256: "a".repeat(64), valid_to: "2026-10-01T00:00:00Z", expires_soon: true,
    trust: "qz-issued", activation: "remember",
  });
  await page.goto("/configuracion/impresion");
  await expect(page.getByText("QZ Tray conectado", { exact: true })).toBeVisible();
  await page.getByText("Conexión y prueba de impresión", { exact: true }).click();
  await expect(page.getByText(/Remember this decision/)).toBeVisible();
  await expect(page.getByText(/El certificado vence en los próximos 30 días/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Descargar activación de QZ" })).toHaveCount(0);
  await page.getByText("Datos públicos del certificado", { exact: true }).click();
  await expect(page.getByText("a".repeat(64), { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(writes).toHaveLength(0);
  expect(await sentJobs(page)).toHaveLength(0);
  await page.screenshot({ path: `.impeccable/review/qz-official-${info.project.name}.png`, fullPage: true });
});

test("detects printers, autosaves main choices, and explicitly saves the configuration draft", async ({ page }, info) => {
  const { writes } = await prepare(page);
  await page.goto("/configuracion/impresion");
  await expect(page.getByText("QZ Tray conectado", { exact: true })).toBeVisible();
  expect(writes).toHaveLength(0);
  await expect(page.getByLabel("Sistema operativo")).toHaveCount(0);
  await expect(page.getByLabel("Impresora", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Configurar impresión", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Personalizar cliente" })).toBeEnabled();
  await page.getByRole("switch", { name: "Impresión avanzada", exact: true }).click();
  await page.getByLabel("Impresora", { exact: true }).selectOption("POS-80 de pruebas");
  await page.getByRole("button", { name: "Configurar impresión", exact: true }).click();
  if (process.env.IMPECCABLE_REVIEW === "1") await page.screenshot({ path: `.impeccable/review/printing-modal-${info.project.name}.png`, fullPage: true });
  await page.getByText("Opciones avanzadas", { exact: true }).click();
  await expect(page.getByLabel("Tipo de impresora", { exact: true })).toHaveValue("escpos");
  await expect(page.getByRole("switch", { name: "Impresión automática", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByLabel("Ticket para cliente", { exact: true })).toHaveValue("off");
  await expect(page.getByLabel("Ticket para cocina/barra", { exact: true })).toHaveValue("on");
  await page.getByLabel("Ancho de papel").selectOption("58");
  await page.getByRole("switch", { name: "Impresión automática", exact: true }).click();
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Configurar impresora", exact: true })).toHaveCount(0);
  await expect(page.getByText("La configuración de impresión se guardó.")).toBeVisible();
  expect(writes).toHaveLength(3);
  expect(writes[0]).toMatchObject({ advanced_printing: true, printer_config: { automatic_printing: true, auto_print_kitchen: true, manual_customer_receipt: true } });
  expect(writes[2]).toMatchObject({ advanced_printing: true, expected_version: 4, printer_config: { printer_name: "POS-80 de pruebas", print_language: "escpos", paper_width_mm: 58, automatic_printing: false, auto_print_kitchen: true, manual_customer_receipt: true } });
  await page.getByRole("switch", { name: "Impresión avanzada", exact: true }).click();
  await expect(page.getByRole("button", { name: "Configurar impresión", exact: true })).toHaveCount(0);
  await page.getByRole("switch", { name: "Impresión avanzada", exact: true }).click();
  await page.getByRole("button", { name: "Configurar impresión", exact: true }).click();
  await expect(page.getByRole("switch", { name: "Impresión automática", exact: true })).toHaveAttribute("aria-checked", "false");
  await expect(page.getByLabel("Ticket para cliente", { exact: true })).toHaveValue("off");
  await expect(page.getByLabel("Ticket para cocina/barra", { exact: true })).toHaveValue("on");
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  expect(writes).toHaveLength(5);
  await expect(page.locator(".printing-settings > .settings-card")).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Contactar soporte" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Guardar", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Sistema operativo")).toHaveAttribute("readonly", "");
  const workspace = page.getByRole("dialog", { name: "Configuración", exact: true });
  expect(await workspace.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  if (process.env.IMPECCABLE_REVIEW === "1") {
    await page.getByRole("heading", { name: "Impresión", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `.impeccable/review/printing-${info.project.name}.png`, fullPage: true });
  }
});

test("downloads explicit one-time QZ activation without changing printing or sending paper", async ({ page }, info) => {
  const { writes, requests } = await prepare(page, true, {
    subject: "CN=Escalar AI POS", issuer: "CN=Escalar AI POS",
    fingerprint_sha256: "b".repeat(64), valid_to: "2099-01-01T00:00:00Z", expires_soon: false,
    trust: "self-signed", activation: "install-certificate",
  });
  await page.route("**/api/v1/settings/branches/1/printing/qz/activation", route => route.fulfill({
    contentType: "application/zip", body: Buffer.from("public activation test fixture"),
  }));
  await page.goto("/configuracion/impresion");
  await expect(page.getByText("QZ Tray conectado", { exact: true })).toBeVisible();
  await page.getByText("Conexión y prueba de impresión", { exact: true }).click();
  expect(requests.filter(item => item.path.endsWith("/activation"))).toHaveLength(0);
  const action = page.getByRole("button", { name: "Descargar activación de QZ" });
  await action.scrollIntoViewIfNeeded();
  if (process.env.IMPECCABLE_REVIEW === "1") await page.screenshot({ path: `.impeccable/review/qz-activation-${info.project.name}.png`, fullPage: true });
  const pending = page.waitForEvent("download");
  await action.click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe("Escalar-AI-POS-activar-impresion.zip");
  await expect(page.getByText(/la descarga no confirma la activación/)).toBeVisible();
  expect(writes).toHaveLength(0);
  expect(await sentJobs(page)).toHaveLength(0);
  expect(requests.filter(item => item.path.endsWith("/activation"))).toEqual([{ path: "/settings/branches/1/printing/qz/activation", method: "GET" }]);
  const dialog = page.getByRole("dialog", { name: "Configuración", exact: true });
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
});

for (const mode of ["manual-approval", "signed"] as const) {
  test(`explains QZ trust in ${mode} mode without printing or changing settings`, async ({ page }, info) => {
    const { writes } = await prepare(page);
    await page.route("**/api/v1/settings/branches/1/printing/qz", (route) => route.fulfill({
      json: { mode, certificate: mode === "signed" ? "test-public-certificate" : null },
    }));
    await page.goto("/configuracion/impresion");
    await expect(page.getByText("QZ Tray conectado", { exact: true })).toBeVisible();
    await page.getByText("Conexión y prueba de impresión", { exact: true }).click();
    if (mode === "manual-approval") {
      await expect(page.getByText("Autorización por trabajo.", { exact: true })).toBeVisible();
      await expect(page.getByText(/No autorices permanentemente solicitudes anónimas/)).toBeVisible();
    } else {
      await expect(page.getByText("Firma del servidor activa.", { exact: true })).toBeVisible();
      await expect(page.getByText(/Pide al administrador que confirme el tipo de certificado/)).toBeVisible();
      await expect(page.getByText("Autorización por trabajo.", { exact: true })).toHaveCount(0);
    }
    expect(writes).toEqual([]);
    expect(await sentJobs(page)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (process.env.IMPECCABLE_REVIEW === "1") await page.screenshot({ path: `.impeccable/review/qz-trust-${mode}-${info.project.name}.png`, fullPage: true });
  });
}

test("opens the WhatsApp agent settings in the same tab instead of the public menu", async ({ page, context }) => {
  const { writes, requests } = await prepare(page);
  await page.goto("/pedidos");
  await expect(page.getByRole("heading", { name: "Pedidos", exact: true })).toBeVisible();
  const opener = page.getByRole("button", { name: "Abrir menú" });
  if (await opener.isVisible()) await opener.click();
  const agentLink = page.getByRole("link", { name: "Agente de Whatsapp", exact: true });
  await expect(agentLink).toHaveAttribute("href", "/configuracion/agente");
  await expect(page.getByRole("link", { name: "Menú digital", exact: true })).toHaveCount(0);
  await agentLink.click();
  await expect(page).toHaveURL(/\/configuracion\/agente$/);
  await expect(page.getByRole("heading", { name: "Perfil del agente", exact: true })).toBeVisible();
  expect(context.pages()).toHaveLength(1);
  expect(writes).toHaveLength(0);
  expect(requests.some(({ path }) => path === "/settings/branches/1/agent")).toBe(true);
  await page.getByRole("button", { name: "Cerrar configuración", exact: true }).click();
  await expect(page).toHaveURL(/\/pedidos$/);
});

test("recovers after opening QZ without creating printer or order records", async ({ page }) => {
  const { writes } = await prepare(page, false);
  await page.goto("/configuracion/impresion");
  await expect(page.getByText("QZ Tray no se encuentra abierto", { exact: true })).toBeVisible();
  await page.getByText("Conexión y prueba de impresión", { exact: true }).click();
  await expect(page.getByRole("link", { name: "Instalar QZ Tray" })).toHaveAttribute("href", "https://qz.io/download/");
  await expect(page.getByLabel("Impresora", { exact: true })).toHaveCount(0);
  await page.evaluate(() => { (window as unknown as { qzTest: { allow: boolean } }).qzTest.allow = true; });
  await page.getByRole("button", { name: "Reintentar", exact: true }).click();
  await expect(page.getByText("QZ Tray conectado", { exact: true })).toBeVisible();
  expect(writes).toHaveLength(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Configuración", exact: true })).toHaveCount(0);
});

test("submits automatic documents and both manual buttons print the selected document", async ({ page }) => {
  await prepare(page);
  const order = { id: 12, business_id: 1, branch_id: 1, version: 3, status: "preparing", number: "TEST-12", folio: 4, created_at: "2026-09-12T17:00:00Z", source: "pos", channel: "takeaway", payment_status: "pending", subtotal: 30, total: 30, discount: 0, delivery_fee: 0, remaining_amount: 30, paid_amount: 0, payments: [], items: [{ id: 1, name: "Pizza de prueba", quantity: 1, unit_price: 30, line_total: 30, modifiers: [] }] };
  const ticket = { id: 5, order_id: 12, branch_id: 1, sequence: 1, version: 2, created_at: order.created_at, status: "pending", context: { order_number: order.number, order_folio: order.folio, channel: order.channel, source: "pos", created_by_name: "Personal de pruebas" }, items: order.items };
  const jobs = ["kitchen_ticket", "customer_receipt"].map((kind, index) => ({ id: `job-${index}`, order_id: 12, branch_id: 1, job_type: kind, status: "pending", retryable: false, payload: { snapshot_version: 1, printer_name: "POS-80 de pruebas", print_language: "escpos", paper_width_mm: 80, copies: 2, business: { name: "Restaurante de pruebas" }, branch: { name: "Sucursal de pruebas" }, order, ticket: kind === "kitchen_ticket" ? ticket : null } }));
  let confirmed = false;
  const manualRequests: unknown[] = [];
  await page.route("**/api/v1/orders/12/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("confirm-and-send")) { confirmed = true; return route.fulfill({ json: { order, tickets: [ticket] } }); }
    if (path.endsWith("detail")) return route.fulfill({ json: { order, tickets: [ticket], payments: [], payment_evidence: [], payment_summary: { paid: 0, remaining: 30 } } });
    if (path.endsWith("printing/qz")) return route.fulfill({ json: { mode: "manual-approval", certificate: null } });
    if (path.endsWith("printing") && route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      manualRequests.push(body);
      const source = jobs.find((job) => job.job_type === body.job_type)!;
      const job = { ...source, id: `manual-${manualRequests.length}`, status: "pending" };
      jobs.push(job);
      return route.fulfill({ status: 201, json: job });
    }
    if (path.endsWith("printing")) return route.fulfill({ json: { order_id: 12, items: confirmed ? jobs : [], recoverable_error: false } });
    const job = jobs.find((item) => path.includes(`/${item.id}/`))!;
    if (path.endsWith("claim")) { job.status = "claimed"; return route.fulfill({ json: { job, dispatch_allowed: true } }); }
    if (path.endsWith("complete")) { expect(route.request().postDataJSON().outcome).toBe("printed"); job.status = "printed"; return route.fulfill({ json: job }); }
    return route.fulfill({ status: 404 });
  });
  await page.goto("/configuracion/impresion");
  await expect(page.getByText("QZ Tray conectado", { exact: true })).toBeVisible();
  const countSent = () => page.evaluate(() => (window as unknown as { qzTest: { sent: unknown[] } }).qzTest.sent.length);
  expect(await countSent()).toBe(0);
  await page.keyboard.press("Escape");
  // Exercise the real API confirmation hook with an isolated backend response.
  await page.evaluate(async () => {
    const path = "/src/lib/api.ts";
    const { api } = await import(/* @vite-ignore */ path);
    await api("/orders/12/confirm-and-send", { method: "POST", body: "{}", idempotencyKey: "isolated-confirm-1" });
  });
  await expect.poll(countSent).toBe(2);
  await expect(page.getByText("Ticket y comanda enviados a la impresora. El pedido está confirmado.")).toBeVisible();
  expect(jobs.every((job) => job.status === "printed")).toBe(true);
  const expectedDocuments = [{ jobName: "Ticket - TEST-12", copies: 2, paperWidth: 80 as const }, { jobName: "Comanda - TEST-12", copies: 2, paperWidth: 80 as const }];
  const automatic = await sentJobs(page);
  expectRawJobs(automatic, expectedDocuments);
  expect(automatic[0].data[1].data).not.toContain("<h1>Comanda #1</h1>");
  expect(automatic[1].data[1].data).toContain("<h1>Comanda #1</h1>");
  // A fresh page must not reprint automatic jobs. Each actual button creates one deliberate copy.
  await page.goto("/pedidos?order_id=12");
  const receiptButton = page.getByRole("button", { name: "Imprimir pedido", exact: true });
  await expect(receiptButton).toBeVisible();
  expect(await countSent()).toBe(0);
  await receiptButton.click();
  await expect.poll(countSent).toBe(1);
  await expect(receiptButton).toBeEnabled();
  await page.getByRole("button", { name: "Acciones de la comanda 1", exact: true }).click();
  await page.getByRole("menuitem", { name: "Imprimir comanda", exact: true }).click();
  await expect.poll(countSent).toBe(2);
  await expect(receiptButton).toBeEnabled();
  expect(manualRequests).toEqual([
    { job_type: "customer_receipt", expected_order_version: 3 },
    { job_type: "kitchen_ticket", kitchen_ticket_id: 5, expected_order_version: 3, expected_ticket_version: 2 },
  ]);
  expect(jobs).toHaveLength(4);
  expect(jobs.every((job) => job.status === "printed")).toBe(true);
  const manual = await sentJobs(page);
  expectRawJobs(manual, expectedDocuments);
  expect(manual.map((submission) => submission.data)).toEqual(automatic.map((submission) => submission.data));
});

for (const paperWidth of [58, 80] as const) {
  test(`prints sequential synthetic diagnostics and a short sample at ${paperWidth} mm without API mutations`, async ({ page }, info) => {
    const { writes, requests } = await prepare(page);
    await page.goto("/configuracion/impresion");
    await expect(page.getByText("QZ Tray conectado", { exact: true })).toBeVisible();
    await page.getByText("Conexión y prueba de impresión", { exact: true }).click();
    const pairButton = page.getByRole("button", { name: "Imprimir prueba", exact: true });
    const shortButton = page.getByRole("button", { name: "Imprimir prueba corta", exact: true });
    await expect(pairButton).toBeDisabled();
    await expect(shortButton).toBeDisabled();
    await page.getByRole("switch", { name: "Impresión avanzada", exact: true }).click();
    await page.getByLabel("Impresora", { exact: true }).selectOption("POS-80 de pruebas");
    await page.getByRole("button", { name: "Configurar impresión", exact: true }).click();
    await page.getByText("Opciones avanzadas", { exact: true }).click();
    await page.getByLabel("Tipo de impresora", { exact: true }).selectOption("escpos");
    await page.getByLabel("Ancho de papel").selectOption(String(paperWidth));
    await page.getByLabel("Copias por trabajo").fill("3");
    await page.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Configurar impresora", exact: true })).toHaveCount(0);
    await expect(page.getByText("Configuración verificada en la API · Sucursal 1 · Versión 5", { exact: true })).toBeVisible();
    await expect(pairButton).toBeEnabled();
    await expect(shortButton).toBeEnabled();
    expect(writes).toHaveLength(3);
    expect(writes[2]).toMatchObject({ advanced_printing: true, printer_config: { printer_name: "POS-80 de pruebas", print_language: "escpos", copies: 3, paper_width_mm: paperWidth } });
    const savedAt = requests.findIndex(({ method }) => method === "PATCH");
    expect(requests.slice(savedAt + 1)).toContainEqual({ path: "/settings/branches/1/printing", method: "GET" });
    expect(await sentJobs(page)).toHaveLength(0);
    writes.length = 0;
    requests.length = 0;

    await page.evaluate(() => { (window as unknown as { qzTest: QzTestState }).qzTest.holdNext = true; });
    await pairButton.click();
    await expect.poll(async () => (await sentJobs(page)).length).toBe(1);
    await expect(pairButton).toBeDisabled();
    await expect(shortButton).toBeDisabled();
    expectRawJobs(await sentJobs(page), [{ jobName: "PRUEBA - Ticket", copies: 1, paperWidth }]);
    await page.evaluate(() => { (window as unknown as { qzTest: QzTestState }).qzTest.release?.(); });
    await expect.poll(async () => (await sentJobs(page)).length).toBe(2);
    await expect(page.getByText(/^2 documentos enviados a QZ Tray\./)).toBeVisible();
    await expect(pairButton).toBeEnabled();
    const pair = await sentJobs(page);
    expectRawJobs(pair, [{ jobName: "PRUEBA - Ticket", copies: 1, paperWidth }, { jobName: "PRUEBA - Comanda", copies: 1, paperWidth }]);
    for (const submission of pair) expect(submission.data[1].data).toContain("PRUEBA DE IMPRESION - SIN VALOR COMERCIAL");
    expect(pair[1].data[1].data).toContain("<h1>Comanda sin número</h1>");

    await page.evaluate(() => { (window as unknown as { qzTest: QzTestState }).qzTest.sent.length = 0; });
    await shortButton.click();
    await expect.poll(async () => (await sentJobs(page)).length).toBe(1);
    await expect(page.getByText(/^1 documento enviado a QZ Tray\./)).toBeVisible();
    await expect(shortButton).toBeEnabled();
    const short = await sentJobs(page);
    expectRawJobs(short, [{ jobName: "PRUEBA - Ticket", copies: 1, paperWidth }]);
    expect(short[0].data[1].data).toContain("PRUEBA DE IMPRESION - SIN VALOR COMERCIAL");
    expect(short[0].data[1].data).not.toContain("<h1>Comanda sin número</h1>");
    expect(short[0].data[1].data.length).toBeLessThan(pair[0].data[1].data.length);
    expect(writes).toHaveLength(0);
    expect(requests.filter(({ method }) => !["GET", "HEAD", "OPTIONS"].includes(method))).toEqual([]);
    expect(requests.filter(({ path }) => /\/(orders|payments|kitchen)(\/|$)/.test(path))).toEqual([]);
    expect(requests.filter(({ path }) => path === "/settings/branches/1/printing/qz")).toHaveLength(3);
    if (process.env.IMPECCABLE_REVIEW === "1" && paperWidth === 80) {
      const diagnostics = page.getByRole("region", { name: "Prueba de impresión", exact: true });
      await diagnostics.screenshot({ path: `.impeccable/review/printing-diagnostics-${info.project.name}.png` });
    }
  });
}

test("edits a receipt locally with a responsive live preview and restores opener focus on discard", async ({ page }) => {
  const { writes } = await prepare(page);
  await page.goto("/configuracion/impresion");
  await page.getByRole("button", { name: "Personalizar cliente" }).click();
  const editor = page.getByRole("dialog", { name: "Ticket para cliente", exact: true });
  await expect(editor).toBeVisible();
  await expect(page).toHaveURL(/\/configuracion\/impresion$/);
  await page.getByLabel("Tamaño de letra").selectOption("large");
  await page.getByLabel("Encabezado personalizado", { exact: true }).check();
  await page.getByLabel("Texto del encabezado").fill("Bienvenidos <texto>");
  await expect(page.getByLabel("Texto del encabezado")).toHaveAttribute("maxlength", "500");
  await expect(page.getByText(/Texto plano, debajo del nombre del negocio/)).toBeVisible();
  await page.getByLabel("Pie de página personalizado", { exact: true }).check();
  await page.getByLabel("Texto del pie de página").fill("Gracias por tu visita");
  await expect(page.getByLabel("Texto del pie de página")).toHaveAttribute("maxlength", "500");
  await expect(page.getByText(/Texto plano, al final del ticket/)).toBeVisible();
  const previewToggle = editor.getByRole("button", { name: "Vista previa", exact: true });
  if (await previewToggle.isVisible()) await previewToggle.click();
  const preview = editor.getByRole("region", { name: "Vista previa del ticket", exact: true });
  await expect(preview.getByText("Bienvenidos <texto>", { exact: true })).toBeVisible();
  await expect(preview.getByText("Gracias por tu visita", { exact: true })).toBeVisible();
  expect(await editor.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  expect(writes).toHaveLength(0);
  expect(await sentJobs(page)).toHaveLength(0);
  await editor.getByRole("button", { name: "Salir", exact: true }).click();
  await page.getByRole("button", { name: "Seguir editando", exact: true }).click();
  await expect(editor).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Descartar cambios", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Personalizar cliente" })).toBeFocused();
  expect(writes).toHaveLength(0);
});

test("saves independent receipt and kitchen templates using the latest shared version", async ({ page }, info) => {
  const { writes } = await prepare(page);
  await page.goto("/configuracion/impresion");
  await page.getByRole("button", { name: "Personalizar cliente" }).click();
  await page.getByLabel("Tamaño de letra").selectOption("large");
  await page.getByLabel("Encabezado personalizado", { exact: true }).check();
  await page.getByLabel("Texto del encabezado", { exact: true }).fill("Preparado al momento");
  await page.getByLabel("Pie de página personalizado", { exact: true }).check();
  await page.getByLabel("Texto del pie de página", { exact: true }).fill("Gracias por tu visita.");
  if (process.env.IMPECCABLE_REVIEW === "1") {
    await page.screenshot({ path: `.impeccable/review/printing-editor-customer-${info.project.name}.png`, fullPage: true });
    if (info.project.name !== "desktop") {
      await page.getByRole("button", { name: "Vista previa", exact: true }).click();
      await page.screenshot({ path: `.impeccable/review/printing-preview-customer-${info.project.name}.png`, fullPage: true });
    }
  }
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Ticket para cliente", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Personalizar cocina" }).click();
  await expect(page.getByLabel("Encabezado personalizado", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Tamaño de letra")).toHaveValue("normal");
  await page.getByLabel("Tamaño de letra").selectOption("small");
  if (process.env.IMPECCABLE_REVIEW === "1") {
    if (info.project.name !== "desktop") await page.getByRole("button", { name: "Vista previa", exact: true }).click();
    await page.screenshot({ path: `.impeccable/review/printing-editor-kitchen-${info.project.name}.png`, fullPage: true });
  }
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Ticket para cocina/barra", exact: true })).toHaveCount(0);
  expect(writes).toHaveLength(2);
  expect(writes[1]).toMatchObject({ expected_version: 3, customer_ticket_template: { font_size: "large" }, kitchen_ticket_template: { font_size: "small" } });
  expect(await sentJobs(page)).toHaveLength(0);
});
