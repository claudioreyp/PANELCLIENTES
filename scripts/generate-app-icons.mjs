import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

// Resize the supplied Escalar AI originals locally. No redrawing, network or app access.
// Run: node scripts/generate-app-icons.mjs [--check]
const checkOnly = process.argv.slice(2).includes("--check");
assert(process.argv.slice(2).every((arg) => arg === "--check"), "Only --check is supported");
const publicDirectory = new URL("../public/", import.meta.url);
const iconsDirectory = new URL("icons/", publicDirectory);
const sourcePath = "brand/escalar-symbol-v1.png";
const wordmarkPath = "brand/escalar-wordmark-v1.png";
const source = await readFile(new URL(sourcePath, publicDirectory));
const wordmark = await readFile(new URL(wordmarkPath, publicDirectory));
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const variants = [
  { file: "escalar-icon-v1-192.png", size: 192 },
  { file: "escalar-icon-v1-512.png", size: 512 },
  { file: "escalar-maskable-v1-512.png", size: 512, maskable: true },
  { file: "escalar-apple-v1-180.png", size: 180 },
  { file: "escalar-favicon-v1-64.png", size: 64 },
];

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ offline: true, serviceWorkers: "block" });
  await context.route("**/*", route => route.abort());
  const page = await context.newPage();
  const generated = [];
  for (const variant of variants) {
    const encoded = await page.evaluate(async ({ imageSource, size, maskable }) => {
      const image = new Image();
      image.src = imageSource;
      await image.decode();
      if (image.naturalWidth !== image.naturalHeight) throw new Error("The app symbol must be square");
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas rendering is unavailable");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, size, size);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      // Padding fits the complete supplied symbol inside the maskable safe circle.
      const drawnSize = maskable ? size * 0.64 : size;
      const inset = (size - drawnSize) / 2;
      ctx.drawImage(image, inset, inset, drawnSize, drawnSize);
      const pixels = ctx.getImageData(0, 0, size, size).data;
      let markPixels = 0;
      for (let offset = 0; offset < pixels.length; offset += 4) {
        if (pixels[offset + 3] !== 255) throw new Error("App icons must be fully opaque");
        const marked = pixels[offset] < 245 || pixels[offset + 1] < 245 || pixels[offset + 2] < 245;
        if (marked) markPixels++;
        if (maskable && marked) {
          const x = (offset / 4) % size + 0.5 - size / 2;
          const y = Math.floor(offset / 4 / size) + 0.5 - size / 2;
          if (Math.hypot(x, y) > size * 0.4) throw new Error("Symbol exceeds the maskable safe circle");
        }
      }
      if (markPixels < size * size * 0.1) throw new Error("Supplied Escalar AI symbol is missing");
      return canvas.toDataURL("image/png").split(",")[1];
    }, { imageSource: `data:image/png;base64,${source.toString("base64")}`, ...variant });
    generated.push({ ...variant, png: Buffer.from(encoded, "base64") });
  }

  const metadata = {
    version: 1,
    sources: [{ src: `/${sourcePath}`, sha256: sha256(source) }, { src: `/${wordmarkPath}`, sha256: sha256(wordmark) }],
    icons: generated.map(({ file, size, png, maskable }) => ({ src: `/icons/${file}`, size,
      purpose: maskable ? "maskable" : "any", sha256: sha256(png) })),
  };
  for (const { file, size, png } of generated) {
    const target = new URL(file, iconsDirectory);
    if (checkOnly) assert(png.equals(await readFile(target)), `${file} is stale; regenerate with the installed Playwright Chromium`);
    else await writeFile(target, png);
    console.log(`${checkOnly ? "Verified" : "Generated"} ${fileURLToPath(target)} (${size}x${size})`);
  }
  const metadataTarget = new URL("escalar-assets-v1.json", iconsDirectory);
  const serialized = JSON.stringify(metadata, null, 2) + "\n";
  if (checkOnly) assert.equal(await readFile(metadataTarget, "utf8"), serialized, "Brand asset metadata is stale");
  else await writeFile(metadataTarget, serialized);
} finally {
  await browser.close();
}
