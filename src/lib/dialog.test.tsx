import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Modal } from "../components/ui";
import { DialogPortal, useDialogSurface } from "./dialog";

afterEach(() => { cleanup(); document.body.style.overflow = ""; });

describe("shared dialog stack", () => {
  it("does not overwrite focus moved inside before the initial focus task runs", () => {
    vi.useFakeTimers();
    try {
      render(<Modal title="Fast interaction" onClose={vi.fn()}><button>Selected day</button></Modal>);
      const day = screen.getByRole("button", { name: "Selected day" });
      day.focus();
      vi.runOnlyPendingTimers();
      expect(day).toHaveFocus();
    } finally {
      cleanup();
      vi.useRealTimers();
    }
  });

  it("keeps a nested portal on top and restores each opener and the original body lock", async () => {
    function Example() {
      const [parent, setParent] = useState(false);
      const [child, setChild] = useState(false);
      return <><button onClick={() => setParent(true)}>Open parent</button>{parent && <Modal title="Parent" onClose={() => setParent(false)}><button onClick={() => setChild(true)}>Open child</button>{child && <Modal title="Child" onClose={() => setChild(false)}><button>Child action</button></Modal>}</Modal>}</>;
    }
    document.body.style.overflow = "scroll";
    render(<StrictMode><Example /></StrictMode>);
    const opener = screen.getByRole("button", { name: "Open parent" });
    opener.focus(); fireEvent.click(opener);
    const parent = screen.getByRole("dialog", { name: "Parent" });
    await waitFor(() => expect(within(parent).getByRole("button", { name: "Cerrar" })).toHaveFocus());
    const childOpener = within(parent).getByRole("button", { name: "Open child" });
    childOpener.focus(); fireEvent.click(childOpener);
    const child = screen.getByRole("dialog", { name: "Child" });
    const childClose = within(child).getByRole("button", { name: "Cerrar" });
    await waitFor(() => expect(childClose).toHaveFocus());
    fireEvent.keyDown(childClose, { key: "Tab", shiftKey: true });
    expect(within(child).getByRole("button", { name: "Child action" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(childClose).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Child" })).not.toBeInTheDocument();
    expect(parent).toBeInTheDocument();
    expect(childOpener).toHaveFocus();
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(opener).toHaveFocus();
    expect(document.body.style.overflow).toBe("scroll");
  });

  it("skips hidden, inert, disabled and negative-tabindex controls and recovers escaped focus", async () => {
    render(<><button>Outside</button><Modal title="Focus" onClose={vi.fn()}>
      <div style={{ display: "none" }}><button>Hidden ancestor</button></div>
      <div inert><button>Inert ancestor</button></div>
      <button disabled>Disabled</button><button tabIndex={-1}>Programmatic only</button><button>Last</button>
    </Modal></>);
    const close = screen.getByRole("button", { name: "Cerrar" });
    await waitFor(() => expect(close).toHaveFocus());
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(screen.getByRole("button", { name: "Last" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(close).toHaveFocus();
    screen.getByRole("button", { name: "Outside" }).focus();
    expect(close).toHaveFocus();
    screen.getByRole("dialog").focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(close).toHaveFocus();
  });

  it("supports conditional surfaces without locking the body before opening", async () => {
    const close = vi.fn();
    function Example({ enabled }: { enabled: boolean }) {
      const surface = useDialogSurface(close, { enabled });
      return enabled ? <DialogPortal><section ref={surface} role="dialog" aria-label="Conditional" tabIndex={-1}>No controls</section></DialogPortal> : null;
    }
    const { rerender } = render(<Example enabled={false} />);
    expect(document.body.style.overflow).toBe("");
    rerender(<Example enabled />);
    const dialog = screen.getByRole("dialog");
    await waitFor(() => expect(dialog).toHaveFocus());
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(dialog).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(close).toHaveBeenCalledTimes(1);
    rerender(<Example enabled={false} />);
    expect(document.body.style.overflow).toBe("");
  });

  it("keeps the opener across callback changes and respects a handled Escape", async () => {
    const first = vi.fn();
    const updated = vi.fn();
    function Example({ onClose }: { onClose: () => void }) {
      const [open, setOpen] = useState(false);
      return <><button onClick={() => setOpen(true)}>Opener</button>{open && <Modal title="Live callback" onClose={onClose}><input aria-label="Draft" onKeyDown={(event) => { if (event.key === "Escape") event.preventDefault(); }} /></Modal>}</>;
    }
    const { rerender, unmount } = render(<Example onClose={first} />);
    fireEvent.click(screen.getByRole("button", { name: "Opener" }));
    const input = screen.getByRole("textbox");
    await waitFor(() => expect(screen.getByRole("button", { name: "Cerrar" })).toHaveFocus());
    input.focus();
    rerender(<Example onClose={updated} />);
    expect(input).toHaveFocus();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(updated).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(updated).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    unmount();
    expect(document.body.style.overflow).toBe("");
  });
});
