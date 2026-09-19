import { expect, test, type Page, type Route } from "@playwright/test";

const productPreview = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" fill="#d96b35"/></svg>',
)}`;

const allChannels = [
  "pos_tables",
  "pos_counter",
  "pos_takeaway",
  "pos_delivery",
  "digital_tables",
  "digital_takeaway",
  "digital_delivery",
];
let contextRole = "owner";
let catalogReadFailuresRemaining = 0;
let catalogReadRequestCount = 0;
let promotionReadFailuresRemaining = 0;
let promotionReadRequestCount = 0;
let promotionWriteFailuresRemaining = 0;

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function mockRestaurantApi(page: Page) {
  let nextCategoryId = 12;
  let nextGroupId = 31;
  let nextModifierId = 102;
  let nextVariantId = 50;
  const catalog = {
    branch: {
      id: 1,
      business_id: 1,
      slug: "matriz",
      name: "Sucursal principal",
      opening_hours: {},
      accepted_payment_methods: ["cash", "yape"],
      delivery_enabled: true,
      takeaway_enabled: true,
      delivery_fee: 0,
      active: true,
    },
    categories: [
      { id: 10, name: "Pizzas", color: "#2aa775", sort_order: 0, active: true },
      { id: 11, name: "Bebidas", color: "#1f7a67", sort_order: 1, active: true },
    ],
    products: [
      {
        id: 20,
        category_id: 10,
        sku: "PIZZA-CLASICA",
        name: "Pizza clásica",
        description: "Masa artesanal y mozzarella",
        price: 24,
        image_url: null,
        service_channels: allChannels,
        product_type: "standard",
        available: true,
        track_stock: false,
        preparation_station: "kitchen",
        sort_order: 0,
        variants: [],
        modifier_groups: [],
        recipe: [],
        combo_components: [],
      },
      {
        id: 22,
        category_id: 10,
        sku: "PIZZA-VEGETARIANA",
        name: "Pizza vegetariana",
        description: "Vegetales frescos y mozzarella",
        price: 20,
        image_url: null,
        service_channels: allChannels,
        product_type: "standard",
        available: true,
        track_stock: false,
        preparation_station: "kitchen",
        sort_order: 1,
        variants: [{ id: 42, name: "Mediana", price_delta: 10, active: true }],
        modifier_groups: [],
        recipe: [],
        combo_components: [],
      },
    ],
    modifier_groups: [{
      id: 30,
      branch_id: 1,
      name: "Elige tus salsas",
      internal_label: "máximo 1",
      minimum: 1,
      maximum: 1,
      required: true,
      allow_repeats: false,
      max_per_option: null,
      sort_order: 0,
      modifiers: [
        { id: 100, name: "BBQ", price_delta: 0, active: true, sort_order: 0 },
        { id: 101, name: "Búfalo", price_delta: 1, active: true, sort_order: 1 },
      ],
    }],
    ingredients: [],
    promotions: [] as {
      id: number;
      business_id: number;
      branch_id: number;
      name: string;
      promotion_type: "product_discount" | "buy_x_pay_y";
      discount_type: "percentage" | "fixed_amount" | null;
      discount_value: number | null;
      receive_quantity: number | null;
      pay_quantity: number | null;
      target_scope: "products" | "categories";
      target_ids: number[];
      target_names: string[];
      starts_on: string | null;
      ends_on: string | null;
      weekdays: number[];
      service_channels: string[];
      active: boolean;
      sort_order: number;
      archived_at: string | null;
      version: number;
    }[],
  };

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^.*\/api\/v1/, "");

    if (request.method() === "GET" && path === "/context") {
      return json(route, {
        role: contextRole,
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
        branches: [catalog.branch],
      });
    }
    if (request.method() === "GET" && path === "/catalog") {
      catalogReadRequestCount += 1;
      if (catalogReadFailuresRemaining > 0) {
        catalogReadFailuresRemaining -= 1;
        return route.abort("connectionrefused");
      }
      return json(route, catalog);
    }
    if (request.method() === "GET" && path === "/catalog/promotions") {
      promotionReadRequestCount += 1;
      if (promotionReadFailuresRemaining > 0) {
        promotionReadFailuresRemaining -= 1;
        return route.abort("connectionrefused");
      }
      return json(route, catalog.promotions);
    }
    if (request.method() === "POST" && path === "/catalog/promotions") {
      if (promotionWriteFailuresRemaining > 0) {
        promotionWriteFailuresRemaining -= 1;
        return json(route, { detail: "Servicio temporalmente no disponible" }, 503);
      }
      const payload = request.postDataJSON();
      const targetNames = payload.target_scope === "products"
        ? catalog.products.filter((item) => payload.target_ids.includes(item.id)).map((item) => item.name)
        : catalog.categories.filter((item) => payload.target_ids.includes(item.id)).map((item) => item.name);
      const promotion = {
        id: 70,
        business_id: 1,
        branch_id: payload.branch_id,
        name: payload.name,
        promotion_type: payload.promotion_type,
        discount_type: payload.discount_type,
        discount_value: payload.discount_value,
        receive_quantity: payload.receive_quantity,
        pay_quantity: payload.pay_quantity,
        target_scope: payload.target_scope,
        target_ids: payload.target_ids,
        target_names: targetNames,
        starts_on: payload.starts_on,
        ends_on: payload.ends_on,
        weekdays: payload.weekdays,
        service_channels: payload.service_channels,
        active: payload.active,
        sort_order: catalog.promotions.length,
        archived_at: null,
        version: 1,
      };
      catalog.promotions.push(promotion);
      return json(route, promotion, 201);
    }
    if (request.method() === "POST" && path === "/catalog/categories") {
      const payload = request.postDataJSON();
      const category = {
        id: nextCategoryId++,
        name: payload.name,
        color: payload.color || "#2aa775",
        sort_order: payload.sort_order ?? catalog.categories.length,
        active: true,
      };
      catalog.categories.push(category);
      return json(route, category, 201);
    }
    if (request.method() === "PUT" && path === "/catalog/categories/order") {
      const payload = request.postDataJSON();
      const position = new Map(payload.category_ids.map((id: number, index: number) => [id, index]));
      catalog.categories.sort((left, right) => {
        const leftPosition = position.get(left.id) ?? left.sort_order;
        const rightPosition = position.get(right.id) ?? right.sort_order;
        return leftPosition - rightPosition;
      });
      catalog.categories.forEach((category, index) => { category.sort_order = index; });
      return json(route, catalog.categories);
    }
    const categoryMatch = path.match(/^\/catalog\/categories\/(\d+)$/);
    if (request.method() === "PATCH" && categoryMatch) {
      const category = catalog.categories.find((item) => item.id === Number(categoryMatch[1]));
      if (!category) return json(route, { detail: "Categoría no encontrada" }, 404);
      Object.assign(category, request.postDataJSON());
      return json(route, category);
    }
    if (request.method() === "POST" && path === "/catalog/modifier-groups") {
      const payload = request.postDataJSON();
      const group = {
        id: nextGroupId++,
        branch_id: payload.branch_id,
        name: payload.name,
        internal_label: payload.internal_label || null,
        minimum: payload.minimum,
        maximum: payload.maximum,
        required: payload.minimum > 0,
        allow_repeats: payload.allow_repeats,
        max_per_option: payload.max_per_option,
        sort_order: payload.sort_order,
        modifiers: payload.modifiers.map((modifier: Record<string, unknown>, index: number) => ({
          id: nextModifierId++,
          active: true,
          sort_order: index,
          ...modifier,
        })),
      };
      catalog.modifier_groups.push(group);
      return json(route, group, 201);
    }
    const groupMatch = path.match(/^\/catalog\/modifier-groups\/(\d+)$/);
    if (request.method() === "DELETE" && groupMatch) {
      const groupId = Number(groupMatch[1]);
      const index = catalog.modifier_groups.findIndex((item) => item.id === groupId);
      if (index < 0) return json(route, { detail: "Personalización no encontrada" }, 404);
      catalog.modifier_groups.splice(index, 1);
      catalog.products.forEach((product) => {
        product.modifier_groups = product.modifier_groups.filter((group) => group.id !== groupId);
      });
      return route.fulfill({ status: 204, body: "" });
    }
    if (request.method() === "PATCH" && groupMatch) {
      const group = catalog.modifier_groups.find((item) => item.id === Number(groupMatch[1]));
      if (!group) return json(route, { detail: "Personalización no encontrada" }, 404);
      const payload = request.postDataJSON();
      Object.assign(group, payload, {
        required: payload.minimum > 0,
        modifiers: payload.modifiers.map((modifier: Record<string, unknown>, index: number) => ({
          id: modifier.id || nextModifierId++,
          active: true,
          sort_order: index,
          ...modifier,
        })),
      });
      return json(route, group);
    }
    if (request.method() === "POST" && path === "/catalog/products") {
      const payload = request.postDataJSON();
      const product = {
        id: 21,
        ...payload,
        image_url: null,
        variants: [],
        modifier_groups: [],
        recipe: [],
        combo_components: [],
      };
      catalog.products.push(product);
      return json(route, product, 201);
    }
    const productMatch = path.match(/^\/catalog\/products\/(\d+)$/);
    if (request.method() === "PATCH" && productMatch) {
      const product = catalog.products.find((item) => item.id === Number(productMatch[1]));
      if (!product) return json(route, { detail: "Producto no encontrado" }, 404);
      Object.assign(product, request.postDataJSON());
      return json(route, product);
    }
    if (request.method() === "PUT" && path === "/catalog/products/order") {
      const payload = request.postDataJSON();
      const position = new Map(payload.product_ids.map((id: number, index: number) => [id, index]));
      const categoryId = payload.category_id ?? null;
      const ordered = catalog.products
        .filter((product) => product.category_id === categoryId)
        .sort((left, right) => (position.get(left.id) ?? left.sort_order) - (position.get(right.id) ?? right.sort_order));
      ordered.forEach((product, index) => { product.sort_order = index; });
      catalog.products.sort((left, right) => left.sort_order - right.sort_order);
      return json(route, ordered);
    }
    if (request.method() === "POST" && /\/catalog\/products\/21\/variants$/.test(path)) {
      const payload = request.postDataJSON();
      const variant = { id: nextVariantId++, active: true, ...payload };
      catalog.products.find((product) => product.id === 21)?.variants.push(variant);
      return json(route, variant, 201);
    }
    const productGroupsMatch = path.match(/^\/catalog\/products\/(\d+)\/modifier-groups$/);
    if (request.method() === "PUT" && productGroupsMatch) {
      const productId = Number(productGroupsMatch[1]);
      const product = catalog.products.find((item) => item.id === productId);
      if (!product) return json(route, { detail: "Producto no encontrado" }, 404);
      const payload = request.postDataJSON();
      product.modifier_groups = catalog.modifier_groups.filter((group) => payload.group_ids.includes(group.id));
      return json(route, { product_id: productId, group_ids: payload.group_ids });
    }
    if (request.method() === "POST" && path === "/catalog/products/21/image") {
      const product = catalog.products.find((item) => item.id === 21);
      if (product) product.image_url = productPreview;
      return json(route, { product_id: 21, image_url: product?.image_url });
    }
    return json(route, { detail: `Ruta no simulada: ${request.method()} ${path}` }, 404);
  });
}

test.beforeEach(async ({ page }) => {
  contextRole = "owner";
  catalogReadFailuresRemaining = 0;
  catalogReadRequestCount = 0;
  promotionReadFailuresRemaining = 0;
  promotionReadRequestCount = 0;
  promotionWriteFailuresRemaining = 0;
  await mockRestaurantApi(page);
  await page.addInitScript(() => {
    localStorage.setItem("impulsa.authMode", "dev");
    localStorage.setItem("impulsa.businessId", "1");
    localStorage.setItem("impulsa.branchId", "1");
  });
});

test("keeps archived read failures inline and clears them after the API recovers", async ({ page }) => {
  test.setTimeout(45_000);
  promotionReadFailuresRemaining = 5;
  await page.goto("/catalogo");

  await page.getByRole("tab", { name: "Promociones" }).click();

  await expect(page.getByRole("heading", { name: "Crea promociones atractivas para tus clientes" })).toBeVisible();
  expect(promotionReadRequestCount).toBe(0);
  await page.getByRole("button", { name: "Ver archivadas" }).click();
  await expect(page.getByRole("alert")).toContainText("No se pudieron cargar las archivadas", { timeout: 10_000 });
  await expect.poll(() => promotionReadRequestCount).toBe(5);
  await expect(page.getByText("No pudimos conectar con el servidor del POS", { exact: false })).toHaveCount(0);

  promotionReadFailuresRemaining = 0;
  await page.getByRole("button", { name: "Reintentar" }).click();
  await expect(page.getByRole("heading", { name: "No tienes promociones archivadas" })).toBeVisible();
  await expect.poll(() => promotionReadRequestCount).toBe(6);
  await expect(page.getByText("No pudimos conectar con el servidor del POS", { exact: false })).toHaveCount(0);
});

test("keeps the catalog editor hidden from cashiers", async ({ page }) => {
  contextRole = "cashier";
  await page.goto("/catalogo");

  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator(".sidebar nav").getByRole("link", { name: "Menú", exact: true })).toHaveCount(0);
});

test("keeps the complete navigation visible on compact desktop screens", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 850 });
  await page.goto("/catalogo");

  await expect(page.locator(".sidebar nav").getByRole("link", { name: "Menú", exact: true }).locator("span")).toBeVisible();
  await expect(page.locator(".sidebar").getByRole("link", { name: /Menú digital/ }).locator("span")).toBeVisible();
  await expect(page.locator(".sidebar")).toHaveCSS("width", "240px");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});

test("creates a menu product with image, variants and service channels", async ({ page }) => {
  await page.goto("/catalogo");
  await expect(page.getByRole("heading", { name: "Menú" })).toBeVisible();
  await expect(page.getByText("Pizza clásica", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Nuevo producto" }).click();
  await page.getByLabel("Nombre del producto").fill("Pizza familiar");
  await page.locator(".product-form-scroll select").first().selectOption({ label: "Pizzas" });
  await page.getByLabel("Descripción").fill("Mozzarella, tomate y orégano");
  const uploadImage = await page.screenshot({ type: "png" });
  await page.locator("input[type=file]").setInputFiles({
    name: "pizza.png",
    mimeType: "image/png",
    buffer: uploadImage,
  });
  await expect(page.getByRole("heading", { name: "Ajusta el encuadre" })).toBeVisible();
  await page.getByAltText("Vista para recortar").waitFor();
  await page.waitForFunction(() => {
    const image = document.querySelector<HTMLImageElement>('img[alt="Vista para recortar"]');
    return Boolean(image?.complete && image.naturalWidth > 0);
  });
  await page.getByRole("button", { name: "Usar imagen" }).click();
  await expect(page.getByAltText("Vista del producto")).toBeVisible();

  await page.locator(".money-input input").first().fill("18");
  await page.getByRole("button", { name: "Agregar otro precio" }).click();
  await page.getByLabel("Nombre de variante").nth(0).fill("Personal");
  await page.getByLabel("Nombre de variante").nth(1).fill("Familiar");
  await page.locator(".variant-price-row .money-input input").nth(0).fill("18");
  await page.locator(".variant-price-row .money-input input").nth(1).fill("42");
  await page.getByRole("button", { name: "Más opciones" }).click();
  await expect(page.getByText("Opciones de servicio")).toBeVisible();

  await page.getByRole("button", { name: "Agregar producto" }).click();
  await expect(page.getByText("Producto agregado al menú.")).toBeVisible();
  await expect(page.getByText("Pizza familiar", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});

test("creates and reorders categories without exposing transport errors", async ({ page }) => {
  await page.goto("/catalogo");

  await page.getByRole("button", { name: "Nueva categoría" }).click();
  await page.getByLabel("Nombre de categoría").fill("Postres");
  await page.getByRole("button", { name: "Agregar categoría" }).click();

  await expect(page.getByText("Categoría agregada.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Postres" })).toBeVisible();
  await expect(page.getByText("Not Found", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Categorías archivadas", { exact: true })).toHaveCount(0);
  await expect(page.locator(".menu-catalog-board")).toHaveCount(1);
  await expect(page.locator(".menu-category-section h2")).toHaveText(["Pizzas", "Bebidas", "Postres"]);

  await page.getByRole("button", { name: "Nuevo producto" }).click();
  await expect(page.locator(".product-form-scroll select").first().getByRole("option", { name: "Postres" })).toHaveCount(1);
  await page.getByRole("button", { name: "Cerrar editor" }).click();

  await page.getByRole("button", { name: "Mover categoría Postres" }).dragTo(
    page.getByRole("button", { name: "Mover categoría Bebidas" }),
  );

  await expect(page.getByText("Orden actualizado.")).toBeVisible();
  await expect(page.locator(".menu-category-section h2")).toHaveText(["Pizzas", "Postres", "Bebidas"]);
});

test("reorders products inside a category with the drag handles", async ({ page }) => {
  await page.goto("/catalogo");

  const pizzaSection = page.locator(".menu-category-section").filter({
    has: page.getByRole("heading", { name: "Pizzas" }),
  });
  await expect(pizzaSection.locator(".menu-product-main strong")).toHaveText(["Pizza clásica", "Pizza vegetariana"]);

  await page.getByRole("button", { name: "Mover Pizza vegetariana" }).dragTo(
    page.getByRole("button", { name: "Mover Pizza clásica" }),
    { targetPosition: { x: 12, y: 2 } },
  );

  await expect(page.getByText("Orden de productos actualizado.")).toBeVisible();
  await expect(pizzaSection.locator(".menu-product-main strong")).toHaveText(["Pizza vegetariana", "Pizza clásica"]);
});

test("creates and reopens a complete customization", async ({ page }) => {
  await page.goto("/catalogo");
  await page.getByRole("tab", { name: "Personalizaciones" }).click();
  await page.getByRole("button", { name: "Nueva personalización" }).click();

  await expect(page.getByRole("heading", { name: "Agrega una personalización" })).toBeVisible();
  await page.getByLabel("Nombre de la personalización").fill("Elige tu bebida");
  await page.getByLabel("Etiqueta distintiva").fill("Bebida del combo");
  await page.getByLabel("Nombre de opción 1").fill("Inca Kola");
  await page.getByLabel("Nombre de opción 2").fill("Coca-Cola");
  const freeOptionPrice = page.getByLabel("Precio adicional de Inca Kola");
  await expect(freeOptionPrice).toHaveValue("");
  await expect(freeOptionPrice).toHaveAttribute("placeholder", "0");
  await freeOptionPrice.click();
  await page.keyboard.type("5");
  await expect(freeOptionPrice).toHaveValue("5");
  await freeOptionPrice.fill("");
  await page.getByLabel("Precio adicional de Coca-Cola").fill("2.5");
  const minimumSelections = page.getByLabel("Selecciones mínimas");
  await expect(minimumSelections).toHaveValue("");
  await expect(minimumSelections).toHaveAttribute("placeholder", "0");
  await minimumSelections.click();
  await page.keyboard.type("1");
  await expect(minimumSelections).toHaveValue("1");
  await page.getByLabel("Selecciones máximas, vacío significa sin límite").fill("1");
  const repeatSwitch = page.getByRole("switch", { name: "Permitir repetición de opciones" });
  await expect(repeatSwitch).not.toBeChecked();
  await expect(page.getByLabel("Máximo de repeticiones por opción, vacío significa sin límite")).toBeHidden();

  const previewToggle = page.getByRole("button", { name: "Vista previa" });
  if (await previewToggle.isVisible()) await previewToggle.click();
  const preview = page.locator(".customization-live-preview");
  await expect(preview.getByText("Elige tu bebida", { exact: true })).toBeVisible();
  await expect(preview.getByText("Selecciona 1", { exact: true })).toBeVisible();
  const requiredBadge = preview.getByText("obligatorio", { exact: true });
  await expect(requiredBadge).toHaveAttribute("data-state", "pending");
  await expect(preview.getByText(/S\/\s*2[.,]50/)).toBeVisible();
  await preview.getByRole("radio", { name: "Inca Kola" }).check();
  await expect(requiredBadge).toHaveAttribute("data-state", "complete");
  await preview.getByRole("radio", { name: "Coca-Cola" }).check();
  await expect(preview.getByRole("radio", { name: "Inca Kola" })).not.toBeChecked();
  if (process.env.IMPECCABLE_REVIEW === "1") {
    await page.screenshot({ path: `.impeccable/review/customization-single-${test.info().project.name}.png` });
  }

  const hidePreview = page.getByRole("button", { name: "Ocultar vista" });
  if (await hidePreview.isVisible()) await hidePreview.click();
  await page.locator(".customization-repeat-track").click();
  await expect(repeatSwitch).toBeChecked();
  await page.getByLabel("Selecciones máximas, vacío significa sin límite").fill("3");
  await page.getByLabel("Máximo de repeticiones por opción, vacío significa sin límite").fill("2");
  if (process.env.IMPECCABLE_REVIEW === "1") {
    await page.screenshot({ path: `.impeccable/review/customization-repeat-form-${test.info().project.name}.png` });
  }

  if (await previewToggle.isVisible()) await previewToggle.click();
  const addCocaCola = preview.getByRole("button", { name: "Agregar una unidad de Coca-Cola" });
  await expect(preview.getByLabel("Cantidad de Coca-Cola")).toHaveText("1");
  await addCocaCola.click();
  await expect(preview.getByLabel("Cantidad de Coca-Cola")).toHaveText("2");
  await expect(addCocaCola).toBeDisabled();
  if (process.env.IMPECCABLE_REVIEW === "1") {
    await page.screenshot({ path: `.impeccable/review/customization-repeat-${test.info().project.name}.png` });
  }
  if (await hidePreview.isVisible()) await hidePreview.click();
  await page.getByRole("button", { name: "Agregar personalización" }).click();

  await expect(page.getByText("Personalización creada.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Elige tu bebida", exact: true })).toBeVisible();
  await expect(page.getByText("Bebida del combo", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Opciones de Elige tu bebida" }).click();
  await page.getByRole("menuitem", { name: "Editar" }).click();
  await expect(page.getByLabel("Nombre de la personalización")).toHaveValue("Elige tu bebida");
  await expect(page.getByLabel("Etiqueta distintiva")).toHaveValue("Bebida del combo");
  await expect(page.getByLabel("Nombre de opción 2")).toHaveValue("Coca-Cola");
  await expect(page.getByLabel("Precio adicional de Inca Kola")).toHaveValue("");
  if (await previewToggle.isVisible()) await previewToggle.click();
  await preview.getByRole("button", { name: "Agregar una unidad de Inca Kola" }).click();
  if (await hidePreview.isVisible()) await hidePreview.click();
  await expect(page.locator(".customization-drawer-footer > span")).toHaveText("Sin cambios pendientes");
  await page.getByRole("button", { name: "Cerrar editor" }).click();

});

test("associates, previews, reopens, removes and deletes customizations", async ({ page }) => {
  await page.goto("/catalogo");
  await page.getByRole("tab", { name: "Personalizaciones" }).click();

  await expect(page.locator(".customization-board")).toBeVisible();
  await expect(page.getByText("Sin usar (1)", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Buscar" }).click();
  await page.getByLabel("Buscar personalización").fill("bufalo");
  await expect(page.getByRole("button", { name: "Elige tus salsas", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cerrar búsqueda" }).click();

  const groupMenuTrigger = page.getByRole("button", { name: "Opciones de Elige tus salsas", exact: true });
  await groupMenuTrigger.click();
  await expect(page.getByRole("menuitem", { name: "Editar" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Duplicar" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menuitem", { name: "Editar" })).toHaveCount(0);
  await expect(groupMenuTrigger).toBeFocused();
  await groupMenuTrigger.click();
  await page.getByRole("menuitem", { name: "Duplicar" }).click();
  await expect(page.getByText('Se duplicó "Elige tus salsas".')).toBeVisible();
  await expect(page.getByRole("button", { name: "Elige tus salsas copia", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Sin usar/ }).click();
  await expect(page.locator(".customization-table-row")).toHaveCount(2);
  if (process.env.IMPECCABLE_REVIEW === "1") {
    await page.screenshot({ path: `.impeccable/review/customization-table-${test.info().project.name}.png` });
  }

  await page.getByRole("tab", { name: "Productos" }).click();
  const pizzaClasica = page.locator(".menu-product-main").filter({ hasText: "Pizza clásica" });
  await pizzaClasica.click();
  await page.getByRole("button", { name: "Agregar personalización" }).click();
  const productGroupSearch = page.getByLabel("Buscar personalización para agregar");
  await expect(productGroupSearch).toBeFocused();
  await productGroupSearch.fill("salsas");
  await page.getByRole("option", { name: /Elige tus salsas 2 opciones máximo 1/ }).click();
  await expect(page.locator(".product-selected-customization").filter({ hasText: "Elige tus salsas" })).toBeVisible();

  const productPreview = page.locator(".product-live-preview");
  const previewToggle = page.getByRole("button", { name: "Vista previa" });
  if (await previewToggle.isVisible()) await previewToggle.click();
  await expect(productPreview.getByText("Elige tus salsas", { exact: true })).toBeVisible();
  const dirtyBeforePreview = await page.locator(".product-drawer-footer > span").textContent();
  await productPreview.getByRole("radio", { name: "BBQ" }).check();
  await expect(page.locator(".product-drawer-footer > span")).toHaveText(dirtyBeforePreview || "Cambios sin guardar");
  if (process.env.IMPECCABLE_REVIEW === "1") {
    await page.screenshot({ path: `.impeccable/review/product-customizations-${test.info().project.name}.png` });
  }
  const hidePreview = page.getByRole("button", { name: "Ocultar vista" });
  if (await hidePreview.isVisible()) await hidePreview.click();

  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByText("Producto actualizado.")).toBeVisible();
  await pizzaClasica.click();
  await expect(page.locator(".product-selected-customization").filter({ hasText: "Elige tus salsas" })).toBeVisible();
  if (await previewToggle.isVisible()) await previewToggle.click();
  await expect(productPreview.getByRole("radio", { name: "BBQ" })).not.toBeChecked();
  if (await hidePreview.isVisible()) await hidePreview.click();

  await page.getByRole("button", { name: "Remover Elige tus salsas" }).click();
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await pizzaClasica.click();
  await expect(page.locator(".product-selected-customization").filter({ hasText: "Elige tus salsas" })).toHaveCount(0);
  await page.getByRole("button", { name: "Cerrar editor" }).click();

  await page.getByRole("tab", { name: "Personalizaciones" }).click();
  await page.getByRole("button", { name: "Opciones de Elige tus salsas", exact: true }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("menuitem", { name: "Borrar" }).click();
  await expect(page.getByText("Personalización borrada.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Elige tus salsas", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});

test("creates an operational product promotion", async ({ page }) => {
  await page.goto("/catalogo");
  await page.getByRole("tab", { name: "Promociones" }).click();
  await expect(page.getByRole("heading", { name: "Crea promociones atractivas para tus clientes" })).toBeVisible();
  await expect(page.getByText("Llama la atención de tus clientes con promociones y aumenta tus ventas.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Nueva promoción" })).toHaveCount(1);

  await page.getByRole("button", { name: "Nueva promoción" }).click();
  await page.getByRole("menuitem", { name: /Descuento en productos/ }).click();
  await page.getByLabel("Nombre de promoción").fill("Martes de pizza");
  const discountValue = page.getByLabel("Valor del descuento");
  await expect(discountValue).toHaveValue("");
  await expect(discountValue).toHaveAttribute("placeholder", "0");
  await discountValue.click();
  await page.keyboard.type("10");
  await expect(discountValue).toHaveValue("10");

  const scopeSelector = page.getByRole("button", { name: "Se aplica a: Productos específicos" });
  await scopeSelector.click();
  const scopeOptions = page.getByRole("listbox", { name: "Opciones de aplicación" });
  await expect(scopeOptions.getByRole("option", { name: "Productos específicos" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(scopeOptions.getByRole("option", { name: "Categorías específicas" })).toBeFocused();
  await page.keyboard.press("Enter");
  const categoryScopeSelector = page.getByRole("button", { name: "Se aplica a: Categorías específicas" });
  await expect(categoryScopeSelector).toBeFocused();
  await categoryScopeSelector.click();
  await scopeOptions.getByRole("option", { name: "Productos específicos" }).click();

  await page.getByLabel("Agregar producto").selectOption({ label: "Pizza vegetariana · Desde S/ 20.00" });
  const selectedPromotionProduct = page.getByLabel("Selección actual").getByRole("article").filter({ hasText: "Pizza vegetariana" });
  await expect(selectedPromotionProduct).toContainText("Desde S/ 20.00");

  const previewToggle = page.getByRole("button", { name: "Vista previa" });
  const mobilePreview = await previewToggle.isVisible();
  if (mobilePreview) await previewToggle.click();
  const promotionPreview = page.getByLabel("Vista previa de la promoción");
  await expect(promotionPreview.getByRole("heading", { name: "Vista previa" })).toBeVisible();
  await expect(promotionPreview.getByRole("heading", { name: "Productos con descuento" })).toBeVisible();
  const previewProduct = promotionPreview.getByRole("article", { name: "Vista previa de Pizza vegetariana" });
  await expect(previewProduct).toContainText("Pizza vegetariana");
  await expect(previewProduct).toContainText("Desde");
  await expect(previewProduct.locator(".promotion-preview-badge")).toHaveText("-10%");
  await expect(previewProduct.locator("del")).toContainText("S/");
  if (mobilePreview) await previewToggle.click();

  await page.getByLabel("Activación").selectOption("weekdays");
  await page.getByRole("button", { name: "Martes" }).click();
  promotionWriteFailuresRemaining = 1;
  await page.getByRole("button", { name: "Agregar promoción" }).click();

  await expect(page.getByRole("alert")).toContainText("Servicio temporalmente no disponible");
  await expect(page.getByLabel("Nombre de promoción")).toHaveValue("Martes de pizza");
  await expect(page.getByRole("button", { name: "Reintentar guardado" })).toBeEnabled();

  catalogReadFailuresRemaining = 5;
  catalogReadRequestCount = 0;
  await page.getByRole("button", { name: "Reintentar guardado" }).click();
  await expect(page.getByText("Promoción creada.")).toBeVisible();
  await expect(page.locator(".promotion-card-main").filter({ hasText: "Martes de pizza" })).toBeVisible();
  await expect.poll(() => catalogReadRequestCount, { timeout: 10_000 }).toBe(5);
  await expect(page.getByText("No pudimos conectar con el servidor del POS", { exact: false })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});
