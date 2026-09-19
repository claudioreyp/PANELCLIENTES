import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QzActivationDownload } from "./QzActivationDownload";

const download = vi.hoisted(() => vi.fn());
vi.mock("../../lib/api", () => ({ apiBlob: download }));
const zip = () => new Blob(["public certificate only"], { type: "application/zip" });

describe("one-time QZ activation download", () => {
  beforeEach(() => {
    download.mockReset().mockResolvedValue(zip());
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn().mockReturnValue("blob:activation"), revokeObjectURL: vi.fn() }));
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("downloads only on click and never confirms machine activation", async () => {
    render(<QzActivationDownload branchId={7} disabled={false} />);
    expect(download).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Descargar activación de QZ" }));
    expect(await screen.findByRole("status")).toHaveTextContent("la descarga no confirma la activación");
    expect(download).toHaveBeenCalledExactlyOnceWith("/settings/branches/7/printing/qz/activation");
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button")).toBeEnabled();
  });

  it("blocks double clicks and ignores a late download after changing branches", async () => {
    let resolve!: (blob: Blob) => void;
    download.mockReturnValue(new Promise<Blob>(r => { resolve = r; }));
    const view = render(<QzActivationDownload key={7} branchId={7} disabled={false} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByRole("button"));
    expect(download).toHaveBeenCalledTimes(1);
    view.rerender(<QzActivationDownload key={8} branchId={8} disabled={false} />);
    await act(async () => { resolve(zip()); });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("button")).toBeEnabled();
  });

  it("does not download while locked or after becoming locked", async () => {
    let resolve!: (blob: Blob) => void;
    download.mockReturnValue(new Promise<Blob>(r => { resolve = r; }));
    const view = render(<QzActivationDownload branchId={7} disabled />);
    fireEvent.click(screen.getByRole("button"));
    expect(download).not.toHaveBeenCalled();
    view.rerender(<QzActivationDownload branchId={7} disabled={false} />);
    fireEvent.click(screen.getByRole("button"));
    view.rerender(<QzActivationDownload branchId={7} disabled />);
    await act(async () => { resolve(zip()); });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    view.rerender(<QzActivationDownload branchId={7} disabled={false} />);
    expect(screen.getByRole("button")).toBeEnabled();
  });

  it.each([new Blob([], { type: "application/zip" }), new Blob(["unauthorized"], { type: "application/json" }), null])(
    "keeps failures recoverable without downloading unexpected responses", async blob => {
      if (blob) download.mockResolvedValueOnce(blob);
      else download.mockRejectedValueOnce(new Error("private server detail"));
      render(<QzActivationDownload branchId={7} disabled={false} />);
      fireEvent.click(screen.getByRole("button"));
      expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo descargar");
      expect(screen.queryByText(/private server detail/)).not.toBeInTheDocument();
      expect(URL.createObjectURL).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button"));
      await waitFor(() => expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1));
    });
});
