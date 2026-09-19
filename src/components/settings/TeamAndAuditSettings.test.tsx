import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../lib/api";
import type { SettingsMember, SettingsMembers } from "../../types/settings";
import { MembersSettings } from "./TeamAndAuditSettings";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("../../lib/api", async (importOriginal) => ({ ...await importOriginal<typeof import("../../lib/api")>(), api: apiMock }));
vi.mock("../../lib/tenant", () => ({ useTenant: () => ({ branch: { id: 7 }, context: { role: "owner", branches: [{ id: 7, name: "Principal" }, { id: 8, name: "Norte" }] } }) }));

const member: SettingsMember = { id: 11, first_name: "Ana", last_name: "Equipo", email: "ana@example.com", email_access: true, roles: ["owner"], branch_ids: [7], all_branches: false, active: true, version: 3, capabilities: { can_edit: true, can_archive: true } };
let listing: SettingsMembers;

function show() { return render(<MembersSettings />); }
async function actions() {
  await screen.findByText("Ana Equipo");
  fireEvent.click(screen.getByRole("button", { name: "Abrir acciones" }));
}
async function openNewMember() {
  await screen.findByText("Ana Equipo");
  fireEvent.click(screen.getByRole("button", { name: "Nuevo miembro" }));
  const drawer = screen.getByRole("dialog", { name: "Agrega un miembro" });
  fireEvent.change(within(drawer).getByLabelText("Nombre(s)"), { target: { value: "Beto" } });
  fireEvent.click(within(drawer).getByRole("button", { name: "Agregar PIN" }));
  const pin = within(drawer).getByRole("dialog", { name: "Editar PIN de acceso" });
  for (const digit of "1234") fireEvent.click(within(pin).getByRole("button", { name: digit }));
  fireEvent.click(within(pin).getByRole("button", { name: "Listo" }));
  fireEvent.click(within(drawer).getByRole("checkbox", { name: /Cajero/ }));
  fireEvent.click(within(drawer).getByRole("switch", { name: "Acceso con correo electrónico" }));
  fireEvent.change(within(drawer).getByLabelText("Correo electrónico"), { target: { value: "beto@example.com" } });
  return drawer;
}

describe("member settings permissions and outcomes", () => {
  beforeEach(() => {
    listing = { items: [{ ...member }], total: 32, page: 1, page_size: 10, capabilities: { assignable_roles: ["owner", "cashier", "members_manager"], can_manage_admins: true } };
    apiMock.mockReset();
    apiMock.mockImplementation((path: string, options?: RequestInit) => {
      if (options?.method) return Promise.resolve({ ...member, id: 12, invitation: { delivery_status: "sent" } });
      if (path.startsWith("/settings/members")) return Promise.resolve(listing);
      if (path.startsWith("/settings/devices")) return Promise.resolve([]);
      return Promise.reject(new Error(`Unexpected path: ${path}`));
    });
  });
  afterEach(cleanup);

  it("allows archiving an owner when the server allows it even with only one owner on this page", async () => {
    show();
    await actions();
    expect(screen.getByRole("menuitem", { name: "Borrar" })).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: "Editar" })).toBeEnabled();
  });

  it("disables edit/archive according to item capabilities rather than the visual tenant role", async () => {
    listing.items[0].capabilities = { can_edit: false, can_archive: false };
    show();
    await actions();
    expect(screen.getByRole("menuitem", { name: /Editar/ })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: /Borrar/ })).toBeDisabled();
  });

  it("fails closed when older responses omit capabilities", async () => {
    delete listing.capabilities;
    delete listing.items[0].capabilities;
    show();
    await actions();
    expect(screen.getByRole("button", { name: "Nuevo miembro" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: /Editar/ })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: /Borrar/ })).toBeDisabled();
    expect(screen.getByText(/No se pudieron verificar los permisos/)).toBeVisible();
  });

  it("honors assignable roles and can_manage_admins independently", async () => {
    listing.capabilities = { assignable_roles: ["owner", "cashier"], can_manage_admins: false };
    show();
    const drawer = await openNewMember();
    expect(within(drawer).getAllByRole("checkbox").filter((box) => box.closest(".settings-role-list"))).toHaveLength(1);
    expect(within(drawer).queryByRole("checkbox", { name: /Administrador/ })).not.toBeInTheDocument();
  });

  it("does not let a members manager expand their own roles or branches", async () => {
    listing.capabilities = { assignable_roles: ["cashier", "members_manager"], can_manage_admins: false };
    listing.items[0] = { ...member, roles: ["members_manager"], is_current_user: true, capabilities: { can_edit: true, can_archive: false } };
    show();
    await actions();
    fireEvent.click(screen.getByRole("menuitem", { name: "Editar" }));
    const drawer = screen.getByRole("dialog", { name: "Editar miembro" });
    expect(within(drawer).getByRole("checkbox", { name: /Cajero/ })).toBeDisabled();
    expect(within(drawer).getByRole("checkbox", { name: "Norte" })).toBeDisabled();
    expect(within(drawer).getByRole("checkbox", { name: "Todas las sucursales" })).toBeDisabled();
  });

  it.each(["failed", "not_configured", undefined])("separates saved member from invitation %s without exposing delivery internals", async (delivery_status) => {
    show();
    const drawer = await openNewMember();
    apiMock.mockResolvedValueOnce({ ...member, id: 12, invitation: { delivery_status, development_accept_url: "https://example.com/private-invite" } });
    fireEvent.click(within(drawer).getByRole("button", { name: "Agregar miembro" }));
    expect(await screen.findByText("El miembro se guardó correctamente.")).toBeVisible();
    expect(screen.getByText(/El miembro está guardado/)).toBeVisible();
    expect(screen.queryByText("La invitación se envió por correo.")).not.toBeInTheDocument();
    expect(screen.queryByText(/private-invite/)).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(apiMock.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1);
  });

  it("keeps a confirmed save successful when refreshing the members list fails", async () => {
    show();
    const drawer = await openNewMember();
    apiMock.mockResolvedValueOnce({ ...member, id: 12, invitation: { delivery_status: "sent" } }).mockRejectedValueOnce(new Error("Refresh failed"));
    fireEvent.click(within(drawer).getByRole("button", { name: "Agregar miembro" }));
    expect(await screen.findByText("El miembro se guardó correctamente.")).toBeVisible();
    expect(screen.getByText("La invitación se envió por correo.")).toBeVisible();
    expect(screen.getByText(/no se pudo actualizar la lista/)).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each([403, 409])("preserves the draft after API %s and protects cancel", async (status) => {
    show();
    const drawer = await openNewMember();
    apiMock.mockRejectedValueOnce(new ApiError("Revisa los permisos o la versión.", status));
    fireEvent.click(within(drawer).getByRole("button", { name: "Agregar miembro" }));
    await waitFor(() => expect(within(drawer).getByRole("alert")).toHaveTextContent("Revisa los permisos"));
    expect(within(drawer).getByDisplayValue("Beto")).toBeVisible();
    fireEvent.click(within(drawer).getByRole("button", { name: "Editar PIN" }));
    const pin = within(drawer).getByRole("dialog", { name: "Editar PIN de acceso" });
    expect(within(pin).getByRole("status")).toHaveTextContent("4 de 4");
    expect(within(drawer).queryByDisplayValue("1234")).not.toBeInTheDocument();
    fireEvent.click(within(pin).getByRole("button", { name: "Cerrar PIN" }));
    fireEvent.click(within(drawer).getByRole("button", { name: "Cancelar" }));
    fireEvent.click(screen.getByRole("button", { name: "Seguir editando" }));
    expect(drawer).toBeVisible();
    fireEvent.click(within(drawer).getByRole("button", { name: "Cerrar" }));
    fireEvent.click(screen.getByRole("button", { name: "Descartar cambios" }));
    expect(drawer).not.toBeInTheDocument();
  });

  it("offers pairing without creating devices merely by opening settings", async () => {
    show();
    await screen.findByText("Ana Equipo");
    const button = screen.getByRole("button", { name: "Vincular dispositivo" });
    expect(button).toBeEnabled();
    expect(apiMock.mock.calls.filter(([, options]) => options?.method)).toHaveLength(0);
  });
});
