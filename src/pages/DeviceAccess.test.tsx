import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DevicePinPage } from "./DeviceAccess";

const mock = vi.hoisted(() => ({ request: vi.fn(), signIn: vi.fn() }));
vi.mock("../lib/auth", () => ({ useAuth: () => ({ signInDevice: mock.signIn }) }));
vi.mock("../lib/device-access", () => ({ deviceRequest: mock.request, getDeviceSession: async () => ({ linked: true, branch_name: "Sucursal de prueba", user: null }) }));
beforeEach(() => { localStorage.clear(); mock.request.mockReset(); mock.signIn.mockReset().mockResolvedValue(undefined); mock.request.mockResolvedValue({ items: [{ id: 9, name: "Ana Cajera" }] }); });
afterEach(cleanup);

it("requires member selection, masks physical keyboard input and restores focus on Escape", async () => {
  render(<MemoryRouter><DevicePinPage /></MemoryRouter>);
  const member = await screen.findByRole("button", { name: "Ana Cajera" });
  expect(screen.queryByRole("group", { name: /Teclado PIN/ })).not.toBeInTheDocument();
  fireEvent.click(member);
  const pad = screen.getByRole("group", { name: /Teclado PIN/ });
  for (const digit of "8062") fireEvent.keyDown(pad, { key: digit });
  expect(screen.getByRole("status", { name: "4 de 4 dígitos ingresados" })).toBeVisible();
  expect(screen.queryByText("8062")).not.toBeInTheDocument();
  fireEvent.keyDown(pad, { key: "Escape" });
  await waitFor(() => expect(screen.getByRole("button", { name: "Ana Cajera" })).toHaveFocus());
  expect(mock.request).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(localStorage)).not.toContain("8062");
});

it("retains the same login attempt on connection failure and waits for server confirmation", async () => {
  render(<MemoryRouter><DevicePinPage /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: "Ana Cajera" }));
  const pad = screen.getByRole("group", { name: /Teclado PIN/ });
  for (const digit of "8062") fireEvent.keyDown(pad, { key: digit });
  mock.request.mockRejectedValueOnce(new Error("Sin conexión"));
  fireEvent.click(screen.getByRole("button", { name: "Ingresar" }));
  await screen.findByText("Sin conexión");
  expect(mock.signIn).not.toHaveBeenCalled();
  const previous = mock.request.mock.calls.at(-1);
  fireEvent.click(screen.getByRole("button", { name: "Reintentar ingreso" }));
  await waitFor(() => expect(mock.signIn).toHaveBeenCalled());
  expect(mock.request.mock.calls.at(-1)).toEqual(previous);
});
