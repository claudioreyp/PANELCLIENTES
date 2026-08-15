import { expect, test } from "@playwright/test";

test("shows the restaurant login without exposing fixed credentials", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Bienvenido de vuelta" })).toBeVisible();
  await expect(page.getByLabel("Usuario")).toHaveValue("");
  await expect(page.getByLabel("Contraseña")).toHaveValue("");
});
