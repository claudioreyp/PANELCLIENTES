import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SchedulesSettings } from "./ScheduleSettings";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("../../lib/api", async (importOriginal) => ({ ...await importOriginal<typeof import("../../lib/api")>(), api: apiMock }));
afterEach(cleanup);

describe("schedule drafts", () => {
  it("protects a new schedule name before it is added to the section draft", async () => {
    apiMock.mockResolvedValue({ items: [] });
    render(<SchedulesSettings branchId={7} />);
    await screen.findByRole("button", { name: "Guardar" });
    fireEvent.click(screen.getByRole("button", { name: "Nuevo horario" }));
    fireEvent.change(screen.getByLabelText("Nombre del horario"), { target: { value: "Almuerzo" } });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("alertdialog", { name: "Tienes cambios sin guardar" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Seguir editando" }));
    expect(screen.getByDisplayValue("Almuerzo")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Agregar horario" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("Almuerzo")).toBeVisible();
    expect(screen.getByRole("button", { name: "Guardar" })).toBeEnabled();
    expect(apiMock.mock.calls.filter(([, options]) => options?.method)).toHaveLength(0);
  });
});
