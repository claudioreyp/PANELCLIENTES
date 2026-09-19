import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, Link } from "react-router-dom";
import { appInstallation } from "../lib/app-installation";
import { DownloadAppPage } from "./DownloadApp";

function offer(outcome = "accepted") {
  const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
    prompt: vi.fn(async () => {}), userChoice: Promise.resolve({ outcome }),
  });
  act(() => { window.dispatchEvent(event); });
  return event;
}

describe("app download page", () => {
  beforeEach(() => {
    vi.stubGlobal("isSecureContext", true);
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    appInstallation.start();
  });
  afterEach(() => { cleanup(); appInstallation.dispose(); vi.unstubAllGlobals(); });

  it("retains an early offer, focuses the heading and restores the title on exit", () => {
    const previousTitle = document.title;
    const event = offer();
    const view = render(<DownloadAppPage />);
    expect(screen.getByRole("heading", { name: "Descargar aplicación" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Instalar Escalar AI POS" })).toBeEnabled();
    expect(event.prompt).not.toHaveBeenCalled();
    expect(document.title).toContain("Escalar AI POS");
    view.unmount();
    expect(document.title).toBe(previousTitle);
  });

  it("retains the offer across route navigation", async () => {
    const event = offer();
    render(<MemoryRouter initialEntries={["/"]}><Routes><Route path="/" element={<Link to="/descargar-app">Instalar app</Link>} /><Route path="/descargar-app" element={<DownloadAppPage />} /></Routes></MemoryRouter>);
    fireEvent.click(screen.getByRole("link", { name: "Instalar app" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Instalar Escalar AI POS" })); });
    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("heading", { name: "Instalación completada" })).not.toBeInTheDocument();
    act(() => { window.dispatchEvent(new Event("appinstalled")); });
    expect(screen.getByRole("heading", { name: "Instalación completada" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Instalar Escalar AI POS" })).not.toBeInTheDocument();
  });

  it("explains cancellation without promising installation or logging out", async () => {
    offer("dismissed");
    render(<DownloadAppPage />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Instalar Escalar AI POS" })); });
    expect(screen.getByRole("status")).toHaveTextContent("Cancelaste la instalación");
    expect(screen.getByRole("button", { name: "Instalar Escalar AI POS" })).toBeDisabled();
    expect(screen.queryByText("Instalación completada")).not.toBeInTheDocument();
  });

  it("explains fallback when a native prompt is absent", () => {
    render(<DownloadAppPage />);
    expect(screen.getByRole("button", { name: "Instalar Escalar AI POS" })).toBeDisabled();
    expect(screen.getByRole("heading", { name: "Instalar desde tu navegador" })).toBeVisible();
    expect(screen.getByText(/Necesitas conexión/)).toBeVisible();
    expect(screen.queryByText("Soporte")).not.toBeInTheDocument();
    expect(screen.queryByText("Tutoriales")).not.toBeInTheDocument();
  });
});
