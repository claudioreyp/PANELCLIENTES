import { describe, expect, it } from "vitest";
import { validateOrderEdit, type OrderEditDraft } from "./order-edit";

const draft: OrderEditDraft = { channel: "delivery", service: "own", name: "Claudio", phone: "944197385", notes: "", neighborhood: "", street: "", number: "", crossStreets: "", reference: "", fee: "0", externalId: "" };

describe("manual delivery edits", () => {
  it("can add just a street or a tariff without requiring other optional address fields", () => {
    expect(validateOrderEdit({ ...draft, street: "Av. Lima" }, { delivery_address: { street: "Av. Lima" } }, "pos")).toBeNull();
    expect(validateOrderEdit({ ...draft, fee: "5" }, { delivery_fee: 5 }, "pos")).toBeNull();
    expect(validateOrderEdit({ ...draft, name: "" }, { delivery_fee: 5 }, "pos")).toContain("nombre y teléfono");
  });
  it("preserves complete delivery validation for the agent and existing callers", () => {
    expect(validateOrderEdit(draft, { delivery_fee: 5 }, "whatsapp_agent")).toContain("calle y referencias");
    expect(validateOrderEdit(draft, { delivery_fee: 5 })).toContain("calle y referencias");
  });
});
