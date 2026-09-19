import { StrictMode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/api";
import type { Catalog, Promotion } from "../types";
import { PromotionWorkspace } from "./PromotionWorkspace";

const apiMock = vi.hoisted(() => vi.fn());

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return { ...actual, api: apiMock };
});

function promotion(overrides: Partial<Promotion> = {}): Promotion {
  return {
    id: 1,
    business_id: 1,
    branch_id: 1,
    name: "Descuento de setiembre",
    promotion_type: "product_discount",
    discount_type: "percentage",
    discount_value: 20,
    receive_quantity: null,
    pay_quantity: null,
    target_scope: "products",
    target_ids: [1],
    starts_on: null,
    ends_on: null,
    weekdays: [0, 1, 2],
    service_channels: ["pos_tables"],
    active: true,
    sort_order: 0,
    archived_at: null,
    version: 1,
    ...overrides,
  };
}

function catalog(branchId = 1, promotions = [promotion()]): Catalog {
  return {
    branch: {
      id: branchId,
      business_id: 1,
      slug: `sucursal-${branchId}`,
      name: `Sucursal ${branchId}`,
      opening_hours: {},
      accepted_payment_methods: ["cash"],
      delivery_enabled: true,
      takeaway_enabled: true,
      delivery_fee: 0,
      active: true,
    },
    categories: [],
    products: [],
    modifier_groups: [],
    ingredients: [],
    promotions,
  };
}

function renderWorkspace({
  currentCatalog = catalog(),
  branchId = 1,
  refreshCatalog = vi.fn().mockResolvedValue(undefined),
  notify = vi.fn(),
}: {
  currentCatalog?: Catalog;
  branchId?: number;
  refreshCatalog?: ReturnType<typeof vi.fn>;
  notify?: ReturnType<typeof vi.fn>;
} = {}) {
  return {
    refreshCatalog,
    notify,
    ...render(
      <PromotionWorkspace
        catalog={currentCatalog}
        branchId={branchId}
        refreshCatalog={refreshCatalog}
        notify={notify}
      />,
    ),
  };
}

function openPromotionEditor() {
  const promotionName = screen.getByText("Descuento de setiembre", { exact: true });
  const cardButton = promotionName.closest("button");
  if (!cardButton) throw new Error("Promotion card button not found");
  fireEvent.click(cardButton);
}

describe("PromotionWorkspace synchronization", () => {
  beforeEach(() => {
    apiMock.mockReset();
  });

  afterEach(() => cleanup());

  it("presents promotions in a compact table with an accessible edit control", () => {
    renderWorkspace();

    expect(screen.getByRole("table", { name: "Promociones" })).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "Promoción" })).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "Estado" })).toBeVisible();
    expect(screen.getByText("Mostrando 1 promoción")).toBeVisible();
    openPromotionEditor();
    expect(screen.getByRole("dialog")).toBeVisible();
  });

  it("keeps input focus while editing and restores the opener after a confirmed close", async () => {
    renderWorkspace();
    const opener = screen.getByText("Descuento de setiembre", { exact: true }).closest("button")!;
    opener.focus();
    fireEvent.click(opener);
    const name = screen.getByLabelText(/Nombre de promoción/);
    await waitFor(() => expect(name).toHaveFocus());
    fireEvent.change(name, { target: { value: "Nueva descripción" } });
    expect(name).toHaveFocus();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.keyDown(name, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(name).toHaveValue("Nueva descripción");
    confirm.mockReturnValue(true);
    fireEvent.keyDown(name, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
    confirm.mockRestore();
  });

  it("supports keyboard action and creation menus without issuing a write", () => {
    renderWorkspace();
    const trigger = screen.getByRole("button", { name: "Opciones de Descuento de setiembre" });
    trigger.focus();
    fireEvent.click(trigger);
    const edit = screen.getByRole("menuitem", { name: "Editar" });
    expect(edit).toHaveFocus();
    fireEvent.keyDown(edit, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "Pausar" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    const create = screen.getByRole("button", { name: "Nueva promoción" });
    fireEvent.click(create);
    const discount = screen.getByRole("menuitem", { name: /Descuento en productos/ });
    expect(discount).toHaveFocus();
    fireEvent.keyDown(discount, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: /Compra X y paga Y/ })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(create).toHaveFocus();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    fireEvent.click(create);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it("uses catalog promotions under StrictMode without an eager secondary request", async () => {
    const notify = vi.fn();
    const refreshCatalog = vi.fn().mockResolvedValue(undefined);
    const firstCatalog = catalog();
    const { rerender } = render(
      <StrictMode>
        <PromotionWorkspace catalog={firstCatalog} branchId={1} refreshCatalog={refreshCatalog} notify={notify} />
      </StrictMode>,
    );

    await waitFor(() => expect(screen.getByText("Descuento de setiembre", { exact: true })).toBeVisible());
    expect(apiMock).not.toHaveBeenCalled();

    rerender(
      <StrictMode>
        <PromotionWorkspace
          catalog={{ ...firstCatalog, promotions: [{ ...firstCatalog.promotions[0], version: 2 }] }}
          branchId={1}
          refreshCatalog={refreshCatalog}
          notify={notify}
        />
      </StrictMode>,
    );
    await Promise.resolve();
    expect(apiMock).not.toHaveBeenCalled();

    rerender(
      <StrictMode>
        <PromotionWorkspace catalog={catalog(2, [])} branchId={2} refreshCatalog={refreshCatalog} notify={notify} />
      </StrictMode>,
    );
    await waitFor(() => expect(screen.getByText("Crea promociones atractivas para tus clientes")).toBeVisible());
    expect(apiMock).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("loads archived promotions only after the operator asks for them", async () => {
    const archived = promotion({ id: 2, name: "Promoción antigua", archived_at: "2026-09-01T12:00:00Z", active: false });
    apiMock.mockResolvedValueOnce([promotion(), archived]);
    renderWorkspace();

    expect(apiMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Ver archivadas" }));

    await waitFor(() => expect(screen.getByText("Promoción antigua", { exact: true })).toBeVisible());
    expect(apiMock).toHaveBeenCalledOnce();
    expect(apiMock).toHaveBeenCalledWith("/catalog/promotions?branch_id=1&include_archived=true");
  });

  it("keeps an archived read failure inline and recovers without a global toast", async () => {
    const archived = promotion({ id: 2, name: "Promoción recuperada", archived_at: "2026-09-01T12:00:00Z", active: false });
    apiMock
      .mockRejectedValueOnce(new ApiError("No pudimos conectar", 0, undefined, "NETWORK_UNREACHABLE"))
      .mockResolvedValueOnce([promotion(), archived]);
    const notify = vi.fn();
    renderWorkspace({ notify });

    fireEvent.click(screen.getByRole("button", { name: "Ver archivadas" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("No se pudieron cargar las archivadas"));
    expect(notify).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(screen.getByText("Promoción recuperada", { exact: true })).toBeVisible());
    expect(apiMock).toHaveBeenCalledTimes(2);
    expect(notify).not.toHaveBeenCalled();
  });

  it("keeps a successful edit even when the silent catalog refresh fails", async () => {
    const updated = promotion({ name: "Martes de pizza", version: 2 });
    apiMock.mockResolvedValueOnce(updated);
    const refreshCatalog = vi.fn().mockRejectedValue(new Error("catalog unavailable"));
    const notify = vi.fn();
    renderWorkspace({ refreshCatalog, notify });

    openPromotionEditor();
    fireEvent.change(screen.getByLabelText(/Nombre de promoción/), { target: { value: "Martes de pizza" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText("Martes de pizza", { exact: true })).toBeVisible();
    expect(notify).toHaveBeenCalledWith("Promoción actualizada.");
    await waitFor(() => expect(refreshCatalog).toHaveBeenCalledOnce());
    expect(notify).not.toHaveBeenCalledWith(expect.stringContaining("servidor"), "error");
  });

  it("reconciles a lost save response before offering a retry", async () => {
    const updated = promotion({ name: "Martes de pizza", version: 2 });
    apiMock
      .mockRejectedValueOnce(new ApiError("No pudimos conectar", 0, undefined, "NETWORK_UNREACHABLE"))
      .mockResolvedValueOnce([updated]);
    const notify = vi.fn();
    renderWorkspace({ notify });

    openPromotionEditor();
    fireEvent.change(screen.getByLabelText(/Nombre de promoción/), { target: { value: "Martes de pizza" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText("Martes de pizza", { exact: true })).toBeVisible();
    expect(apiMock).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledWith("Promoción actualizada.");
    expect(notify).not.toHaveBeenCalledWith(expect.any(String), "error");
  });

  it("preserves the draft and exposes a retry for a confirmed save failure", async () => {
    apiMock
      .mockRejectedValueOnce(new ApiError("Servicio temporalmente no disponible", 503))
      .mockResolvedValueOnce([promotion()]);
    const notify = vi.fn();
    renderWorkspace({ notify });

    openPromotionEditor();
    fireEvent.change(screen.getByLabelText(/Nombre de promoción/), { target: { value: "Martes de pizza" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Servicio temporalmente no disponible"));
    expect(screen.getByLabelText(/Nombre de promoción/)).toHaveValue("Martes de pizza");
    expect(screen.getByRole("button", { name: "Reintentar guardado" })).toBeEnabled();
    expect(notify).not.toHaveBeenCalled();
  });
});
