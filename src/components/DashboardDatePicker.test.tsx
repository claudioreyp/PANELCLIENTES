import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardDatePicker } from "./DashboardDatePicker";

afterEach(cleanup);
const initial = { from: "2026-09-08", to: "2026-09-08", preset: "Hoy" };
describe("dashboard date picker", () => {
  it("keeps presets provisional and cancels with Escape returning focus", async () => {
    const change = vi.fn();
    render(<DashboardDatePicker value={initial} today="2026-09-08" onChange={change} />);
    const trigger = screen.getByRole("button", { name: "Hoy" });
    trigger.focus(); fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Últimos 7 días" }));
    expect(change).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Hoy" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "6 meses anteriores" }));
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    expect(change).toHaveBeenCalledWith({ from: "2026-03-01", to: "2026-08-31", preset: "6 meses anteriores" });
    await waitFor(() => expect(trigger).toHaveFocus());
  });
  it("supports manual ranges, keyboard navigation and disabled future dates", async () => {
    const change = vi.fn();
    render(<DashboardDatePicker value={initial} today="2026-09-08" onChange={change} />);
    fireEvent.click(screen.getByRole("button", { name: "Hoy" }));
    const day8 = screen.getByRole("button", { name: /martes, 8 de se(p)?tiembre de 2026/ });
    expect(screen.getByRole("button", { name: /miércoles, 9 de se(p)?tiembre de 2026/ })).toBeDisabled();
    fireEvent.keyDown(day8, { key: "ArrowLeft" });
    const day7 = screen.getByRole("button", { name: /lunes, 7 de se(p)?tiembre de 2026/ });
    await waitFor(() => expect(day7).toHaveFocus());
    fireEvent.click(day7); fireEvent.click(day8);
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    expect(change).toHaveBeenCalledWith({ from: "2026-09-07", to: "2026-09-08" });
  });
});
