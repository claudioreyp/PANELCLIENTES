import { expect, test, type Page, type Route } from "@playwright/test";

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

const secondaryRegister = { id: 6, name: "Caja secundaria", active: true, is_default: false };
const register = { id: 7, name: "Caja Principal", active: true, is_default: true };
const closedAt = "2026-08-31T23:07:00-05:00";

function cutDetail(id = 3741) {
  return {
    id,
    number: id,
    register,
    closed_at: closedAt,
    created_by: "Claudio Rey",
    retained_fund_amount: 5,
    cash_withdrawn_amount: 15,
    opening_amount: 5,
    previous_session_id: 3740,
    total_expected_amount: 60,
    total_difference: 0,
    result: "balanced",
    reconciliation_status: "balanced",
    has_discrepancy: false,
    notes: null,
    methods: [
      {
        key: "cash",
        label: "Efectivo",
        counted: 20,
        expected: 20,
        difference: 0,
        transactions: [{ id: 91, kind: "payment", amount: 15, signed_amount: 15, order_id: 8, order_folio: 8, order_number: "0008", created_at: closedAt }],
      },
      {
        key: "card",
        label: "Tarjeta",
        counted: null,
        expected: 0,
        difference: null,
        transactions: [],
      },
      {
        key: "transfer",
        label: "Transferencias",
        counted: null,
        expected: 40,
        difference: null,
        transactions: [{ id: 92, kind: "payment", method: "yape", amount: 40, signed_amount: 40, order_id: 9, order_folio: 9, order_number: "0009", created_at: closedAt }],
      },
    ],
  };
}

async function mockCashApi(page: Page) {
  let latestCut = cutDetail();
  const cutPayloads: Record<string, unknown>[] = [];
  const cutIdempotencyKeys: string[] = [];
  const movementPayloads: Record<string, unknown>[] = [];
  const movementIdempotencyKeys: string[] = [];
  const movements = [{
    id: 80,
    movement_type: "income",
    amount: 12,
    note: "Cambio para el turno",
    created_at: closedAt,
    created_by: "Claudio Rey",
  }];

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^.*\/api\/v1/, "");
    const method = request.method();

    if (method === "GET" && path === "/context") {
      return json(route, {
        role: "owner",
        business: {
          id: 1,
          slug: "maspedidos",
          name: "Maspedidos",
          status: "active",
          plan: "pro",
          currency: "PEN",
          timezone: "America/Lima",
          modules: { pos: true, cash: true, inventory: true },
        },
        branches: [{
          id: 1,
          business_id: 1,
          slug: "matriz",
          name: "Matriz",
          opening_hours: {},
          accepted_payment_methods: ["cash", "card", "yape"],
          delivery_enabled: true,
          takeaway_enabled: true,
          delivery_fee: 0,
          active: true,
        }],
      });
    }
    if (method === "GET" && path === "/cash/registers") return json(route, [secondaryRegister, register]);
    if (method === "GET" && path === "/cash/registers/7/cut-preview") {
      return json(route, {
        register,
        session_id: 33,
        version: 4,
        period_started_at: closedAt,
        opening_fund: 5,
        has_cash_activity: true,
        has_card_activity: false,
        transfer_expected_amount: 40,
        pending_orders: [{ id: 3, folio: 3, number: "0003", remaining_amount: 30 }],
        pending_order_count: 1,
      });
    }
    if (method === "GET" && path === "/cash/cuts") {
      return json(route, { items: [latestCut], total: 1, page: 1, page_size: 10 });
    }
    const detailMatch = path.match(/^\/cash\/cuts\/(\d+)$/);
    if (method === "GET" && detailMatch) return json(route, cutDetail(Number(detailMatch[1])));
    if (method === "POST" && path === "/cash/registers/7/cuts") {
      cutPayloads.push(request.postDataJSON() as Record<string, unknown>);
      cutIdempotencyKeys.push(request.headers()["idempotency-key"] || "");
      latestCut = cutDetail(3742);
      return json(route, latestCut, 201);
    }
    if (method === "GET" && path === "/cash/registers/7/movements") {
      const income = movements.filter((movement) => movement.movement_type === "income").reduce((total, movement) => total + movement.amount, 0);
      const withdrawals = movements.filter((movement) => movement.movement_type === "withdrawal").reduce((total, movement) => total + movement.amount, 0);
      return json(route, { items: movements, total: movements.length, page: 1, page_size: 10, session_id: 33, summary: { income_amount: income, withdrawal_amount: withdrawals, expense_amount: 0, refund_amount: 0, signed_amount: income - withdrawals } });
    }
    if (method === "POST" && path === "/cash/registers/7/movements") {
      const payload = request.postDataJSON() as Record<string, unknown>;
      movementPayloads.push(payload);
      movementIdempotencyKeys.push(request.headers()["idempotency-key"] || "");
      movements.unshift({
        id: 81,
        movement_type: String(payload.movement_type),
        amount: Number(payload.amount),
        note: String(payload.note),
        created_at: closedAt,
        created_by: "Claudio Rey",
      });
      return json(route, movements[0], 201);
    }

    return json(route, { detail: `Ruta no simulada: ${method} ${path}` }, 404);
  });

  return { cutPayloads, cutIdempotencyKeys, movementPayloads, movementIdempotencyKeys };
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("impulsa.authMode", "dev");
    localStorage.setItem("impulsa.businessId", "1");
    localStorage.setItem("impulsa.branchId", "1");
  });
});

test("completes the blind cut flow without hiding responsive table columns", async ({ page }, testInfo) => {
  const mock = await mockCashApi(page);
  await page.goto("/caja");

  await expect(page.getByRole("heading", { name: "Caja", exact: true })).toBeVisible();
  for (const column of ["Corte", "Fecha", "Caja", "Creado por", "Resultado", "Total esperado"]) {
    await expect(page.getByRole("columnheader", { name: column, exact: true }).first()).toBeVisible();
  }
  if (process.env.IMPECCABLE_REVIEW === "1") {
    await page.screenshot({ path: `.impeccable/review/cash-history-${testInfo.project.name}.png`, fullPage: true });
  }

  const cutButton = page.getByRole("button", { name: "Abrir corte #3741" });
  await cutButton.click();
  const detail = page.getByRole("dialog", { name: "#3741 en Caja Principal" });
  await expect(detail).toBeVisible();
  await detail.getByRole("button", { name: /Efectivo/ }).click();
  await expect(detail.locator(".cash-method-transactions span").filter({ hasText: "Pedido #8" })).toBeVisible();
  await expect(detail.getByText("Fondo de caja anterior (corte #3740)")).toBeVisible();
  await page.evaluate(() => { window.print = () => document.body.setAttribute("data-print-invoked", "true"); });
  await detail.getByRole("button", { name: "Imprimir corte de caja" }).click();
  await expect(page.locator("body")).toHaveAttribute("data-print-invoked", "true");
  await page.keyboard.press("Escape");
  await expect(detail).toBeHidden();
  await expect(cutButton).toBeFocused();

  await page.getByRole("button", { name: "Nuevo corte de caja" }).click();
  const drawer = page.getByRole("dialog", { name: "Agregar un corte de caja" });
  await expect(drawer.getByText("Hay 1 pedido sin cobrar.", { exact: true })).toBeVisible();
  await expect(drawer.getByLabel("Monto en efectivo")).toHaveValue("");
  await expect(drawer.getByLabel("Monto en efectivo")).toHaveAttribute("required", "");
  await expect(drawer.getByLabel("Resumen del conteo").getByText("Pendiente", { exact: true }).first()).toBeVisible();
  await expect(drawer.getByLabel("Monto de pagos en tarjeta")).toBeDisabled();
  await expect(drawer.getByText("No hay movimientos con tarjeta que contabilizar.", { exact: true })).toBeVisible();
  await drawer.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));

  if ((page.viewportSize()?.width || 1280) <= 1024) {
    const drawerBox = await drawer.boundingBox();
    expect(drawerBox?.x || 0).toBeLessThanOrEqual(1);
    expect(drawerBox?.width || 0).toBeGreaterThanOrEqual((page.viewportSize()?.width || 0) - 1);
  }
  if (process.env.IMPECCABLE_REVIEW === "1") {
    await page.screenshot({ path: `.impeccable/review/cash-drawer-${testInfo.project.name}.png`, fullPage: true });
  }

  await drawer.getByRole("button", { name: "Contar efectivo" }).click();
  const calculator = page.getByRole("dialog", { name: "Calculadora de efectivo" });
  await calculator.getByLabel("Cantidad de S/ 20.00").fill("1");
  await expect(calculator.getByText(/Total/)).toContainText("20.00");
  await calculator.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
  if (process.env.IMPECCABLE_REVIEW === "1") {
    await page.screenshot({ path: `.impeccable/review/cash-calculator-${testInfo.project.name}.png`, fullPage: true });
  }
  await calculator.getByRole("button", { name: "Guardar" }).click();
  await expect(drawer.getByLabel("Monto en efectivo")).toHaveValue("20.00");
  await drawer.getByRole("checkbox", { name: "Omitir pagos pendientes" }).check();
  await drawer.getByRole("button", { name: "Guardar" }).click();

  await expect.poll(() => mock.cutPayloads.length).toBe(1);
  expect(mock.cutPayloads[0]).toMatchObject({
    expected_version: 4,
    expected_session_id: 33,
    cash_counted: 20,
    card_counted: 0,
    retained_fund: 5,
    ignore_pending_orders: true,
  });
  expect(mock.cutIdempotencyKeys[0]).not.toBe("");
  await expect(page.getByRole("dialog", { name: "#3742 en Caja Principal" })).toBeVisible();

  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  if (process.env.IMPECCABLE_REVIEW === "1") {
    await page.screenshot({ path: `.impeccable/review/cash-workspace-${testInfo.project.name}.png`, fullPage: true });
  }
});

test("registers only supported cash movement types", async ({ page }, testInfo) => {
  const mock = await mockCashApi(page);
  await page.goto("/caja");
  await page.getByRole("tab", { name: "Entradas y retiros de efectivo" }).click();

  for (const column of ["Fecha", "Caja", "Tipo", "Cantidad", "Motivo", "Registrado por"]) {
    await expect(page.getByRole("columnheader", { name: column, exact: true }).last()).toBeVisible();
  }
  await page.getByRole("button", { name: "Agregar movimiento" }).click();
  const dialog = page.getByRole("dialog", { name: "Agrega un movimiento" });
  const movementType = dialog.getByLabel("Tipo de movimiento");
  await expect(movementType.locator("option")).toHaveText(["Entrada de efectivo", "Retiro de efectivo"]);
  await movementType.selectOption("withdrawal");
  await dialog.getByLabel("Cantidad").fill("9.50");
  await dialog.getByLabel("Motivo").fill("Compra de insumos");
  await dialog.getByRole("button", { name: "Confirmar" }).click();

  await expect.poll(() => mock.movementPayloads.length).toBe(1);
  expect(mock.movementPayloads[0]).toEqual({
    movement_type: "withdrawal",
    amount: 9.5,
    note: "Compra de insumos",
    expected_version: 4,
    expected_session_id: 33,
  });
  expect(mock.movementIdempotencyKeys[0]).not.toBe("");
  await expect(page.getByText("Movimiento de efectivo registrado.", { exact: true })).toBeVisible();
  await expect(page.locator("tr").filter({ hasText: "Compra de insumos" }).getByText(/-.*9\.50/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  if (process.env.IMPECCABLE_REVIEW === "1") {
    await page.screenshot({ path: `.impeccable/review/cash-movements-${testInfo.project.name}.png`, fullPage: true });
  }
});

test("shows signed source details and mixed differences without hiding them in print", async ({ page }, testInfo) => {
  await mockCashApi(page);
  const proof = {
    ...cutDetail(),
    opening_amount: 10,
    previous_session_id: 3740,
    retained_fund_amount: 5,
    cash_withdrawn_amount: 229,
    total_expected_amount: 473,
    total_difference: -5,
    result: "shortage",
    reconciliation_status: "mixed",
    has_discrepancy: true,
    methods: [
      { key: "cash", label: "Efectivo", counted: 234, expected: 473, difference: -239, transactions: [
        { id: 1, kind: "payment", order_id: 7, order_folio: 7, amount: 468, signed_amount: 468, created_at: "2026-10-04T20:57:00" },
        { id: 1, kind: "movement", movement_type: "income", amount: 10, signed_amount: 10, note: "Se encontró", created_at: "2026-10-04T20:58:00" },
        { id: 2, kind: "movement", movement_type: "withdrawal", amount: 15, signed_amount: -15, note: "Compra de insumos para el turno de atención", created_at: "2026-10-04T20:58:00" },
      ] },
      { key: "card", label: "Tarjeta", counted: 234, expected: 0, difference: 234, transactions: [
        { id: 2, kind: "payment", order_id: 8, order_folio: 8, amount: 468, signed_amount: 468, created_at: "2026-10-04T20:57:00" },
        { id: 3, kind: "refund", movement_type: "refund", method: "card", order_id: 8, order_folio: 8, amount: 468, signed_amount: -468, created_at: "2026-10-04T20:59:00" },
      ] },
      { key: "transfer", label: "Transferencias", counted: null, expected: 0, difference: null, transactions: [] },
    ],
  };
  await page.route("**/api/v1/cash/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/cash/cuts")) return json(route, { items: [proof], total: 1, page: 1, page_size: 10 });
    if (url.pathname.endsWith("/cash/cuts/3741")) return json(route, proof);
    return route.fallback();
  });
  await page.goto("/caja");
  await page.getByRole("button", { name: "Abrir corte #3741" }).click();
  const detail = page.getByRole("dialog", { name: "#3741 en Caja Principal" });
  await detail.getByRole("button", { name: /Efectivo/ }).click();
  await expect(detail.getByText("Con diferencias por método", { exact: true })).toBeVisible();
  await expect(detail.getByText("Retiros de efectivo (1)", { exact: true })).toBeVisible();
  await expect(detail.locator(".cash-transaction-category > div .cash-amount-out").filter({ hasText: /15\.00/ })).toContainText("-");
  await expect(detail.getByText(/3:57/).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  if (process.env.IMPECCABLE_REVIEW === "1") {
    await page.screenshot({ path: `.impeccable/review/cash-signed-cash-${testInfo.project.name}.png`, fullPage: true });
  }
  await detail.getByRole("button", { name: /Tarjeta/ }).click();
  await expect(detail.getByText("Reembolsos en tarjeta (1)", { exact: true })).toBeVisible();
  await expect(detail.locator(".cash-transaction-category > div .cash-amount-out").filter({ hasText: /468\.00/ })).toContainText("-");
  if (process.env.IMPECCABLE_REVIEW === "1") {
    await page.screenshot({ path: `.impeccable/review/cash-signed-card-${testInfo.project.name}.png`, fullPage: true });
  }
  await detail.getByRole("button", { name: /Tarjeta/ }).click();
  await page.emulateMedia({ media: "print" });
  const printSheet = page.locator(".cash-cut-print-sheet");
  await expect(printSheet.getByText("Retiros de efectivo (1)", { exact: true })).toBeVisible();
  await expect(printSheet.getByText("Reembolsos en tarjeta (1)", { exact: true })).toBeVisible();
});
