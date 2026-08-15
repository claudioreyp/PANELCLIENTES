export type AcceptedInvitationScope = {
  business_id: number;
  branch_id: number | null;
};

export function persistInvitationScope(
  storage: Pick<Storage, "setItem" | "removeItem">,
  invitation: AcceptedInvitationScope,
): void {
  storage.setItem("impulsa.businessId", String(invitation.business_id));
  if (invitation.branch_id) storage.setItem("impulsa.branchId", String(invitation.branch_id));
  else storage.removeItem("impulsa.branchId");
}
