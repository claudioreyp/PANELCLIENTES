import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../lib/api";
import type { SettingsMember, SettingsMembers } from "../../types/settings";
import { SettingsStateProvider } from "./SettingsState";
import { MembersSettings } from "./TeamAndAuditSettings";

const { apiMock, tenant } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  tenant: { branch: { id: 7 }, context: { role: "owner", branches: [{ id: 7, name: "Principal" }, { id: 8, name: "Norte" }] } },
}));
vi.mock("../../lib/api", async (original) => ({ ...await original<typeof import("../../lib/api")>(), api: apiMock }));
vi.mock("../../lib/tenant", () => ({ useTenant: () => tenant }));

const member: SettingsMember = {
  id: 11, first_name: "Ana", last_name: "Equipo", email: null, email_access: false,
  roles: ["cashier"], branch_ids: [7], all_branches: false, active: true, version: 3,
  capabilities: { can_edit: true, can_archive: true },
};
let listing: SettingsMembers;
const registration = vi.fn();

function Surface({ scopeKey = "business:7", enabled = true }: { scopeKey?: string; enabled?: boolean }) {
  return <SettingsStateProvider scopeKey={scopeKey} enabled={enabled} onRegistration={registration}><MembersSettings /></SettingsStateProvider>;
}

async function openMember(edit = false) {
  await screen.findByText("Ana Equipo");
  if (edit) {
    fireEvent.click(screen.getByRole("button", { name: "Abrir acciones" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Editar" }));
  } else fireEvent.click(screen.getByRole("button", { name: "Nuevo miembro" }));
  return screen.getByRole("dialog", { name: edit ? "Editar miembro" : "Agrega un miembro" });
}

async function enterPin(drawer: HTMLElement, pin: string, trigger = "Agregar PIN") {
  fireEvent.click(within(drawer).getByRole("button", { name: trigger }));
  const popover = within(drawer).getByRole("dialog", { name: "Editar PIN de acceso" });
  const display = within(popover).getByRole("group", { name: "PIN del miembro" });
  await waitFor(() => expect(display).toHaveFocus());
  for (const key of pin) fireEvent.keyDown(display, { key });
  return { popover, display };
}

function completeMember(drawer: HTMLElement) {
  fireEvent.change(within(drawer).getByLabelText("Nombre(s)"), { target: { value: "Beto" } });
  fireEvent.click(within(drawer).getByRole("checkbox", { name: /Cajero/ }));
}

const writes = () => apiMock.mock.calls.filter(([, options]) => options?.method);

beforeEach(() => {
  tenant.branch.id = 7;
  registration.mockReset();
  listing = { items: [{ ...member }], total: 1, page: 1, page_size: 10, capabilities: { assignable_roles: ["cashier", "members_manager"], can_manage_admins: false } };
  apiMock.mockReset();
  apiMock.mockImplementation((path: string, options?: RequestInit) => {
    if (options?.method) return Promise.resolve({ ...member, id: 12 });
    if (path.startsWith("/settings/members")) return Promise.resolve(listing);
    if (path.startsWith("/settings/devices")) return Promise.resolve([]);
    return Promise.reject(new Error("Unexpected test API path"));
  });
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("member PIN popover integration", () => {
  it("requires four digits for a new member and writes only through the existing save action", async () => {
    render(<Surface />);
    const drawer = await openMember();
    completeMember(drawer);
    const save = within(drawer).getByRole("button", { name: "Agregar miembro" });
    expect(save).toBeDisabled();
    const { display } = await enterPin(drawer, "083");
    expect(save).toBeDisabled();
    expect(writes()).toHaveLength(0);
    fireEvent.keyDown(display, { key: "6" });
    fireEvent.keyDown(display, { key: "Enter" });
    expect(save).toBeEnabled();
    expect(writes()).toHaveLength(0);
    fireEvent.click(save);
    await screen.findByText("El miembro se guardó correctamente.");
    expect(writes()).toHaveLength(1);
    const [path, options] = writes()[0];
    expect(path).toBe("/settings/members");
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toMatchObject({ pin: "0836", branch_ids: [7], roles: ["cashier"] });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const next = await openMember();
    expect(within(next).getByRole("button", { name: "Agregar PIN" })).toBeEnabled();
  });

  it("omits an unchanged PIN from PATCH and preserves expected version and branch", async () => {
    render(<Surface />);
    const drawer = await openMember(true);
    const { display } = await enterPin(drawer, "", "Cambiar PIN");
    fireEvent.keyDown(display, { key: "Enter" });
    fireEvent.change(within(drawer).getByLabelText("Nombre(s)"), { target: { value: "Ana María" } });
    fireEvent.click(within(drawer).getByRole("button", { name: "Guardar cambios" }));
    await screen.findByText("Los cambios del miembro se guardaron.");
    const [path, options] = writes()[0];
    expect(path).toBe("/settings/members/11");
    expect(options.method).toBe("PATCH");
    const payload = JSON.parse(options.body);
    expect(payload).not.toHaveProperty("pin");
    expect(payload).toMatchObject({ expected_version: 3, branch_ids: [7] });
  });

  it("disables partial replacement and clears only the proposed PIN, not the stored PIN", async () => {
    render(<Surface />);
    const drawer = await openMember(true);
    const save = within(drawer).getByRole("button", { name: "Guardar cambios" });
    const { popover } = await enterPin(drawer, "80", "Cambiar PIN");
    expect(save).toBeDisabled();
    fireEvent.click(within(popover).getByRole("button", { name: "Limpiar PIN" }));
    fireEvent.click(within(popover).getByRole("button", { name: "Listo" }));
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await screen.findByText("Los cambios del miembro se guardaron.");
    expect(JSON.parse(writes()[0][1].body)).not.toHaveProperty("pin");
  });

  it("registers keypad changes immediately and preserves the drawer on the first Escape", async () => {
    render(<Surface />);
    const drawer = await openMember();
    expect(registration).toHaveBeenLastCalledWith(expect.objectContaining({ dirty: false }));
    const { display } = await enterPin(drawer, "8");
    expect(registration).toHaveBeenLastCalledWith(expect.objectContaining({ dirty: true }));
    fireEvent.keyDown(display, { key: "Escape" });
    expect(drawer).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(within(drawer).getByRole("button", { name: "Editar PIN" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Seguir editando" }));
    expect(drawer).toBeInTheDocument();
    fireEvent.click(within(drawer).getByRole("button", { name: "Cerrar" }));
    fireEvent.click(screen.getByRole("button", { name: "Descartar cambios" }));
    expect(drawer).not.toBeInTheDocument();
    const fresh = await openMember();
    const { popover } = await enterPin(fresh, "");
    expect(within(popover).getByRole("status")).toHaveTextContent("0 de 4");
    expect(writes()).toHaveLength(0);
  });

  it.each([403, 409])("retains a masked draft after a rejected %s save without claiming success", async (status) => {
    render(<Surface />);
    const drawer = await openMember();
    completeMember(drawer);
    const { display } = await enterPin(drawer, "8062");
    fireEvent.keyDown(display, { key: "Enter" });
    apiMock.mockRejectedValueOnce(new ApiError("Revisa los permisos o la versión.", status));
    fireEvent.click(within(drawer).getByRole("button", { name: "Agregar miembro" }));
    await waitFor(() => expect(within(drawer).getByRole("alert")).toHaveTextContent("Revisa los permisos"));
    expect(screen.queryByText("El miembro se guardó correctamente.")).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain("8062");
    const { popover } = await enterPin(drawer, "", "Editar PIN");
    expect(within(popover).getByRole("status")).toHaveTextContent("4 de 4");
    expect(writes()).toHaveLength(1);
  });

  it("keeps role and branch restrictions and disables the PIN for an inactive scope", async () => {
    listing.items[0] = { ...member, roles: ["members_manager"], is_current_user: true };
    const view = render(<Surface />);
    const drawer = await openMember(true);
    expect(within(drawer).getByRole("checkbox", { name: /Cajero/ })).toBeDisabled();
    expect(within(drawer).getByRole("checkbox", { name: "Norte" })).toBeDisabled();
    expect(within(drawer).getByRole("checkbox", { name: "Todas las sucursales" })).toBeDisabled();
    await enterPin(drawer, "8062", "Cambiar PIN");
    tenant.branch.id = 8;
    view.rerender(<Surface scopeKey="business:8" enabled={false} />);
    expect(within(drawer).queryByRole("dialog")).not.toBeInTheDocument();
    expect(within(drawer).getByRole("button", { name: "Editar PIN" })).toBeDisabled();
    expect(within(drawer).getByRole("button", { name: "Guardar cambios" })).toBeDisabled();
    expect(writes()).toHaveLength(0);
  });

  it("explains that a linked device is required without issuing writes when entering a PIN", async () => {
    render(<Surface />);
    const drawer = await openMember();
    expect(within(drawer).getByRole("button", { name: "Agregar PIN" })).toHaveAccessibleDescription(/vincula primero un dispositivo/);
    expect(screen.getByRole("button", { name: "Vincular dispositivo" })).toBeEnabled();
    await enterPin(drawer, "8062");
    expect(writes()).toHaveLength(0);
  });
});
