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
    total_expected_amount: 60,
    total_difference: 0,
    result: "balanced",
    notes: null,
    methods: [
      {
        key: "cash",
        label: "Efectivo",
        counted: 20,
        expected: 20,
        difference: 0,
        transactions: [{ id: 91, amount: 20, order_number: "0008", created_at: closedAt }],
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
        transactions: [{ id: 92, amount: 40, order_number: "0009", created_at: closedAt }],
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
        has_card_activity: false,
        transfer_expected_amount: 40,
        pending_orders: [{ id: 3, number: "0003", remaining_amount: 30 }],
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
      return json(route, { items: movements, total: movements.length, page: 1, page_size: 10 });
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
  await expect(detail.locator(".cash-method-transactions span").filter({ hasText: "Pedido #0008" })).toBeVisible();
  await page.evaluate(() => { window.print = () => document.body.setAttribute("data-print-invoked", "true"); });
  await detail.getByRole("button", { name: "Imprimir corte de caja" }).click();
  await expect(page.locator("body")).toHaveAttribute("data-print-invoked", "true");
  await page.keyboard.press("Escape");
  await expect(detail).toBeHidden();
  await expect(cutButton).toBeFocused();

  await page.getByRole("button", { name: "Nuevo corte de caja" }).click();
  const drawer = page.getByRole("dialog", { name: "Agregar un corte de caja" });
  await expect(drawer.getByText("Hay 1 pedido sin cobrar.", { exact: true })).toBeVisible();
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

test("registers only supported cash movement types", async ({ page }) => {
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
  });
  expect(mock.movementIdempotencyKeys[0]).not.toBe("");
  await expect(page.getByText("Movimiento de efectivo registrado.", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});
