import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({
  signIn: vi.fn(),
  signInDev: vi.fn(),
}));

vi.mock("../lib/auth", () => ({
  useAuth: () => ({ ...authMock, canUseDevMode: false }),
}));

import { LoginPage } from "./Login";

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={["/login"]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<h1>POS abierto</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("restaurant login", () => {
  afterEach(cleanup);

  beforeEach(() => {
    authMock.signIn.mockReset();
    authMock.signIn.mockResolvedValue(undefined);
  });

  it("submits with Enter and redirects after a successful login", async () => {
    renderLogin();
    fireEvent.change(screen.getByLabelText("Usuario"), { target: { value: "owner@pizza.test" } });
    fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: "secret" } });
    fireEvent.submit(screen.getByRole("button", { name: "Entrar" }).closest("form")!);

    await waitFor(() => expect(authMock.signIn).toHaveBeenCalledWith("owner@pizza.test", "secret"));
    expect(await screen.findByRole("heading", { name: "POS abierto" })).toBeInTheDocument();
  });

  it("uses the same flow when the Entrar button is clicked", async () => {
    renderLogin();
    fireEvent.change(screen.getByLabelText("Usuario"), { target: { value: "owner@pizza.test" } });
    fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));

    await waitFor(() => expect(authMock.signIn).toHaveBeenCalledWith("owner@pizza.test", "secret"));
    expect(await screen.findByRole("heading", { name: "POS abierto" })).toBeInTheDocument();
  });
});
