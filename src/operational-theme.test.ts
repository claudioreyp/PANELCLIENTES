// @vitest-environment node
import { readFileSync } from "node:fs";
import { chromium, type Browser, type Page } from "@playwright/test";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const baseCss = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const themeCss = readFileSync(new URL("./operational-theme.css", import.meta.url), "utf8");
const historyCss = readFileSync(new URL("./components/table-history.css", import.meta.url), "utf8");
const font = readFileSync(new URL("../public/fonts/inter-latin.woff2", import.meta.url)).toString("base64");
const icon = '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24"><circle cx="10" cy="10" r="6" /></svg>';

let browser: Browser;
let page: Page;

beforeAll(async () => { browser = await chromium.launch({ headless: true }); });
beforeEach(async () => {
  page = await browser.newPage();
  await page.route("**/*", (route) => route.abort());
});
afterEach(async () => { await page?.close(); });
afterAll(async () => { await browser?.close(); });

async function renderFixture(content: string, width: number) {
  await page.setViewportSize({ width, height: 1000 });
  await page.setContent(`<!doctype html><html><head><style>${baseCss}</style><style>${themeCss}</style><style>${historyCss}</style>
    <style>@font-face { font-family: Inter; font-weight: 400 700; src: url(data:font/woff2;base64,${font}) format('woff2'); }</style>
    </head><body class="pos-operational">${content}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
}

describe("table cancellation layer", () => {
  it.each([1280, 820, 390])("keeps cancellation clickable above table overlays at %ipx", async (width) => {
    await renderFixture(`<div class="table-order-backdrop"><section class="table-order-dialog">Cuenta de mesa</section></div>
      <div class="table-empty-warning-backdrop">Cuenta sin productos</div>
      <div class="modal-backdrop"><section class="modal-card order-cancel-modal"><header><h2>Cancelar pedido</h2></header><div class="modal-content">
      <label>Motivo<textarea id="reason"></textarea></label><button type="button" id="confirm">Confirmar cancelacion</button>
      </div></section></div>`, width);
    await page.locator("#reason").click();
    expect(await page.locator("#reason").evaluate((input) => input === document.activeElement)).toBe(true);
    await page.locator("#confirm").click();
    expect(await page.locator("#confirm").evaluate((button) => button === document.activeElement)).toBe(true);
  });
});

describe("operational table toolbar layout", () => {
  it.each([1440, 1024, 768, 390, 320])("wraps long zones and actions without page overflow at %ipx", async (width) => {
    const names = ["Sala principal", "Terraza cubierta para celebraciones y reuniones familiares", "Zona".repeat(35), "Segundo piso"];
    await renderFixture(`<div class="app-shell"><aside class="sidebar"></aside><div class="workspace"><main class="main-content"><section class="tables-workspace">
      <section class="tables-summary-strip">${Array.from({ length: 5 }, () => '<div>4 mesas disponibles</div>').join("")}</section>
      <section class="tables-zone-panel"><header class="tables-workspace-toolbar">
        <div class="table-area-tabs" role="tablist">${names.map((name) => `<button type="button" role="tab">${name}</button>`).join("")}</div>
        <div class="tables-workspace-actions">${["Terminar movimiento", "Editar sala", "Nueva zona"].map((name) => `<button class="button button-secondary">${icon}${name}</button>`).join("")}</div>
      </header><div class="tables-operational-floor"><div class="tables-floor-canvas" style="width: 1600px; height: 540px"></div></div></section>
      </section></main></div></div>`, width);

    const metrics = await page.evaluate(() => {
      const toolbar = document.querySelector(".tables-workspace-toolbar")!.getBoundingClientRect();
      const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(".tables-workspace-toolbar button"));
      return {
        pageWidth: document.documentElement.scrollWidth,
        viewport: window.innerWidth,
        buttons: buttons.map((button) => {
          const box = button.getBoundingClientRect();
          return {
            name: button.textContent,
            contained: box.left >= toolbar.left && box.right <= toolbar.right && box.bottom <= toolbar.bottom,
            clipped: button.scrollWidth > button.clientWidth + 1 || button.scrollHeight > button.clientHeight + 1,
            height: box.height,
          };
        }),
      };
    });
    expect(metrics.pageWidth).toBeLessThanOrEqual(metrics.viewport);
    expect(metrics.buttons).toHaveLength(7);
    for (const button of metrics.buttons) {
      expect(button.contained, button.name ?? "button").toBe(true);
      expect(button.clipped, button.name ?? "button").toBe(false);
      if (width <= 900) expect(button.height).toBeGreaterThanOrEqual(44);
    }
  });
});

describe("operational input adornments", () => {
  it.each([1440, 768, 390])("reserves currency, percent, units and search space at %ipx", async (width) => {
    const prefixes = [
      ["settings-money-input", "S/"],
      ["money-input", "S/"],
      ["promotion-number-input", "%"],
      ["settings-input-icon", icon],
      ["search-field", icon],
      ["search-field orders-search", icon],
      ["availability-search-field", icon],
    ];
    await renderFixture(`<main style="max-width: 500px; padding: 20px; display: grid; gap: 16px">
      ${prefixes.map(([className, adornment], index) => `<label>Campo ${index}<div class="${className}" data-prefix>${adornment === icon ? icon : className === "promotion-number-input" ? `<b>${adornment}</b>` : `<span>${adornment}</span>`}<input type="${index < 3 ? "number" : "text"}" value="123.45" /></div></label>`).join("")}
      <label>Minutos<div class="settings-unit-input"><input id="minutes" type="number" value="15" min="1" /><span>min</span></div></label>
      <label>Direccion<div class="settings-place-field"><div class="settings-input-icon">${icon}<input id="address" role="combobox" aria-expanded="true" aria-controls="places" autocomplete="off" value="Direccion de prueba" /></div><div id="places" class="settings-place-suggestions" role="listbox"><button role="option">Direccion de prueba</button></div></div></label>
      <label class="new-order-select">Tipo de pedido<select><option>Para comer aqui</option></select>${icon}</label>
      <div class="customization-search-field">${icon}<input value="Busqueda" /><button aria-label="Limpiar">x</button></div>
      <div class="product-group-search">${icon}<input value="Busqueda" /></div>
      <label>Caja<div class="cash-prefix-input"><span>S/</span><input type="number" value="10" /></div></label>
      </main>`, width);

    const metrics = await page.evaluate(() => {
      const prefixes = Array.from(document.querySelectorAll("[data-prefix]")).map((wrapper) => {
        const input = wrapper.querySelector("input")!;
        const adornment = wrapper.querySelector("span, b, svg")!;
        const style = getComputedStyle(input);
        return {
          name: wrapper.className,
          gap: input.getBoundingClientRect().left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft) - adornment.getBoundingClientRect().right,
        };
      });
      const unit = document.querySelector<HTMLInputElement>("#minutes")!;
      const unitStyle = getComputedStyle(unit);
      const unitLabel = unit.nextElementSibling!.getBoundingClientRect();
      return {
        prefixes,
        unitGap: unitLabel.left - (unit.getBoundingClientRect().right - parseFloat(unitStyle.borderRightWidth) - parseFloat(unitStyle.paddingRight)),
        appearance: unitStyle.appearance,
        spinnerAppearance: getComputedStyle(unit, "::-webkit-inner-spin-button").appearance,
        compositeSearchPadding: Array.from(document.querySelectorAll(".customization-search-field input, .product-group-search input")).map((input) => getComputedStyle(input).paddingLeft),
        selectPadding: getComputedStyle(document.querySelector(".new-order-select select")!).paddingRight,
        pageWidth: document.documentElement.scrollWidth,
      };
    });
    for (const prefix of metrics.prefixes) expect(prefix.gap, prefix.name).toBeGreaterThanOrEqual(6);
    expect(metrics.unitGap).toBeGreaterThanOrEqual(6);
    expect(metrics.appearance).not.toBe("none");
    expect(metrics.spinnerAppearance).not.toBe("none");
    expect(metrics.compositeSearchPadding).toEqual(["0px", "0px"]);
    expect(metrics.selectPadding).toBe("38px");
    expect(metrics.pageWidth).toBeLessThanOrEqual(width);

    await page.locator("#minutes").focus();
    await page.locator("#minutes").press("ArrowUp");
    expect(await page.locator("#minutes").inputValue()).toBe("16");
    const addressIcon = await page.locator(".settings-place-field svg").boundingBox();
    await page.mouse.click(addressIcon!.x + 8, addressIcon!.y + 8);
    expect(await page.locator("#address").evaluate((input) => ({
      focused: input === document.activeElement,
      outline: getComputedStyle(input).outlineWidth,
    }))).toMatchObject({ focused: true, outline: "2px" });
    expect(await page.locator("#address").evaluate((input) => getComputedStyle(input).boxShadow)).not.toBe("none");
    expect(await page.locator("#places").isVisible()).toBe(true);
    expect(await page.locator("#address").getAttribute("autocomplete")).toBe("off");
  });
});
