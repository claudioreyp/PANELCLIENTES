import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadSettings, memberInvitationFeedback, printingTemplate, saveSettings } from "./settings";
import type { BranchProfileSettings, DeliverySettings, MemberSaveResult, SettingsMembers, PrintSettings } from "../types/settings";

const apiMock = vi.hoisted(() => vi.fn());

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, api: apiMock };
});

const profileFallback: BranchProfileSettings = {
  id: 7,
  alias: "Sucursal",
  address: "",
  maps_url: "",
  google_place_id: "",
  latitude: null,
  longitude: null,
  logo_url: null,
  cover_url: null,
  active: true,
  version: 0,
};

const deliveryFallback: DeliverySettings = {
  version: 0,
  mode: "free",
  fixed_fee: 0,
  base_fee: 0,
  per_km_fee: 0,
  max_distance_km: 10,
  free_over_enabled: false,
  free_over_amount: 0,
  minimum_enabled: false,
  minimum_amount: 0,
  radii: [],
  google_routes_configured: false,
};

describe("settings adapters", () => {
  beforeEach(() => apiMock.mockReset());

  it("maps the canonical branch profile name to the UI alias", async () => {
    apiMock.mockResolvedValue({ ...profileFallback, name: "Matriz Miraflores", version: 4 });
    const result = await loadSettings("/settings/branches/7/profile", profileFallback);
    expect(result.data.alias).toBe("Matriz Miraflores");
    expect(result.data.version).toBe(4);
  });

  it("round trips independent print templates and preserves text while disabled", async () => {
    const payload = {
      version: 4, advanced_printing: true,
      printer_config: { automatic_printing: false, printer_name: "Printer POS-80", print_language: "escpos", paper_width_mm: 80, copies: 3, auto_print_kitchen: true, manual_customer_receipt: false },
      customer_ticket_template: { fields: [], font_size: "small", header_enabled: false, header_text: "Saved header", footer_enabled: true, footer_text: "Thank you\nVisit again" },
      kitchen_ticket_template: { fields: [], font_size: "large" },
    };
    apiMock.mockResolvedValue(payload);
    const result = await loadSettings<PrintSettings>("/settings/branches/7/printing", {} as PrintSettings);
    expect(result.data).toMatchObject({ automatic_printing: false, copies: 3, customer_ticket_font_size: "small", kitchen_ticket_font_size: "large", customer_ticket_header_enabled: false, customer_ticket_header_text: "Saved header" });
    expect(printingTemplate(result.data, "customer")).toEqual(payload.customer_ticket_template);
    expect(printingTemplate(result.data, "kitchen")).toEqual(payload.kitchen_ticket_template);
    await saveSettings("/settings/branches/7/printing", { ...result.data, expected_version: 4 });
    expect(JSON.parse(apiMock.mock.calls[1][1].body)).toMatchObject({
      advanced_printing: payload.advanced_printing,
      printer_config: payload.printer_config,
      customer_ticket_template: payload.customer_ticket_template,
      kitchen_ticket_template: payload.kitchen_ticket_template,
      expected_version: 4,
    });
  });

  it("reads legacy printing defaults without enabling or saving anything", async () => {
    apiMock.mockResolvedValue({ version: 1, advanced_printing: false, printer_config: { copies: 2, auto_print_kitchen: false, manual_customer_receipt: true } });
    const result = await loadSettings<PrintSettings>("/settings/branches/7/printing", {} as PrintSettings);
    expect(result.data).toMatchObject({ advanced_printing: false, automatic_printing: true, copies: 2, auto_print_kitchen: false, manual_customer_receipt: true, customer_ticket_font_size: "normal", kitchen_ticket_font_size: "normal", customer_ticket_header_text: "", customer_ticket_footer_enabled: false });
    expect(apiMock).toHaveBeenCalledOnce();
  });

  it("preserves server member capabilities without deriving them from the page", async () => {
    const payload = { items: [{ id: 11, roles: ["owner"], capabilities: { can_edit: true, can_archive: true } }], total: 35, capabilities: { assignable_roles: ["cashier"], can_manage_admins: false } };
    apiMock.mockResolvedValue(payload);
    const result = await loadSettings<SettingsMembers>("/settings/members?page=2", { items: [], total: 0, page: 2, page_size: 10 });
    expect(result.data).toMatchObject(payload);
    expect(result.data.items[0].capabilities?.can_archive).toBe(true);
  });

  it.each(["failed", "not_configured", "pending", undefined])("does not report an invitation success for %s", (delivery_status) => {
    const feedback = memberInvitationFeedback({ invitation: { delivery_status } } as MemberSaveResult, true);
    expect(feedback.success).toBeNull();
    expect(feedback.notice).toContain("guardado");
  });

  it("reports invitation success only for sent and stays quiet when no invitation was requested", () => {
    expect(memberInvitationFeedback({ invitation: { delivery_status: "sent" } } as MemberSaveResult, true).success).toContain("se envió");
    expect(memberInvitationFeedback({} as MemberSaveResult, false)).toEqual({ success: null, notice: null });
  });

  it("normalizes canonical delivery bands and serializes UI-friendly fields on save", async () => {
    apiMock.mockResolvedValueOnce({
      version: 3,
      delivery_mode: "bands",
      fixed_delivery_fee: 8,
      distance_base_fee: 4,
      distance_fee_per_km: 1.5,
      distance_max_km: 12,
      free_delivery_threshold: 60,
      minimum_order_amount: 25,
      bands: [{ id: 2, minimum_km: 0, maximum_km: 3, fee: 5 }],
    });
    const loaded = await loadSettings("/settings/branches/7/delivery", deliveryFallback);
    expect(loaded.data).toMatchObject({ mode: "radius", fixed_fee: 8, base_fee: 4, per_km_fee: 1.5, max_distance_km: 12, free_over_enabled: true, minimum_enabled: true });
    expect(loaded.data.radii).toEqual([{ id: 2, from_km: 0, to_km: 3, fee: 5 }]);

    apiMock.mockResolvedValueOnce({ ...loaded.data, delivery_mode: "bands", bands: [{ minimum_km: 0, maximum_km: 3, fee: 5 }] });
    const saved = await saveSettings("/settings/branches/7/delivery", { ...loaded.data, expected_version: 3 });
    const request = apiMock.mock.calls[1][1] as RequestInit & { idempotencyKey?: string };
    const body = JSON.parse(String(request.body));
    expect(body).toMatchObject({
      delivery_mode: "bands",
      fixed_delivery_fee: 8,
      distance_base_fee: 4,
      distance_fee_per_km: 1.5,
      distance_max_km: 12,
      free_delivery_threshold: 60,
      minimum_order_amount: 25,
      bands: [{ id: 2, minimum_km: 0, maximum_km: 3, fee: 5 }],
    });
    expect(body.mode).toBeUndefined();
    expect(body.radii).toBeUndefined();
    expect(saved.mode).toBe("radius");
  });
});
