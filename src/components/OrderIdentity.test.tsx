import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { OrderIdentity } from "./OrderIdentity";

afterEach(cleanup);

describe("order identity presentation", () => {
  it("keeps the complete code in default and explicit full mode", () => {
    const { container, rerender } = render(<OrderIdentity folio={7} number="260910-ABCDEF-COMPLETE" />);
    expect(container.textContent).toBe("#7 \u00b7 #260910-ABCDEF-COMPLETE");
    expect(screen.getByText("#7")).toHaveClass("order-folio");
    expect(screen.getByText("#260910-ABCDEF-COMPLETE")).toHaveClass("order-code");
    rerender(<OrderIdentity folio={7} number="260910-ABCDEF-COMPLETE" mode="full" />);
    expect(container.textContent).toBe("#7 \u00b7 #260910-ABCDEF-COMPLETE");
  });

  it("omits the code and separator entirely in folio mode, including attributes", () => {
    const { container } = render(<OrderIdentity folio={7} number="260910-ABCDEF-COMPLETE" mode="folio" />);
    expect(container.textContent).toBe("#7");
    expect(container.innerHTML).not.toContain("260910-ABCDEF-COMPLETE");
    expect(container.querySelector(".order-code, .order-identity-separator, [title], [aria-label]")).toBeNull();
  });

  it.each([null, undefined])("shows Sin folio for a %s folio without revealing the code", (folio) => {
    const { container, rerender } = render(<OrderIdentity folio={folio} number="LEGACY-PRIVATE-CODE" mode="folio" />);
    expect(container.textContent).toBe("Sin folio");
    expect(container.innerHTML).not.toContain("LEGACY-PRIVATE-CODE");
    rerender(<OrderIdentity folio={folio} number="LEGACY-PRIVATE-CODE" />);
    expect(container.textContent).toBe("#LEGACY-PRIVATE-CODE");
  });
});
