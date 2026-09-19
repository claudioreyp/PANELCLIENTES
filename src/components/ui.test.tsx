import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorState, Modal, Money, StatusPill, Toast } from "./ui";

describe("shared POS UI", () => {
  afterEach(() => vi.useRealTimers());

  it("formats PEN amounts and readable statuses", () => {
    render(<div><Money value={42.5} /><StatusPill value="sent_to_kitchen" /></div>);
    expect(screen.getByText(/S\/\s*42[.,]50/)).toBeInTheDocument();
    expect(screen.getByText("Enviado a cocina")).toBeInTheDocument();
  });

  it("lets operators retry failed requests", () => {
    const retry = vi.fn();
    render(<ErrorState message="No se pudo cargar" onRetry={retry} />);
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("announces real errors and dismisses temporary success messages", async () => {
    vi.useFakeTimers();
    const dismiss = vi.fn();
    const { rerender } = render(
      <Toast message="Promoción creada." durationMs={4500} onDismiss={dismiss} />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Promoción creada.");
    await act(async () => vi.advanceTimersByTimeAsync(4500));
    expect(dismiss).toHaveBeenCalledOnce();

    rerender(<Toast message="No se pudo guardar" tone="error" onDismiss={dismiss} />);
    expect(screen.getByRole("alert")).toHaveTextContent("No se pudo guardar");
  });

  it("traps operational focus and closes a modal with Escape", async () => {
    function Example() {
      const [open, setOpen] = useState(false);
      return <><button onClick={() => setOpen(true)}>Abrir detalle</button>{open && <Modal title="Detalle" onClose={() => setOpen(false)}><button>Acción</button></Modal>}</>;
    }

    render(<Example />);
    const trigger = screen.getByRole("button", { name: "Abrir detalle" });
    trigger.focus();
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole("button", { name: "Cerrar" })).toHaveFocus());
    expect(document.body.style.overflow).toBe("hidden");

    const close = screen.getByRole("button", { name: "Cerrar" });
    const action = screen.getByRole("button", { name: "Acción" });
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(action).toHaveFocus();
    fireEvent.keyDown(action, { key: "Tab" });
    expect(close).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe("");
    expect(trigger).toHaveFocus();
  });
});
