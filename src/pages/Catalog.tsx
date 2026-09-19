import {
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  GripVertical,
  ImagePlus,
  MoreHorizontal,
  PackageOpen,
  Pencil,
  Plus,
  Save,
  Search,
  SlidersHorizontal,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { ImageCropper } from "../components/ImageCropper";
import { ModifierGroupSelector } from "../components/ModifierGroupSelector";
import { PromotionWorkspace } from "../components/PromotionWorkspace";
import { EmptyState, ErrorState, LoadingState, Money, Toast } from "../components/ui";
import { DialogPortal, useDialogSurface } from "../lib/dialog";
import { api, ApiError, isTransportError, publicAssetUrl } from "../lib/api";
import {
  categoryDeleteEligibility,
  DEFAULT_PRODUCT_SERVICE_CHANNELS,
  availableModifierGroupsForProduct,
  duplicateModifierGroupPayload,
  filterCatalogModifierGroups,
  generateProductSku,
  hasCrossedReorderThreshold,
  menuVisibleProducts,
  modifierGroupUsageCounts,
  modifierGroupsForProduct,
  normalizeCatalogPayload,
  priceRowsToPayload,
  productAbsolutePrices,
  reorderCatalogCategories,
  reorderCatalogModifierGroups,
  reorderCatalogProducts,
  upsertCatalogCategory,
  type AbsolutePriceRow,
  type ModifierGroupListFilter,
} from "../lib/catalog";
import { useBranchRealtime } from "../lib/hooks";
import { useQuery } from "../lib/query-session";
import { normalizeModifierSelection } from "../lib/modifier-selection";
import { useTenant } from "../lib/tenant";
import type {
  Catalog,
  Category,
  ModifierGroup,
  Product,
  ProductServiceChannel,
} from "../types";

type CatalogTab = "products" | "customizations" | "promotions";
type ToastState = { message: string; tone: "success" | "error" } | null;

function catalogActionError(caught: unknown, fallback: string): string {
  if (isTransportError(caught)) {
    return `${fallback}. No recibimos confirmación del servidor; conservamos tus cambios para que puedas comprobar el catálogo antes de intentarlo otra vez.`;
  }
  return caught instanceof Error ? caught.message : fallback;
}

type CategoryDialogState = { mode: "create" | "rename"; value: string; categoryId?: number } | null;
type GroupOptionDraft = {
  key: string;
  id?: number;
  name: string;
  price_delta: string;
  active: boolean;
};
type GroupEditorState = {
  id?: number;
  name: string;
  internal_label: string;
  minimum: string;
  maximum: number | null;
  allow_repeats: boolean;
  max_per_option: number | null;
  sort_order: number;
  options: GroupOptionDraft[];
} | null;

type ProductDraft = {
  id: number | null;
  name: string;
  category_id: string;
  description: string;
  prices: AbsolutePriceRow[];
  group_ids: number[];
  service_channels: ProductServiceChannel[];
  image_url: string | null;
  available: boolean;
};

type FlipNode = HTMLElement | null;
const REORDER_PREVIEW_COOLDOWN_MS = 120;

function useFlipReorder(orderKey: string) {
  const nodes = useRef(new Map<string, HTMLElement>());
  const previousRects = useRef(new Map<string, DOMRect>());

  const register = useCallback((key: string, node: FlipNode) => {
    if (node) nodes.current.set(key, node);
    else nodes.current.delete(key);
  }, []);

  const capture = useCallback(() => {
    previousRects.current = new Map(
      [...nodes.current].map(([key, node]) => [key, node.getBoundingClientRect()]),
    );
  }, []);

  useLayoutEffect(() => {
    if (!previousRects.current.size) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const previous = previousRects.current;
    previousRects.current = new Map();
    if (reduceMotion) return;

    nodes.current.forEach((node, key) => {
      const before = previous.get(key);
      if (!before) return;
      const after = node.getBoundingClientRect();
      const x = before.left - after.left;
      const y = before.top - after.top;
      if (Math.abs(x) < 1 && Math.abs(y) < 1) return;
      node.getAnimations().forEach((animation) => animation.cancel());
      node.animate(
        [
          { transform: `translate3d(${x}px, ${y}px, 0)` },
          { transform: "translate3d(0, 0, 0)" },
        ],
        { duration: 290, easing: "cubic-bezier(.16, 1, .3, 1)" },
      );
    });
  }, [orderKey]);

  return { capture, register };
}

const serviceOptions: {
  title: string;
  options: { value: ProductServiceChannel; label: string }[];
}[] = [
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

function priceKey() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `price-${Date.now()}-${Math.random()}`;
}

function optionKey() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `option-${Date.now()}-${Math.random()}`;
}

function emptyGroupOption(): GroupOptionDraft {
  return { key: optionKey(), name: "", price_delta: "", active: true };
}

function emptyGroupEditor(sortOrder = 0): NonNullable<GroupEditorState> {
  return {
    name: "",
    internal_label: "",
    minimum: "",
    maximum: null,
    allow_repeats: false,
    max_per_option: null,
    sort_order: sortOrder,
    options: [emptyGroupOption(), emptyGroupOption()],
  };
}

function groupEditorFromGroup(group: ModifierGroup): NonNullable<GroupEditorState> {
  const options = group.modifiers
    .filter((modifier) => modifier.active)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((modifier) => ({
      key: `modifier-${modifier.id}`,
      id: modifier.id,
      name: modifier.name,
      price_delta: Number(modifier.price_delta) === 0 ? "" : String(modifier.price_delta),
      active: true,
    }));
  return {
    id: group.id,
    name: group.name,
    internal_label: group.internal_label || "",
    minimum: group.minimum === 0 ? "" : String(group.minimum),
    maximum: group.maximum,
    allow_repeats: group.allow_repeats,
    max_per_option: group.max_per_option ?? null,
    sort_order: group.sort_order,
    options: options.length ? options : [emptyGroupOption()],
  };
}

function groupEditorSignature(editor: NonNullable<GroupEditorState>) {
  return JSON.stringify({
    ...editor,
    options: editor.options.map(({ id, name, price_delta, active }) => ({
      id,
      name,
      price_delta,
      active,
    })),
  });
}

function validateGroupEditor(editor: NonNullable<GroupEditorState>): string | null {
  const minimum = Number(editor.minimum || 0);
  if (!editor.name.trim()) return "Escribe el nombre de la personalización.";
  if (!editor.options.length) return "Agrega al menos una opción.";
  if (editor.options.some((option) => !option.name.trim())) return "Completa el nombre de todas las opciones.";
  if (editor.options.some((option) => {
    const price = Number(option.price_delta || 0);
    return !Number.isFinite(price) || price < 0;
  })) {
    return "Los precios adicionales no pueden ser negativos.";
  }
  const names = editor.options.map((option) => option.name.trim().toLocaleLowerCase("es-PE"));
  if (new Set(names).size !== names.length) return "Las opciones deben tener nombres diferentes.";
  if (!Number.isInteger(minimum) || minimum < 0) return "El mínimo debe ser un número entero desde cero.";
  if (editor.maximum !== null && (!Number.isInteger(editor.maximum) || editor.maximum < 1)) {
    return "El máximo debe ser un número entero positivo o quedar sin límite.";
  }
  if (editor.max_per_option !== null && (!Number.isInteger(editor.max_per_option) || editor.max_per_option < 1)) {
    return "El máximo por opción debe ser un número entero positivo o quedar sin límite.";
  }
  if (editor.maximum !== null && editor.maximum < minimum) return "El máximo no puede ser menor que el mínimo.";
  if (!editor.allow_repeats && minimum > editor.options.length) {
    return "El mínimo no puede superar la cantidad de opciones disponibles.";
  }
  if (
    editor.allow_repeats
    && editor.max_per_option !== null
    && minimum > editor.options.length * editor.max_per_option
  ) {
    return "El mínimo no puede alcanzarse con el máximo permitido por opción.";
  }
  return null;
}

function emptyProductDraft(): ProductDraft {
  return {
    id: null,
    name: "",
    category_id: "",
    description: "",
    prices: [{ key: priceKey(), name: "", price: 0 }],
    group_ids: [],
    service_channels: [...DEFAULT_PRODUCT_SERVICE_CHANNELS],
    image_url: null,
    available: true,
  };
}

function draftFromProduct(product: Product): ProductDraft {
  return {
    id: product.id,
    name: product.name,
    category_id: product.category_id ? String(product.category_id) : "",
    description: product.description || "",
    prices: productAbsolutePrices(product),
    group_ids: product.modifier_groups.map((group) => group.id),
    service_channels: [...product.service_channels],
    image_url: product.image_url || null,
    available: product.available,
  };
}

function draftSignature(draft: ProductDraft) {
  return JSON.stringify({
    ...draft,
    prices: draft.prices.map(({ id, name, price }) => ({ id, name, price })),
    group_ids: [...draft.group_ids].sort((a, b) => a - b),
    service_channels: [...draft.service_channels].sort(),
  });
}

function validateProductDraft(draft: ProductDraft): string | null {
  if (!draft.name.trim()) return "Escribe el nombre del producto.";
  if (!draft.category_id) return "Selecciona una categoría.";
  if (!draft.prices.length) return "Agrega al menos un precio.";
  if (draft.prices.some((row) => !Number.isFinite(row.price) || row.price <= 0)) {
    return "Todos los precios deben ser mayores que cero.";
  }
  if (draft.prices.length > 1) {
    if (draft.prices.some((row) => !row.name.trim())) return "Ponle un nombre a cada precio o tamaño.";
    const names = draft.prices.map((row) => row.name.trim().toLocaleLowerCase("es-PE"));
    if (new Set(names).size !== names.length) return "Los nombres de los precios deben ser diferentes.";
  }
  if (!draft.service_channels.length) return "Activa al menos una opción de servicio.";
  return null;
}

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "P";
}

function CatalogImageDialog(props: ComponentProps<typeof ImageCropper>) {
  const surfaceRef = useDialogSurface<HTMLDivElement>(props.onCancel);
  return <DialogPortal><div ref={surfaceRef} tabIndex={-1}><ImageCropper {...props} /></div></DialogPortal>;
}

export function CatalogPage() {
  const { branch } = useTenant();
  const [tab, setTab] = useState<CatalogTab>("products");
  const [categoryDialog, setCategoryDialog] = useState<CategoryDialogState>(null);
  const [groupEditor, setGroupEditor] = useState<GroupEditorState>(null);
  const [previewModifierKeys, setPreviewModifierKeys] = useState<string[]>([]);
  const [initialGroupSignature, setInitialGroupSignature] = useState("");
  const [draggedGroupOption, setDraggedGroupOption] = useState<string | null>(null);
  const [openCategoryMenu, setOpenCategoryMenu] = useState<number | null>(null);
  const [openProductMenu, setOpenProductMenu] = useState<number | null>(null);
  const [openGroupMenu, setOpenGroupMenu] = useState<number | null>(null);
  const [customizationFilter, setCustomizationFilter] = useState<ModifierGroupListFilter>("all");
  const [customizationSearchOpen, setCustomizationSearchOpen] = useState(false);
  const [customizationSearch, setCustomizationSearch] = useState("");
  const [draggedCategory, setDraggedCategory] = useState<number | null>(null);
  const [draggedProduct, setDraggedProduct] = useState<number | null>(null);
  const [draggedGroup, setDraggedGroup] = useState<number | null>(null);
  const [draft, setDraft] = useState<ProductDraft | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [initialDraftSignature, setInitialDraftSignature] = useState("");
  const [imageBlob, setImageBlob] = useState<Blob | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [moreOptions, setMoreOptions] = useState(false);
  const [mobilePreviewOpen, setMobilePreviewOpen] = useState(false);
  const [productGroupPickerOpen, setProductGroupPickerOpen] = useState(false);
  const [productGroupSearch, setProductGroupSearch] = useState("");
  const [productPreviewVariantKeys, setProductPreviewVariantKeys] = useState<string[]>([]);
  const [productPreviewSelections, setProductPreviewSelections] = useState<Record<number, number[]>>({});
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const duplicateImageRequestRef = useRef(0);
  const customizationSearchRef = useRef<HTMLInputElement>(null);
  const groupMenuRef = useRef<HTMLDivElement>(null);
  const groupMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const productGroupPickerTriggerRef = useRef<HTMLButtonElement | null>(null);
  const productGroupSearchRef = useRef<HTMLInputElement>(null);
  const productDragIdRef = useRef<number | null>(null);
  const productDragOriginalRef = useRef<Catalog | null>(null);
  const productDragCurrentRef = useRef<Catalog | null>(null);
  const productLastPreviewAtRef = useRef(Number.NEGATIVE_INFINITY);
  const productOrderQueueRef = useRef<Promise<void>>(Promise.resolve());
  const productOrderRevisionRef = useRef(0);
  const groupDragIdRef = useRef<number | null>(null);
  const groupDragOriginalRef = useRef<Catalog | null>(null);
  const groupDragCurrentRef = useRef<Catalog | null>(null);
  const groupLastPreviewAtRef = useRef(Number.NEGATIVE_INFINITY);
  const groupOrderQueueRef = useRef<Promise<void>>(Promise.resolve());
  const groupOrderRevisionRef = useRef(0);

  const resource = useQuery(
    ["catalog", branch?.id],
    async () => branch
      ? normalizeCatalogPayload(await api<Catalog>(`/catalog?branch_id=${branch.id}`))
      : Promise.reject(new Error("Selecciona una sucursal")),
    30000,
  );
  useBranchRealtime(branch?.id, resource.refresh);

  const catalog = resource.data;
  const productOrderKey = catalog
    ? [...catalog.products]
      .sort((left, right) => (
        (left.category_id ?? -1) - (right.category_id ?? -1)
        || left.sort_order - right.sort_order
      ))
      .map((product) => product.id)
      .join("|")
    : "";
  const groupOrderKey = catalog
    ? [...catalog.modifier_groups]
      .sort((left, right) => left.sort_order - right.sort_order)
      .map((group) => group.id)
      .join("|")
    : "";
  const productFlip = useFlipReorder(productOrderKey);
  const groupFlip = useFlipReorder(groupOrderKey);
  const dirty = Boolean(
    draft
    && (draftSignature(draft) !== initialDraftSignature || imageBlob || removeImage),
  );
  const groupDirty = Boolean(groupEditor && groupEditorSignature(groupEditor) !== initialGroupSignature);

  useEffect(() => {
    if (!customizationSearchOpen) return;
    customizationSearchRef.current?.focus();
  }, [customizationSearchOpen]);

  useEffect(() => {
    if (openGroupMenu === null) return;
    const focusFrame = window.requestAnimationFrame(() => {
      groupMenuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    });
    function closeFromOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (groupMenuRef.current?.contains(target) || groupMenuTriggerRef.current?.contains(target)) return;
      setOpenGroupMenu(null);
    }
    function closeFromKeyboard(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpenGroupMenu(null);
      groupMenuTriggerRef.current?.focus();
    }
    document.addEventListener("mousedown", closeFromOutside);
    document.addEventListener("keydown", closeFromKeyboard);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("mousedown", closeFromOutside);
      document.removeEventListener("keydown", closeFromKeyboard);
    };
  }, [openGroupMenu]);

  useEffect(() => {
    if (!draft) return;
    const priceKeys = new Set(draft.prices.map((row) => row.key));
    setProductPreviewVariantKeys((current) => {
      const next = current.filter((key) => priceKeys.has(key));
      return next.length === current.length ? current : next;
    });
  }, [draft]);

  useEffect(() => {
    if (!draft || !catalog) return;
    const selectedGroupIds = new Set(draft.group_ids);
    const validOptionIds = new Map(
      catalog.modifier_groups
        .filter((group) => selectedGroupIds.has(group.id))
        .map((group) => [
          group.id,
          new Set(group.modifiers.filter((modifier) => modifier.active).map((modifier) => modifier.id)),
        ]),
    );
    setProductPreviewSelections((current) => {
      const next = Object.fromEntries(
        Object.entries(current)
          .filter(([groupId]) => selectedGroupIds.has(Number(groupId)))
          .map(([groupId, selections]) => [
            groupId,
            selections.filter((modifierId) => validOptionIds.get(Number(groupId))?.has(modifierId)),
          ]),
      );
      return JSON.stringify(next) === JSON.stringify(current) ? current : next;
    });
  }, [catalog, draft]);

  useEffect(() => {
    if (!groupEditor) return;
    const optionIds = groupEditor.options.filter((option) => option.name.trim()).map((option) => option.key);
    setPreviewModifierKeys((current) => {
      const normalized = normalizeModifierSelection(current, optionIds, {
        allowRepeats: groupEditor.allow_repeats,
        maximum: groupEditor.maximum,
        maxPerOption: groupEditor.max_per_option,
      });
      const unchanged = normalized.length === current.length
        && normalized.every((value, index) => value === current[index]);
      return unchanged ? current : normalized;
    });
  }, [groupEditor]);

  useEffect(() => {
    if (!dirty && !groupDirty) return;
    function warnOnExit(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    window.addEventListener("beforeunload", warnOnExit);
    return () => window.removeEventListener("beforeunload", warnOnExit);
  }, [dirty, groupDirty]);

  useEffect(() => () => {
    if (imagePreview?.startsWith("blob:")) URL.revokeObjectURL(imagePreview);
  }, [imagePreview]);

  function notify(message: string, tone: "success" | "error" = "success") {
    setToast({ message, tone });
  }

  function handleActionMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    if (!items.length) return;
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex: number | null = null;
    if (event.key === "ArrowDown") nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
    if (event.key === "ArrowUp") nextIndex = currentIndex < 0 ? items.length - 1 : (currentIndex - 1 + items.length) % items.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = items.length - 1;
    if (event.key === "Tab") setOpenGroupMenu(null);
    if (nextIndex === null) return;
    event.preventDefault();
    items[nextIndex].focus();
  }

  async function duplicateGroup(group: ModifierGroup) {
    if (!branch || !catalog) return;
    setOpenGroupMenu(null);
    setSaving(true);
    try {
      const highestSortOrder = Math.max(-1, ...catalog.modifier_groups.map((item) => item.sort_order));
      await api("/catalog/modifier-groups", {
        method: "POST",
        body: JSON.stringify(duplicateModifierGroupPayload(group, branch.id, highestSortOrder + 1)),
      });
      await resource.refresh();
      notify(`Se duplicó "${group.name}".`);
    } catch (caught) {
      notify(catalogActionError(caught, "No se pudo duplicar la personalización"), "error");
    } finally {
      setSaving(false);
    }
  }

  async function deleteGroup(group: ModifierGroup) {
    if (!catalog) return;
    setOpenGroupMenu(null);
    const affectedProducts = catalog.products.filter((product) => (
      product.modifier_groups.some((item) => item.id === group.id)
    ));
    const productNames = affectedProducts.map((product) => product.name);
    const visibleNames = productNames.slice(0, 6).join(", ");
    const remaining = productNames.length - 6;
    const affectedCopy = productNames.length
      ? `\n\nSe quitará de ${productNames.length} ${productNames.length === 1 ? "producto" : "productos"}: ${visibleNames}${remaining > 0 ? ` y ${remaining} más` : ""}.`
      : "";
    if (!window.confirm(`¿Borrar "${group.name}"?${affectedCopy}\n\nEsta acción no se puede deshacer.`)) return;

    setSaving(true);
    try {
      await api(`/catalog/modifier-groups/${group.id}`, { method: "DELETE" });
      await resource.refresh();
      notify(productNames.length
        ? `Personalización borrada y retirada de ${productNames.length} ${productNames.length === 1 ? "producto" : "productos"}.`
        : "Personalización borrada.");
    } catch (caught) {
      notify(catalogActionError(caught, "No se pudo borrar la personalización"), "error");
    } finally {
      setSaving(false);
    }
  }

  function addProductGroup(groupId: number) {
    if (!draft || draft.group_ids.includes(groupId)) return;
    setDraft({ ...draft, group_ids: [...draft.group_ids, groupId] });
    setProductGroupPickerOpen(false);
    setProductGroupSearch("");
  }

  function removeProductGroup(groupId: number) {
    if (!draft) return;
    setDraft({ ...draft, group_ids: draft.group_ids.filter((id) => id !== groupId) });
    setProductPreviewSelections((current) => {
      const next = { ...current };
      delete next[groupId];
      return next;
    });
  }

  function openNewProduct(categoryId?: number) {
    const next = emptyProductDraft();
    if (categoryId) next.category_id = String(categoryId);
    setEditingProduct(null);
    setDraft(next);
    setInitialDraftSignature(draftSignature(next));
    setImageBlob(null);
    setImagePreview(null);
    setRemoveImage(false);
    setMoreOptions(false);
    setMobilePreviewOpen(false);
    setProductGroupPickerOpen(false);
    setProductGroupSearch("");
    setProductPreviewVariantKeys([]);
    setProductPreviewSelections({});
  }

  function openEditProduct(product: Product) {
    const next = draftFromProduct(product);
    setEditingProduct(product);
    setDraft(next);
    setInitialDraftSignature(draftSignature(next));
    setImageBlob(null);
    setImagePreview(null);
    setRemoveImage(false);
    setMoreOptions(false);
    setMobilePreviewOpen(false);
    setProductGroupPickerOpen(false);
    setProductGroupSearch("");
    setProductPreviewVariantKeys([]);
    setProductPreviewSelections({});
    setOpenProductMenu(null);
  }

  async function openDuplicateProduct(product: Product) {
    const requestId = duplicateImageRequestRef.current + 1;
    duplicateImageRequestRef.current = requestId;
    const next = {
      ...draftFromProduct(product),
      id: null,
      name: `${product.name} copia`,
      image_url: null,
    };
    setEditingProduct(null);
    setDraft(next);
    setInitialDraftSignature(draftSignature(next));
    setImageBlob(null);
    setImagePreview(null);
    setRemoveImage(false);
    setMoreOptions(false);
    setMobilePreviewOpen(false);
    setOpenProductMenu(null);
    setProductGroupPickerOpen(false);
    setProductGroupSearch("");
    setProductPreviewVariantKeys([]);
    setProductPreviewSelections({});

    const sourceImage = publicAssetUrl(product.image_url);
    if (!sourceImage) return;
    try {
      const response = await fetch(sourceImage);
      if (!response.ok) return;
      const blob = await response.blob();
      if (duplicateImageRequestRef.current !== requestId) return;
      const preview = URL.createObjectURL(blob);
      setImageBlob(blob);
      setImagePreview(preview);
    } catch {
      // The duplicate remains usable even if its image cannot be copied.
    }
  }

  function closeProductDrawer(force = false) {
    if (!force && dirty && !window.confirm("Tienes cambios sin guardar. ¿Quieres cerrar de todos modos?")) return;
    if (imagePreview?.startsWith("blob:")) URL.revokeObjectURL(imagePreview);
    duplicateImageRequestRef.current += 1;
    setDraft(null);
    setEditingProduct(null);
    setImageBlob(null);
    setImagePreview(null);
    setRemoveImage(false);
    setCropFile(null);
    setProductGroupPickerOpen(false);
    setProductGroupSearch("");
    setProductPreviewVariantKeys([]);
    setProductPreviewSelections({});
  }

  function openNewGroup() {
    const next = emptyGroupEditor(catalog?.modifier_groups.length || 0);
    setGroupEditor(next);
    setInitialGroupSignature(groupEditorSignature(next));
    setPreviewModifierKeys([]);
    setMobilePreviewOpen(false);
  }

  function openEditGroup(group: ModifierGroup) {
    const next = groupEditorFromGroup(group);
    setGroupEditor(next);
    setInitialGroupSignature(groupEditorSignature(next));
    setPreviewModifierKeys([]);
    setMobilePreviewOpen(false);
  }

  function closeGroupEditor(force = false) {
    if (!force && groupDirty && !window.confirm("Tienes cambios sin guardar. ¿Quieres cerrar de todos modos?")) return;
    setGroupEditor(null);
    setPreviewModifierKeys([]);
    setDraggedGroupOption(null);
  }

  const productSurfaceRef = useDialogSurface(() => closeProductDrawer(), { enabled: Boolean(draft && catalog && branch) });
  const categorySurfaceRef = useDialogSurface(() => setCategoryDialog(null), { enabled: Boolean(categoryDialog && catalog && branch) });
  const groupSurfaceRef = useDialogSurface(() => closeGroupEditor(), { enabled: Boolean(groupEditor && catalog && branch) });
  const productGroupPickerRef = useDialogSurface<HTMLDivElement>(() => setProductGroupPickerOpen(false), {
    enabled: Boolean(draft && productGroupPickerOpen && catalog && branch),
  });

  useEffect(() => {
    if (!productGroupPickerOpen) return;
    function closeFromOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (productGroupPickerRef.current?.contains(target) || productGroupPickerTriggerRef.current?.contains(target)) return;
      setProductGroupPickerOpen(false);
    }
    document.addEventListener("mousedown", closeFromOutside);
    return () => document.removeEventListener("mousedown", closeFromOutside);
  }, [productGroupPickerOpen, productGroupPickerRef]);

  function updateGroupOption(key: string, changes: Partial<GroupOptionDraft>) {
    if (!groupEditor) return;
    setGroupEditor({
      ...groupEditor,
      options: groupEditor.options.map((option) => option.key === key ? { ...option, ...changes } : option),
    });
  }

  function addGroupOption() {
    if (!groupEditor) return;
    setGroupEditor({ ...groupEditor, options: [...groupEditor.options, emptyGroupOption()] });
  }

  function removeGroupOption(key: string) {
    if (!groupEditor) return;
    setGroupEditor({ ...groupEditor, options: groupEditor.options.filter((option) => option.key !== key) });
  }

  function moveGroupOption(sourceKey: string, targetKey: string) {
    if (!groupEditor || sourceKey === targetKey) return;
    const sourceIndex = groupEditor.options.findIndex((option) => option.key === sourceKey);
    const targetIndex = groupEditor.options.findIndex((option) => option.key === targetKey);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const next = [...groupEditor.options];
    const [moved] = next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, moved);
    setGroupEditor({ ...groupEditor, options: next });
    setDraggedGroupOption(null);
  }

  function moveGroupOptionBy(key: string, direction: -1 | 1) {
    if (!groupEditor) return;
    const index = groupEditor.options.findIndex((option) => option.key === key);
    const target = groupEditor.options[index + direction];
    if (target) moveGroupOption(key, target.key);
  }

  async function saveCategory() {
    if (!branch || !categoryDialog?.value.trim()) return;
    setSaving(true);
    try {
      if (categoryDialog.mode === "create") {
        const created = await api<Category>("/catalog/categories", {
          method: "POST",
          body: JSON.stringify({
            branch_id: branch.id,
            name: categoryDialog.value.trim(),
            sort_order: catalog?.categories.length || 0,
          }),
        });
        resource.setData((current) => upsertCatalogCategory(current, created));
        setDraft((current) => current ? { ...current, category_id: String(created.id) } : current);
        notify("Categoría agregada.");
      } else if (categoryDialog.categoryId) {
        const updated = await api<Category>(`/catalog/categories/${categoryDialog.categoryId}`, {
          method: "PATCH",
          body: JSON.stringify({ name: categoryDialog.value.trim() }),
        });
        resource.setData((current) => upsertCatalogCategory(current, updated));
        notify("Categoría renombrada.");
      }
      setCategoryDialog(null);
    } catch (caught) {
      notify(catalogActionError(caught, "No se pudo guardar la categoría"), "error");
    } finally {
      setSaving(false);
    }
  }

  async function deleteCategory(category: Category) {
    setOpenCategoryMenu(null);
    if (!catalog) return;
    const eligibility = categoryDeleteEligibility(catalog, category.id);
    if (!eligibility.allowed) {
      notify("No puedes borrar esta categoría porque contiene los últimos productos del restaurante.", "error");
      return;
    }
    const confirmation = eligibility.categoryProductCount
      ? `¿Borrar "${category.name}" y retirar sus ${eligibility.categoryProductCount} productos del menú?`
      : `¿Borrar la categoría vacía "${category.name}"?`;
    if (!window.confirm(confirmation)) return;
    setSaving(true);
    try {
      await api(`/catalog/categories/${category.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: false }),
      });
      resource.setData((current) => current ? {
        ...current,
        categories: current.categories.map((item) => (
          item.id === category.id ? { ...item, active: false } : item
        )),
      } : current);
      notify("Categoría borrada del menú.");
    } catch (caught) {
      notify(catalogActionError(caught, "No se pudo borrar la categoría"), "error");
    } finally {
      setSaving(false);
    }
  }

  async function persistCategoryOrder(sourceId: number, targetId: number) {
    if (!catalog || sourceId === targetId) return;
    const previous = catalog;
    const optimistic = reorderCatalogCategories(catalog, sourceId, targetId);
    if (optimistic === catalog) return;
    const next = optimistic.categories
      .filter((category) => category.active)
      .sort((a, b) => a.sort_order - b.sort_order);
    resource.setData(optimistic);
    setSaving(true);
    try {
      try {
        await api("/catalog/categories/order", {
          method: "PUT",
          body: JSON.stringify({
            branch_id: catalog.branch.id,
            category_ids: next.map((category) => category.id),
          }),
        });
      } catch (caught) {
        if (!(caught instanceof ApiError) || ![404, 405].includes(caught.status)) throw caught;
        await Promise.all(next.map((category, sort_order) => api(`/catalog/categories/${category.id}`, {
          method: "PATCH",
          body: JSON.stringify({ sort_order }),
        })));
      }
      notify("Orden actualizado.");
    } catch (caught) {
      resource.setData(previous);
      notify(catalogActionError(caught, "No se pudo reordenar"), "error");
    } finally {
      setSaving(false);
      setDraggedCategory(null);
    }
  }

  async function moveCategory(categoryId: number, direction: -1 | 1) {
    if (!catalog) return;
    const ordered = catalog.categories.filter((item) => item.active).sort((a, b) => a.sort_order - b.sort_order);
    const index = ordered.findIndex((item) => item.id === categoryId);
    const target = ordered[index + direction];
    setOpenCategoryMenu(null);
    if (target) await persistCategoryOrder(categoryId, target.id);
  }

  function resetProductDrag() {
    productDragIdRef.current = null;
    productDragOriginalRef.current = null;
    productDragCurrentRef.current = null;
    productLastPreviewAtRef.current = Number.NEGATIVE_INFINITY;
    setDraggedProduct(null);
  }

  async function saveProductOrder(
    previous: Catalog,
    nextCatalog: Catalog,
    categoryId: number | null,
    revision: number,
  ) {
    const next = nextCatalog.products
      .filter((product) => product.category_id === categoryId)
      .sort((a, b) => a.sort_order - b.sort_order);
    try {
      try {
        await api("/catalog/products/order", {
          method: "PUT",
          body: JSON.stringify({
            branch_id: nextCatalog.branch.id,
            category_id: categoryId,
            product_ids: next.map((product) => product.id),
          }),
        });
      } catch (caught) {
        if (!(caught instanceof ApiError) || ![404, 405].includes(caught.status)) throw caught;
        await Promise.all(next.map((product, sort_order) => api(`/catalog/products/${product.id}`, {
          method: "PATCH",
          body: JSON.stringify({ category_id: categoryId, sort_order }),
        })));
      }
      if (revision === productOrderRevisionRef.current) notify("Orden de productos actualizado.");
    } catch (caught) {
      if (revision !== productOrderRevisionRef.current) return;
      productFlip.capture();
      resource.setData(previous);
      notify(catalogActionError(caught, "No se pudo reordenar el producto"), "error");
    }
  }

  function queueProductOrderSave(previous: Catalog, next: Catalog, categoryId: number | null) {
    const revision = productOrderRevisionRef.current + 1;
    productOrderRevisionRef.current = revision;
    const queued = productOrderQueueRef.current
      .catch(() => undefined)
      .then(() => saveProductOrder(previous, next, categoryId, revision));
    productOrderQueueRef.current = queued;
    return queued;
  }

  async function persistProductOrder(sourceId: number, targetId: number, categoryId: number | null) {
    if (!catalog || sourceId === targetId) return;
    const optimistic = reorderCatalogProducts(catalog, sourceId, targetId, categoryId);
    if (optimistic === catalog) return;
    productFlip.capture();
    resource.setData(optimistic);
    await queueProductOrderSave(catalog, optimistic, categoryId);
  }

  function startProductDrag(productId: number) {
    if (!catalog) return;
    productDragIdRef.current = productId;
    productDragOriginalRef.current = catalog;
    productDragCurrentRef.current = catalog;
    productLastPreviewAtRef.current = Number.NEGATIVE_INFINITY;
    setDraggedProduct(productId);
  }

  function previewProductOrder(
    targetId: number,
    categoryId: number | null,
    pointerY: number,
    targetRect: DOMRect,
  ) {
    const sourceId = productDragIdRef.current;
    const current = productDragCurrentRef.current;
    if (!sourceId || !current || sourceId === targetId) return;
    const ordered = current.products
      .filter((product) => product.category_id === categoryId)
      .sort((left, right) => left.sort_order - right.sort_order);
    const sourceIndex = ordered.findIndex((product) => product.id === sourceId);
    const targetIndex = ordered.findIndex((product) => product.id === targetId);
    if (!hasCrossedReorderThreshold({
      sourceIndex,
      targetIndex,
      pointerY,
      targetTop: targetRect.top,
      targetHeight: targetRect.height,
    })) return;
    const now = performance.now();
    if (now - productLastPreviewAtRef.current < REORDER_PREVIEW_COOLDOWN_MS) return;
    const next = reorderCatalogProducts(current, sourceId, targetId, categoryId);
    if (next === current) return;
    productFlip.capture();
    productLastPreviewAtRef.current = now;
    productDragCurrentRef.current = next;
    resource.setData(next);
  }

  function commitProductDrag(categoryId: number | null) {
    const previous = productDragOriginalRef.current;
    const next = productDragCurrentRef.current;
    resetProductDrag();
    if (!previous || !next || previous === next) return;
    void queueProductOrderSave(previous, next, categoryId);
  }

  function cancelProductDrag() {
    const previous = productDragOriginalRef.current;
    const current = productDragCurrentRef.current;
    if (previous && current && previous !== current) {
      productFlip.capture();
      resource.setData(previous);
    }
    resetProductDrag();
  }

  async function moveProduct(product: Product, direction: -1 | 1) {
    if (!catalog) return;
    const ordered = catalog.products
      .filter((item) => item.category_id === product.category_id)
      .sort((a, b) => a.sort_order - b.sort_order);
    const index = ordered.findIndex((item) => item.id === product.id);
    const target = ordered[index + direction];
    setOpenProductMenu(null);
    if (target) await persistProductOrder(product.id, target.id, product.category_id);
  }

  function resetGroupDrag() {
    groupDragIdRef.current = null;
    groupDragOriginalRef.current = null;
    groupDragCurrentRef.current = null;
    groupLastPreviewAtRef.current = Number.NEGATIVE_INFINITY;
    setDraggedGroup(null);
  }

  async function saveGroupOrder(previous: Catalog, nextCatalog: Catalog, revision: number) {
    const next = [...nextCatalog.modifier_groups].sort((a, b) => a.sort_order - b.sort_order);
    try {
      try {
        await api("/catalog/modifier-groups/order", {
          method: "PUT",
          body: JSON.stringify({
            branch_id: nextCatalog.branch.id,
            group_ids: next.map((group) => group.id),
          }),
        });
      } catch (caught) {
        if (!(caught instanceof ApiError) || ![404, 405].includes(caught.status)) throw caught;
        await Promise.all(next.map((group, sort_order) => api(`/catalog/modifier-groups/${group.id}`, {
          method: "PATCH",
          body: JSON.stringify({ sort_order }),
        })));
      }
      if (revision === groupOrderRevisionRef.current) notify("Orden actualizado.");
    } catch (caught) {
      if (revision !== groupOrderRevisionRef.current) return;
      groupFlip.capture();
      resource.setData(previous);
      notify(catalogActionError(caught, "No se pudo reordenar"), "error");
    }
  }

  function queueGroupOrderSave(previous: Catalog, next: Catalog) {
    const revision = groupOrderRevisionRef.current + 1;
    groupOrderRevisionRef.current = revision;
    const queued = groupOrderQueueRef.current
      .catch(() => undefined)
      .then(() => saveGroupOrder(previous, next, revision));
    groupOrderQueueRef.current = queued;
    return queued;
  }

  async function persistGroupOrder(sourceId: number, targetId: number) {
    if (!catalog || sourceId === targetId) return;
    const optimistic = reorderCatalogModifierGroups(catalog, sourceId, targetId);
    if (optimistic === catalog) return;
    groupFlip.capture();
    resource.setData(optimistic);
    await queueGroupOrderSave(catalog, optimistic);
  }

  function startGroupDrag(groupId: number) {
    if (!catalog) return;
    groupDragIdRef.current = groupId;
    groupDragOriginalRef.current = catalog;
    groupDragCurrentRef.current = catalog;
    groupLastPreviewAtRef.current = Number.NEGATIVE_INFINITY;
    setDraggedGroup(groupId);
  }

  function previewGroupOrder(targetId: number, pointerY: number, targetRect: DOMRect) {
    const sourceId = groupDragIdRef.current;
    const current = groupDragCurrentRef.current;
    if (!sourceId || !current || sourceId === targetId) return;
    const ordered = [...current.modifier_groups].sort((left, right) => left.sort_order - right.sort_order);
    const sourceIndex = ordered.findIndex((group) => group.id === sourceId);
    const targetIndex = ordered.findIndex((group) => group.id === targetId);
    if (!hasCrossedReorderThreshold({
      sourceIndex,
      targetIndex,
      pointerY,
      targetTop: targetRect.top,
      targetHeight: targetRect.height,
    })) return;
    const now = performance.now();
    if (now - groupLastPreviewAtRef.current < REORDER_PREVIEW_COOLDOWN_MS) return;
    const next = reorderCatalogModifierGroups(current, sourceId, targetId);
    if (next === current) return;
    groupFlip.capture();
    groupLastPreviewAtRef.current = now;
    groupDragCurrentRef.current = next;
    resource.setData(next);
  }

  function commitGroupDrag() {
    const previous = groupDragOriginalRef.current;
    const next = groupDragCurrentRef.current;
    resetGroupDrag();
    if (!previous || !next || previous === next) return;
    void queueGroupOrderSave(previous, next);
  }

  function cancelGroupDrag() {
    const previous = groupDragOriginalRef.current;
    const current = groupDragCurrentRef.current;
    if (previous && current && previous !== current) {
      groupFlip.capture();
      resource.setData(previous);
    }
    resetGroupDrag();
  }

  async function moveGroup(groupId: number, direction: -1 | 1) {
    if (!catalog) return;
    const ordered = [...catalog.modifier_groups].sort((a, b) => a.sort_order - b.sort_order);
    const index = ordered.findIndex((group) => group.id === groupId);
    const target = ordered[index + direction];
    if (target) await persistGroupOrder(groupId, target.id);
  }

  async function removeProductFromMenu(product: Product) {
    setOpenProductMenu(null);
    if (!window.confirm(`¿Borrar "${product.name}" del menú? Podrás restaurarlo desde Disponibilidad.`)) return;
    setSaving(true);
    try {
      await api(`/catalog/products/${product.id}/availability`, {
        method: "PATCH",
        body: JSON.stringify({ available: false }),
      });
      resource.setData((current) => current ? {
        ...current,
        products: current.products.map((item) => item.id === product.id ? { ...item, available: false } : item),
      } : current);
      notify("Producto retirado del menú. Puedes restaurarlo en Disponibilidad.");
    } catch (caught) {
      notify(catalogActionError(caught, "No se pudo retirar el producto"), "error");
    } finally {
      setSaving(false);
    }
  }

  async function syncVariants(productId: number, sourceProduct: Product | null, rows: AbsolutePriceRow[]) {
    const { basePrice, variants } = priceRowsToPayload(rows);
    const existing = sourceProduct?.variants || [];
    const usedIds = new Set<number>();
    for (const variant of variants) {
      const nameMatch = existing.find((item) => (
        item.name.trim().toLocaleLowerCase("es-PE") === variant.name.toLocaleLowerCase("es-PE")
      ));
      const variantId = variant.id || nameMatch?.id;
      if (variantId) {
        usedIds.add(variantId);
        await api(`/catalog/variants/${variantId}`, {
          method: "PATCH",
          body: JSON.stringify({
            name: variant.name,
            price_delta: variant.price_delta,
            active: true,
          }),
        });
      } else {
        const created = await api<{ id: number }>(`/catalog/products/${productId}/variants`, {
          method: "POST",
          body: JSON.stringify({
            name: variant.name,
            price_delta: variant.price_delta,
            active: true,
          }),
        });
        usedIds.add(created.id);
      }
    }
    for (const variant of existing.filter((item) => item.active && !usedIds.has(item.id))) {
      await api(`/catalog/variants/${variant.id}`, { method: "DELETE" });
    }
    return basePrice;
  }

  async function saveProduct() {
    if (!branch || !catalog || !draft) return;
    const validation = validateProductDraft(draft);
    if (validation) {
      notify(validation, "error");
      return;
    }
    setSaving(true);
    let productId = draft.id;
    let basicSaved = false;
    try {
      const { basePrice } = priceRowsToPayload(draft.prices);
      const sku = editingProduct?.sku || generateProductSku(
        draft.name,
        catalog.products.filter((product) => product.id !== draft.id).map((product) => product.sku),
      );
      const productPayload = {
        category_id: Number(draft.category_id),
        sku,
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        price: basePrice,
        service_channels: draft.service_channels,
        available: draft.available,
      };
      if (productId) {
        await api(`/catalog/products/${productId}`, {
          method: "PATCH",
          body: JSON.stringify(productPayload),
        });
      } else {
        const created = await api<{ id: number }>("/catalog/products", {
          method: "POST",
          body: JSON.stringify({
            ...productPayload,
            branch_id: branch.id,
            product_type: "standard",
            track_stock: false,
            preparation_station: "kitchen",
            sort_order: catalog.products.filter((product) => product.category_id === Number(draft.category_id)).length,
          }),
        });
        productId = created.id;
      }
      basicSaved = true;
      await syncVariants(productId, editingProduct, draft.prices);
      const previousGroupIds = (editingProduct?.modifier_groups ?? []).map((group) => group.id).sort((a, b) => a - b);
      const nextGroupIds = [...draft.group_ids].sort((a, b) => a - b);
      const modifierGroupsChanged = previousGroupIds.length !== nextGroupIds.length
        || previousGroupIds.some((groupId, index) => groupId !== nextGroupIds[index]);
      if (modifierGroupsChanged) {
        await api(`/catalog/products/${productId}/modifier-groups`, {
          method: "PUT",
          body: JSON.stringify({ group_ids: draft.group_ids }),
        });
      }
      if (imageBlob) {
        const form = new FormData();
        form.append("file", new File([imageBlob], `producto-${productId}.webp`, { type: "image/webp" }));
        await api(`/catalog/products/${productId}/image`, { method: "POST", body: form });
      } else if (removeImage && editingProduct?.image_url) {
        await api(`/catalog/products/${productId}/image`, { method: "DELETE" });
      }
      const refreshed = normalizeCatalogPayload(
        await api<Catalog>(`/catalog?branch_id=${branch.id}`),
      );
      resource.setData(refreshed);
      closeProductDrawer(true);
      notify(draft.id ? "Producto actualizado." : "Producto agregado al menú.");
    } catch (caught) {
      if (basicSaved && productId) {
        setDraft((current) => current ? { ...current, id: productId } : current);
        try {
          const refreshed = normalizeCatalogPayload(
            await api<Catalog>(`/catalog?branch_id=${branch.id}`),
          );
          resource.setData(refreshed);
          setEditingProduct(refreshed.products.find((product) => product.id === productId) || null);
        } catch {
          // The saved ID still prevents a duplicate creation on the next retry.
        }
      }
      const detail = catalogActionError(caught, "No se pudo guardar el producto");
      notify(
        basicSaved
          ? `Se guardaron los datos básicos, pero faltó completar una parte: ${detail}`
          : detail,
        "error",
      );
    } finally {
      setSaving(false);
    }
  }

  function handleImageFile(file?: File) {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      notify("Usa una imagen JPEG, PNG o WebP.", "error");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      notify("La imagen no puede superar 5 MB.", "error");
      return;
    }
    setCropFile(file);
  }

  async function saveGroup() {
    if (!branch || !groupEditor) return;
    const validation = validateGroupEditor(groupEditor);
    if (validation) return notify(validation, "error");
    setSaving(true);
    try {
      const minimum = Number(groupEditor.minimum || 0);
      const payload = {
        name: groupEditor.name.trim(),
        internal_label: groupEditor.internal_label.trim() || null,
        minimum,
        maximum: groupEditor.maximum,
        required: minimum > 0,
        allow_repeats: groupEditor.allow_repeats,
        max_per_option: groupEditor.allow_repeats ? groupEditor.max_per_option : null,
        sort_order: groupEditor.sort_order,
        modifiers: groupEditor.options.map((option, sort_order) => ({
          id: option.id,
          name: option.name.trim(),
          price_delta: Number(option.price_delta),
          active: true,
          sort_order,
        })),
      };
      if (groupEditor.id) {
        await api(`/catalog/modifier-groups/${groupEditor.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        notify("Personalización actualizada.");
      } else {
        await api("/catalog/modifier-groups", {
          method: "POST",
          body: JSON.stringify({ ...payload, branch_id: branch.id }),
        });
        notify("Personalización creada.");
      }
      await resource.refresh();
      closeGroupEditor(true);
    } catch (caught) {
      const message = caught instanceof ApiError && caught.code === "API_CONTRACT_UNSUPPORTED"
        ? "La API instalada todavía no reconoce este editor. Actualiza la API y vuelve a intentar."
        : catalogActionError(caught, "No se pudo guardar la personalización");
      notify(message, "error");
    } finally {
      setSaving(false);
    }
  }

  if (resource.loading && !catalog) return <LoadingState label="Preparando el menú..." />;
  if (resource.error && !catalog) return <ErrorState message={resource.error} onRetry={() => void resource.refresh()} />;
  if (!catalog || !branch) return <LoadingState />;

  const activeCategories = catalog.categories.filter((category) => category.active).sort((a, b) => a.sort_order - b.sort_order);
  const visibleProducts = menuVisibleProducts(catalog);
  const uncategorizedProducts = visibleProducts.filter((product) => product.category_id === null);
  const previewImage = imagePreview || publicAssetUrl(draft?.image_url);
  const modifierUsage = modifierGroupUsageCounts(catalog);
  const unusedModifierGroupCount = [...modifierUsage.values()].filter((count) => count === 0).length;
  const visibleModifierGroups = filterCatalogModifierGroups(catalog, customizationFilter, customizationSearch);
  const selectedPreviewGroups = modifierGroupsForProduct(catalog, draft?.group_ids || []);
  const availableProductGroups = availableModifierGroupsForProduct(
    catalog,
    draft?.group_ids || [],
    productGroupSearch,
  );

  return (
    <div className="menu-page" onClickCapture={(event) => {
      const item = (event.target as Element).closest(".category-menu [role='menuitem'], .product-menu [role='menuitem'], .customization-menu [role='menuitem']");
      // Menu items unmount when they open an editor; retain their persistent trigger.
      item?.closest(".menu-context")?.querySelector<HTMLButtonElement>(":scope > button")?.focus();
    }}>
      {resource.error && <div className="orders-sync-warning" role="alert">No se pudo actualizar. Se muestra la última consulta. {resource.error}<button className="button button-secondary" onClick={() => void resource.refresh()}>Reintentar</button></div>}
      <header className="menu-page-header">
        <div>
          <h1>Menú</h1>
          <p>Organiza lo que ofreces en el local y en tu carta digital.</p>
        </div>
      </header>

      <nav className="menu-tabs" aria-label="Secciones del menú" role="tablist">
        {([
          ["products", "Productos"],
          ["customizations", "Personalizaciones"],
          ["promotions", "Promociones"],
        ] as [CatalogTab, string][]).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            id={`menu-tab-${value}`}
            aria-controls={`menu-panel-${value}`}
            aria-selected={tab === value}
            tabIndex={tab === value ? 0 : -1}
            className={tab === value ? "active" : ""}
            onClick={() => setTab(value)}
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const tabs = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role='tab']") || []);
              const currentIndex = tabs.indexOf(event.currentTarget);
              const nextIndex = event.key === "Home"
                ? 0
                : event.key === "End"
                  ? tabs.length - 1
                  : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
              const nextTab = tabs[nextIndex];
              nextTab?.focus();
              nextTab?.click();
            }}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === "products" && <div className="menu-page-actions">
        <button className="button button-secondary" type="button" onClick={() => setCategoryDialog({ mode: "create", value: "" })}>
          <Plus /> Nueva categoría
        </button>
        <button className="button menu-primary" type="button" onClick={() => openNewProduct()}>
          <Plus /> Nuevo producto
        </button>
      </div>}

      {tab === "products" && (
        <section className="menu-category-list" id="menu-panel-products" role="tabpanel" aria-labelledby="menu-tab-products">
          {activeCategories.length || uncategorizedProducts.length ? (
            <div
              className={`menu-catalog-board ${draggedCategory ? "dragging-category" : ""} ${draggedProduct ? "dragging-product" : ""}`}
            >
              {activeCategories.map((category) => {
                const products = visibleProducts
                  .filter((product) => product.category_id === category.id)
                  .sort((a, b) => a.sort_order - b.sort_order);
                const deleteEligibility = categoryDeleteEligibility(catalog, category.id);
                const deleteBlockedMessage = "No puedes borrar esta categoría porque contiene los últimos productos del restaurante.";
                return (
                  <section
                    key={category.id}
                    className={`menu-category-section ${draggedCategory === category.id ? "dragging" : ""}`}
                    onDragOver={(event) => {
                      if (!draggedCategory) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={(event) => {
                      if (!draggedCategory) return;
                      event.preventDefault();
                      void persistCategoryOrder(draggedCategory, category.id);
                    }}
                  >
                    <header>
                      <div className="menu-drag-label">
                        <button
                          className="menu-drag-handle"
                          type="button"
                          draggable={!saving}
                          aria-label={`Mover categoría ${category.name}`}
                          title="Arrastra para reordenar"
                          onDragStart={(event) => {
                            event.dataTransfer.effectAllowed = "move";
                            event.dataTransfer.setData("text/plain", `category:${category.id}`);
                            setDraggedCategory(category.id);
                          }}
                          onDragEnd={() => setDraggedCategory(null)}
                          onKeyDown={(event) => {
                            if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                            event.preventDefault();
                            void moveCategory(category.id, event.key === "ArrowUp" ? -1 : 1);
                          }}
                        >
                          <GripVertical aria-hidden="true" />
                        </button>
                        <div>
                          <h2>{category.name}</h2>
                          <span>{products.length} {products.length === 1 ? "producto" : "productos"}</span>
                        </div>
                      </div>
                      <div className="menu-context">
                        <button
                          className="menu-icon-button"
                          type="button"
                          aria-label={`Opciones de ${category.name}`}
                          aria-expanded={openCategoryMenu === category.id}
                          onClick={() => setOpenCategoryMenu(openCategoryMenu === category.id ? null : category.id)}
                        >
                          <MoreHorizontal />
                        </button>
                        {openCategoryMenu === category.id && (
                          <div className="menu-context-popover category-menu" role="menu" aria-label={`Acciones para ${category.name}`}>
                            <span className="menu-context-title">Acciones</span>
                            <button className="edit-action" role="menuitem" type="button" onClick={() => {
                              setCategoryDialog({ mode: "rename", value: category.name, categoryId: category.id });
                              setOpenCategoryMenu(null);
                            }}><Pencil /> Editar</button>
                            <button className="add-action" role="menuitem" type="button" onClick={() => {
                              openNewProduct(category.id);
                              setOpenCategoryMenu(null);
                            }}><Plus /> Agregar producto</button>
                            <button
                              className="danger"
                              role="menuitem"
                              type="button"
                              disabled={!deleteEligibility.allowed || saving}
                              title={!deleteEligibility.allowed ? deleteBlockedMessage : undefined}
                              aria-label={!deleteEligibility.allowed ? `Borrar. ${deleteBlockedMessage}` : "Borrar categoría"}
                              onClick={() => void deleteCategory(category)}
                            >
                              <Trash2 /> Borrar
                            </button>
                          </div>
                        )}
                      </div>
                    </header>
                    <div className="menu-product-rows">
                      {products.map((product) => (
                        <div
                          key={product.id}
                          ref={(node) => productFlip.register(String(product.id), node)}
                          className={`menu-product-row ${draggedProduct === product.id ? "dragging" : ""} ${openProductMenu === product.id ? "menu-open" : ""}`}
                          onDragOver={(event) => {
                            if (!productDragIdRef.current) return;
                            event.preventDefault();
                            event.stopPropagation();
                            event.dataTransfer.dropEffect = "move";
                            previewProductOrder(
                              product.id,
                              category.id,
                              event.clientY,
                              event.currentTarget.getBoundingClientRect(),
                            );
                          }}
                          onDrop={(event) => {
                            if (!productDragIdRef.current) return;
                            event.preventDefault();
                            event.stopPropagation();
                            commitProductDrag(category.id);
                          }}
                        >
                          <button
                            className="menu-drag-handle product-drag-handle"
                            type="button"
                            draggable
                            aria-label={`Mover ${product.name}`}
                            title="Arrastra para reordenar"
                            onDragStart={(event) => {
                              event.stopPropagation();
                              event.dataTransfer.effectAllowed = "move";
                              event.dataTransfer.setData("text/plain", `product:${product.id}`);
                              const row = event.currentTarget.closest<HTMLElement>(".menu-product-row");
                              if (row) {
                                const rect = row.getBoundingClientRect();
                                event.dataTransfer.setDragImage(
                                  row,
                                  Math.max(0, event.clientX - rect.left),
                                  Math.max(0, event.clientY - rect.top),
                                );
                              }
                              startProductDrag(product.id);
                            }}
                            onDragEnd={(event) => {
                              cancelProductDrag();
                              event.currentTarget.blur();
                            }}
                            onKeyDown={(event) => {
                              if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                              event.preventDefault();
                              void moveProduct(product, event.key === "ArrowUp" ? -1 : 1);
                            }}
                          >
                            <GripVertical aria-hidden="true" />
                          </button>
                          <button className="menu-product-main" type="button" onClick={() => openEditProduct(product)}>
                            <span
                              className="menu-product-thumb"
                              style={product.image_url ? { backgroundImage: `url(${publicAssetUrl(product.image_url)})` } : undefined}
                            >
                              {!product.image_url && initials(product.name)}
                            </span>
                            <span>
                              <strong>{product.name}</strong>
                              <small>
                                {product.variants.filter((variant) => variant.active).length
                                  ? `Desde S/ ${Number(product.price).toFixed(2)}`
                                  : `S/ ${Number(product.price).toFixed(2)}`}
                              </small>
                            </span>
                          </button>
                          <div className="menu-context">
                            <button
                              className="menu-icon-button"
                              type="button"
                              aria-label={`Opciones de ${product.name}`}
                              aria-expanded={openProductMenu === product.id}
                              onClick={() => setOpenProductMenu(openProductMenu === product.id ? null : product.id)}
                            >
                              <MoreHorizontal />
                            </button>
                            {openProductMenu === product.id && (
                              <div className="menu-context-popover product-menu" role="menu" aria-label={`Acciones para ${product.name}`}>
                                <span className="menu-context-title">Acciones</span>
                                <button className="edit-action" role="menuitem" type="button" onClick={() => openEditProduct(product)}>
                                  <Pencil /> Editar
                                </button>
                                <button className="duplicate-action" role="menuitem" type="button" onClick={() => void openDuplicateProduct(product)}>
                                  <Copy /> Duplicar
                                </button>
                                <button className="danger" role="menuitem" type="button" onClick={() => void removeProductFromMenu(product)}>
                                  <Trash2 /> Borrar
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                      {!products.length && (
                        <button className="menu-empty-category" type="button" onClick={() => openNewProduct(category.id)}>
                          <Plus /> Agregar el primer producto
                        </button>
                      )}
                    </div>
                  </section>
                );
              })}

              {uncategorizedProducts.length > 0 && (
                <section className="menu-category-section menu-category-warning">
                  <header><div><h2>Sin categoría</h2><span>Revisa estos productos</span></div></header>
                  <div className="menu-product-rows">
                    {uncategorizedProducts.map((product) => (
                      <button className="menu-product-main standalone" key={product.id} type="button" onClick={() => openEditProduct(product)}>
                        <span className="menu-product-thumb">{initials(product.name)}</span>
                        <span><strong>{product.name}</strong><small>Asigna una categoría para publicarlo</small></span>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              <footer className="menu-catalog-summary">
                Mostrando {visibleProducts.length} {visibleProducts.length === 1 ? "producto" : "productos"}
              </footer>
            </div>
          ) : (
            <EmptyState title="Tu menú está listo para empezar" detail="Crea una categoría y agrega tu primer producto." />
          )}

        </section>
      )}

      {tab === "customizations" && (
        <section className="customization-workspace" id="menu-panel-customizations" role="tabpanel" aria-labelledby="menu-tab-customizations">
          <div className="customization-page-action">
            <button className="button menu-primary" type="button" onClick={openNewGroup}>
              <Plus /> Nueva personalización
            </button>
          </div>

          <div className="customization-board">
            <header className="customization-toolbar">
              <div className="customization-filters" role="group" aria-label="Filtrar personalizaciones">
                <button
                  type="button"
                  className={customizationFilter === "all" ? "active" : ""}
                  aria-pressed={customizationFilter === "all"}
                  onClick={() => setCustomizationFilter("all")}
                >Todas</button>
                <button
                  type="button"
                  className={customizationFilter === "unused" ? "active" : ""}
                  aria-pressed={customizationFilter === "unused"}
                  onClick={() => setCustomizationFilter("unused")}
                >Sin usar <span>({unusedModifierGroupCount})</span></button>
              </div>

              <div className={`customization-search ${customizationSearchOpen ? "open" : ""}`}>
                {customizationSearchOpen ? (
                  <div className="customization-search-field">
                    <Search aria-hidden="true" />
                    <input
                      ref={customizationSearchRef}
                      type="search"
                      value={customizationSearch}
                      onChange={(event) => setCustomizationSearch(event.target.value)}
                      placeholder="Buscar personalización..."
                      aria-label="Buscar personalización"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setCustomizationSearch("");
                        setCustomizationSearchOpen(false);
                      }}
                      aria-label="Cerrar búsqueda"
                    ><X /></button>
                  </div>
                ) : (
                  <button className="button button-secondary" type="button" onClick={() => setCustomizationSearchOpen(true)}>
                    <Search /> Buscar
                  </button>
                )}
              </div>
            </header>

            <div className="customization-table-wrap">
              <table className="customization-table">
                <thead>
                  <tr>
                    <th scope="col">Personalización</th>
                    <th scope="col">Etiqueta distintiva</th>
                    <th scope="col"><span className="visually-hidden">Acciones</span></th>
                  </tr>
                </thead>
                <tbody>
                  {visibleModifierGroups.map((group) => {
                    const canReorder = customizationFilter === "all" && !customizationSearch.trim();
                    return (
                      <tr
                        ref={(node) => groupFlip.register(String(group.id), node)}
                        className={`customization-table-row ${draggedGroup === group.id ? "dragging" : ""} ${openGroupMenu === group.id ? "menu-open" : ""}`}
                        key={group.id}
                        onDragOver={(event) => {
                          if (!groupDragIdRef.current) return;
                          event.preventDefault();
                          event.dataTransfer.dropEffect = "move";
                          previewGroupOrder(group.id, event.clientY, event.currentTarget.getBoundingClientRect());
                        }}
                        onDrop={(event) => {
                          if (!groupDragIdRef.current) return;
                          event.preventDefault();
                          commitGroupDrag();
                        }}
                      >
                        <td>
                          <div className="customization-name-cell">
                            <button
                              className="customization-row-drag"
                              type="button"
                              draggable={canReorder}
                              disabled={!canReorder}
                              aria-label={`Mover ${group.name}. Usa Alt y flecha arriba o abajo.`}
                              onDragStart={(event) => {
                                event.dataTransfer.effectAllowed = "move";
                                event.dataTransfer.setData("text/plain", `customization:${group.id}`);
                                const row = event.currentTarget.closest<HTMLElement>(".customization-table-row");
                                if (row) event.dataTransfer.setDragImage(row, 18, row.clientHeight / 2);
                                startGroupDrag(group.id);
                              }}
                              onDragEnd={(event) => {
                                cancelGroupDrag();
                                event.currentTarget.blur();
                              }}
                              onKeyDown={(event) => {
                                if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
                                event.preventDefault();
                                void moveGroup(group.id, event.key === "ArrowUp" ? -1 : 1);
                              }}
                            ><GripVertical aria-hidden="true" /></button>
                            <button className="customization-name-button" type="button" onClick={() => openEditGroup(group)}>
                              {group.name}
                            </button>
                          </div>
                        </td>
                        <td>
                          {group.internal_label
                            ? <span className="customization-label-badge">{group.internal_label}</span>
                            : <span className="customization-label-empty">Sin etiqueta</span>}
                        </td>
                        <td className="customization-actions-cell">
                          <div className="menu-context">
                            <button
                              className="menu-icon-button"
                              type="button"
                              aria-label={`Opciones de ${group.name}`}
                              aria-haspopup="menu"
                              aria-controls={`customization-actions-${group.id}`}
                              aria-expanded={openGroupMenu === group.id}
                              onClick={(event) => {
                                groupMenuTriggerRef.current = event.currentTarget;
                                setOpenGroupMenu(openGroupMenu === group.id ? null : group.id);
                              }}
                            ><MoreHorizontal /></button>
                            {openGroupMenu === group.id && (
                              <div
                                ref={groupMenuRef}
                                id={`customization-actions-${group.id}`}
                                className="menu-context-popover customization-menu"
                                role="menu"
                                aria-label={`Acciones para ${group.name}`}
                                onKeyDown={handleActionMenuKeyDown}
                              >
                                <span className="menu-context-title">Acciones</span>
                                <button className="edit-action" role="menuitem" type="button" onClick={() => {
                                  setOpenGroupMenu(null);
                                  openEditGroup(group);
                                }}><Pencil /> Editar</button>
                                <button className="duplicate-action" role="menuitem" type="button" disabled={saving} onClick={() => void duplicateGroup(group)}>
                                  <Copy /> Duplicar
                                </button>
                                <button className="danger" role="menuitem" type="button" disabled={saving} onClick={() => void deleteGroup(group)}>
                                  <Trash2 /> Borrar
                                </button>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {!visibleModifierGroups.length && (
                    <tr>
                      <td className="customization-table-empty" colSpan={3}>
                        {catalog.modifier_groups.length
                          ? "No encontramos personalizaciones con estos filtros."
                          : "Todavía no hay personalizaciones. Crea la primera para empezar."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <footer className="customization-summary">
              Mostrando {visibleModifierGroups.length} {visibleModifierGroups.length === 1 ? "personalización" : "personalizaciones"}
            </footer>
          </div>
        </section>
      )}

      {tab === "promotions" && (
        <PromotionWorkspace
          catalog={catalog}
          branchId={branch.id}
          refreshCatalog={resource.refresh}
          notify={notify}
        />
      )}

      {draft && (
        <DialogPortal>
        <div
          className="product-drawer-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeProductDrawer();
          }}
        >
          <aside ref={productSurfaceRef} className="product-drawer" role="dialog" aria-modal="true" aria-labelledby="product-drawer-title" tabIndex={-1} inert={Boolean(categoryDialog || groupEditor || cropFile)} aria-hidden={categoryDialog || groupEditor || cropFile ? true : undefined}>
            <header className="product-drawer-header">
              <div>
                <h2 id="product-drawer-title">{draft.id ? draft.name || "Producto" : "Agrega un producto"}</h2>
              </div>
              <div className="product-drawer-header-actions">
                <button
                  className="button button-secondary mobile-preview-toggle"
                  type="button"
                  aria-expanded={mobilePreviewOpen}
                  onClick={() => setMobilePreviewOpen((current) => !current)}
                ><Eye /> {mobilePreviewOpen ? "Ocultar vista" : "Vista previa"}</button>
                <button className="menu-icon-button" type="button" onClick={() => closeProductDrawer()} aria-label="Cerrar editor"><X /></button>
              </div>
            </header>
            <div className="product-drawer-layout">
              <div className="product-form-scroll">
                <section className="product-form-section">
                  <label>Nombre del producto
                    <input
                      value={draft.name}
                      onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                      data-dialog-initial-focus
                      maxLength={180}
                    />
                  </label>
                  <div className="category-field-row">
                    <label>Categoría
                      <select value={draft.category_id} onChange={(event) => setDraft({ ...draft, category_id: event.target.value })}>
                        <option value="">Selecciona una categoría</option>
                        {activeCategories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}
                      </select>
                    </label>
                    <button className="button button-secondary" type="button" onClick={() => setCategoryDialog({ mode: "create", value: "" })}>
                      <Plus /> Nueva categoría
                    </button>
                  </div>
                  <label>Descripción
                    <textarea
                      rows={4}
                      maxLength={800}
                      value={draft.description}
                      onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                      placeholder="Ingredientes o una descripción breve"
                    />
                  </label>
                </section>

                <section className="product-form-section">
                  <div className="product-section-title">
                    <div><h3>Imagen del producto</h3><p>JPEG, PNG o WebP · máximo 5 MB</p></div>
                    {(previewImage || draft.image_url) && (
                      <button type="button" className="menu-text-button danger" onClick={() => {
                        if (imagePreview?.startsWith("blob:")) URL.revokeObjectURL(imagePreview);
                        setImagePreview(null);
                        setImageBlob(null);
                        setRemoveImage(true);
                      }}><Trash2 /> Borrar</button>
                    )}
                  </div>
                  <input
                    ref={fileInputRef}
                    className="visually-hidden"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(event) => {
                      handleImageFile(event.target.files?.[0]);
                      event.target.value = "";
                    }}
                  />
                  {previewImage ? (
                    <button className="product-image-preview" type="button" onClick={() => fileInputRef.current?.click()}>
                      <img src={previewImage} alt="Vista del producto" />
                      <span><Upload /> Reemplazar imagen</span>
                    </button>
                  ) : (
                    <button className="product-image-upload" type="button" onClick={() => fileInputRef.current?.click()}>
                      <ImagePlus />
                      <strong>Cargar imagen</strong>
                      <span>La podrás recortar antes de guardarla</span>
                    </button>
                  )}
                </section>

                <section className="product-form-section">
                  <div className="product-section-title">
                    <div><h3>{draft.prices.length > 1 ? "Precios y tamaños" : "Precio"}</h3><p>Puedes ofrecer distintos tamaños o presentaciones.</p></div>
                  </div>
                  {draft.prices.length === 1 ? (
                    <label>Precio
                      <div className="money-input"><span>S/</span><input type="number" min="0.01" step="0.10" value={draft.prices[0].price || ""} placeholder="0" onChange={(event) => setDraft({
                        ...draft,
                        prices: [{ ...draft.prices[0], price: Number(event.target.value) }],
                      })} /></div>
                    </label>
                  ) : (
                    <div className="variant-price-list">
                      <div className="variant-price-head"><span>Nombre de variante</span><span>Precio</span></div>
                      {draft.prices.map((row, index) => (
                        <div className="variant-price-row" key={row.key}>
                          <input
                            value={row.name}
                            onChange={(event) => setDraft({
                              ...draft,
                              prices: draft.prices.map((item) => item.key === row.key ? { ...item, name: event.target.value } : item),
                            })}
                            placeholder={index === 0 ? "Personal" : "Familiar"}
                            aria-label="Nombre de variante"
                          />
                          <div className="money-input"><span>S/</span><input
                            type="number"
                            min="0.01"
                            step="0.10"
                            value={row.price || ""}
                            placeholder="0"
                            onChange={(event) => setDraft({
                              ...draft,
                              prices: draft.prices.map((item) => item.key === row.key ? { ...item, price: Number(event.target.value) } : item),
                            })}
                            aria-label={`Precio de ${row.name || `variante ${index + 1}`}`}
                          /></div>
                          <button
                            className="menu-icon-button danger"
                            type="button"
                            aria-label="Quitar precio"
                            onClick={() => {
                              const next = draft.prices.filter((item) => item.key !== row.key);
                              setDraft({ ...draft, prices: next.length === 1 ? [{ ...next[0], name: "" }] : next });
                            }}
                          ><Trash2 /></button>
                        </div>
                      ))}
                    </div>
                  )}
                  <button className="menu-text-button" type="button" onClick={() => {
                    const current = draft.prices.length === 1 && !draft.prices[0].name
                      ? [{ ...draft.prices[0], name: "Personal" }]
                      : draft.prices;
                    setDraft({
                      ...draft,
                      prices: [...current, { key: priceKey(), name: "", price: current[0]?.price || 0 }],
                    });
                  }}><Plus /> Agregar otro precio</button>
                </section>

                <section className="product-form-section">
                  <div className="product-section-title">
                    <div><h3>Personalizaciones</h3><p>Agrega las elecciones que estarán disponibles al pedir este producto.</p></div>
                  </div>
                  <div className="product-customization-picker">
                    {selectedPreviewGroups.length > 0 && (
                      <div className="product-selected-customizations" aria-label="Personalizaciones agregadas">
                        {selectedPreviewGroups.map((group) => {
                          const activeOptions = group.modifiers
                            .filter((modifier) => modifier.active)
                            .sort((left, right) => left.sort_order - right.sort_order);
                          return (
                            <article className="product-selected-customization" key={group.id}>
                              <span className="product-selected-icon"><SlidersHorizontal /></span>
                              <span className="product-selected-copy">
                                <span className="product-selected-heading">
                                  <strong>{group.name}</strong>
                                  {group.internal_label && <i>{group.internal_label}</i>}
                                </span>
                                <small>
                                  {activeOptions.length
                                    ? activeOptions.map((modifier) => (
                                        Number(modifier.price_delta) > 0
                                          ? `${modifier.name} (+S/ ${Number(modifier.price_delta).toFixed(2)})`
                                          : modifier.name
                                      )).join(", ")
                                    : "Sin opciones activas"}
                                </small>
                              </span>
                              <button
                                className="product-selected-remove"
                                type="button"
                                onClick={() => removeProductGroup(group.id)}
                                aria-label={`Remover ${group.name}`}
                              ><Trash2 /><span>Remover</span></button>
                            </article>
                          );
                        })}
                      </div>
                    )}

                    {catalog.modifier_groups.length ? (
                      <div className="product-group-add">
                        <button
                          ref={productGroupPickerTriggerRef}
                          className="menu-text-button"
                          type="button"
                          disabled={!availableProductGroups.length && !productGroupSearch}
                          aria-haspopup="dialog"
                          aria-expanded={productGroupPickerOpen}
                          aria-controls="product-group-picker"
                          onClick={() => setProductGroupPickerOpen((current) => !current)}
                        ><Plus /> {selectedPreviewGroups.length ? "Agregar otra personalización" : "Agregar personalización"}</button>

                        {productGroupPickerOpen && (
                          <div ref={productGroupPickerRef} id="product-group-picker" className="product-group-popover" role="dialog" aria-modal="true" aria-label="Agregar personalización" tabIndex={-1}>
                            <label className="product-group-search">
                              <Search aria-hidden="true" />
                              <input
                                ref={productGroupSearchRef}
                                data-dialog-initial-focus
                                role="combobox"
                                aria-expanded="true"
                                aria-controls="product-group-results"
                                aria-label="Buscar personalización para agregar"
                                value={productGroupSearch}
                                onChange={(event) => setProductGroupSearch(event.target.value)}
                                placeholder="Buscar personalización..."
                              />
                            </label>
                            <div id="product-group-results" className="product-group-results" role="listbox">
                              {availableProductGroups.map((group) => (
                                <button
                                  key={group.id}
                                  type="button"
                                  role="option"
                                  aria-selected="false"
                                  onClick={() => addProductGroup(group.id)}
                                >
                                  <span><strong>{group.name}</strong><small>{group.modifiers.filter((modifier) => modifier.active).length} opciones</small></span>
                                  {group.internal_label && <i>{group.internal_label}</i>}
                                </button>
                              ))}
                              {!availableProductGroups.length && (
                                <p>{productGroupSearch ? "No encontramos coincidencias." : "Todas las personalizaciones ya están agregadas."}</p>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="drawer-empty-note">Todavía no hay personalizaciones. Créala primero desde la pestaña Personalizaciones.</p>
                    )}
                  </div>
                </section>

                <section className="product-form-section more-options-section">
                  <button className="more-options-toggle" type="button" onClick={() => setMoreOptions(!moreOptions)}>
                    <span>Más opciones</span>{moreOptions ? <ChevronUp /> : <ChevronDown />}
                  </button>
                  {moreOptions && (
                    <div className="service-channel-groups">
                      <div><h3>Opciones de servicio</h3><p>El producto solo se podrá pedir en los canales activados.</p></div>
                      {serviceOptions.map((group) => (
                        <fieldset key={group.title}>
                          <legend>{group.title}</legend>
                          {group.options.map((option) => (
                            <label key={option.value}>
                              <input
                                type="checkbox"
                                checked={draft.service_channels.includes(option.value)}
                                onChange={(event) => setDraft({
                                  ...draft,
                                  service_channels: event.target.checked
                                    ? [...draft.service_channels, option.value]
                                    : draft.service_channels.filter((channel) => channel !== option.value),
                                })}
                              />
                              <span>{option.label}</span>
                            </label>
                          ))}
                        </fieldset>
                      ))}
                    </div>
                  )}
                </section>
              </div>

              <aside className={`product-live-preview ${mobilePreviewOpen ? "mobile-open" : ""}`}>
                <div className="preview-heading"><Eye /><span>Vista previa</span></div>
                <article className="preview-product-card">
                  <div
                    className="preview-product-image"
                    style={previewImage ? { backgroundImage: `url(${previewImage})` } : undefined}
                  >{!previewImage && <PackageOpen />}</div>
                  <h3>{draft.name || "Nombre del producto"}</h3>
                  <p>{draft.description || "La descripción aparecerá aquí."}</p>
                  {draft.prices.length > 1 ? (
                    <ModifierGroupSelector
                      groupId="product-variants"
                      name="Opciones"
                      options={draft.prices.map((row) => ({
                        id: row.key,
                        name: row.name || "Sin nombre",
                        priceDelta: Number(row.price || 0),
                      }))}
                      minimum={1}
                      maximum={1}
                      allowRepeats={false}
                      selected={productPreviewVariantKeys}
                      onChange={setProductPreviewVariantKeys}
                      appearance="preview"
                      priceDisplay="absolute"
                    />
                  ) : (
                    <strong className="preview-single-price"><Money value={draft.prices[0]?.price || 0} /></strong>
                  )}
                  {selectedPreviewGroups.map((group) => (
                    <ModifierGroupSelector
                      key={group.id}
                      groupId={`product-group-${group.id}`}
                      name={group.name}
                      options={group.modifiers
                        .filter((modifier) => modifier.active)
                        .sort((left, right) => left.sort_order - right.sort_order)
                        .map((modifier) => ({
                          id: modifier.id,
                          name: modifier.name,
                          priceDelta: Number(modifier.price_delta),
                        }))}
                      minimum={Math.max(group.minimum, group.required ? 1 : 0)}
                      maximum={group.maximum}
                      allowRepeats={group.allow_repeats}
                      maxPerOption={group.max_per_option}
                      selected={productPreviewSelections[group.id] || []}
                      onChange={(selected) => setProductPreviewSelections((current) => ({
                        ...current,
                        [group.id]: selected,
                      }))}
                      appearance="preview"
                    />
                  ))}
                </article>
              </aside>
            </div>
            <footer className="product-drawer-footer">
              <span>{dirty ? "Cambios sin guardar" : "Sin cambios pendientes"}</span>
              <div>
                <button className="button button-secondary" type="button" onClick={() => closeProductDrawer()}>Cancelar</button>
                <button className="button menu-primary" type="button" disabled={saving} onClick={() => void saveProduct()}>
                  <Save /> {saving ? "Guardando..." : draft.id ? "Guardar cambios" : "Agregar producto"}
                </button>
              </div>
            </footer>
          </aside>
        </div>
        </DialogPortal>
      )}

      {categoryDialog && (
        <DialogPortal>
        <div className="menu-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setCategoryDialog(null)}>
          <section ref={categorySurfaceRef} className="menu-modal" role="dialog" aria-modal="true" aria-labelledby="category-dialog-title" tabIndex={-1}>
            <header><h2 id="category-dialog-title">{categoryDialog.mode === "create" ? "Agrega una categoría" : "Renombra la categoría"}</h2></header>
            <label>Nombre de categoría
              <input
                value={categoryDialog.value}
                onChange={(event) => setCategoryDialog({ ...categoryDialog, value: event.target.value })}
                data-dialog-initial-focus
                onKeyDown={(event) => event.key === "Enter" && void saveCategory()}
              />
            </label>
            <footer>
              <button className="button button-secondary" type="button" onClick={() => setCategoryDialog(null)}>Cancelar</button>
              <button className="button menu-primary" type="button" disabled={saving || !categoryDialog.value.trim()} onClick={() => void saveCategory()}>
                {categoryDialog.mode === "create" ? "Agregar categoría" : "Guardar nombre"}
              </button>
            </footer>
          </section>
        </div>
        </DialogPortal>
      )}

      {groupEditor && (
        <DialogPortal>
        <div
          className="customization-drawer-backdrop"
          role="presentation"
          onMouseDown={(event) => event.target === event.currentTarget && closeGroupEditor()}
        >
          <aside ref={groupSurfaceRef} className="customization-drawer" role="dialog" aria-modal="true" aria-labelledby="group-dialog-title" tabIndex={-1}>
            <header className="customization-drawer-header">
              <h2 id="group-dialog-title">{groupEditor.id ? "Editar personalización" : "Agrega una personalización"}</h2>
              <div>
                <button
                  className="button button-secondary mobile-preview-toggle"
                  type="button"
                  aria-expanded={mobilePreviewOpen}
                  onClick={() => setMobilePreviewOpen((current) => !current)}
                ><Eye /> {mobilePreviewOpen ? "Ocultar vista" : "Vista previa"}</button>
                <button className="menu-icon-button" type="button" onClick={() => closeGroupEditor()} aria-label="Cerrar editor"><X /></button>
              </div>
            </header>

            <div className="customization-drawer-layout">
              <div className="customization-form-scroll">
                <section className="customization-form-section">
                  <label>Nombre de la personalización
                    <input
                      data-dialog-initial-focus
                      value={groupEditor.name}
                      onChange={(event) => setGroupEditor({ ...groupEditor, name: event.target.value })}
                      placeholder="Ej. Elige tu bebida"
                    />
                    <small>Esta instrucción será visible para el cliente.</small>
                  </label>
                  <label>Etiqueta distintiva
                    <input
                      value={groupEditor.internal_label}
                      onChange={(event) => setGroupEditor({ ...groupEditor, internal_label: event.target.value })}
                      placeholder="Ej. Opciones de bebida"
                    />
                    <small>Solo la verá tu equipo para identificar esta personalización.</small>
                  </label>
                </section>

                <section className="customization-form-section">
                  <div className="customization-section-heading">
                    <div>
                      <h3>Opciones</h3>
                      <p>Agrega lo que podrá elegir el cliente y su costo adicional.</p>
                    </div>
                  </div>
                  <div className="customization-option-editor-list">
                    {groupEditor.options.map((option, index) => (
                      <div
                        className="customization-option-editor-row"
                        key={option.key}
                        draggable={!saving}
                        onDragStart={() => setDraggedGroupOption(option.key)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={() => draggedGroupOption && moveGroupOption(draggedGroupOption, option.key)}
                      >
                        <button
                          className="customization-option-handle"
                          type="button"
                          aria-label={`Mover opción ${index + 1}. Usa flecha arriba o abajo.`}
                          onKeyDown={(event) => {
                            if (event.key === "ArrowUp") {
                              event.preventDefault();
                              moveGroupOptionBy(option.key, -1);
                            }
                            if (event.key === "ArrowDown") {
                              event.preventDefault();
                              moveGroupOptionBy(option.key, 1);
                            }
                          }}
                        ><GripVertical /></button>
                        <input
                          value={option.name}
                          onChange={(event) => updateGroupOption(option.key, { name: event.target.value })}
                          placeholder={`Opción ${index + 1}`}
                          aria-label={`Nombre de opción ${index + 1}`}
                        />
                        <div className="money-input">
                          <span>S/</span>
                          <input
                            type="number"
                            min="0"
                            step="0.10"
                            value={option.price_delta}
                            placeholder="0"
                            onChange={(event) => updateGroupOption(option.key, { price_delta: event.target.value })}
                            aria-label={`Precio adicional de ${option.name || `opción ${index + 1}`}`}
                          />
                        </div>
                        <button
                          className="menu-icon-button danger"
                          type="button"
                          onClick={() => removeGroupOption(option.key)}
                          aria-label={`Eliminar ${option.name || `opción ${index + 1}`}`}
                        ><Trash2 /></button>
                      </div>
                    ))}
                  </div>
                  <button className="menu-text-button" type="button" onClick={addGroupOption}><Plus /> Agregar opción</button>
                </section>

                <section className="customization-form-section selection-rules">
                  <div className="selection-rules-heading">
                    <h3>Cantidad que se podrá seleccionar</h3>
                  </div>
                  <div className="selection-rule-grid">
                    <label>Selecciones mínimas
                      <span className="selection-limit-input">
                        <b>Mínimo</b>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={groupEditor.minimum}
                          placeholder="0"
                          onChange={(event) => setGroupEditor({ ...groupEditor, minimum: event.target.value })}
                          aria-label="Selecciones mínimas"
                        />
                      </span>
                    </label>
                    <label>Selecciones máximas
                      <span className="selection-limit-input">
                        <b>Máximo</b>
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={groupEditor.maximum ?? ""}
                          placeholder="Sin límite"
                          onChange={(event) => setGroupEditor({
                            ...groupEditor,
                            maximum: event.target.value === "" ? null : Number(event.target.value),
                          })}
                          aria-label="Selecciones máximas, vacío significa sin límite"
                        />
                      </span>
                    </label>
                  </div>
                  <label className="customization-repeat-switch">
                    <input
                      type="checkbox"
                      role="switch"
                      checked={groupEditor.allow_repeats}
                      onChange={(event) => {
                        const allowRepeats = event.target.checked;
                        setGroupEditor({
                          ...groupEditor,
                          allow_repeats: allowRepeats,
                          max_per_option: allowRepeats ? groupEditor.max_per_option : null,
                        });
                      }}
                    />
                    <span className="customization-repeat-track" aria-hidden="true" />
                    <span>Permitir repetición de opciones</span>
                  </label>
                  {groupEditor.allow_repeats && (
                    <label className="repeat-option-limit">
                      <span className="selection-limit-input">
                        <b>Máximo por opción</b>
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={groupEditor.max_per_option ?? ""}
                          placeholder="Sin límite"
                          onChange={(event) => setGroupEditor({
                            ...groupEditor,
                            max_per_option: event.target.value === "" ? null : Number(event.target.value),
                          })}
                          aria-label="Máximo de repeticiones por opción, vacío significa sin límite"
                        />
                      </span>
                    </label>
                  )}
                </section>
              </div>

              <aside className={`customization-live-preview ${mobilePreviewOpen ? "mobile-open" : ""}`} aria-label="Vista previa">
                <h3 className="customization-preview-title">Vista previa</h3>
                <ModifierGroupSelector
                  appearance="preview"
                  groupId={`preview-${groupEditor.id ?? "new"}`}
                  name={groupEditor.name || "Nombre de la personalización"}
                  options={groupEditor.options
                    .filter((option) => option.name.trim())
                    .map((option) => ({
                      id: option.key,
                      name: option.name.trim(),
                      priceDelta: Number(option.price_delta || 0),
                    }))}
                  minimum={Number(groupEditor.minimum || 0)}
                  maximum={groupEditor.maximum}
                  allowRepeats={groupEditor.allow_repeats}
                  maxPerOption={groupEditor.max_per_option}
                  selected={previewModifierKeys}
                  onChange={setPreviewModifierKeys}
                  emptyMessage="Las opciones aparecerán aquí."
                />
              </aside>
            </div>

            <footer className="customization-drawer-footer">
              <span>{groupDirty ? "Cambios sin guardar" : "Sin cambios pendientes"}</span>
              <div>
                <button className="button button-secondary" type="button" onClick={() => closeGroupEditor()}>Cancelar</button>
                <button className="button menu-primary" type="button" disabled={saving} onClick={() => void saveGroup()}>
                  <Save /> {saving ? "Guardando..." : groupEditor.id ? "Guardar cambios" : "Agregar personalización"}
                </button>
              </div>
            </footer>
          </aside>
        </div>
        </DialogPortal>
      )}

      {cropFile && (
        <CatalogImageDialog
          file={cropFile}
          onCancel={() => setCropFile(null)}
          onSave={(blob, previewUrl) => {
            if (imagePreview?.startsWith("blob:")) URL.revokeObjectURL(imagePreview);
            setImageBlob(blob);
            setImagePreview(previewUrl);
            setRemoveImage(false);
            setCropFile(null);
          }}
        />
      )}

      {toast && (
        <Toast
          {...toast}
          durationMs={toast.tone === "success" ? 4500 : undefined}
          onDismiss={() => setToast(null)}
        />
      )}
    </div>
  );
}
