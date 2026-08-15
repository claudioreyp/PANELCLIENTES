import { describe, expect, it } from "vitest";
import { persistInvitationScope } from "./invitation";

describe("invitation tenant activation", () => {
  it("clears a stale branch when the owner receives business-wide access", () => {
    localStorage.setItem("impulsa.branchId", "999");
    persistInvitationScope(localStorage, { business_id: 12, branch_id: null });
    expect(localStorage.getItem("impulsa.businessId")).toBe("12");
    expect(localStorage.getItem("impulsa.branchId")).toBeNull();
  });

  it("stores a branch for branch-scoped employee invitations", () => {
    persistInvitationScope(localStorage, { business_id: 12, branch_id: 34 });
    expect(localStorage.getItem("impulsa.branchId")).toBe("34");
  });
});
