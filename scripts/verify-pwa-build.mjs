import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { JSDOM } from "jsdom";

// Default: inspect dist without building. --source inspects public/ + index.html.
// Optional URL: anonymous GETs only; never execute the app, auth, or a service worker.
// node scripts/verify-pwa-build.mjs [--source] [--url http://localhost:5173]
const { values, positionals } = parseArgs({
  options: { source: { type: "boolean" }, url: { type: "string" }, help: { type: "boolean" } },
  allowPositionals: true,
});
const root = new URL("../", import.meta.url);
const expectedManifest = {
  id: "/",
  name: "Escalar AI POS",
  short_name: "Escalar POS",
  description: "Punto de venta de Escalar AI para restaurantes.",
  start_url: "/",
  scope: "/",
  lang: "es",
  display: "standalone",
  background_color: "#ffffff",
  theme_color: "#25824f",
};
const expectedIcons = [
  { src: "/icons/escalar-icon-v1-192.png", size: 192, purpose: "any" },
  { src: "/icons/escalar-icon-v1-512.png", size: 512, purpose: "any" },
  { src: "/icons/escalar-maskable-v1-512.png", size: 512, purpose: "maskable" },
];
const appleIcon = { src: "/icons/escalar-apple-v1-180.png", size: 180 };
const favicon = { src: "/icons/escalar-favicon-v1-64.png", size: 64 };
const brandSources = ["/brand/escalar-symbol-v1.png", "/brand/escalar-wordmark-v1.png"];
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const deepRoutes = [
  "/login", "/descargar-app", "/pedidos", "/catalogo", "/disponibilidad", "/caja",
  "/configuracion/general", "/configuracion/agente", "/configuracion/dispositivos",
  "/activar-dispositivo", "/acceso-pin", "/invitacion",
  "/tienda/pwa-verification", "/reservar/pwa-verification",
];

function verifyManifest(manifest) {
  for (const [key, value] of Object.entries(expectedManifest)) {
    assert.equal(manifest[key], value, `Manifest ${key} must be ${value}`);
  }
  assert(Array.isArray(manifest.icons), "Manifest icons must be an array");
  assert.equal(manifest.icons.length, expectedIcons.length, "Unexpected manifest icons");
  for (const icon of expectedIcons) {
    assert.deepEqual(manifest.icons.find((entry) => entry.src === icon.src), {
      src: icon.src, sizes: `${icon.size}x${icon.size}`, type: "image/png", purpose: icon.purpose,
    }, `Invalid manifest entry for ${icon.src}`);
  }
}

function verifyPng(bytes, { src, size }) {
  assert(bytes.length > 33, `${src}: truncated PNG`);
  assert(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `${src}: not a PNG (HTML fallback?)`);
  assert.equal(bytes.toString("ascii", 12, 16), "IHDR", `${src}: missing PNG header`);
  assert.equal(bytes.readUInt32BE(8), 13, `${src}: invalid PNG header length`);
  assert.equal(bytes.readUInt32BE(16), size, `${src}: wrong width`);
  assert.equal(bytes.readUInt32BE(20), size, `${src}: wrong height`);
  assert.equal(bytes.toString("ascii", bytes.length - 8, bytes.length - 4), "IEND", `${src}: incomplete PNG`);
}

function verifyHtml(html, label) {
  // JSDOM does not run scripts or load subresources with these default options.
  const dom = new JSDOM(html);
  try {
    const document = dom.window.document;
    assert.equal(document.documentElement.lang, "es", `${label}: wrong language`);
    assert.equal(document.title, expectedManifest.name, `${label}: wrong title`);
    assert(document.querySelector("#root"), `${label}: missing SPA root`);
    const meta = {
      "theme-color": expectedManifest.theme_color,
      "application-name": expectedManifest.name,
      "apple-mobile-web-app-title": expectedManifest.short_name,
      description: expectedManifest.description,
    };
    for (const [name, content] of Object.entries(meta)) {
      assert.equal(document.querySelector(`meta[name="${name}"]`)?.content, content, `${label}: invalid ${name}`);
    }
    const links = [
      ['link[rel="manifest"]', "/manifest.webmanifest"],
      ['link[rel="icon"][type="image/png"][sizes="64x64"]', favicon.src],
      ['link[rel="icon"][type="image/png"][sizes="192x192"]', expectedIcons[0].src],
      ['link[rel="apple-touch-icon"][sizes="180x180"]', appleIcon.src],
    ];
    for (const [selector, href] of links) {
      assert.equal(document.querySelector(selector)?.getAttribute("href"), href, `${label}: invalid ${selector}`);
    }
    const scripts = [...document.querySelectorAll('script[type="module"][src]')].map((script) => script.getAttribute("src"));
    assert(scripts.length > 0, `${label}: missing app module`);
    assert(scripts.every((src) => src.startsWith("/") && !src.startsWith("//")), `${label}: module paths must survive deep routes`);
    return scripts;
  } finally {
    dom.window.close();
  }
}

function verifyBrandAsset(bytes, metadata, src) {
  const entry = [...metadata.sources, ...metadata.icons].find(item => item.src === src);
  assert(entry && /^[a-f0-9]{64}$/.test(entry.sha256), `${src}: missing generated brand asset hash`);
  assert.equal(sha256(bytes), entry.sha256, `${src}: differs from the original or its generated derivative`);
}

function parseBaseUrl(value) {
  const url = new URL(value);
  assert(["http:", "https:"].includes(url.protocol), "URL must use HTTP(S)");
  assert(!url.username && !url.password && !url.search && !url.hash, "Use a URL without credentials, tokens, query, or fragment");
  assert.equal(url.pathname, "/", "Use the site origin, not an API or deep route URL");
  return url;
}

async function getStatic(baseUrl, path, contentTypes) {
  let response;
  try {
    response = await fetch(new URL(path, baseUrl), {
      method: "GET",
      credentials: "omit",
      redirect: "manual",
      headers: { Accept: contentTypes.join(", "), "Cache-Control": "no-cache" },
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new Error(`${path}: static GET failed or timed out`);
  }
  assert.equal(response.status, 200, `${path}: expected 200, got ${response.status}; redirects/auth are not followed`);
  const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  assert(contentTypes.includes(contentType), `${path}: unexpected Content-Type ${contentType}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  console.log(`HTTP OK ${path} (${contentType})`);
  return bytes;
}

async function main() {
  if (values.help) {
    console.log("Usage: node scripts/verify-pwa-build.mjs [--source] [--url URL | URL]\nDefault checks dist; --source checks public/ and index.html. Never builds or runs app scripts.");
    return;
  }
  assert(positionals.length <= 1 && !(values.url && positionals.length), "Pass only one URL");
  const url = values.url ?? positionals[0];
  const baseUrl = url ? parseBaseUrl(url) : null;
  const directory = new URL(values.source ? "public/" : "dist/", root);
  const indexPath = values.source ? new URL("index.html", root) : new URL("index.html", directory);
  const manifestBytes = await readFile(new URL("manifest.webmanifest", directory));
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  verifyManifest(manifest);
  const html = await readFile(indexPath, "utf8");
  verifyHtml(html, fileURLToPath(indexPath));
  const brandMetadata = JSON.parse(await readFile(new URL("icons/escalar-assets-v1.json", directory), "utf8"));
  assert.equal(brandMetadata.version, 1, "Unknown Escalar AI brand asset version");
  assert.deepEqual(brandMetadata.sources.map(item => item.src), brandSources, "Wrong supplied brand originals");
  assert.deepEqual(brandMetadata.icons.map(item => ({ src: item.src, size: item.size, purpose: item.purpose })),
    [...expectedIcons, { ...appleIcon, purpose: "any" }, { ...favicon, purpose: "any" }], "Wrong generated brand icons");
  const icons = new Map();
  for (const icon of [...expectedIcons, appleIcon, favicon]) {
    const bytes = await readFile(new URL(icon.src.slice(1), directory));
    verifyPng(bytes, icon);
    verifyBrandAsset(bytes, brandMetadata, icon.src);
    icons.set(icon.src, bytes);
  }
  const originals = new Map();
  for (const src of brandSources) {
    const bytes = await readFile(new URL(src.slice(1), directory));
    verifyBrandAsset(bytes, brandMetadata, src);
    originals.set(src, bytes);
  }
  console.log(`${values.source ? "Source" : "Build"} OK: manifest identity, HTML metadata/links, supplied brand originals and five PNG dimensions/hashes`);

  if (!baseUrl) {
    console.log("HTTP endpoints/content types/deep routes not checked: no URL supplied.");
    return;
  }
  const remoteManifest = JSON.parse((await getStatic(baseUrl, "/manifest.webmanifest", ["application/manifest+json"])).toString("utf8"));
  verifyManifest(remoteManifest);
  assert.deepEqual(remoteManifest, manifest, "Served manifest differs from the local artifact");
  for (const icon of [...expectedIcons, appleIcon, favicon]) {
    const bytes = await getStatic(baseUrl, icon.src, ["image/png"]);
    verifyPng(bytes, icon);
    assert(bytes.equals(icons.get(icon.src)), `${icon.src}: served icon differs from local artifact`);
  }
  for (const src of brandSources) {
    const bytes = await getStatic(baseUrl, src, ["image/png"]);
    verifyBrandAsset(bytes, brandMetadata, src);
    assert(bytes.equals(originals.get(src)), `${src}: served brand original differs from local artifact`);
  }
  const entryHtml = (await getStatic(baseUrl, "/", ["text/html"])).toString("utf8");
  const entryScripts = verifyHtml(entryHtml, "/");
  for (const path of deepRoutes) {
    const routeHtml = (await getStatic(baseUrl, path, ["text/html"])).toString("utf8");
    assert.deepEqual(verifyHtml(routeHtml, path), entryScripts, `${path}: not the same SPA entry point`);
  }
  console.log(`HTTP OK: manifest, all icon endpoints, root and ${deepRoutes.length} deep routes; no app/auth scripts executed.`);
}

main().catch((error) => {
  console.error(`PWA verification failed: ${error.message}`);
  if (error.code === "ENOENT" && !values.source) {
    console.error("dist is missing required files. Use --source before a build; this verifier never runs a build.");
  }
  process.exitCode = 1;
});
