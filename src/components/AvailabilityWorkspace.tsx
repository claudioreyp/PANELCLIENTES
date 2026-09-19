import { ChevronLeft, ChevronRight, ImageIcon, Search } from "lucide-react";
import { useDeferredValue, useEffect, useRef, useState } from "react";
import { api, publicAssetUrl } from "../lib/api";
import { normalizeCatalogPayload } from "../lib/catalog";
import { useBranchRealtime, usePolling } from "../lib/hooks";
import { useTenant } from "../lib/tenant";
import type { Catalog, Product } from "../types";
import { availabilityPath, catalogAvailabilityItems, normalizeAvailabilitySearch, updateCatalogAvailability, type AvailabilityItem } from "../lib/availability";
import "./availability-workspace.css";
import { ErrorState, Toast } from "./ui";

export const AVAILABILITY_PAGE_SIZE = 10;

type AvailabilityFilter = "all" | "unavailable";
type ToastState = { message: string; tone: "success" | "error" } | null;

function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-PE")
    .trim();
}

function AvailabilitySkeleton() {
  return (
    <section className="availability-card availability-skeleton" aria-busy="true" aria-label="Cargando disponibilidad">
      <div className="availability-card-toolbar">
        <span className="availability-skeleton-block skeleton-filter" />
        <span className="availability-skeleton-block skeleton-filter skeleton-filter-wide" />
        <span className="availability-skeleton-block skeleton-search" />
      </div>
      <div className="availability-skeleton-heading">
        <span className="availability-skeleton-block" />
        <span className="availability-skeleton-block" />
      </div>
      {[0, 1, 2].map((item) => (
        <div className="availability-skeleton-row" key={item}>
          <span className="availability-skeleton-block skeleton-image" />
          <span className="availability-skeleton-copy">
            <span className="availability-skeleton-block" />
            <span className="availability-skeleton-block" />
          </span>
          <span className="availability-skeleton-block skeleton-pill" />
          <span className="availability-skeleton-block skeleton-toggle" />
        </div>
      ))}
      <div className="availability-skeleton-footer"><span className="availability-skeleton-block" /></div>
    </section>
  );
}

function AvailabilityProductThumbnail({ product }: { product: Product }) {
  const source = publicAssetUrl(product.image_url);
  const [failedSource, setFailedSource] = useState<string | null>(null);

  if (!source || failedSource === source) {
    return <span className="availability-product-image"><ImageIcon aria-hidden="true" /></span>;
  }

  return (
    <span className="availability-product-image">
      <img
        src={source}
        alt=""
        loading="lazy"
        onError={() => setFailedSource(source)}
      />
    </span>
  );
}

export function AvailabilityWorkspace() {
  const { branch } = useTenant();
  return <AvailabilityBranch key={branch?.id || "none"} />;
}

function AvailabilityBranch() {
  const { branch } = useTenant();
  const [filter, setFilter] = useState<AvailabilityFilter>("all");
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [updating, setUpdating] = useState<Set<string>>(() => new Set());
  const pending = useRef(new Set<string>());
  const mounted = useRef(true);
  const searchButton = useRef<HTMLButtonElement>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const deferredQuery = useDeferredValue(query);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (toast?.tone !== "success") return;
    const timer = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const resource = usePolling(
    async () => branch
      ? api<Catalog>(`/catalog?branch_id=${branch.id}`).then(normalizeCatalogPayload)
      : Promise.reject(new Error("Selecciona una sucursal")),
    [branch?.id],
    20000,
  );
  useBranchRealtime(branch?.id, resource.refresh);

  useEffect(() => {
    setFilter("all");
    setSearchOpen(false);
    setQuery("");
    setPage(1);
  }, [branch?.id]);

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  const catalog = resource.data;
  const items = catalog ? catalogAvailabilityItems(catalog) : [];
  const unavailableCount = items.filter((item) => !item.available).length;
  const normalizedQuery = normalizeSearch(deferredQuery);
  const filteredProducts = items.filter((product) => {
    if (filter === "unavailable" && product.available) return false;
    if (!normalizedQuery) return true;
    return normalizeAvailabilitySearch(product.search).includes(normalizedQuery);
  });
  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / AVAILABILITY_PAGE_SIZE));
  const visiblePage = Math.min(page, totalPages);
  const pageStartIndex = (visiblePage - 1) * AVAILABILITY_PAGE_SIZE;
  const visibleProducts = filteredProducts.slice(pageStartIndex, pageStartIndex + AVAILABILITY_PAGE_SIZE);
  const rangeStart = filteredProducts.length === 0 ? 0 : pageStartIndex + 1;
  const rangeEnd = Math.min(pageStartIndex + AVAILABILITY_PAGE_SIZE, filteredProducts.length);

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  useEffect(() => {
    if (filter === "unavailable" && unavailableCount === 0 && updating.size === 0) {
      setFilter("all");
      setPage(1);
    }
  }, [filter, unavailableCount, updating.size]);

  function selectFilter(nextFilter: AvailabilityFilter) {
    setFilter(nextFilter);
    setPage(1);
  }

  function closeSearch() {
    setQuery("");
    setSearchOpen(false);
    setPage(1);
    window.requestAnimationFrame(() => searchButton.current?.focus());
  }

  async function toggleAvailability(product: AvailabilityItem) {
    if (pending.current.has(product.key)) return;
    pending.current.add(product.key);
    const nextAvailable = !product.available;
    setUpdating(new Set(pending.current));

    try {
      const response = await api<{ available: boolean; product_available?: boolean }>(availabilityPath(product), {
        method: "PATCH",
        body: JSON.stringify({ available: nextAvailable }),
      });
      if (!mounted.current) return;
      resource.setData((current) => current ? updateCatalogAvailability(current, product, response.available, response.product_available) : current);
      setToast({
        message: nextAvailable ? `${product.name} disponible para nuevos pedidos.` : `${product.name} desactivado en todos los canales.`,
        tone: "success",
      });
      void resource.refresh();
    } catch (caught) {
      if (!mounted.current) return;
      setToast({
        message: `No se pudo confirmar la disponibilidad de ${product.name}. Vuelve a intentarlo con el interruptor.${caught instanceof Error && !('status' in caught) ? ` ${caught.message}` : ""}`,
        tone: "error",
      });
    } finally {
      pending.current.delete(product.key);
      if (mounted.current) {
      setUpdating((current) => {
        const next = new Set(current);
        next.delete(product.key);
        return next;
      });
      }
    }
  }

  const emptyTitle = normalizedQuery
    ? "No encontramos ítems"
    : filter === "unavailable"
      ? "No hay ítems desactivados"
      : "No hay ítems para administrar";
  const emptyDetail = normalizedQuery
    ? "Prueba con otro nombre, categoría, grupo o SKU."
    : filter === "unavailable"
      ? "Los productos que desactives aparecerán aquí."
      : "Crea productos desde Menú para gestionar su disponibilidad.";

  return (
    <div className="page-stack availability-workspace">
      <header className="availability-workspace-header">
        <h1>Disponibilidad</h1>
      </header>
      <section className="availability-surface" aria-label="Gestión de disponibilidad">
        {catalog && resource.error && <div className="availability-refresh-error" role="alert"><span>No se pudo actualizar la lista. Conservamos los últimos datos confirmados.</span><button className="availability-toolbar-button" type="button" onClick={() => void resource.refresh()}>Reintentar</button></div>}
        {resource.loading && !catalog ? <AvailabilitySkeleton /> : resource.error && !catalog ? (
          <section className="availability-card availability-error">
            <ErrorState message={resource.error} onRetry={() => void resource.refresh()} />
          </section>
        ) : catalog ? (
          <section className="availability-card" aria-label="Disponibilidad de productos y personalizaciones">
            <div className={`availability-card-toolbar ${searchOpen ? "is-searching" : ""}`}>
              {searchOpen ? (
                <div className="availability-search-mode">
                  <label className="availability-search-field">
                    <span className="sr-only">Buscar productos</span>
                    <Search aria-hidden="true" />
                    <input
                      ref={searchInputRef}
                      value={query}
                      onChange={(event) => { setQuery(event.target.value); setPage(1); }}
                      onKeyDown={(event) => { if (event.key === "Escape") closeSearch(); }}
                      placeholder={filter === "unavailable" ? "Buscar en no disponibles" : "Buscar en todos"}
                      aria-label="Buscar productos"
                    />
                  </label>
                  <button className="availability-toolbar-button" type="button" onClick={closeSearch}>Cancelar</button>
                </div>
              ) : (
                <>
                  <div className="availability-filters" role="group" aria-label="Filtrar productos por disponibilidad">
                    <button
                      type="button"
                      className={filter === "all" ? "is-active" : ""}
                      aria-pressed={filter === "all"}
                      onClick={() => selectFilter("all")}
                    >
                      Todos
                    </button>
                    <button
                      type="button"
                      className={filter === "unavailable" ? "is-active" : ""}
                      aria-pressed={filter === "unavailable"}
                      disabled={unavailableCount === 0 && filter !== "unavailable"}
                      onClick={() => selectFilter("unavailable")}
                    >
                      No disponibles{unavailableCount > 0 && <> <span>({unavailableCount})</span></>}
                    </button>
                  </div>
                  <button ref={searchButton} className="availability-toolbar-button" type="button" onClick={() => setSearchOpen(true)}>
                    <Search aria-hidden="true" /> Buscar
                  </button>
                </>
              )}
            </div>

            <div className="availability-table-wrap">
              <table className="availability-table">
                <thead>
                  <tr>
                    <th scope="col">Ítem</th>
                    <th scope="col">Estado</th>
                    <th scope="col"><span className="sr-only">Cambiar disponibilidad</span></th>
                  </tr>
                </thead>
                <tbody>
                  {visibleProducts.map((product) => {
                    const isUpdating = updating.has(product.key);
                    return (
                      <tr key={product.key} className={product.available ? "is-available" : "is-unavailable"}>
                        <td>
                          <div className="availability-product">
                            {product.product && <AvailabilityProductThumbnail product={product.product} />}
                            <span className="availability-product-name">
                              <strong>{product.name}</strong>
                              <small>{product.subtitle}</small>
                            </span>
                          </div>
                        </td>
                        <td>
                          <span className={`availability-status ${product.available ? "is-available" : "is-unavailable"}`}>
                            {product.available ? "Disponible" : "Desactivado"}
                          </span>
                        </td>
                        <td>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={product.available}
                            aria-busy={isUpdating}
                            aria-label={`${product.available ? "Desactivar" : "Activar"} ${product.name}`}
                            className={`availability-toggle ${product.available ? "is-active" : ""} ${isUpdating ? "is-updating" : ""}`}
                            disabled={isUpdating}
                            onClick={() => void toggleAvailability(product)}
                          >
                            <span aria-hidden="true" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {visibleProducts.length === 0 && (
                    <tr className="availability-empty-row">
                      <td colSpan={3}>
                        <div>
                          <strong>{emptyTitle}</strong>
                          <p>{emptyDetail}</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <footer className="availability-pagination" aria-label="Paginación de productos">
              <button
                type="button"
                aria-label="Página anterior"
                disabled={visiblePage <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              ><ChevronLeft aria-hidden="true" /></button>
              <span>{rangeStart} - {rangeEnd} de {filteredProducts.length} items</span>
              <button
                type="button"
                aria-label="Página siguiente"
                disabled={visiblePage >= totalPages}
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              ><ChevronRight aria-hidden="true" /></button>
            </footer>
          </section>
        ) : null}
      </section>
      {toast && <Toast {...toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
