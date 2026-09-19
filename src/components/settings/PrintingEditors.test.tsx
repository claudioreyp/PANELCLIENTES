import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrintSettings } from "../../types/settings";
import { PrintingConfigurationDialog, PrintingTemplateEditor } from "./PrintingEditors";
import { SettingsStateProvider } from "./SettingsState";

const settings: PrintSettings = {
  version: 4, advanced_printing: true, operating_system: "windows", printer_name: "Caja",
  paper_width_mm: 80, copies: 1, auto_print_kitchen: true, manual_customer_receipt: true,
  customer_ticket_fields: [{ key: "notes", label: "Notas del pedido", enabled: true }],
  kitchen_ticket_fields: [{ key: "items", label: "Productos", enabled: true }],
};
const common = () => ({ settings, busy: false, enabled: true, error: null, onSave: vi.fn().mockResolvedValue(true), onClose: vi.fn() });

afterEach(cleanup);

describe("independent printing drafts", () => {
  it("submits only changed modal fields, never templates or main choices", async () => {
    const props = common();
    render(<PrintingConfigurationDialog {...props} validate={() => null} />);
    expect(screen.getByText(/Impresora:/).parentElement).toHaveTextContent("Impresora: Caja");
    expect(screen.getByText(/Al crear un pedido fuera de mesas/)).toBeInTheDocument();
    expect(screen.getByText(/incluidos los productos agregados/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Ancho de papel"), { target: { value: "58" } });
    fireEvent.click(screen.getByRole("switch", { name: "Impresión automática" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(props.onSave).toHaveBeenCalledWith({ paper_width_mm: 58, automatic_printing: false }));
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it("limits plain header and footer text to 500 characters and blocks an oversized existing draft", async () => {
    const props = common();
    props.settings = { ...settings, customer_ticket_header_enabled: true, customer_ticket_header_text: "x".repeat(501), customer_ticket_footer_enabled: true, customer_ticket_footer_text: "Gracias" };
    render(<PrintingTemplateEditor {...props} kind="customer" />);
    const header = screen.getByLabelText(/Texto del encabezado/);
    const footer = screen.getByLabelText(/Texto del pie de página/);
    expect(header).toHaveAttribute("maxlength", "500");
    expect(footer).toHaveAttribute("maxlength", "500");
    expect(header).toHaveAttribute("aria-invalid", "true");
    expect(header).toHaveAccessibleDescription(/debajo del nombre del negocio.*501\/500/);
    expect(footer).toHaveAccessibleDescription(/al final del ticket.*7\/500/);
    fireEvent.change(screen.getByLabelText("Tamaño de letra"), { target: { value: "large" } });
    expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("500 caracteres");
    fireEvent.change(header, { target: { value: "x".repeat(500) } });
    expect(screen.getByRole("button", { name: "Guardar" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(props.onSave).toHaveBeenCalledWith({ customer_ticket_header_text: "x".repeat(500), customer_ticket_font_size: "large" }));
  });

  it("submits only the selected template patch and retains the local draft on failure", async () => {
    const props = common(); props.onSave.mockResolvedValue(false);
    const view = render(<PrintingTemplateEditor {...props} kind="customer" />);
    fireEvent.change(screen.getByLabelText("Tamaño de letra"), { target: { value: "large" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(props.onSave).toHaveBeenCalledWith({ customer_ticket_font_size: "large" }));
    expect(props.onClose).not.toHaveBeenCalled();
    view.rerender(<PrintingTemplateEditor {...props} kind="customer" error="No se pudo confirmar el guardado." />);
    expect(screen.getByLabelText("Tamaño de letra")).toHaveValue("large");
    expect(screen.getByRole("alert")).toHaveTextContent("No se pudo confirmar");
  });

  it("registers the local draft for existing guards and preserves it across a disabled scope", async () => {
    const props = common(); const registration = vi.fn();
    const tree = (enabled: boolean) => <SettingsStateProvider onRegistration={registration}><PrintingTemplateEditor {...props} enabled={enabled} kind="kitchen" /></SettingsStateProvider>;
    const view = render(tree(true));
    fireEvent.change(screen.getByLabelText("Tamaño de letra"), { target: { value: "small" } });
    expect(registration).toHaveBeenLastCalledWith({ dirty: true, saving: false, save: null });
    view.rerender(tree(false));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(props.onClose).not.toHaveBeenCalled();
    expect(props.onSave).not.toHaveBeenCalled();
    view.rerender(tree(true));
    expect(screen.getByLabelText("Tamaño de letra")).toHaveValue("small");
    fireEvent.click(screen.getByText("Campos avanzados del ticket"));
    expect(screen.getByRole("switch", { name: "Productos" })).toBeDisabled();
    expect(screen.getByRole("switch", { name: "Productos" })).toHaveAttribute("aria-checked", "true");
  });

  it("contains keyboard focus in the editor and then its discard confirmation", async () => {
    const props = common();
    render(<PrintingTemplateEditor {...props} kind="kitchen" />);
    const exit = screen.getByRole("button", { name: "Salir" });
    await waitFor(() => expect(exit).toHaveFocus());
    fireEvent.change(screen.getByLabelText("Tamaño de letra"), { target: { value: "large" } });
    fireEvent.keyDown(document, { key: "Escape" });
    const keep = screen.getByRole("button", { name: "Seguir editando" });
    const discard = screen.getByRole("button", { name: "Descartar cambios" });
    await waitFor(() => expect(keep).toHaveFocus());
    fireEvent.keyDown(keep, { key: "Tab", shiftKey: true });
    expect(discard).toHaveFocus();
    fireEvent.keyDown(discard, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(props.onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Tamaño de letra")).toHaveValue("large");
  });
});
