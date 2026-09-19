import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrintingSettings } from "./PrintingSettings";

const apiMock = vi.hoisted(() => vi.fn());
const printersMock = vi.hoisted(() => vi.fn());
const dispatchMock = vi.hoisted(() => vi.fn());
vi.mock("../../lib/api", async (importOriginal) => ({ ...await importOriginal<typeof import("../../lib/api")>(), api: apiMock }));
vi.mock("../../lib/qz-tray", async (importOriginal) => ({ ...await importOriginal<typeof import("../../lib/qz-tray")>(), qzBridge: { printers: printersMock, dispatch: dispatchMock, isActive: () => true, disconnect: vi.fn().mockResolvedValue(undefined) } }));

const printing = { version: 4, advanced_printing: true, printer_config: { operating_system: "windows", printer_name: "Cocina", paper_width_mm: 80, copies: 1, auto_print_kitchen: true, manual_customer_receipt: true }, customer_ticket_template: { fields: [{ key: "notes", label: "Notas del pedido", enabled: true }] }, kitchen_ticket_template: { fields: [{ key: "notes", label: "Notas de cocina", enabled: true }] } };

async function showDiagnostics() {
  const summary = await screen.findByText("Conexión y prueba de impresión");
  if (!summary.parentElement?.hasAttribute("open")) fireEvent.click(summary);
}

async function configure() {
  fireEvent.click(await screen.findByRole("button", { name: "Configurar impresión" }));
  fireEvent.click(screen.getByText("Opciones avanzadas"));
  return screen.getByRole("dialog", { name: "Configurar impresora" });
}

const writes = () => apiMock.mock.calls.filter(([, options]) => options?.method === "PATCH");

describe("printing configuration and QZ discovery", () => {
  beforeEach(() => {
    apiMock.mockReset();
    printersMock.mockReset();
    dispatchMock.mockReset().mockResolvedValue(undefined);
    printersMock.mockResolvedValue({ printers: ["Cocina", "Caja"], mode: "manual-approval" });
    let saved = printing;
    apiMock.mockImplementation((path: string, options?: RequestInit) => {
      if (options?.method) saved = { ...saved, ...JSON.parse(String(options.body)), version: saved.version + 1 };
      return Promise.resolve(path.endsWith("/printers") ? [] : saved);
    });
  });
  afterEach(cleanup);

  it("autosaves advanced off/on while preserving the master and both document preferences", async () => {
    let saved = { ...printing, printer_config: { ...printing.printer_config, automatic_printing: false, auto_print_kitchen: false, copies: 3 } };
    apiMock.mockImplementation((_path: string, options?: RequestInit) => {
      if (options?.method) saved = { ...saved, ...JSON.parse(String(options.body)), version: saved.version + 1 };
      return Promise.resolve(saved);
    });
    render(<PrintingSettings branchId={7} />);
    fireEvent.click(await screen.findByRole("switch", { name: "Impresión avanzada" }));
    await waitFor(() => expect(screen.getByRole("switch", { name: "Impresión avanzada" })).toBeEnabled());
    expect(writes()).toHaveLength(1);
    expect(JSON.parse(writes()[0][1].body)).toMatchObject({ advanced_printing: false, expected_version: 4 });
    expect(screen.queryByLabelText("Sistema operativo")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Impresora")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Configurar impresión" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Personalizar cliente" })).toBeEnabled();
    fireEvent.click(screen.getByRole("switch", { name: "Impresión avanzada" }));
    await waitFor(() => expect(screen.getByRole("switch", { name: "Impresión avanzada" })).toBeEnabled());
    expect(writes()).toHaveLength(2);
    expect(JSON.parse(writes()[1][1].body)).toMatchObject({ advanced_printing: true, expected_version: 5, printer_config: { automatic_printing: false, auto_print_kitchen: false, manual_customer_receipt: true, copies: 3 } });
    expect(screen.getByRole("button", { name: "Configurar impresión" })).toBeEnabled();
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it("explains repeated authorization without treating printer selection as trust", async () => {
    render(<PrintingSettings branchId={7} />);
    expect(await screen.findByText("Autorización por trabajo.")).toBeVisible();
    fireEvent.click(screen.getByText("Conexión y prueba de impresión"));
    expect(screen.getByText(/No autorices permanentemente solicitudes anónimas/)).toBeVisible();
    expect(screen.queryByText("Firma del servidor activa.")).not.toBeInTheDocument();
  });

  it("distinguishes a server signature from local QZ trust", async () => {
    printersMock.mockResolvedValue({ printers: ["Cocina"], mode: "signed" });
    render(<PrintingSettings branchId={7} />);
    await screen.findByText("QZ Tray conectado");
    fireEvent.click(screen.getByText("Conexión y prueba de impresión"));
    expect(screen.getByText("Firma del servidor activa.")).toBeVisible();
    expect(screen.getByText(/Remember this decision/)).toBeVisible();
    expect(screen.queryByText("Autorización por trabajo.")).not.toBeInTheDocument();
  });

  it("rolls back a failed printer selection after verifying the saved settings without another write", async () => {
    render(<PrintingSettings branchId={7} />);
    await screen.findByText("QZ Tray conectado");
    apiMock.mockRejectedValueOnce(new Error("No se pudo guardar."));
    fireEvent.change(screen.getByLabelText("Impresora"), { target: { value: "Caja" } });
    expect(await screen.findByText(/El cambio no está confirmado/)).toBeVisible();
    expect(screen.getByLabelText("Impresora")).toHaveValue("Cocina");
    expect(screen.getByLabelText("Impresora")).toBeEnabled();
    expect(writes()).toHaveLength(1);
  });

  it("keeps an uncertain main change locked and verifies with GET only", async () => {
    render(<PrintingSettings branchId={7} />);
    await screen.findByText("QZ Tray conectado");
    apiMock.mockRejectedValue(new Error("Offline"));
    fireEvent.change(screen.getByLabelText("Impresora"), { target: { value: "Caja" } });
    const verify = await screen.findByRole("button", { name: "Verificar guardado" });
    expect(screen.getByLabelText("Impresora")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Personalizar cliente" })).toBeDisabled();
    expect(writes()).toHaveLength(1);
    apiMock.mockResolvedValue({ ...printing, version: 5, printer_config: { ...printing.printer_config, printer_name: "Caja" } });
    fireEvent.click(verify);
    await waitFor(() => expect(screen.getByLabelText("Impresora")).toBeEnabled());
    expect(screen.getByLabelText("Impresora")).toHaveValue("Caja");
    expect(writes()).toHaveLength(1);
  });

  it("keeps per-document preferences while disabling the master and labels the real copy count", async () => {
    render(<PrintingSettings branchId={7} />);
    await screen.findByText("QZ Tray conectado");
    await configure();
    expect(screen.getByRole("switch", { name: "Impresión automática" })).toHaveAttribute("aria-checked", "true");
    fireEvent.change(screen.getByLabelText("Copias por trabajo"), { target: { value: "3" } });
    expect(screen.getAllByRole("option", { name: "Imprimir 3 veces" })).toHaveLength(2);
    expect(screen.getByLabelText("Ticket para cliente", { exact: true })).toHaveValue("off");
    expect(screen.getByLabelText("Ticket para cocina/barra", { exact: true })).toHaveValue("on");
    fireEvent.click(screen.getByRole("switch", { name: "Impresión automática" }));
    expect(screen.getByLabelText("Ticket para cocina/barra", { exact: true })).toBeDisabled();
    expect(writes()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(JSON.parse(writes()[0][1].body)).toMatchObject({ printer_config: { copies: 3, automatic_printing: false, manual_customer_receipt: true, auto_print_kitchen: true } });
    await configure();
    fireEvent.click(screen.getByRole("switch", { name: "Impresión automática" }));
    expect(screen.getByLabelText("Ticket para cliente", { exact: true })).toHaveValue("off");
    expect(screen.getByLabelText("Ticket para cocina/barra", { exact: true })).toHaveValue("on");
  });

  it("rejects empty, fractional and out-of-range copies without saving", async () => {
    render(<PrintingSettings branchId={7} />);
    await screen.findByText("QZ Tray conectado");
    await configure();
    for (const value of ["", "0", "1.5", "6"]) {
      fireEvent.change(screen.getByLabelText("Copias por trabajo"), { target: { value } });
      expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();
    }
    expect(writes()).toHaveLength(0);
  });

  it("previews escaped receipt text and only saves the editor on explicit confirmation", async () => {
    render(<PrintingSettings branchId={7} />);
    fireEvent.click(await screen.findByRole("button", { name: "Personalizar cliente" }));
    const editor = screen.getByRole("dialog", { name: "Ticket para cliente" });
    fireEvent.change(screen.getByLabelText("Tamaño de letra"), { target: { value: "large" } });
    fireEvent.click(screen.getByLabelText("Encabezado personalizado"));
    fireEvent.change(screen.getByLabelText("Texto del encabezado"), { target: { value: "Gracias <script>alert(1)</script>" } });
    fireEvent.click(screen.getByLabelText("Pie de página personalizado"));
    fireEvent.change(screen.getByLabelText("Texto del pie de página"), { target: { value: "Vuelve pronto" } });
    const preview = within(editor).getByRole("region", { name: "Vista previa del ticket" });
    expect(within(preview).getByText("Gracias <script>alert(1)</script>")).toBeInTheDocument();
    expect(preview.querySelector("script")).toBeNull();
    expect(within(preview).getByText("Vuelve pronto")).toBeInTheDocument();
    expect(writes()).toHaveLength(0);
    expect(dispatchMock).not.toHaveBeenCalled();
    fireEvent.click(within(editor).getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(JSON.parse(writes()[0][1].body)).toMatchObject({ customer_ticket_template: { font_size: "large", header_enabled: true, header_text: "Gracias <script>alert(1)</script>", footer_enabled: true, footer_text: "Vuelve pronto" }, printer_config: { copies: 1, printer_name: "Cocina" }, expected_version: 4 });
    fireEvent.click(screen.getByRole("button", { name: "Personalizar cocina" }));
    expect(screen.queryByLabelText("Encabezado personalizado")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Tamaño de letra")).toHaveValue("normal");
    fireEvent.change(screen.getByLabelText("Tamaño de letra"), { target: { value: "small" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(JSON.parse(writes()[1][1].body)).toMatchObject({ expected_version: 5, kitchen_ticket_template: { font_size: "small" }, customer_ticket_template: { font_size: "large", footer_text: "Vuelve pronto" } });
  });

  it("retains hidden header text and blocks Escape during an editor save", async () => {
    render(<PrintingSettings branchId={7} />);
    fireEvent.click(await screen.findByRole("button", { name: "Personalizar cliente" }));
    fireEvent.click(screen.getByLabelText("Encabezado personalizado"));
    fireEvent.change(screen.getByLabelText("Texto del encabezado"), { target: { value: "Texto retenido" } });
    fireEvent.click(screen.getByLabelText("Encabezado personalizado"));
    expect(screen.queryByLabelText("Texto del encabezado")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Encabezado personalizado"));
    expect(screen.getByLabelText("Texto del encabezado")).toHaveValue("Texto retenido");
    let release!: (value: unknown) => void;
    apiMock.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(screen.getByRole("button", { name: "Salir" })).toBeDisabled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    const saved = { ...printing, version: 5, customer_ticket_template: { ...printing.customer_ticket_template, header_enabled: true, header_text: "Texto retenido" } };
    apiMock.mockResolvedValue(saved);
    await act(async () => release(saved));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("automatically discovers printers, keeps preferences, and saves explicit changes", async () => {
    render(<PrintingSettings branchId={7} />);
    expect(await screen.findByRole("switch", { name: "Impresión avanzada" })).toBeEnabled();
    expect(screen.getByRole("switch", { name: "Impresión avanzada" })).toHaveAttribute("aria-checked", "true");
    expect(await screen.findByText("QZ Tray conectado")).toBeVisible();
    await showDiagnostics();
    expect(screen.getByText("Autorización por trabajo.")).toBeVisible();
    expect(screen.getByRole("option", { name: "Caja" })).toBeInTheDocument();
    expect(apiMock.mock.calls.filter(([, options]) => options?.method)).toHaveLength(0);
    expect(printersMock).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll(".settings-card")).toHaveLength(3);
    expect(screen.getByRole("heading", { name: "Configuración de impresión" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Contactar soporte" })).toBeDisabled();
    expect(screen.getByLabelText("Sistema operativo")).toHaveAttribute("readonly");
    expect(screen.queryByRole("button", { name: "Guardar" })).not.toBeInTheDocument();
    await configure();
    fireEvent.change(screen.getByLabelText("Copias por trabajo"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Configurar impresora" })).not.toBeInTheDocument());
    expect(await screen.findByText("La configuración de impresión se guardó.")).toBeVisible();
    const request = apiMock.mock.calls.find(([, options]) => options?.method === "PATCH")![1];
    expect(JSON.parse(request.body)).toMatchObject({ advanced_printing: true, printer_config: { auto_print_kitchen: true, copies: 2, printer_name: "Cocina" } });
    expect(await screen.findByText(/Configuración verificada en la API.*Versión 5/)).toBeVisible();
  });

  it("prints a clearly marked receipt then a kitchen sample, without creating orders", async () => {
    render(<PrintingSettings branchId={7} businessName="Restaurante aislado" branchName="Sucursal de prueba" />);
    await showDiagnostics();
    await waitFor(() => expect(screen.getByRole("button", { name: "Imprimir prueba" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Imprimir prueba" }));
    expect(await screen.findByText(/2 documentos enviados a QZ Tray/)).toBeVisible();
    expect(dispatchMock).toHaveBeenCalledTimes(2);
    const [receipt, kitchen] = dispatchMock.mock.calls.map(([options]) => options);
    expect(receipt).toMatchObject({ branchId: 7, printerName: "Cocina", copies: 1, jobName: "PRUEBA - Ticket" });
    expect(kitchen).toMatchObject({ branchId: 7, jobName: "PRUEBA - Comanda" });
    expect(receipt.html).toContain("PRUEBA DE IMPRESION");
    expect(receipt.html).toContain("Monto a pagar");
    expect(kitchen.html).toContain("PRUEBA DE IMPRESION");
    expect(kitchen.html).not.toContain("Monto a pagar");
    expect(apiMock.mock.calls.filter(([, options]) => options?.method)).toHaveLength(0);
  });

  it("blocks graphical samples for a known text-only driver without silently changing mode", async () => {
    printersMock.mockResolvedValue({ printers: ["Cocina"], details: [{ name: "Cocina", driver: "Generic / Text Only" }], mode: "signed" });
    render(<PrintingSettings branchId={7} />);
    await showDiagnostics();
    expect(await screen.findByText(/No se enviará impresión gráfica/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Imprimir prueba" })).toBeDisabled();
    expect(dispatchMock).not.toHaveBeenCalled();
    await configure();
    expect(screen.getByLabelText("Tipo de impresora")).toHaveValue("pixel");
  });

  it("blocks an unverified saved version and recovers with reads only", async () => {
    apiMock.mockResolvedValueOnce(printing).mockRejectedValueOnce(new Error("API offline"));
    render(<PrintingSettings branchId={7} />);
    await showDiagnostics();
    expect(await screen.findByText(/No se pudo verificar el guardado en la API/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Imprimir prueba" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Verificar de nuevo" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Imprimir prueba" })).toBeEnabled());
    expect(apiMock.mock.calls.filter(([, options]) => options?.method)).toHaveLength(0);
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it("does not send the second sample after an uncertain first result", async () => {
    dispatchMock.mockImplementation(async (options) => { options.onSending(); throw new Error("Connection closed"); });
    render(<PrintingSettings branchId={7} />);
    await showDiagnostics();
    await waitFor(() => expect(screen.getByRole("button", { name: "Imprimir prueba" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Imprimir prueba" }));
    expect(await screen.findByText(/QZ no confirmó el resultado/)).toBeVisible();
    expect(dispatchMock).toHaveBeenCalledTimes(1);
  });

  it("cancels the remaining sample and ignores the late response when the branch changes", async () => {
    let resolve!: () => void;
    dispatchMock.mockImplementationOnce(() => new Promise<void>((done) => { resolve = done; }));
    const view = render(<PrintingSettings branchId={7} />);
    await showDiagnostics();
    await waitFor(() => expect(screen.getByRole("button", { name: "Imprimir prueba" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Imprimir prueba" }));
    await waitFor(() => expect(dispatchMock).toHaveBeenCalledTimes(1));
    view.rerender(<PrintingSettings branchId={8} />);
    await act(async () => resolve());
    expect(dispatchMock.mock.calls[0][0].signal.aborted).toBe(true);
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/2 documentos enviados/)).not.toBeInTheDocument();
  });

  it("keeps a missing saved printer distinct from locally discovered printers", async () => {
    printersMock.mockResolvedValue({ printers: ["Caja"], mode: "signed" });
    render(<PrintingSettings branchId={7} />);
    expect(await screen.findByText("QZ Tray conectado")).toBeVisible();
    expect(screen.getByRole("option", { name: "Cocina (no detectada)" })).toBeDisabled();
    expect(screen.getByLabelText("Impresora")).toHaveValue("Cocina");
    await configure();
    fireEvent.change(screen.getByLabelText("Copias por trabajo"), { target: { value: "2" } });
    expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();
  });

  it("reports an empty printer list and does not claim that a configured printer was detected", async () => {
    printersMock.mockResolvedValue({ printers: [], mode: "signed" });
    render(<PrintingSettings branchId={7} />);
    expect(await screen.findByText(/No se encontraron impresoras/)).toBeVisible();
    expect(screen.queryByRole("option", { name: "Cocina" })).not.toBeInTheDocument();
  });

  it("offers installation and retries a recoverable failure without saving", async () => {
    printersMock.mockRejectedValueOnce(new Error("Unable to establish connection with QZ Tray"));
    render(<PrintingSettings branchId={7} />);
    await showDiagnostics();
    expect(await screen.findByText("QZ Tray no se encuentra abierto")).toBeVisible();
    expect(screen.getByRole("link", { name: "Instalar QZ Tray" })).toHaveAttribute("href", "https://qz.io/download/");
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("QZ Tray conectado")).toBeVisible();
    expect(apiMock.mock.calls.filter(([, options]) => options?.method)).toHaveLength(0);
  });

  it("ignores a late printer response after changing branches", async () => {
    let resolve!: (value: unknown) => void;
    printersMock.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const view = render(<PrintingSettings branchId={7} />);
    await waitFor(() => expect(printersMock).toHaveBeenCalledTimes(1));
    view.rerender(<PrintingSettings branchId={8} />);
    await waitFor(() => expect(printersMock).toHaveBeenCalledTimes(2));
    await act(async () => resolve({ printers: ["Vieja"], mode: "signed" }));
    expect(screen.queryByRole("option", { name: "Vieja" })).not.toBeInTheDocument();
    expect(await screen.findByRole("option", { name: "Caja" })).toBeInTheDocument();
  });

  it("protects ticket edits, keeps them on failure, and discards only that ticket draft", async () => {
    render(<PrintingSettings branchId={7} />);
    await screen.findByText("QZ Tray conectado");
    await configure();
    fireEvent.change(screen.getByLabelText("Copias por trabajo"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const opener = screen.getByRole("button", { name: "Personalizar cliente" });
    opener.focus();
    fireEvent.click(opener);
    const drawer = screen.getByRole("dialog", { name: "Ticket para cliente" });
    fireEvent.click(screen.getByText("Campos avanzados del ticket"));
    fireEvent.click(within(drawer).getByRole("switch", { name: "Notas del pedido" }));
    apiMock.mockRejectedValueOnce(new Error("No se pudo guardar la plantilla."));
    fireEvent.click(within(drawer).getByRole("button", { name: "Guardar" }));
    expect(await within(drawer).findByRole("alert")).toHaveTextContent("No se pudo guardar");
    expect(within(drawer).getByRole("switch", { name: "Notas del pedido" })).toHaveAttribute("aria-checked", "false");
    fireEvent.click(within(drawer).getByRole("button", { name: "Salir" }));
    fireEvent.click(screen.getByRole("button", { name: "Seguir editando" }));
    expect(drawer).toBeVisible();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Descartar cambios" }));
    expect(opener).toHaveFocus();
    await configure();
    expect(screen.getByLabelText("Copias por trabajo")).toHaveValue(2);
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    fireEvent.click(opener);
    fireEvent.click(screen.getByText("Campos avanzados del ticket"));
    expect(screen.getByRole("switch", { name: "Notas del pedido" })).toHaveAttribute("aria-checked", "true");
  });
});
