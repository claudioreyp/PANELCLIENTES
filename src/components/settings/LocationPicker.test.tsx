import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocationPicker } from "./LocationPicker";
import { mapPoint } from "../../lib/google-map";

const loader = vi.hoisted(() => vi.fn());
vi.mock("../../lib/google-map", async (original) => ({ ...await original<typeof import("../../lib/google-map")>(), loadGoogleMaps: loader }));
let change: () => void;
let center: { lat: number; lng: number };
const remove = vi.fn();
const constructor = vi.fn();
class FakeMap {
  constructor(_element: HTMLElement, options: { center: typeof center }) { center = options.center; constructor(options); }
  getCenter() { return { lat: () => center.lat, lng: () => center.lng }; }
  setCenter(next: typeof center) { center = next; change(); }
  setZoom() {}
  addListener(_event: string, callback: () => void) { change = callback; return { remove }; }
}
const props = () => ({ value: null, onCancel: vi.fn(), onSelect: vi.fn() });
const confirm = () => screen.getByRole("button", { name: "Agregar ubicación" });

describe("LocationPicker", () => {
  beforeEach(() => { loader.mockReset().mockResolvedValue({ Map: FakeMap }); constructor.mockClear(); remove.mockClear(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
  it("does not silently select the initial map center", async () => {
    const p = props(); render(<LocationPicker {...p} />);
    await waitFor(() => expect(constructor).toHaveBeenCalled());
    act(() => change());
    expect(confirm()).toBeDisabled();
    act(() => { center = { lat: -5.1, lng: -80.6 }; change(); });
    fireEvent.click(confirm());
    expect(p.onSelect).toHaveBeenCalledWith(mapPoint(-5.1, -80.6));
  });
  it("preserves a saved point and drafts across retry without applying them", async () => {
    const p = { ...props(), value: mapPoint(-5, -80) };
    render(<LocationPicker {...p} />);
    await waitFor(() => expect(constructor).toHaveBeenCalled());
    act(() => { center = { lat: -6, lng: -79 }; change(); window.dispatchEvent(new Event("pos-google-maps-error")); });
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(constructor).toHaveBeenCalledTimes(2));
    expect(center).toEqual({ lat: -6, lng: -79 });
    expect(p.onSelect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(p.onCancel).toHaveBeenCalledOnce();
  });
  it("allows valid manual coordinates when Maps is unavailable", async () => {
    loader.mockRejectedValue(new Error("Mapa no configurado"));
    const p = props(); render(<LocationPicker {...p} />);
    await screen.findByText("Mapa no configurado");
    fireEvent.change(screen.getByLabelText("Latitud"), { target: { value: "91" } });
    fireEvent.change(screen.getByLabelText("Longitud"), { target: { value: "-80" } });
    expect(screen.getByRole("button", { name: "Usar coordenadas" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Latitud"), { target: { value: "-5.123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Usar coordenadas" }));
    expect(p.onSelect).not.toHaveBeenCalled();
    fireEvent.click(confirm());
    expect(p.onSelect).toHaveBeenCalledWith(mapPoint(-5.123456, -80));
  });
  it("requests geolocation only on click and ignores a late result after context changes", async () => {
    let done!: PositionCallback;
    const locate = vi.fn((callback: PositionCallback) => { done = callback; });
    vi.stubGlobal("navigator", { geolocation: { getCurrentPosition: locate } });
    const p = props(); const view = render(<LocationPicker {...p} />);
    await waitFor(() => expect(constructor).toHaveBeenCalled());
    expect(locate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Llevar a ubicación actual" }));
    view.rerender(<LocationPicker {...p} enabled={false} />);
    act(() => done({ coords: { latitude: 1, longitude: 2 } } as GeolocationPosition));
    view.rerender(<LocationPicker {...p} enabled />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Llevar a ubicación actual" })).toBeEnabled());
    expect(confirm()).toBeDisabled();
    expect(remove).toHaveBeenCalled();
  });
  it("shows a denied-location error without fabricating a point", async () => {
    vi.stubGlobal("navigator", { geolocation: { getCurrentPosition: (_done: unknown, fail: PositionErrorCallback) => fail({ code: 1 } as GeolocationPositionError) } });
    render(<LocationPicker {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "Llevar a ubicación actual" }));
    expect(await screen.findByText(/Revisa el permiso del navegador/)).toBeVisible();
    expect(confirm()).toBeDisabled();
  });
  it("restores focus after Escape closes the location dialog", async () => {
    const p = props();
    const view = render(<button>Ubicación</button>);
    screen.getByRole("button").focus();
    view.rerender(<><button>Ubicación</button><LocationPicker {...p} /></>);
    await waitFor(() => expect(constructor).toHaveBeenCalled());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(p.onCancel).toHaveBeenCalledOnce();
    view.rerender(<button>Ubicación</button>);
    await waitFor(() => expect(screen.getByRole("button")).toHaveFocus());
  });
});
