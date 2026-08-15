import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ErrorState, Money, StatusPill } from "./ui";

describe("shared POS UI", () => {
  it("formats PEN amounts and readable statuses", () => {
    render(<div><Money value={42.5} /><StatusPill value="sent_to_kitchen" /></div>);
    expect(screen.getByText(/S\/\s*42[.,]50/)).toBeInTheDocument();
    expect(screen.getByText("sent to kitchen")).toBeInTheDocument();
  });

  it("lets operators retry failed requests", () => {
    const retry = vi.fn();
    render(<ErrorState message="No se pudo cargar" onRetry={retry} />);
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
