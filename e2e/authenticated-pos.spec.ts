import { expect, test } from "@playwright/test";

const ownerEmail = process.env.POS_OWNER_EMAIL;
const ownerPassword = process.env.POS_OWNER_PASSWORD;

test("owner enters the restaurant POS with the assigned tenant", async ({ page }) => {
  test.skip(!ownerEmail || !ownerPassword, "Set POS_OWNER_EMAIL and POS_OWNER_PASSWORD to run the real Auth check");

  await page.goto("/login");
  await page.getByLabel("Usuario").fill(ownerEmail!);
  await page.getByLabel("Contraseña").fill(ownerPassword!);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText("Pizza House", { exact: true })).toBeVisible();

  if ((page.viewportSize()?.width || 1280) < 920) {
    await page.getByRole("button", { name: "Abrir menú" }).click();
  }
  for (const moduleName of ["Inicio", "Pedidos", "Menú", "Caja", "Disponibilidad", "Menú digital"]) {
    await expect(page.getByRole("link", { name: moduleName, exact: true })).toBeVisible();
  }

  for (const removedModule of ["POS", "Mesas", "Cocina", "Delivery", "Reservas", "Ventas", "Configuración"]) {
    await expect(page.getByRole("link", { name: removedModule, exact: true })).toHaveCount(0);
  }
});
