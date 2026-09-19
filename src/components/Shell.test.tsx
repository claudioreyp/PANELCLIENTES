import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { MemoryRouter, useLocation, useNavigate, type NavigateFunction } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Shell } from "./Shell";

const assigned = vi.hoisted(() => ({ roles: ["owner"] as string[], role: undefined as string | undefined }));

vi.mock("../lib/auth", () => ({ useAuth: () => ({ user: { email: "owner@example.test" }, signOut: vi.fn() }) }));
vi.mock("../lib/tenant", () => ({ useTenant: () => ({
  context: { business: { name: "Local", slug: "local", modules: { pos: true, cash: true, inventory: true } }, roles: assigned.roles, role: assigned.role, branches: [{ id: 1, name: "Principal" }] },
  branch: { id: 1, name: "Principal" }, selectBranch: vi.fn(),
}) }));

const listeners = new Set<() => void>();
const media = {
  matches: true,
  addEventListener: vi.fn((_name: string, listener: () => void) => listeners.add(listener)),
  removeEventListener: vi.fn((_name: string, listener: () => void) => listeners.delete(listener)),
};

function resize(mobile: boolean) {
  act(() => { media.matches = mobile; listeners.forEach((listener) => listener()); });
}

function renderShell() {
  return render(<StrictMode><MemoryRouter><Shell><button>Accion operativa</button></Shell></MemoryRouter></StrictMode>);
}

describe("accessible operational shell", () => {
  beforeEach(() => {
    assigned.roles = ["owner"]; assigned.role = undefined;
    media.matches = true;
    listeners.clear();
    vi.stubGlobal("matchMedia", vi.fn(() => media));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it.each(["superadmin", "owner", "manager", "members_manager"])("links %s to the existing agent route in the same tab", (role) => {
    assigned.roles = [role]; media.matches = false;
    renderShell();
    const agent = screen.getByRole("link", { name: "Agente de Whatsapp" });
    expect(agent).toHaveAttribute("href", "/configuracion/agente");
    expect(agent).not.toHaveAttribute("target");
    expect(screen.queryByRole("link", { name: "Menú digital" })).not.toBeInTheDocument();
  });

  it.each(["cashier", "kitchen", "menu_manager"])("does not advertise agent settings to %s", (role) => {
    assigned.roles = [role]; media.matches = false;
    renderShell();
    expect(screen.queryByRole("link", { name: "Agente de Whatsapp" })).not.toBeInTheDocument();
  });

  it("preserves the route role fallback and the legacy empty-role behavior", () => {
    media.matches = false; assigned.roles = []; assigned.role = "manager";
    const view = renderShell();
    expect(screen.getByRole("link", { name: "Agente de Whatsapp" })).toBeVisible();
    view.unmount(); assigned.role = undefined;
    renderShell();
    expect(screen.getByRole("link", { name: "Agente de Whatsapp" })).toBeVisible();
  });

  it("closes the mobile menu and retains the full originating URL for agent settings", async () => {
    function LocationProbe() {
      const location = useLocation();
      return <output>{location.pathname}:{location.state?.settingsFrom}</output>;
    }
    render(<MemoryRouter initialEntries={["/pedidos?view=mesas#cuenta"]}><Shell><LocationProbe /></Shell></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Abrir menú" }));
    fireEvent.click(screen.getByRole("link", { name: "Agente de Whatsapp" }));
    expect(await screen.findByText("/configuracion/agente:/pedidos?view=mesas#cuenta")).toBeVisible();
    expect(screen.queryByRole("dialog", { name: "Menú principal" })).not.toBeInTheDocument();
  });

  it("isolates the operational body theme and releases it in StrictMode", () => {
    document.body.classList.add("unrelated-theme");
    const { unmount } = renderShell();
    expect(document.body).toHaveClass("pos-operational", "unrelated-theme");
    expect(listeners.size).toBe(1);
    unmount();
    expect(document.body).not.toHaveClass("pos-operational");
    expect(document.body).toHaveClass("unrelated-theme");
    expect(listeners.size).toBe(0);
    document.body.classList.remove("unrelated-theme");
  });

  it("makes the closed mobile sidebar inert and contains open-menu focus", async () => {
    renderShell();
    expect(window.matchMedia).toHaveBeenCalledWith("(max-width: 900px)");
    const trigger = screen.getByRole("button", { name: "Abrir men\u00fa" });
    const sidebar = document.getElementById(trigger.getAttribute("aria-controls")!)!;
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(sidebar).toHaveAttribute("inert");
    expect(screen.queryByRole("link", { name: "Pedidos" })).not.toBeInTheDocument();
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Men\u00fa principal" });
    const close = within(dialog).getByRole("button", { name: "Cerrar men\u00fa" });
    const last = within(dialog).getByRole("button", { name: "Salir" });
    await waitFor(() => expect(close).toHaveFocus());
    expect(sidebar).not.toHaveAttribute("inert");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger.closest(".workspace")).toHaveAttribute("inert");
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: "Escape" });
    expect(trigger).toHaveFocus();
    expect(sidebar).toHaveAttribute("inert");
    expect(trigger.closest(".workspace")).not.toHaveAttribute("inert");
    expect(document.body.style.overflow).toBe("");
  });

  it.each(["navigation", "scrim", "close"])("returns focus after %s closes the mobile menu", async (method) => {
    renderShell();
    const trigger = screen.getByRole("button", { name: "Abrir men\u00fa" });
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog");
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Cerrar men\u00fa" })).toHaveFocus());
    if (method === "navigation") fireEvent.click(within(dialog).getByRole("link", { name: "Pedidos" }));
    else if (method === "scrim") fireEvent.click(document.querySelector(".sidebar-scrim")!);
    else fireEvent.click(within(dialog).getByRole("button", { name: "Cerrar men\u00fa" }));
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe("");
  });

  it("keeps desktop navigation available and releases a mobile lock when resizing", async () => {
    media.matches = false;
    renderShell();
    const link = screen.getByRole("link", { name: "Pedidos" });
    expect(link.closest(".sidebar")).not.toHaveAttribute("inert");
    link.focus();
    resize(true);
    const trigger = screen.getByRole("button", { name: "Abrir men\u00fa" });
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole("dialog")).toContainElement(document.activeElement as HTMLElement));
    resize(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(link.closest(".sidebar")).not.toHaveAttribute("inert");
    expect(document.body.style.overflow).toBe("");
    resize(true);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("does not reopen a stale menu when returning through browser history", async () => {
    let navigate: NavigateFunction = () => undefined;
    function HistoryShell() {
      navigate = useNavigate();
      return <Shell><button>Content</button></Shell>;
    }
    render(<MemoryRouter><HistoryShell /></MemoryRouter>);
    const trigger = screen.getByRole("button", { name: "Abrir men\u00fa" });
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole("dialog")).toContainElement(document.activeElement as HTMLElement));
    await act(async () => { await navigate("/pedidos"); });
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await act(async () => { await navigate(-1); });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(document.body.style.overflow).toBe("");
  });
});
