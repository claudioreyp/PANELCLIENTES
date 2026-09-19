import { expect, test, type Page, type Route } from "@playwright/test";

const productPreview = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#d96837"/><circle cx="16" cy="16" r="10" fill="#f2c25c"/></svg>',
)}`;
const uploadedProductImage = "/api/v1/public/catalog/products/1/image?v=pepperoni";

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function mockAvailabilityApi(page: Page) {
  const branch = {
    id: 1,
    business_id: 1,
    slug: "principal",
    name: "Sucursal principal",
    opening_hours: {},
    accepted_payment_methods: ["cash", "card"],
    delivery_enabled: true,
    takeaway_enabled: true,
    delivery_fee: 0,
    active: true,
  };
  const categories = [
    { id: 10, name: "Pizzas", color: "#2f8b5a", sort_order: 0, active: true },
    { id: 11, name: "Bebidas", color: "#46758b", sort_order: 1, active: true },
  ];
  const products = Array.from({ length: 12 }, (_, index) => {
    const id = index + 1;
    return {
      id,
      category_id: id % 2 === 0 ? 11 : 10,
      sku: `SKU-${String(id).padStart(2, "0")}`,
      name: id === 1 ? "Pizza Peperoni" : id === 2 ? "Chicha morada" : `Producto ${id}`,
      description: null,
      price: 15 + id,
      image_url: id === 1 ? uploadedProductImage : id === 2 ? productPreview : null,
      service_channels: ["pos_tables", "pos_counter", "digital_tables"],
      product_type: "standard",
      available: id !== 2,
      track_stock: false,
      preparation_station: "kitchen",
      sort_order: index,
      variants: [],
      modifier_groups: [],
      recipe: [],
      combo_components: [],
    };
  });
  const catalog = { branch, categories, products, modifier_groups: [], ingredients: [], promotions: [] };

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^.*\/api\/v1/, "");
    if (request.method() === "GET" && path === "/public/catalog/products/1/image") {
      return route.fulfill({
        status: 200,
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#d96837"/></svg>',
      });
    }
    if (request.method() === "GET" && path === "/context") {
      return json(route, {
        role: "owner",
        business: {
          id: 1,
          slug: "pizza-house",
          name: "Pizza House",
          status: "active",
          plan: "pro",
          currency: "PEN",
          timezone: "America/Lima",
          modules: { pos: true, cash: true, inventory: true },
        },
        branches: [branch],
      });
    }
    if (request.method() === "GET" && path === "/catalog") return json(route, catalog);
    const availabilityMatch = path.match(/^\/catalog\/products\/(\d+)\/availability$/);
    if (request.method() === "PATCH" && availabilityMatch) {
      const product = products.find((item) => item.id === Number(availabilityMatch[1]));
      const payload = request.postDataJSON() as { available: boolean };
      if (product) product.available = payload.available;
      return json(route, { id: product?.id, available: product?.available });
    }
    return json(route, { detail: `Ruta no simulada: ${request.method()} ${path}` }, 404);
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("impulsa.authMode", "dev");
    localStorage.setItem("impulsa.businessId", "1");
    localStorage.setItem("impulsa.branchId", "1");
  });
});

test("availability matches the reference flow without responsive overflow", async ({ page }, testInfo) => {
  await mockAvailabilityApi(page);
  await page.goto("/disponibilidad");

  await expect(page.getByRole("heading", { name: "Disponibilidad" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Todos" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "No disponibles (1)" })).toBeVisible();
  await expect(page.getByText("1 - 10 de 12 items")).toBeVisible();
  await expect(page.getByText("Pizza Peperoni")).toBeVisible();
  await expect(page.getByText("Chicha morada")).toBeVisible();
  const pepperoniImage = page.getByRole("row").filter({ hasText: "Pizza Peperoni" }).locator(".availability-product-image img");
  await expect(pepperoniImage).toHaveAttribute(
    "src",
    "http://127.0.0.1:8000/api/v1/public/catalog/products/1/image?v=pepperoni",
  );
  await expect.poll(() => pepperoniImage.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);

  const card = page.locator(".availability-card");
  const tableWrap = page.locator(".availability-table-wrap");
  await expect(card).toBeVisible();
  const viewport = page.viewportSize();
  const box = await card.boundingBox();
  expect(box).not.toBeNull();
  expect((box?.x || 0) + (box?.width || 0)).toBeLessThanOrEqual((viewport?.width || 0) + 1);
  expect(await tableWrap.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);

  if (process.env.IMPECCABLE_REVIEW === "1") {
    await page.screenshot({ path: `.impeccable/review/availability-${testInfo.project.name}.png`, fullPage: true });
  }

  await page.getByRole("button", { name: "No disponibles (1)" }).click();
  await expect(page.getByText("Chicha morada")).toBeVisible();
  await expect(page.getByText("Pizza Peperoni")).toHaveCount(0);
  await expect(page.getByText("1 - 1 de 1 items")).toBeVisible();

  await page.getByRole("button", { name: "Todos" }).click();
  await page.getByRole("button", { name: "Buscar" }).click();
  const search = page.getByRole("textbox", { name: "Buscar productos" });
  await expect(search).toBeFocused();
  await search.fill("bebidas");
  await expect(page.getByText("1 - 6 de 6 items")).toBeVisible();
  await search.press("Escape");
  await expect(search).toHaveCount(0);

  const patch = page.waitForRequest((request) => request.method() === "PATCH" && request.url().includes("/catalog/products/1/availability"));
  await page.getByRole("switch", { name: "Desactivar Pizza Peperoni" }).click();
  const request = await patch;
  expect(request.postDataJSON()).toEqual({ available: false });
  await expect(page.getByRole("switch", { name: "Activar Pizza Peperoni" })).toHaveAttribute("aria-checked", "false");
  await expect(page.getByRole("button", { name: "No disponibles (2)" })).toBeVisible();
});
