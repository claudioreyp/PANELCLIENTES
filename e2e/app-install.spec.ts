import { expect, test as base, type Page, type TestInfo } from "@playwright/test";

const DOWNLOAD_PATH = "/descargar-app";
const DOWNLOAD_TITLE = "Descargar aplicaci\u00f3n";
const APP_TITLE = "Aplicaci\u00f3n de Escalar AI POS";
const INSTALL_LABEL = "Instalar Escalar AI POS";
const INSTALLED_TITLE = "Instalaci\u00f3n completada";
const ACCEPTED_MESSAGE = "Confirma la instalaci\u00f3n en el navegador.";
const DISMISSED_MESSAGE = "Cancelaste la instalaci\u00f3n.";

type Role = "owner" | "cashier" | "kitchen" | "waiter";
type Outcome = "accepted" | "dismissed";
type PromptFailure = "throw" | "reject";
type BrowserProfile = { userAgent: string; platform: string; maxTouchPoints: number };
const browserProfiles = {
  chrome: {
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    platform: "Win32", maxTouchPoints: 0,
  },
  edge: {
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
    platform: "Win32", maxTouchPoints: 0,
  },
  ios: {
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
    platform: "iPhone", maxTouchPoints: 5,
  },
  ipad: {
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15",
    platform: "MacIntel", maxTouchPoints: 5,
  },
  safari: {
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15",
    platform: "MacIntel", maxTouchPoints: 0,
  },
} satisfies Record<string, BrowserProfile>;

type InstallOptions = {
  role?: Role;
  auth?: "dev" | "pending-device" | "public";
  browser?: keyof typeof browserProfiles;
  standalone?: "display-mode" | "ios";
  posEnabled?: boolean;
};
type PromptSnapshot = {
  defaultPrevented: boolean;
  promptCalls: number;
  synchronousCalls: boolean[];
  calls: ("prompt" | "userChoice")[];
};
type PwaHarness = {
  inClick: boolean;
  emit: (id: string, failure?: PromptFailure) => PromptSnapshot;
  snapshot: (id: string) => PromptSnapshot;
  settle: (id: string, outcome: Outcome | "error") => void;
  totalPrompts: () => number;
};
type TestWindow = typeof window & { pwaTest: PwaHarness };
type RequestRecord = { method: string; path: string };
type Prepare = (options?: InstallOptions) => Promise<{
  requests: RequestRecord[];
  releaseAuth: () => void;
}>;

// All helpers live in this spec: no production hooks, credentials or shared fixture edits.
const test = base.extend<{ prepare: Prepare }>({
  prepare: async ({ page, context, baseURL }, runFixture) => {
    if (baseURL !== "http://127.0.0.1:5175") {
      throw new Error("PWA E2E requires the isolated Playwright server on port 5175, not a user browser.");
    }
    const origin = new URL(baseURL).origin;
    const requests: RequestRecord[] = [];
    const violations: string[] = [];
    const errors: string[] = [];
    let options: InstallOptions = {};
    let prepared = false;
    let releaseAuth = () => {};
    const authReady = new Promise<void>((resolve) => { releaseAuth = resolve; });
    page.on("pageerror", (error) => errors.push(error.message));

    // Neither API realtime, QZ nor Vite HMR can open a real socket.
    await context.routeWebSocket(/.*/, (socket) => {
      const url = new URL(socket.url());
      if (url.pathname === "/api/v1/ws/branches/1") socket.send(JSON.stringify({ event: "connected" }));
      else if (url.host !== new URL(origin).host) violations.push(`Blocked WebSocket: ${url.origin}${url.pathname}`);
    });
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname;
      const method = request.method();
      const apiPath = path.startsWith("/api/v1/") ? path.slice("/api/v1".length) : null;
      if (method === "OPTIONS" && apiPath) return route.fulfill({ status: 204 });
      if (!["GET", "HEAD"].includes(method)) {
        violations.push(`Blocked write: ${method} ${path}`);
        return route.fulfill({ status: 405, json: { detail: "PWA tests never write to an API." } });
      }
      if (apiPath) {
        requests.push({ method, path: apiPath });
        const role = options.role ?? "owner";
        const business = {
          id: 1, name: "Restaurante de pruebas", slug: "isolated", currency: "PEN",
          modules: { pos: options.posEnabled ?? true, cash: false, inventory: false },
        };
        const branch = {
          id: 1, business_id: 1, name: "Sucursal de pruebas", active: true,
          opening_hours: {}, delivery_enabled: false, delivery_fee: 0,
        };
        if (apiPath === "/auth/devices/session") {
          if (options.auth === "pending-device") await authReady;
          return route.fulfill({ json: {
            linked: options.auth !== "public", business_id: 1, branch_id: 1,
            branch_name: branch.name,
            user: options.auth === "public" ? null : { id: "isolated-member", name: "Personal de pruebas", roles: [role] },
          } });
        }
        if (apiPath === "/context") return route.fulfill({ json: { role, roles: [role], business, branches: [branch] } });
        if (apiPath === "/orders/workspace") return route.fulfill({ json: {
          branch_id: 1, period: "all", view: "orders", items: [], total: 0,
          page: 1, page_size: 12, review_count: 0,
        } });
        if (apiPath === "/catalog") return route.fulfill({ json: { categories: [], products: [], modifier_groups: [], promotions: [] } });
        if (apiPath === "/public/isolated/menu") return route.fulfill({ json: { business, branch, categories: [], products: [], promotions: [] } });
        violations.push(`Unmocked API read: ${method} ${apiPath}`);
        return route.fulfill({ status: 404, json: { detail: "Missing isolated PWA fixture." } });
      }
      const appAsset = url.origin === origin
        && ["document", "script", "stylesheet", "image", "font", "other"].includes(request.resourceType());
      const fontAsset = url.protocol === "https:" && (
        (url.hostname === "fonts.googleapis.com" && /^\/css2?$/.test(path) && request.resourceType() === "stylesheet")
        || (url.hostname === "fonts.gstatic.com" && path.startsWith("/s/") && request.resourceType() === "font")
      );
      if (appAsset || fontAsset) return route.continue();
      violations.push(`Blocked nonfixture request: ${method} ${url.origin}${path}`);
      return route.abort("blockedbyclient");
    });

    try {
      await runFixture(async (selected = {}) => {
        if (prepared) throw new Error("Prepare each isolated page exactly once, before navigation.");
        prepared = true;
        options = selected;
        await page.addInitScript(({ auth, role, profile, standalone }) => {
          localStorage.clear();
          sessionStorage.clear();
          if (auth !== "public") {
            localStorage.setItem("impulsa.authMode", auth === "pending-device" ? "device" : "dev");
            localStorage.setItem("impulsa.businessId", "1");
            localStorage.setItem("impulsa.branchId", "1");
            localStorage.setItem("impulsa.devRole", role);
          }
          Object.defineProperties(navigator, {
            userAgent: { configurable: true, get: () => profile.userAgent },
            platform: { configurable: true, get: () => profile.platform },
            maxTouchPoints: { configurable: true, get: () => profile.maxTouchPoints },
            userAgentData: { configurable: true, get: () => undefined },
            standalone: { configurable: true, get: () => standalone === "ios" },
          });
          const originalMatchMedia = window.matchMedia.bind(window);
          window.matchMedia = (query) => {
            const media = originalMatchMedia(query);
            if (/^\(\s*display-mode\s*:\s*standalone\s*\)$/.test(query)) {
              Object.defineProperty(media, "matches", { get: () => standalone === "display-mode" });
            }
            return media;
          };
          // A browser-generated event must never reach UI that could open a native prompt.
          window.addEventListener("beforeinstallprompt", (event) => {
            if (event.isTrusted) { event.preventDefault(); event.stopImmediatePropagation(); }
          }, { capture: true });

          type RecordState = PromptSnapshot & {
            resolve: (choice: { outcome: Outcome; platform: string }) => void;
            reject: (error: Error) => void;
          };
          const records = new Map<string, RecordState>();
          const harness: PwaHarness = {
            inClick: false,
            emit(id, failure) {
              if (records.has(id)) throw new Error(`Duplicate synthetic event: ${id}`);
              let resolve: RecordState["resolve"] = () => {};
              let reject: RecordState["reject"] = () => {};
              const userChoice = new Promise<{ outcome: Outcome; platform: string }>((yes, no) => { resolve = yes; reject = no; });
              // A failed prompt may never read userChoice; keep this test-owned promise handled.
              void userChoice.catch(() => {});
              const record: RecordState = { defaultPrevented: false, promptCalls: 0, synchronousCalls: [], calls: [], resolve, reject };
              records.set(id, record);
              const event = new Event("beforeinstallprompt", { cancelable: true });
              Object.defineProperties(event, {
                platforms: { value: ["web"] },
                prompt: { value: () => {
                  record.promptCalls += 1;
                  record.synchronousCalls.push(harness.inClick);
                  record.calls.push("prompt");
                  if (failure === "throw") throw new Error("Synthetic prompt failure");
                  if (failure === "reject") return Promise.reject(new Error("Synthetic prompt rejection"));
                  return Promise.resolve();
                } },
                userChoice: { get: () => { record.calls.push("userChoice"); return userChoice; } },
              });
              window.dispatchEvent(event);
              record.defaultPrevented = event.defaultPrevented;
              return harness.snapshot(id);
            },
            snapshot(id) {
              const record = records.get(id);
              if (!record) throw new Error(`Unknown synthetic event: ${id}`);
              return {
                defaultPrevented: record.defaultPrevented, promptCalls: record.promptCalls,
                synchronousCalls: [...record.synchronousCalls], calls: [...record.calls],
              };
            },
            settle(id, outcome) {
              const record = records.get(id);
              if (!record) throw new Error(`Unknown synthetic event: ${id}`);
              if (outcome === "error") record.reject(new Error("Synthetic userChoice rejection"));
              else record.resolve({ outcome, platform: "web" });
            },
            totalPrompts: () => [...records.values()].reduce((sum, record) => sum + record.promptCalls, 0),
          };
          Object.assign(window, { pwaTest: harness });
        }, {
          auth: selected.auth ?? "dev", role: selected.role ?? "owner",
          profile: browserProfiles[selected.browser ?? "chrome"], standalone: selected.standalone,
        });
        return { requests, releaseAuth };
      });
    } finally {
      releaseAuth();
      expect(violations, "All API traffic must be mocked; writes, QZ and other services stay blocked").toEqual([]);
      expect(errors, "No unhandled browser errors, including rejected installation promises").toEqual([]);
    }
  },
});

test.use({ serviceWorkers: "block" });

const header = (page: Page) => page.getByRole("banner");
const installLink = (page: Page) => header(page).getByRole("link", { name: "Instalar app", exact: true });
const installButton = (page: Page) => page.getByRole("main").locator("button.install-app-action");
const downloadHeading = (page: Page) => page.getByRole("heading", { level: 1, name: DOWNLOAD_TITLE, exact: true });
const installedHeading = (page: Page) => page.getByRole("heading", { name: INSTALLED_TITLE, exact: true });
const status = (page: Page) => page.getByRole("main").getByRole("status");

async function snapshot(page: Page, id: string) {
  return page.evaluate((id) => (window as TestWindow).pwaTest.snapshot(id), id);
}

async function emitPrompt(page: Page, id: string, failure?: PromptFailure) {
  const event = await page.evaluate(({ id, failure }) => (window as TestWindow).pwaTest.emit(id, failure), { id, failure });
  expect(event.defaultPrevented, "The application must defer the browser event").toBe(true);
  expect(event.promptCalls, "Receiving an event never opens an installation prompt").toBe(0);
}

async function clickPrompt(page: Page, id: string, clicks = 1) {
  await expect(installButton(page)).toBeEnabled();
  await expect(installButton(page)).toHaveAccessibleName(INSTALL_LABEL);
  // DOM activation keeps both clicks and this assertion in one JS stack. An awaited
  // step before prompt() would lose native user activation and fails the snapshot.
  const immediate = await installButton(page).evaluate((element, { id, clicks }) => {
    const harness = (window as TestWindow).pwaTest;
    harness.inClick = true;
    try {
      for (let index = 0; index < clicks; index += 1) (element as HTMLButtonElement).click();
      return harness.snapshot(id);
    } finally { harness.inClick = false; }
  }, { id, clicks });
  expect(immediate.promptCalls).toBe(1);
  expect(immediate.synchronousCalls).toEqual([true]);
  expect(immediate.calls.filter((call) => call === "prompt")).toEqual(["prompt"]);
  await expect(installButton(page)).toBeDisabled();
}

async function waitForChoiceRead(page: Page, id: string) {
  // Capture can validate the getter before a click; wait for the installation read.
  await expect.poll(async () => {
    const { calls } = await snapshot(page, id);
    const firstPrompt = calls.indexOf("prompt");
    return firstPrompt >= 0 && calls.lastIndexOf("userChoice") > firstPrompt;
  }).toBe(true);
}

async function settleChoice(page: Page, id: string, outcome: Outcome | "error") {
  await page.evaluate(async ({ id, outcome }) => {
    (window as TestWindow).pwaTest.settle(id, outcome);
    // Let promise continuations and their React render commit before negative assertions.
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  }, { id, outcome });
}

async function assertInstalled(page: Page) {
  await expect(installedHeading(page)).toBeVisible();
  await expect(installLink(page)).toHaveCount(0);
  await expect(installButton(page).and(page.locator(":enabled"))).toHaveCount(0);
  await expect(page.getByText(ACCEPTED_MESSAGE)).toHaveCount(0);
  await expect(page.getByText(DISMISSED_MESSAGE)).toHaveCount(0);
}

async function reviewScreenshot(page: Page, info: TestInfo, state: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
  if (process.env.IMPECCABLE_REVIEW === "1") {
    const path = `.impeccable/review/app-install-${state}-${info.project.name}.png`;
    await page.screenshot({ path, fullPage: true });
    await info.attach(`app-install-${state}-${info.project.name}`, { path, contentType: "image/png" });
  }
}

for (const role of ["owner", "cashier", "kitchen", "waiter"] as const) {
  test(`${role} opens the header download NavLink and keeps back/forward navigation and heading focus`, async ({ page, context, prepare }) => {
    await prepare({ role });
    await page.goto("/pedidos");
    await expect(page.getByRole("heading", { name: "Pedidos", exact: true })).toBeVisible();
    await expect(installLink(page)).toBeVisible();
    await expect(installLink(page)).toHaveAttribute("href", DOWNLOAD_PATH);
    await expect(installLink(page).locator("svg.lucide-download")).toBeVisible();
    await expect(header(page).getByText(/Soporte|Tutoriales/i)).toHaveCount(0);
    await installLink(page).click();
    await expect(page).toHaveURL(/\/descargar-app$/);
    await expect(installLink(page)).toHaveAttribute("aria-current", "page");
    await expect(downloadHeading(page)).toBeVisible();
    await expect(downloadHeading(page)).toHaveAttribute("tabindex", "-1");
    await expect(downloadHeading(page)).toBeFocused();
    await expect(page.getByRole("heading", { level: 2, name: APP_TITLE, exact: true })).toBeVisible();
    await expect(installButton(page)).toBeDisabled();
    expect(context.pages()).toHaveLength(1);
    await page.goBack();
    await expect(page).toHaveURL(/\/pedidos$/);
    await expect(page.getByRole("heading", { name: "Pedidos", exact: true })).toBeVisible();
    await page.goForward();
    await expect(downloadHeading(page)).toBeFocused();
    await expect(installButton(page)).toBeDisabled();
    await page.reload();
    await expect(page).toHaveURL(/\/descargar-app$/);
    await expect(downloadHeading(page)).toBeFocused();
    expect(await page.evaluate(() => (window as TestWindow).pwaTest.totalPrompts())).toBe(0);
  });
}

test("download access does not require a POS module or management role", async ({ page, prepare }) => {
  await prepare({ role: "waiter", posEnabled: false });
  await page.goto(DOWNLOAD_PATH);
  await expect(downloadHeading(page)).toBeVisible();
  await expect(installLink(page)).toBeVisible();
  await expect(installButton(page)).toBeDisabled();
});

test("captures beforeinstallprompt before auth resolves and retains it across SPA navigation", async ({ page, prepare }) => {
  const mock = await prepare({ auth: "pending-device", role: "cashier" });
  await page.goto("/pedidos");
  await expect.poll(() => mock.requests.some(({ path }) => path === "/auth/devices/session")).toBe(true);
  await expect(page.getByText("Verificando tu sesi\u00f3n...", { exact: true })).toBeVisible();
  await expect(installLink(page)).toHaveCount(0);
  expect(mock.requests.some(({ path }) => path === "/context")).toBe(false);
  await emitPrompt(page, "before-auth");
  mock.releaseAuth();
  await expect(page.getByRole("heading", { name: "Pedidos", exact: true })).toBeVisible();
  await installLink(page).click();
  await expect(installButton(page)).toBeEnabled();
  await expect(downloadHeading(page)).toBeFocused();
  await page.goBack();
  await expect(page).toHaveURL(/\/pedidos$/);
  await page.goForward();
  await expect(installButton(page)).toBeEnabled();
  expect((await snapshot(page, "before-auth")).promptCalls).toBe(0);
  await clickPrompt(page, "before-auth");
  await settleChoice(page, "before-auth", "dismissed");
  await expect(status(page)).toContainText(DISMISSED_MESSAGE);
});

test("only appinstalled confirms success after an accepted choice, with no double prompt", async ({ page, prepare }, info) => {
  await prepare();
  await page.goto(DOWNLOAD_PATH);
  await expect(installButton(page)).toBeDisabled();
  await emitPrompt(page, "available");
  await expect(installButton(page)).toBeEnabled();
  await expect(installedHeading(page)).toHaveCount(0);
  await reviewScreenshot(page, info, "available");
  await clickPrompt(page, "available", 2);
  await waitForChoiceRead(page, "available");
  await expect(installedHeading(page)).toHaveCount(0);
  await settleChoice(page, "available", "accepted");
  await expect(status(page)).toContainText(ACCEPTED_MESSAGE);
  await expect(installedHeading(page)).toHaveCount(0);
  await expect(installLink(page)).toBeVisible();
  await expect(installButton(page)).toBeDisabled();
  await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
  await assertInstalled(page);
  expect((await snapshot(page, "available")).promptCalls).toBe(1);
  await reviewScreenshot(page, info, "success");
  if (info.project.name === "desktop" && process.env.IMPECCABLE_REVIEW === "1") {
    const originalViewport = page.viewportSize();
    try {
      await page.setViewportSize({ width: 1144, height: 800 });
      await assertInstalled(page);
      await reviewScreenshot(page, info, "user-1144");
    } finally {
      if (originalViewport) await page.setViewportSize(originalViewport);
    }
  }
});

test("dismissal consumes the event through navigation and a fresh event enables a deliberate retry", async ({ page, prepare }) => {
  await prepare();
  await page.goto("/pedidos");
  await expect(installLink(page)).toBeVisible();
  await emitPrompt(page, "cancelled");
  await installLink(page).click();
  await clickPrompt(page, "cancelled", 2);
  await settleChoice(page, "cancelled", "dismissed");
  await expect(status(page)).toContainText(DISMISSED_MESSAGE);
  await expect(installButton(page)).toBeDisabled();
  await expect(installLink(page)).toBeVisible();
  await expect(installedHeading(page)).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(/\/pedidos$/);
  await installLink(page).click();
  await expect(installButton(page)).toBeDisabled();
  expect((await snapshot(page, "cancelled")).promptCalls).toBe(1);
  await emitPrompt(page, "retry-after-cancel");
  await expect(installButton(page)).toBeEnabled();
  await expect(page.getByText(DISMISSED_MESSAGE)).toHaveCount(0);
  await installButton(page).click();
  await settleChoice(page, "retry-after-cancel", "accepted");
  await expect(status(page)).toContainText(ACCEPTED_MESSAGE);
  expect((await snapshot(page, "retry-after-cancel")).promptCalls).toBe(1);
  await expect(installedHeading(page)).toHaveCount(0);
});

for (const failure of ["throw", "reject", "userChoice"] as const) {
  test(`recovers only on a fresh event after ${failure} fails`, async ({ page, prepare }) => {
    await prepare();
    await page.goto(DOWNLOAD_PATH);
    await expect(downloadHeading(page)).toBeVisible();
    await emitPrompt(page, "failed", failure === "userChoice" ? undefined : failure);
    await clickPrompt(page, "failed");
    if (failure === "userChoice") await settleChoice(page, "failed", "error");
    const errorNotice = page.getByRole("main").getByRole("alert");
    await expect(errorNotice).toContainText("No se pudo abrir la instalaci\u00f3n.");
    await expect(installButton(page)).toBeDisabled();
    await expect(installedHeading(page)).toHaveCount(0);
    await expect(installLink(page)).toBeVisible();
    await emitPrompt(page, "retry-after-error");
    await expect(installButton(page)).toBeEnabled();
    await expect(errorNotice).toHaveCount(0);
    await clickPrompt(page, "retry-after-error");
    await settleChoice(page, "retry-after-error", "accepted");
    await expect(status(page)).toContainText(ACCEPTED_MESSAGE);
    expect((await snapshot(page, "failed")).promptCalls).toBe(1);
    expect((await snapshot(page, "retry-after-error")).promptCalls).toBe(1);
    await expect(installedHeading(page)).toHaveCount(0);
  });
}

for (const outcome of ["accepted", "dismissed", "error"] as const) {
  test(`a late ${outcome} userChoice cannot overwrite appinstalled`, async ({ page, prepare }) => {
    await prepare();
    await page.goto(DOWNLOAD_PATH);
    await expect(downloadHeading(page)).toBeVisible();
    await emitPrompt(page, "pending-choice");
    await clickPrompt(page, "pending-choice");
    await waitForChoiceRead(page, "pending-choice");
    await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
    await assertInstalled(page);
    await settleChoice(page, "pending-choice", outcome);
    await assertInstalled(page);
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
    expect((await snapshot(page, "pending-choice")).promptCalls).toBe(1);
  });
}

test("appinstalled received off-route persists and cannot be undone by another prompt event", async ({ page, prepare }) => {
  await prepare();
  await page.goto("/pedidos");
  await expect(installLink(page)).toBeVisible();
  await installLink(page).click();
  await expect(downloadHeading(page)).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/pedidos$/);
  await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
  await expect(installLink(page)).toHaveCount(0);
  await page.goForward();
  await assertInstalled(page);
  await page.evaluate(() => (window as TestWindow).pwaTest.emit("after-installed"));
  await assertInstalled(page);
  expect((await snapshot(page, "after-installed")).promptCalls).toBe(0);
});

for (const standalone of ["display-mode", "ios"] as const) {
  test(`${standalone} standalone starts installed and never offers a header installation CTA`, async ({ page, prepare }, info) => {
    await prepare({ standalone, browser: standalone === "ios" ? "ios" : "chrome" });
    await page.goto("/pedidos");
    await expect(page.getByRole("heading", { name: "Pedidos", exact: true })).toBeVisible();
    await expect(installLink(page)).toHaveCount(0);
    await page.goto(DOWNLOAD_PATH);
    await assertInstalled(page);
    expect(await page.evaluate(() => (window as TestWindow).pwaTest.totalPrompts())).toBe(0);
    await reviewScreenshot(page, info, `success-${standalone}`);
  });
}

const guides: { browser: keyof typeof browserProfiles; expected: RegExp[]; absent: RegExp }[] = [
  { browser: "ios", expected: [/Safari/i, /Compartir/i, /pantalla de inicio/i], absent: /Dock/i },
  { browser: "ipad", expected: [/Safari/i, /Compartir/i, /pantalla de inicio/i], absent: /Dock/i },
  { browser: "edge", expected: [/Edge/i, /men\u00fa/i, /instalar/i], absent: /Dock|pantalla de inicio/i },
  { browser: "chrome", expected: [/Chrome/i, /men\u00fa/i, /instalar/i], absent: /Dock|pantalla de inicio/i },
  { browser: "safari", expected: [/Safari/i, /Archivo/i, /(?:agregar|a\u00f1adir) al Dock/i], absent: /pantalla de inicio/i },
];

for (const { browser, expected, absent } of guides) {
  test(`${browser} shows its fallback guide without claiming native installation is available`, async ({ page, prepare }, info) => {
    await prepare({ browser });
    await page.goto(DOWNLOAD_PATH);
    await expect(downloadHeading(page)).toBeVisible();
    await expect(installButton(page)).toBeVisible();
    await expect(installButton(page)).toBeDisabled();
    await expect(installLink(page)).toBeVisible();
    for (const text of expected) await expect(page.getByRole("main")).toContainText(text);
    await expect(page.getByRole("main")).not.toContainText(absent);
    await expect(installedHeading(page)).toHaveCount(0);
    expect(await page.evaluate(() => (window as TestWindow).pwaTest.totalPrompts())).toBe(0);
    await reviewScreenshot(page, info, `fallback-${browser}`);
  });
}

for (const publicPage of [
  { path: "/login", heading: "Bienvenido de vuelta" },
  { path: "/tienda/isolated", heading: "Hoy se come bien." },
  { path: "/reservar/isolated", heading: "Reserva un momento, no solo una mesa." },
]) {
  test(`${publicPage.path} never exposes installation controls, even when a prompt is available`, async ({ page, prepare }) => {
    const mock = await prepare({ auth: "public" });
    await page.goto(publicPage.path);
    await expect(page.getByRole("heading", { name: publicPage.heading, exact: true })).toBeVisible();
    await page.evaluate(() => (window as TestWindow).pwaTest.emit("public-event"));
    await expect(page.getByRole("link", { name: "Instalar app", exact: true })).toHaveCount(0);
    await expect(installButton(page)).toHaveCount(0);
    await expect(downloadHeading(page)).toHaveCount(0);
    await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
    await expect(installedHeading(page)).toHaveCount(0);
    expect((await snapshot(page, "public-event")).promptCalls).toBe(0);
    expect(mock.requests.some(({ path }) => path === "/context")).toBe(false);
  });
}

test("unauthenticated direct download access redirects to login without install controls", async ({ page, prepare }) => {
  const mock = await prepare({ auth: "public" });
  await page.goto(DOWNLOAD_PATH);
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("button", { name: "Entrar", exact: true })).toBeVisible();
  await page.evaluate(() => (window as TestWindow).pwaTest.emit("unauthenticated"));
  await expect(page.getByRole("link", { name: "Instalar app", exact: true })).toHaveCount(0);
  await expect(installButton(page)).toHaveCount(0);
  await expect(downloadHeading(page)).toHaveCount(0);
  expect((await snapshot(page, "unauthenticated")).promptCalls).toBe(0);
  expect(mock.requests.some(({ path }) => path === "/context")).toBe(false);
});
