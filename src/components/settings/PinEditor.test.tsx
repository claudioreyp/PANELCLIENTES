import { StrictMode, useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PinEditor } from "./PinEditor";
import { SettingsDrawer } from "./SettingsPrimitives";

function Harness({ initial = "", preserveExisting = false, disabled = false, changed = () => {} }: {
  initial?: string;
  preserveExisting?: boolean;
  disabled?: boolean;
  changed?: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return <PinEditor value={value} preserveExisting={preserveExisting} disabled={disabled} onChange={(next) => { setValue(next); changed(next); }} />;
}

async function openPin(name = "Agregar PIN") {
  const trigger = screen.getByRole("button", { name });
  fireEvent.click(trigger);
  const popover = screen.getByRole("dialog", { name: "Editar PIN de acceso" });
  const display = within(popover).getByRole("group", { name: "PIN del miembro" });
  await waitFor(() => expect(display).toHaveFocus());
  return { trigger, popover, display };
}

function typeKeys(keys: string) {
  for (const key of keys) fireEvent.keyDown(document.activeElement!, { key });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PinEditor", () => {
  it("opens the labelled popover with four empty dots and the 3x4 keypad order", async () => {
    render(<Harness />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const { trigger, popover } = await openPin();
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).toHaveAttribute("aria-controls", popover.id);
    expect(popover).toHaveAttribute("aria-modal", "true");
    expect(popover.querySelectorAll(".settings-pin-dot")).toHaveLength(4);
    expect(popover.querySelectorAll(".is-filled")).toHaveLength(0);
    const buttons = within(within(popover).getByRole("group", { name: "Teclado numérico" })).getAllByRole("button");
    expect(buttons.map((button) => button.getAttribute("aria-label") || button.textContent)).toEqual([
      "1", "2", "3", "4", "5", "6", "7", "8", "9", "Limpiar PIN", "0", "Borrar último dígito",
    ]);
  });

  it("accepts physical digits including leading zero, caps at four and ignores unrelated shortcuts", async () => {
    const changed = vi.fn();
    render(<Harness changed={changed} />);
    const { display, popover } = await openPin();
    for (const options of [{ key: "a" }, { key: "-" }, { key: "３" }, { key: "7", ctrlKey: true }, { key: "8", metaKey: true }, { key: "9", altKey: true }, { key: "6", isComposing: true }]) {
      fireEvent.keyDown(display, options);
    }
    expect(changed).not.toHaveBeenCalled();
    typeKeys("08362");
    expect(changed).toHaveBeenCalledTimes(4);
    expect(changed).toHaveBeenLastCalledWith("0836");
    expect(within(popover).getByRole("status")).toHaveTextContent("4 de 4 dígitos ingresados.");
    expect(popover.querySelectorAll(".is-filled")).toHaveLength(4);
    fireEvent.keyDown(display, { key: "Backspace" });
    expect(changed).toHaveBeenLastCalledWith("083");
    expect(popover.querySelectorAll(".is-filled")).toHaveLength(3);
  });

  it("supports the onscreen zero, clear and backspace without exposing the draft", async () => {
    const changed = vi.fn();
    const storage = vi.spyOn(Storage.prototype, "setItem");
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "info"), vi.spyOn(console, "warn"), vi.spyOn(console, "error"), vi.spyOn(console, "debug")];
    render(<Harness changed={changed} />);
    const { popover, display } = await openPin();
    for (const digit of "8062") fireEvent.click(within(popover).getByRole("button", { name: digit }));
    expect(changed).toHaveBeenLastCalledWith("8062");
    expect(display).toHaveFocus();
    expect(document.body.innerHTML).not.toContain("8062");
    expect(document.body.textContent).not.toContain("8062");
    expect(document.querySelector("input")).toBeNull();
    expect(storage).not.toHaveBeenCalled();
    logs.forEach((log) => expect(log).not.toHaveBeenCalled());
    fireEvent.click(within(popover).getByRole("button", { name: "Borrar último dígito" }));
    expect(changed).toHaveBeenLastCalledWith("806");
    fireEvent.click(within(popover).getByRole("button", { name: "Limpiar PIN" }));
    expect(changed).toHaveBeenLastCalledWith("");
    expect(popover.querySelectorAll(".is-filled")).toHaveLength(0);
    fireEvent.keyDown(display, { key: "Backspace" });
    expect(changed).toHaveBeenLastCalledWith("");
  });

  it("validates Enter and Listo, then returns focus without submitting an enclosing form", async () => {
    const submit = vi.fn((event) => event.preventDefault());
    render(<form onSubmit={submit}><Harness /></form>);
    const { trigger, popover, display } = await openPin();
    typeKeys("80");
    fireEvent.keyDown(display, { key: "Enter" });
    expect(within(popover).getByRole("alert")).toHaveTextContent("exactamente 4 dígitos");
    fireEvent.click(within(popover).getByRole("button", { name: "Listo" }));
    expect(popover).toBeInTheDocument();
    typeKeys("62");
    expect(within(popover).queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.keyDown(display, { key: "Enter" });
    expect(popover).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAccessibleName("Editar PIN");
    expect(submit).not.toHaveBeenCalled();
  });

  it("does not replace native Enter or Space activation on keypad buttons", async () => {
    render(<Harness />);
    const { popover } = await openPin();
    const key = within(popover).getByRole("button", { name: "8" });
    act(() => key.focus());
    expect(fireEvent.keyDown(key, { key: "Enter" })).toBe(true);
    expect(fireEvent.keyDown(key, { key: " " })).toBe(true);
    expect(popover).toBeInTheDocument();
  });

  it("contains forward/backward Tab and attempted outside focus", async () => {
    render(<><button>Fuera</button><Harness /></>);
    const { popover, display } = await openPin();
    const last = within(popover).getByRole("button", { name: "Listo" });
    fireEvent.keyDown(display, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(display).toHaveFocus();
    act(() => screen.getByRole("button", { name: "Fuera" }).focus());
    expect(display).toHaveFocus();
  });

  it("allows closing an incomplete PIN without a physical keyboard", async () => {
    render(<Harness />);
    const { trigger, popover } = await openPin();
    fireEvent.click(within(popover).getByRole("button", { name: "8" }));
    fireEvent.click(within(popover).getByRole("button", { name: "Cerrar PIN" }));
    expect(popover).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAccessibleDescription(/Completa los 4 dígitos/);
    const reopened = await openPin("Editar PIN");
    expect(within(reopened.popover).getByRole("status")).toHaveTextContent("1 de 4");
  });

  it("closes only the nested popover on Escape and leaves drawer dirty handling intact", async () => {
    const onClose = vi.fn();
    render(<SettingsDrawer title="Miembro" dirty onClose={onClose}><Harness /></SettingsDrawer>);
    const { trigger, popover } = await openPin();
    typeKeys("80");
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(popover).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    const reopened = await openPin("Editar PIN");
    expect(within(reopened.popover).getByRole("status")).toHaveTextContent("2 de 4");
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.getByRole("alertdialog", { name: "Tienes cambios sin guardar" })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("preserves the existing PIN when empty and allows clearing a replacement", async () => {
    const changed = vi.fn();
    render(<Harness preserveExisting changed={changed} />);
    const { popover, display, trigger } = await openPin("Cambiar PIN");
    expect(trigger).toHaveAccessibleDescription(/vacío para conservar el PIN actual/);
    fireEvent.keyDown(display, { key: "Enter" });
    expect(popover).not.toBeInTheDocument();
    expect(changed).not.toHaveBeenCalled();
    const reopened = await openPin("Cambiar PIN");
    typeKeys("8062");
    fireEvent.click(within(reopened.popover).getByRole("button", { name: "Limpiar PIN" }));
    fireEvent.click(within(reopened.popover).getByRole("button", { name: "Listo" }));
    expect(changed).toHaveBeenLastCalledWith("");
    expect(trigger).toHaveAccessibleName("Cambiar PIN");
  });

  it("disables opening and closes an active keypad when saving or permissions disable it", async () => {
    const view = render(<Harness disabled />);
    expect(screen.getByRole("button", { name: "Agregar PIN" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Agregar PIN" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    view.rerender(<Harness />);
    await openPin();
    view.rerender(<Harness disabled />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    view.rerender(<Harness />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("releases focus and body locking after unmount and retains no PIN on a new mount", async () => {
    const before = document.body.style.overflow;
    const view = render(<StrictMode><Harness /></StrictMode>);
    await openPin();
    typeKeys("8062");
    expect(document.body.style.overflow).toBe("hidden");
    view.unmount();
    expect(document.body.style.overflow).toBe(before);
    render(<StrictMode><Harness /></StrictMode>);
    const { popover } = await openPin();
    expect(within(popover).getByRole("status")).toHaveTextContent("0 de 4");
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(document.body.style.overflow).toBe(before);
  });
});
