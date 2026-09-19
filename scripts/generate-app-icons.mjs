import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

// Uses the installed Playwright/Chromium, with no server, app, or network access.
// Run: node scripts/generate-app-icons.mjs [--check]
const checkOnly = process.argv.slice(2).includes("--check");
assert(process.argv.slice(2).every((arg) => arg === "--check"), "Only --check is supported");
const iconsDirectory = new URL("../public/icons/", import.meta.url);
const source = await readFile(new URL("icon.svg", iconsDirectory), "utf8");
const variants = [
  { file: "icon-192.png", size: 192 },
  { file: "icon-512.png", size: 512 },
  { file: "icon-maskable-512.png", size: 512, maskable: true },
  { file: "apple-touch-icon.png", size: 180 },
];

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ offline: true, serviceWorkers: "block" });
  await context.route("**/*", (route) => route.abort());
  const page = await context.newPage();
  const generated = [];
  for (const variant of variants) {
    const encoded = await page.evaluate(async ({ svgSource, size, maskable }) => {
      const document = new DOMParser().parseFromString(svgSource, "image/svg+xml");
      if (document.querySelector("parsererror")) throw new Error("Invalid source SVG");
      const svg = document.documentElement;
      svg.setAttribute("width", String(size));
      svg.setAttribute("height", String(size));
      const mark = document.getElementById("store-mark");
      if (!mark) throw new Error("Source SVG is missing store-mark");
      // The entire mark, including strokes, stays inside the 40%-radius safe circle.
      if (maskable) mark.setAttribute("transform", "translate(6.4 6.4) scale(0.8)");
      const image = new Image();
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
      await image.decode();
      const canvas = globalThis.document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas rendering is unavailable");
      ctx.drawImage(image, 0, 0, size, size);
      const pixels = ctx.getImageData(0, 0, size, size).data;
      let greenPixels = 0;
      for (let offset = 0; offset < pixels.length; offset += 4) {
        if (pixels[offset + 3] !== 255) throw new Error("Icons must be fully opaque");
        if (pixels[offset] === 37 && pixels[offset + 1] === 130 && pixels[offset + 2] === 79) greenPixels++;
        if (maskable && pixels[offset] < 250) {
          const x = (offset / 4) % size + 0.5 - size / 2;
          const y = Math.floor(offset / 4 / size) + 0.5 - size / 2;
          if (Math.hypot(x, y) > size * 0.4) throw new Error("Mark exceeds the maskable safe circle");
        }
      }
      if (greenPixels < size * size * 0.05) throw new Error("Brand mark is missing or has the wrong color");
      return canvas.toDataURL("image/png").split(",")[1];
    }, { svgSource: source, ...variant });
    generated.push({ ...variant, png: Buffer.from(encoded, "base64") });
  }

  for (const { file, size, png } of generated) {
    const target = new URL(file, iconsDirectory);
    if (checkOnly) {
      assert(png.equals(await readFile(target)), `${file} is stale; regenerate with the installed Playwright Chromium`);
    } else {
      await writeFile(target, png);
    }
    console.log(`${checkOnly ? "Verified" : "Generated"} ${fileURLToPath(target)} (${size}x${size})`);
  }
} finally {
  await browser.close();
}
