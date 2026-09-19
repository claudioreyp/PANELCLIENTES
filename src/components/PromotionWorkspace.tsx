import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronUp,
  Eye,
  ImageOff,
  Pause,
  Pencil,
  Percent,
  Play,
  Plus,
  RefreshCw,
  Repeat2,
  Tag,
  X,
} from "lucide-react";
import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { api, ApiError, isTransportError, publicAssetUrl } from "../lib/api";
import { DEFAULT_PRODUCT_SERVICE_CHANNELS } from "../lib/catalog";
import { DialogPortal, useDialogSurface } from "../lib/dialog";
import { OrderActionsMenu } from "./OrderActionsMenu";
import type {
  Catalog,
  ProductServiceChannel,
  Promotion,
  PromotionDiscountType,
  PromotionTargetScope,
  PromotionType,
} from "../types";

type PromotionWorkspaceProps = {
  catalog: Catalog;
  branchId: number;
  refreshCatalog: () => Promise<void>;
  notify: (message: string, tone?: "success" | "error") => void;
};

type ActivationMode = "always" | "date_range" | "weekdays";

type PromotionPayload = {
  branch_id: number;
  name: string;
  promotion_type: PromotionType;
  discount_type: PromotionDiscountType | null;
  discount_value: number | null;
  receive_quantity: number | null;
  pay_quantity: number | null;
  target_scope: PromotionTargetScope;
  target_ids: number[];
  starts_on: string | null;
  ends_on: string | null;
  weekdays: number[];
  service_channels: ProductServiceChannel[];
  active: boolean;
};

type RetryablePromotionError = {
  message: string;
  retry: () => void;
};

type PromotionDraft = {
  id: number | null;
  version: number | null;
  name: string;
  promotion_type: PromotionType;
  discount_type: PromotionDiscountType;
  discount_value: string;
  receive_quantity: string;
  pay_quantity: string;
  target_scope: PromotionTargetScope;
  target_ids: number[];
  activation_mode: ActivationMode;
  starts_on: string;
  ends_on: string;
  weekdays: number[];
  service_channels: ProductServiceChannel[];
  active: boolean;
};

const weekdays = [
  { value: 0, short: "Lu", label: "Lunes" },
  { value: 1, short: "Ma", label: "Martes" },
  { value: 2, short: "Mi", label: "Miércoles" },
  { value: 3, short: "Ju", label: "Jueves" },
  { value: 4, short: "Vi", label: "Viernes" },
  { value: 5, short: "Sa", label: "Sábado" },
  { value: 6, short: "Do", label: "Domingo" },
];

const channelGroups: { title: string; options: { value: ProductServiceChannel; label: string }[] }[] = [
  {
    title: "Punto de venta",
    options: [
      { value: "pos_tables", label: "Mesas" },
      { value: "pos_counter", label: "En el local (sin mesa asignada)" },
      { value: "pos_takeaway", label: "Para llevar" },
      { value: "pos_delivery", label: "Domicilio" },
    ],
  },
  {
    title: "Menú digital",
    options: [
      { value: "digital_tables", label: "Mesas" },
      { value: "digital_takeaway", label: "Para recoger" },
      { value: "digital_delivery", label: "Domicilio" },
    ],
  },
];

const channelLabels = new Map(
  channelGroups.flatMap((group) => group.options.map((option) => [option.value, option.label] as const)),
);

function editableNumber(value: number | null | undefined): string {
  const numericValue = Number(value ?? 0);
  return Number.isFinite(numericValue) && numericValue !== 0 ? String(numericValue) : "";
}

function draftNumber(value: string): number {
  return value.trim() === "" ? 0 : Number(value);
}

const previewCurrency = new Intl.NumberFormat("es-PE", {
  style: "currency",
  currency: "PEN",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const previewNumber = new Intl.NumberFormat("es-PE", {
  maximumFractionDigits: 2,
});

function discountedPreviewPrice(price: number, draft: PromotionDraft): number {
  if (draft.promotion_type !== "product_discount") return price;
  const discount = Math.max(0, draftNumber(draft.discount_value));
  if (draft.discount_type === "percentage") {
    return Math.max(0, price * (1 - Math.min(discount, 100) / 100));
  }
  return Math.max(0, price - discount);
}

function previewBadge(draft: PromotionDraft): string | null {
  if (draft.promotion_type === "buy_x_pay_y") {
    const receive = draftNumber(draft.receive_quantity);
    const pay = draftNumber(draft.pay_quantity);
    return receive > pay && pay > 0 ? `${receive}x${pay}` : null;
  }
  const discount = Math.max(0, draftNumber(draft.discount_value));
  if (!discount) return null;
  return draft.discount_type === "percentage"
    ? `-${previewNumber.format(Math.min(discount, 100))}%`
    : `-${previewCurrency.format(discount)}`;
}

function catalogProductPriceLabel(product: Catalog["products"][number]): string {
  const prefix = product.variants.some((variant) => variant.active) ? "Desde " : "";
  return `${prefix}S/ ${Number(product.price).toFixed(2)}`;
}

const targetScopeOptions: { value: PromotionTargetScope; label: string }[] = [
  { value: "products", label: "Productos específicos" },
  { value: "categories", label: "Categorías específicas" },
];

function PromotionTargetScopeSelect({
  value,
  onChange,
}: {
  value: PromotionTargetScope;
  onChange: (value: PromotionTargetScope) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = targetScopeOptions.findIndex((option) => option.value === value);
  const selectedOption = targetScopeOptions[selectedIndex] ?? targetScopeOptions[0];

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", closeOutside);
    return () => document.removeEventListener("mousedown", closeOutside);
  }, [open]);

  function openAt(index: number) {
    setOpen(true);
    window.requestAnimationFrame(() => optionRefs.current[index]?.focus());
  }

  function closeAndRestoreFocus() {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function handleOptionKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeAndRestoreFocus();
      return;
    }
    const destinations: Record<string, number> = {
      ArrowDown: (index + 1) % targetScopeOptions.length,
      ArrowUp: (index - 1 + targetScopeOptions.length) % targetScopeOptions.length,
      Home: 0,
      End: targetScopeOptions.length - 1,
    };
    const destination = destinations[event.key];
    if (destination === undefined) return;
    event.preventDefault();
    optionRefs.current[destination]?.focus();
  }

  return (
    <div className="promotion-target-scope" ref={rootRef}>
      <span>Se aplica a</span>
      <button
        ref={triggerRef}
        className="promotion-target-scope-trigger"
        type="button"
        aria-label={`Se aplica a: ${selectedOption.label}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => open ? closeAndRestoreFocus() : openAt(selectedIndex)}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          openAt(selectedIndex);
        }}
      >
        <span>{selectedOption.label}</span>
        <ChevronDown />
      </button>
      {open && (
        <div className="promotion-target-scope-options" role="listbox" aria-label="Opciones de aplicación">
          {targetScopeOptions.map((option, index) => (
            <button
              ref={(element) => { optionRefs.current[index] = element; }}
              type="button"
              role="option"
              aria-selected={option.value === value}
              key={option.value}
              onKeyDown={(event) => handleOptionKeyDown(event, index)}
              onClick={() => {
                if (option.value !== value) onChange(option.value);
                closeAndRestoreFocus();
              }}
            >
              <span>{option.label}</span>
              {option.value === value && <Check />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function draftFor(type: PromotionType): PromotionDraft {
  return {
    id: null,
    version: null,
    name: "",
    promotion_type: type,
    discount_type: "percentage",
    discount_value: "",
    receive_quantity: "",
    pay_quantity: "",
    target_scope: "products",
    target_ids: [],
    activation_mode: "always",
    starts_on: "",
    ends_on: "",
    weekdays: [],
    service_channels: [...DEFAULT_PRODUCT_SERVICE_CHANNELS],
    active: true,
  };
}

function draftFromPromotion(promotion: Promotion): PromotionDraft {
  return {
    id: promotion.id,
    version: promotion.version,
    name: promotion.name,
    promotion_type: promotion.promotion_type,
    discount_type: promotion.discount_type ?? "percentage",
    discount_value: editableNumber(promotion.discount_value),
    receive_quantity: editableNumber(promotion.receive_quantity),
    pay_quantity: editableNumber(promotion.pay_quantity),
    target_scope: promotion.target_scope,
    target_ids: [...promotion.target_ids],
    activation_mode: promotion.starts_on || promotion.ends_on
      ? "date_range"
      : promotion.weekdays.length
        ? "weekdays"
        : "always",
    starts_on: promotion.starts_on ?? "",
    ends_on: promotion.ends_on ?? "",
    weekdays: [...(promotion.weekdays ?? [])],
    service_channels: [...(promotion.service_channels ?? DEFAULT_PRODUCT_SERVICE_CHANNELS)],
    active: promotion.active,
  };
}

function serializeDraft(draft: PromotionDraft): string {
  return JSON.stringify({
    ...draft,
    name: draft.name.trim(),
    target_ids: [...draft.target_ids].sort((a, b) => a - b),
    weekdays: [...draft.weekdays].sort((a, b) => a - b),
    service_channels: [...draft.service_channels].sort(),
  });
}

function payloadFromDraft(draft: PromotionDraft, branchId: number): PromotionPayload {
  return {
    branch_id: branchId,
    name: draft.name.trim(),
    promotion_type: draft.promotion_type,
    discount_type: draft.promotion_type === "product_discount" ? draft.discount_type : null,
    discount_value: draft.promotion_type === "product_discount" ? draftNumber(draft.discount_value) : null,
    receive_quantity: draft.promotion_type === "buy_x_pay_y" ? draftNumber(draft.receive_quantity) : null,
    pay_quantity: draft.promotion_type === "buy_x_pay_y" ? draftNumber(draft.pay_quantity) : null,
    target_scope: draft.target_scope,
    target_ids: [...draft.target_ids],
    starts_on: draft.activation_mode === "date_range" ? draft.starts_on : null,
    ends_on: draft.activation_mode === "date_range" ? draft.ends_on : null,
    weekdays: draft.activation_mode === "weekdays" ? [...draft.weekdays] : [],
    service_channels: [...draft.service_channels],
    active: draft.active,
  };
}

function normalizedPromotionConfiguration(value: Promotion | PromotionPayload) {
  return {
    name: value.name.trim(),
    promotion_type: value.promotion_type,
    discount_type: value.promotion_type === "product_discount" ? value.discount_type ?? null : null,
    discount_value: value.promotion_type === "product_discount" ? Number(value.discount_value ?? 0) : null,
    receive_quantity: value.promotion_type === "buy_x_pay_y" ? Number(value.receive_quantity ?? 0) : null,
    pay_quantity: value.promotion_type === "buy_x_pay_y" ? Number(value.pay_quantity ?? 0) : null,
    target_scope: value.target_scope,
    target_ids: [...value.target_ids].sort((left, right) => left - right),
    starts_on: value.starts_on || null,
    ends_on: value.ends_on || null,
    weekdays: [...value.weekdays].sort((left, right) => left - right),
    service_channels: [...value.service_channels].sort(),
    active: value.active,
  };
}

function promotionMatchesPayload(promotion: Promotion, payload: PromotionPayload): boolean {
  return JSON.stringify(normalizedPromotionConfiguration(promotion))
    === JSON.stringify(normalizedPromotionConfiguration(payload));
}

function sortedPromotions(promotions: Promotion[]): Promotion[] {
  return [...promotions].sort((left, right) => (
    left.sort_order - right.sort_order
    || left.name.localeCompare(right.name, "es")
    || left.id - right.id
  ));
}

function shouldReconcileMutation(caught: unknown): boolean {
  return isTransportError(caught) || (caught instanceof ApiError && caught.status >= 500);
}

function promotionActionError(caught: unknown, fallback: string): string {
  if (isTransportError(caught)) {
    return `${fallback} No recibimos confirmación del servidor; conservamos tus cambios para que puedas intentarlo nuevamente.`;
  }
  return caught instanceof Error ? caught.message : fallback;
}

function promotionTypeLabel(type: PromotionType): string {
  return type === "product_discount" ? "Descuento en productos" : "Compra X y paga Y";
}

function promotionSummary(promotion: Promotion): string {
  if (promotion.promotion_type === "buy_x_pay_y") {
    return `Recibe ${promotion.receive_quantity} y paga ${promotion.pay_quantity}`;
  }
  if (promotion.discount_type === "fixed_amount") {
    return `S/ ${Number(promotion.discount_value ?? 0).toFixed(2)} menos por unidad`;
  }
  return `${Number(promotion.discount_value ?? 0).toFixed(0)}% de descuento`;
}

function promotionSchedule(promotion: Promotion): string {
  const dates = promotion.starts_on || promotion.ends_on
    ? `${promotion.starts_on || "Desde hoy"} · ${promotion.ends_on || "Sin fecha final"}`
    : "Vigencia indefinida";
  const days = promotion.weekdays.length
    ? promotion.weekdays.map((day) => weekdays.find((item) => item.value === day)?.short).filter(Boolean).join(", ")
    : "todos los días";
  return `${dates} · ${days}`;
}

function validateDraft(draft: PromotionDraft): string | null {
  const discountValue = draftNumber(draft.discount_value);
  const receiveQuantity = draftNumber(draft.receive_quantity);
  const payQuantity = draftNumber(draft.pay_quantity);
  if (draft.name.trim().length < 2) return "Escribe un nombre de al menos 2 caracteres.";
  if (!draft.target_ids.length) return "Selecciona al menos un producto o categoría.";
  if (!draft.service_channels.length) return "Selecciona al menos un canal de venta.";
  if (draft.activation_mode === "date_range") {
    if (!draft.starts_on || !draft.ends_on) return "Selecciona la fecha inicial y la fecha final.";
    if (draft.ends_on < draft.starts_on) return "La fecha final no puede ser anterior a la fecha inicial.";
  }
  if (draft.activation_mode === "weekdays" && !draft.weekdays.length) {
    return "Selecciona al menos un día de la semana.";
  }
  if (draft.promotion_type === "product_discount") {
    if (!(discountValue > 0)) return "El descuento debe ser mayor que cero.";
    if (draft.discount_type === "percentage" && discountValue > 100) {
      return "El porcentaje no puede superar 100%.";
    }
  } else if (!(receiveQuantity > payQuantity && payQuantity > 0)) {
    return "La cantidad a recibir debe ser mayor que la cantidad a pagar.";
  }
  return null;
}

type PromotionCreateMenuProps = {
  open: boolean;
  placement?: "toolbar" | "empty";
  onToggle: () => void;
  onSelect: (type: PromotionType) => void;
};

function PromotionCreateMenu({ open, placement = "toolbar", onToggle, onSelect }: PromotionCreateMenuProps) {
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const toggleRef = useRef(onToggle);
  toggleRef.current = onToggle;
  const id = useId();
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const outside = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) toggleRef.current();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      toggleRef.current();
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open]);
  function select(type: PromotionType) {
    trigger.current?.focus();
    onSelect(type);
  }
  return (
    <div ref={wrapper} className={`promotion-create-menu promotion-create-menu-${placement}`}>
      <button
        ref={trigger}
        className="button menu-primary"
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={open ? id : undefined}
      >
        <Plus /> Nueva promoción
      </button>
      {open && (
        <div ref={menu} id={id} className="promotion-type-popover" role="menu" aria-label="Tipo de promoción" onKeyDown={(event) => {
          if (event.key === "Tab") { onToggle(); return; }
          const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
          const current = items.indexOf(document.activeElement as HTMLButtonElement);
          const index = event.key === "ArrowDown" ? (current + 1) % items.length : event.key === "ArrowUp" ? (current - 1 + items.length) % items.length : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : null;
          if (index !== null) { event.preventDefault(); items[index]?.focus(); }
        }}>
          <button type="button" role="menuitem" onClick={() => select("product_discount")}>
            <Tag />
            <span><strong>Descuento en productos</strong><small>Porcentaje o monto fijo por unidad.</small></span>
          </button>
          <button type="button" role="menuitem" onClick={() => select("buy_x_pay_y")}>
            <Repeat2 />
            <span><strong>Compra X y paga Y</strong><small>Promociones como 2x1 o 3x2.</small></span>
          </button>
        </div>
      )}
    </div>
  );
}

export function PromotionWorkspace({ catalog, branchId, refreshCatalog, notify }: PromotionWorkspaceProps) {
  const [promotions, setPromotions] = useState<Promotion[]>(catalog.promotions ?? []);
  const [archivedLoading, setArchivedLoading] = useState(false);
  const [archivedLoaded, setArchivedLoaded] = useState(false);
  const [archivedError, setArchivedError] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<RetryablePromotionError | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);
  const [draft, setDraft] = useState<PromotionDraft | null>(null);
  const [baseline, setBaseline] = useState("");
  const [moreOptions, setMoreOptions] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const archivedRequestRef = useRef(0);
  const branchIdRef = useRef(branchId);
  branchIdRef.current = branchId;

  const serializedDraft = draft ? serializeDraft(draft) : "";
  const dirty = draft ? serializedDraft !== baseline : false;
  const drawerOpen = Boolean(draft);
  const drawerRef = useDialogSurface(() => closeEditor(), { enabled: drawerOpen });

  useEffect(() => {
    setSaveError(null);
  }, [serializedDraft]);

  async function loadAllPromotions(targetBranchId = branchId): Promise<Promotion[]> {
    return api<Promotion[]>(`/catalog/promotions?branch_id=${targetBranchId}&include_archived=true`);
  }

  async function loadArchivedPromotions() {
    const requestId = ++archivedRequestRef.current;
    setArchivedLoading(true);
    setArchivedError(null);
    try {
      const data = await loadAllPromotions();
      if (requestId !== archivedRequestRef.current) return;
      setPromotions(sortedPromotions(data));
      setArchivedLoaded(true);
    } catch {
      if (requestId !== archivedRequestRef.current) return;
      setArchivedError("No pudimos actualizar las promociones archivadas. Las promociones activas siguen disponibles.");
    } finally {
      if (requestId === archivedRequestRef.current) setArchivedLoading(false);
    }
  }

  useEffect(() => {
    archivedRequestRef.current += 1;
    setPromotions((current) => current.every((promotion) => promotion.branch_id === branchId) ? current : []);
    setArchivedLoading(false);
    setArchivedLoaded(false);
    setArchivedError(null);
    setOperationError(null);
    setSaveError(null);
    setSaving(false);
    setShowArchived(false);
    setTypeMenuOpen(false);
    setDraft(null);
    setBaseline("");
    setPreviewOpen(false);
  }, [branchId]);

  useEffect(() => {
    if (catalog.branch.id !== branchId) return;
    setPromotions((current) => {
      const currentArchived = current.filter((promotion) => (
        promotion.branch_id === branchId && promotion.archived_at
      ));
      const activeIds = new Set(catalog.promotions.map((promotion) => promotion.id));
      return [
        ...catalog.promotions,
        ...currentArchived.filter((promotion) => !activeIds.has(promotion.id)),
      ].sort((left, right) => (
        left.sort_order - right.sort_order
        || left.name.localeCompare(right.name, "es")
        || left.id - right.id
      ));
    });
  }, [branchId, catalog.branch.id, catalog.promotions]);

  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);

  function openNew(type: PromotionType) {
    const next = draftFor(type);
    setDraft(next);
    setBaseline(serializeDraft(next));
    setSaveError(null);
    setOperationError(null);
    setTypeMenuOpen(false);
    setMoreOptions(false);
    setPreviewOpen(false);
  }

  function openEdit(promotion: Promotion) {
    const next = draftFromPromotion(promotion);
    setDraft(next);
    setBaseline(serializeDraft(next));
    setSaveError(null);
    setOperationError(null);
    setMoreOptions(false);
    setPreviewOpen(false);
  }

  function closeEditor(force = false) {
    if (!force && dirty && !window.confirm("Hay cambios sin guardar. ¿Quieres cerrar de todos modos?")) return;
    setDraft(null);
    setBaseline("");
    setSaveError(null);
    setPreviewOpen(false);
  }

  function addTarget(targetId: number) {
    if (!draft) return;
    if (draft.target_ids.includes(targetId)) return;
    setDraft({ ...draft, target_ids: [...draft.target_ids, targetId] });
  }

  function removeTarget(targetId: number) {
    if (!draft) return;
    setDraft({ ...draft, target_ids: draft.target_ids.filter((id) => id !== targetId) });
  }

  function toggleWeekday(day: number) {
    if (!draft) return;
    setDraft({
      ...draft,
      weekdays: draft.weekdays.includes(day)
        ? draft.weekdays.filter((value) => value !== day)
        : [...draft.weekdays, day],
    });
  }

  function toggleChannel(channel: ProductServiceChannel) {
    if (!draft) return;
    setDraft({
      ...draft,
      service_channels: draft.service_channels.includes(channel)
        ? draft.service_channels.filter((value) => value !== channel)
        : [...draft.service_channels, channel],
    });
  }

  function upsertPromotion(nextPromotion: Promotion) {
    if (nextPromotion.branch_id !== branchIdRef.current) return;
    setPromotions((current) => sortedPromotions([
      ...current.filter((promotion) => promotion.id !== nextPromotion.id),
      nextPromotion,
    ]));
  }

  function refreshCatalogSilently(actionBranchId: number) {
    if (branchIdRef.current !== actionBranchId) return;
    void refreshCatalog().catch(() => undefined);
  }

  async function promotionsForRecovery(actionBranchId: number): Promise<Promotion[] | null> {
    try {
      const recovered = sortedPromotions(await loadAllPromotions(actionBranchId));
      if (branchIdRef.current === actionBranchId) {
        setPromotions(recovered);
        setArchivedLoaded(true);
        setArchivedError(null);
      }
      return recovered;
    } catch {
      return null;
    }
  }

  function finishPromotionMutation(
    promotion: Promotion,
    message: string,
    actionBranchId: number,
    closeDraft = false,
  ) {
    if (branchIdRef.current !== actionBranchId) return;
    upsertPromotion(promotion);
    setOperationError(null);
    if (closeDraft) closeEditor(true);
    notify(message);
    refreshCatalogSilently(actionBranchId);
  }

  async function savePromotion() {
    if (!draft) return;
    const snapshot = draft;
    const actionBranchId = branchId;
    const validation = validateDraft(snapshot);
    if (validation) {
      setSaveError(validation);
      return;
    }
    const payload = payloadFromDraft(snapshot, actionBranchId);
    const successMessage = snapshot.id ? "Promoción actualizada." : "Promoción creada.";
    setSaveError(null);
    setSaving(true);
    try {
      let saved: Promotion;
      if (snapshot.id) {
        const updatePayload: Partial<PromotionPayload> & { expected_version: number | null } = {
          ...payload,
          expected_version: snapshot.version,
        };
        delete updatePayload.branch_id;
        saved = await api<Promotion>(`/catalog/promotions/${snapshot.id}`, {
          method: "PATCH",
          body: JSON.stringify(updatePayload),
        });
      } else {
        saved = await api<Promotion>("/catalog/promotions", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }
      finishPromotionMutation(saved, successMessage, actionBranchId, true);
    } catch (caught) {
      if (shouldReconcileMutation(caught)) {
        const recovered = await promotionsForRecovery(actionBranchId);
        const saved = snapshot.id
          ? recovered?.find((promotion) => promotion.id === snapshot.id && promotionMatchesPayload(promotion, payload))
          : recovered
            ?.filter((promotion) => promotionMatchesPayload(promotion, payload))
            .sort((left, right) => right.id - left.id)[0];
        if (saved) {
          finishPromotionMutation(saved, successMessage, actionBranchId, true);
          return;
        }
      }
      if (branchIdRef.current === actionBranchId) {
        setSaveError(promotionActionError(caught, "No se pudo guardar la promoción."));
      }
    } finally {
      if (branchIdRef.current === actionBranchId) setSaving(false);
    }
  }

  async function setPromotionActive(promotion: Promotion, active: boolean) {
    const actionBranchId = branchId;
    setOperationError(null);
    setSaving(true);
    try {
      const saved = await api<Promotion>(`/catalog/promotions/${promotion.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active, expected_version: promotion.version }),
      });
      finishPromotionMutation(saved, active ? "Promoción activada." : "Promoción pausada.", actionBranchId);
    } catch (caught) {
      let latest = promotion;
      if (shouldReconcileMutation(caught)) {
        const recovered = await promotionsForRecovery(actionBranchId);
        latest = recovered?.find((item) => item.id === promotion.id) ?? promotion;
        if (latest.active === active) {
          finishPromotionMutation(latest, active ? "Promoción activada." : "Promoción pausada.", actionBranchId);
          return;
        }
      }
      if (branchIdRef.current === actionBranchId) {
        setOperationError({
          message: promotionActionError(caught, "No se pudo cambiar el estado de la promoción."),
          retry: () => void setPromotionActive(latest, active),
        });
      }
    } finally {
      if (branchIdRef.current === actionBranchId) {
        setSaving(false);
      }
    }
  }

  async function archivePromotion(promotion: Promotion, requestConfirmation = true) {
    if (requestConfirmation && !window.confirm(`¿Archivar “${promotion.name}”? Podrás restaurarla después.`)) return;
    const actionBranchId = branchId;
    setOperationError(null);
    setSaving(true);
    try {
      const saved = await api<Promotion>(`/catalog/promotions/${promotion.id}/archive`, { method: "POST" });
      finishPromotionMutation(saved, "Promoción archivada.", actionBranchId);
    } catch (caught) {
      let latest = promotion;
      if (shouldReconcileMutation(caught)) {
        const recovered = await promotionsForRecovery(actionBranchId);
        latest = recovered?.find((item) => item.id === promotion.id) ?? promotion;
        if (latest.archived_at) {
          finishPromotionMutation(latest, "Promoción archivada.", actionBranchId);
          return;
        }
      }
      if (branchIdRef.current === actionBranchId) {
        setOperationError({
          message: promotionActionError(caught, "No se pudo archivar la promoción."),
          retry: () => void archivePromotion(latest, false),
        });
      }
    } finally {
      if (branchIdRef.current === actionBranchId) {
        setSaving(false);
      }
    }
  }

  async function restorePromotion(promotion: Promotion) {
    const actionBranchId = branchId;
    setOperationError(null);
    setSaving(true);
    try {
      const saved = await api<Promotion>(`/catalog/promotions/${promotion.id}/restore`, { method: "POST" });
      finishPromotionMutation(saved, "Promoción restaurada. Actívala cuando esté lista.", actionBranchId);
    } catch (caught) {
      let latest = promotion;
      if (shouldReconcileMutation(caught)) {
        const recovered = await promotionsForRecovery(actionBranchId);
        latest = recovered?.find((item) => item.id === promotion.id) ?? promotion;
        if (!latest.archived_at) {
          finishPromotionMutation(latest, "Promoción restaurada. Actívala cuando esté lista.", actionBranchId);
          return;
        }
      }
      if (branchIdRef.current === actionBranchId) {
        setOperationError({
          message: promotionActionError(caught, "No se pudo restaurar la promoción."),
          retry: () => void restorePromotion(latest),
        });
      }
    } finally {
      if (branchIdRef.current === actionBranchId) setSaving(false);
    }
  }

  const visiblePromotions = promotions.filter((promotion) => Boolean(promotion.archived_at) === showArchived);
  const targets = draft?.target_scope === "categories" ? catalog.categories : catalog.products;
  const selectedTargets = draft
    ? targets.filter((target) => draft.target_ids.includes(target.id))
    : [];
  const availableTargets = draft
    ? targets.filter((target) => {
        const active = !("active" in target) || target.active;
        return active && !draft.target_ids.includes(target.id);
      })
    : [];
  const eligibleProducts = draft
    ? draft.target_scope === "products"
      ? catalog.products.filter((product) => draft.target_ids.includes(product.id))
      : catalog.products.filter((product) => product.category_id !== null && draft.target_ids.includes(product.category_id))
    : [];
  const activePromotions = promotions.filter((promotion) => !promotion.archived_at);
  const hasArchivedPromotions = promotions.some((promotion) => promotion.archived_at);
  const isEmptyState = !showArchived && !activePromotions.length;
  const showToolbar = activePromotions.length > 0 || showArchived || hasArchivedPromotions;

  return (
    <section className={`promotion-workspace ${isEmptyState ? "is-empty" : ""}`} id="menu-panel-promotions" role="tabpanel" aria-labelledby="menu-tab-promotions">
      {operationError && (
        <div className="promotion-retry-state" role="alert">
          <AlertTriangle />
          <div>
            <strong>No pudimos completar la acción</strong>
            <p>{operationError.message}</p>
          </div>
          <button className="button button-secondary" type="button" disabled={saving} onClick={operationError.retry}>
            <RefreshCw /> Reintentar
          </button>
          <button className="menu-icon-button" type="button" aria-label="Cerrar error" onClick={() => setOperationError(null)}>
            <X />
          </button>
        </div>
      )}

      {showToolbar && <header className="promotion-toolbar">
        <div>
          <h2>Promociones</h2>
          <p>Define descuentos claros y controla dónde y cuándo se aplican.</p>
        </div>
        <div className="promotion-toolbar-actions">
          <button className="button button-secondary" type="button" onClick={() => {
            if (showArchived) {
              setShowArchived(false);
              setArchivedError(null);
              return;
            }
            setShowArchived(true);
            if (!archivedLoaded && !archivedLoading) void loadArchivedPromotions();
          }}>
            {showArchived ? <ChevronUp /> : <Archive />}
            {showArchived ? "Ver activas" : "Ver archivadas"}
          </button>
          <PromotionCreateMenu open={typeMenuOpen} onToggle={() => setTypeMenuOpen(!typeMenuOpen)} onSelect={openNew} />
        </div>
      </header>}

      {showArchived && archivedLoading ? (
        <div className="promotion-loading" role="status">Cargando promociones archivadas...</div>
      ) : showArchived && archivedError ? (
        <div className="promotion-retry-state promotion-archive-error" role="alert">
          <AlertTriangle />
          <div>
            <strong>No se pudieron cargar las archivadas</strong>
            <p>{archivedError}</p>
          </div>
          <button className="button button-secondary" type="button" onClick={() => void loadArchivedPromotions()}>
            <RefreshCw /> Reintentar
          </button>
        </div>
      ) : !visiblePromotions.length && !showArchived ? (
        <div className="promotions-empty">
          <span><Percent /></span>
          <h2>Crea promociones atractivas para tus clientes</h2>
          <p>Llama la atención de tus clientes con promociones y aumenta tus ventas.</p>
          <div className="promotion-empty-actions">
            <PromotionCreateMenu
              open={typeMenuOpen}
              placement="empty"
              onToggle={() => setTypeMenuOpen(!typeMenuOpen)}
              onSelect={openNew}
            />
            <button className="button button-secondary" type="button" onClick={() => {
              setShowArchived(true);
              if (!archivedLoaded && !archivedLoading) void loadArchivedPromotions();
            }}>
              <Archive /> Ver archivadas
            </button>
          </div>
        </div>
      ) : !visiblePromotions.length ? (
        <div className="promotions-empty compact">
          <span><Archive /></span>
          <h2>No tienes promociones archivadas</h2>
          <button className="button button-secondary" type="button" onClick={() => setShowArchived(false)}>Volver a promociones</button>
        </div>
      ) : (
        <div className="promotion-list promotion-table-container">
          <table className="promotion-table" aria-label="Promociones">
            <thead><tr><th>Promoción</th><th>Tipo</th><th>Estado</th><th aria-label="Acciones" /></tr></thead>
            <tbody>
          {visiblePromotions.map((promotion) => (
            <tr className={promotion.active ? "" : "paused"} key={promotion.id}>
              <td data-label="Promoción"><button className="promotion-card-main" type="button" disabled={Boolean(promotion.archived_at)} onClick={() => openEdit(promotion)}>
                <span className="promotion-card-heading">
                  <strong>{promotion.name}</strong>
                </span>
                <small><CalendarDays /> {promotionSchedule(promotion)}</small>
              </button></td>
              <td data-label="Tipo"><span>{promotionTypeLabel(promotion.promotion_type)}</span><small className="promotion-discount-summary">{promotionSummary(promotion)}</small>
              <div className="promotion-card-channels" aria-label="Canales de la promoción">
                {promotion.service_channels.slice(0, 2).map((channel) => <span key={channel}>{channelLabels.get(channel)}</span>)}
                {promotion.service_channels.length > 2 && <span>+{promotion.service_channels.length - 2}</span>}
              </div></td>
              <td data-label="Estado"><span className={`promotion-status ${promotion.active && !promotion.archived_at ? "active" : ""}`}>{promotion.archived_at ? "Archivada" : promotion.active ? "Activa" : "Pausada"}</span></td>
              <td>
              {promotion.archived_at ? (
                <button className="menu-icon-button" type="button" aria-label={`Restaurar ${promotion.name}`} onClick={() => void restorePromotion(promotion)}>
                  <ArchiveRestore />
                </button>
              ) : (
                <OrderActionsMenu label={`Opciones de ${promotion.name}`} floating actions={[
                  { label: "Editar", icon: <Pencil />, onSelect: () => openEdit(promotion) },
                  { label: promotion.active ? "Pausar" : "Activar", icon: promotion.active ? <Pause /> : <Play />, onSelect: () => void setPromotionActive(promotion, !promotion.active) },
                  { label: "Archivar", icon: <Archive />, danger: true, onSelect: () => void archivePromotion(promotion) },
                ]} />
              )}
              </td>
            </tr>
          ))}
            </tbody>
          </table>
          <footer className="customization-summary">Mostrando {visiblePromotions.length} {visiblePromotions.length === 1 ? "promoción" : "promociones"}</footer>
        </div>
      )}

      {draft && (
        <DialogPortal>
        <div className="promotion-drawer-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.currentTarget === event.target) closeEditor();
        }}>
          <section ref={drawerRef} tabIndex={-1} className="promotion-drawer" role="dialog" aria-modal="true" aria-labelledby="promotion-editor-title">
            <header className="promotion-drawer-header">
              <div>
                <h2 id="promotion-editor-title">{draft.id ? "Editar promoción" : "Agrega una promoción"}</h2>
              </div>
              <div>
                <button className="button button-secondary mobile-preview-toggle" type="button" onClick={() => setPreviewOpen(!previewOpen)}>
                  <Eye /> Vista previa
                </button>
                <button className="menu-icon-button" type="button" aria-label="Cerrar editor" onClick={() => closeEditor()}><X /></button>
              </div>
            </header>

            <div className="promotion-drawer-layout">
              <div className="promotion-form-scroll">
                <section className="promotion-form-section">
                  <label>Nombre de promoción
                    <input data-dialog-initial-focus value={draft.name} maxLength={180} placeholder={draft.promotion_type === "product_discount" ? "Promo de pizzas" : "2x1 de los martes"} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
                    <small>El equipo verá este nombre en el POS.</small>
                  </label>
                </section>

                <section className="promotion-form-section">
                  {draft.promotion_type === "product_discount" ? (
                    <div className="promotion-value-grid">
                      <label>Tipo de descuento
                        <select value={draft.discount_type} onChange={(event) => setDraft({ ...draft, discount_type: event.target.value as PromotionDiscountType })}>
                          <option value="percentage">Porcentaje</option>
                          <option value="fixed_amount">Monto fijo por unidad</option>
                        </select>
                      </label>
                      <label>Valor del descuento
                        <span className="promotion-number-input">
                          <b>{draft.discount_type === "percentage" ? "%" : "S/"}</b>
                          <input type="number" min="0.01" max={draft.discount_type === "percentage" ? 100 : undefined} step="0.01" value={draft.discount_value} placeholder="0" onChange={(event) => setDraft({ ...draft, discount_value: event.target.value })} />
                        </span>
                      </label>
                    </div>
                  ) : (
                    <div className="promotion-value-grid buy-x-grid">
                      <label>Cantidad a recibir
                        <input type="number" min="2" max="100" step="1" value={draft.receive_quantity} placeholder="0" onChange={(event) => setDraft({ ...draft, receive_quantity: event.target.value })} />
                      </label>
                      <span aria-hidden="true">×</span>
                      <label>Cantidad a pagar
                        <input type="number" min="1" max="99" step="1" value={draft.pay_quantity} placeholder="0" onChange={(event) => setDraft({ ...draft, pay_quantity: event.target.value })} />
                      </label>
                    </div>
                  )}
                </section>

                <section className="promotion-form-section">
                  <PromotionTargetScopeSelect
                    value={draft.target_scope}
                    onChange={(targetScope) => setDraft({ ...draft, target_scope: targetScope, target_ids: [] })}
                  />
                  <div className="promotion-target-picker">
                    {selectedTargets.length > 0 && (
                      <div className="promotion-selected-targets" aria-label="Selección actual">
                        {selectedTargets.map((target) => (
                          <article className="promotion-selected-target" key={target.id}>
                            <span
                              className="promotion-target-thumb"
                              style={"price" in target && target.image_url
                                ? { backgroundImage: `url(${publicAssetUrl(target.image_url)})` }
                                : undefined}
                            >
                              {(!("price" in target) || !target.image_url) && ("price" in target ? <ImageOff /> : <Tag />)}
                            </span>
                            <span className="promotion-target-copy">
                              <strong>{target.name}</strong>
                              <small>{"price" in target ? catalogProductPriceLabel(target) : "Categoría completa"}</small>
                            </span>
                            <button type="button" className="promotion-target-remove" aria-label={`Quitar ${target.name}`} onClick={() => removeTarget(target.id)}>
                              <X />
                            </button>
                          </article>
                        ))}
                      </div>
                    )}
                    <label className="promotion-target-add">Agregar {draft.target_scope === "products" ? "producto" : "categoría"}
                      <select value="" onChange={(event) => {
                        const targetId = Number(event.target.value);
                        if (targetId) addTarget(targetId);
                      }}>
                        <option value="">Selecciona una opción</option>
                        {availableTargets.map((target) => (
                          <option value={target.id} key={target.id}>
                            {target.name}{"price" in target ? ` · ${catalogProductPriceLabel(target)}` : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    {!selectedTargets.length && <p className="promotion-target-empty">Aún no has seleccionado ninguna opción.</p>}
                    {!availableTargets.length && selectedTargets.length > 0 && <p className="promotion-target-empty">Ya agregaste todas las opciones disponibles.</p>}
                  </div>
                </section>

                <section className="promotion-form-section">
                  <div className="product-section-title"><div><h3>Cuándo se activa</h3><p>Define una vigencia simple y fácil de revisar.</p></div></div>
                  <label>Activación
                    <select value={draft.activation_mode} onChange={(event) => {
                      const activationMode = event.target.value as ActivationMode;
                      setDraft({
                        ...draft,
                        activation_mode: activationMode,
                        starts_on: activationMode === "date_range" ? draft.starts_on : "",
                        ends_on: activationMode === "date_range" ? draft.ends_on : "",
                        weekdays: activationMode === "weekdays" ? draft.weekdays : [],
                      });
                    }}>
                      <option value="always">Siempre</option>
                      <option value="date_range">Durante un rango de fechas</option>
                      <option value="weekdays">En ciertos días de la semana</option>
                    </select>
                  </label>
                  {draft.activation_mode === "date_range" && (
                    <div className="promotion-date-grid">
                      <label>Fecha inicial<input type="date" value={draft.starts_on} onChange={(event) => setDraft({ ...draft, starts_on: event.target.value })} /></label>
                      <label>Fecha final<input type="date" min={draft.starts_on || undefined} value={draft.ends_on} onChange={(event) => setDraft({ ...draft, ends_on: event.target.value })} /></label>
                    </div>
                  )}
                  {draft.activation_mode === "weekdays" && (
                    <fieldset className="promotion-weekdays">
                      <legend>Días de la semana <small>Selecciona los días en los que estará activa.</small></legend>
                      <div>{weekdays.map((day) => (
                        <button key={day.value} type="button" aria-pressed={draft.weekdays.includes(day.value)} aria-label={day.label} onClick={() => toggleWeekday(day.value)}>{day.short}</button>
                      ))}</div>
                    </fieldset>
                  )}
                </section>

                <section className="promotion-form-section more-options-section">
                  <button className="more-options-toggle" type="button" onClick={() => setMoreOptions(!moreOptions)} aria-expanded={moreOptions}>
                    Más opciones {moreOptions ? <ChevronUp /> : <ChevronDown />}
                  </button>
                  {moreOptions && (
                    <div className="service-channel-groups">
                      <div><h3>Opciones de servicio</h3><p>La promoción solo se aplicará en los canales activados.</p></div>
                      {channelGroups.map((group) => (
                        <fieldset key={group.title}>
                          <legend>{group.title}</legend>
                          {group.options.map((option) => (
                            <label key={option.value}><input type="checkbox" checked={draft.service_channels.includes(option.value)} onChange={() => toggleChannel(option.value)} /><span>{option.label}</span></label>
                          ))}
                        </fieldset>
                      ))}
                    </div>
                  )}
                </section>
              </div>

              <aside
                className={`promotion-live-preview ${previewOpen ? "mobile-open" : ""}`}
                aria-label="Vista previa de la promoción"
              >
                <h3 className="promotion-preview-heading">Vista previa</h3>
                <section className="promotion-preview-catalog">
                  <h4>{draft.promotion_type === "product_discount" ? "Productos con descuento" : "Productos en promoción"}</h4>
                  {eligibleProducts.length ? (
                    <div className="promotion-preview-list">
                      {eligibleProducts.map((product) => {
                        const originalPrice = Math.max(0, Number(product.price) || 0);
                        const salePrice = discountedPreviewPrice(originalPrice, draft);
                        const badge = previewBadge(draft);
                        const hasDiscount = salePrice < originalPrice;
                        const hasVariants = product.variants.some((variant) => variant.active);
                        return (
                          <article
                            className="promotion-preview-product"
                            aria-label={`Vista previa de ${product.name}`}
                            key={product.id}
                          >
                            <div className="promotion-preview-product-copy">
                              <strong>{product.name}</strong>
                              <p>
                                {hasVariants && <span>Desde </span>}
                                <b>{previewCurrency.format(salePrice)}</b>
                                {hasDiscount && <del>{previewCurrency.format(originalPrice)}</del>}
                              </p>
                            </div>
                            <div className="promotion-preview-product-image">
                              {product.image_url
                                ? <img src={publicAssetUrl(product.image_url)} alt="" />
                                : <span aria-hidden="true"><ImageOff /></span>}
                              {badge && <i className="promotion-preview-badge">{badge}</i>}
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="promotion-preview-empty">
                      <ImageOff />
                      <strong>Aún no hay productos para mostrar</strong>
                      <p>Selecciona al menos un producto o una categoría.</p>
                    </div>
                  )}
                </section>
              </aside>
            </div>

            <footer className="promotion-drawer-footer">
              <div className={`promotion-save-status ${saveError ? "is-error" : ""}`} role={saveError ? "alert" : "status"}>
                {saveError && <AlertTriangle />}
                <span>{saveError || (dirty ? "Tienes cambios sin guardar" : draft.id ? "Sin cambios pendientes" : "Completa los datos para guardar")}</span>
              </div>
              <div className="promotion-drawer-actions">
                <button className="button button-secondary" type="button" disabled={saving} onClick={() => closeEditor()}>Cancelar</button>
                <button className="button menu-primary" type="button" disabled={saving} onClick={() => void savePromotion()}>
                  {saving ? "Guardando..." : saveError ? "Reintentar guardado" : draft.id ? "Guardar cambios" : "Agregar promoción"}
                </button>
              </div>
            </footer>
          </section>
        </div>
        </DialogPortal>
      )}
    </section>
  );
}
