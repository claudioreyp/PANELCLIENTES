import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { QzPrinters } from "../../lib/qz-tray";
import { QzIdentityDetails } from "./QzIdentityDetails";

vi.mock("../../lib/api", () => ({ apiBlob: vi.fn() }));
const data: QzPrinters = { printers: [], details: [], mode: "signed", identity: {
  subject: "CN=Escalar AI POS", issuer: "CN=Issuer", fingerprint_sha256: "a".repeat(64),
  valid_to: "2027-09-20T00:00:00+00:00", expires_soon: false, trust: "qz-issued", activation: "remember",
} };

describe("QZ identity guidance", () => {
  afterEach(cleanup);
  it("shows one-time consent and expiry, without a fake QZ badge or self-signed installer", () => {
    render(<QzIdentityDetails data={data} branchId={7} disabled={false} />);
    expect(screen.getByText(/Remember this decision/)).toBeVisible();
    expect(screen.getByText(/Certificado vigente hasta/)).toHaveTextContent("2027");
    expect(screen.queryByRole("button", { name: "Descargar activación de QZ" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Verified by/)).not.toBeInTheDocument();
  });
  it("retains own activation while awaiting official issuance and warns before expiry", () => {
    render(<QzIdentityDetails data={{ ...data, identity: { ...data.identity!, activation: "install-certificate", trust: "self-signed", expires_soon: true } }} branchId={7} disabled={true} />);
    expect(screen.getByRole("button", { name: "Descargar activación de QZ" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("30 días");
  });
  it("does not invent metadata for an older API and clears it when the scope disappears", () => {
    const view = render(<QzIdentityDetails data={data} branchId={7} disabled={false} />);
    view.rerender(<QzIdentityDetails data={{ ...data, identity: undefined }} branchId={8} disabled={false} />);
    expect(screen.queryByText(/Certificado vigente hasta/)).not.toBeInTheDocument();
    expect(screen.getByText(/confirme el tipo de certificado/)).toBeVisible();
    view.rerender(<QzIdentityDetails data={null} branchId={8} disabled={false} />);
    expect(screen.queryByText(/Firma del servidor activa/)).not.toBeInTheDocument();
  });
});
