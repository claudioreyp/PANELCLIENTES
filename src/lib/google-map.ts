export type MapPoint = { latitude: number; longitude: number; maps_url: string };
export type MapInstance = {
  getCenter(): { lat(): number; lng(): number } | undefined;
  setCenter(point: { lat: number; lng: number }): void;
  setZoom(zoom: number): void;
  addListener(event: string, callback: () => void): { remove(): void };
};
export type MapsLibrary = { Map: new (element: HTMLElement, options: Record<string, unknown>) => MapInstance };
type MapsWindow = Window & {
  google?: { maps?: MapsLibrary };
  __posGoogleMapsReady?: () => void;
  gm_authFailure?: () => void;
};
let pending: Promise<MapsLibrary> | null = null;
let authorizationFailed = false;
export class GoogleMapsError extends Error {
  constructor(public kind: "missing-key" | "authorization" | "connection") {
    super(kind === "missing-key" ? "Falta configurar Google Maps: VITE_GOOGLE_MAPS_BROWSER_KEY no está definida. Puedes ingresar coordenadas mientras se activa el mapa."
      : kind === "authorization" ? "Google Maps no autorizó este sitio. Revisa la clave y sus restricciones y vuelve a cargar el POS."
      : "No se pudo cargar Google Maps por un problema de conexión. Comprueba tu conexión y pulsa Reintentar.");
  }
}

export function mapPoint(latitude: number, longitude: number): MapPoint {
  return { latitude, longitude, maps_url: `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}` };
}

export function validMapPoint(value: { latitude: number | null; longitude: number | null } | null | undefined): value is { latitude: number; longitude: number } {
  return typeof value?.latitude === "number" && Number.isFinite(value.latitude) && Math.abs(value.latitude) <= 90
    && typeof value.longitude === "number" && Number.isFinite(value.longitude) && Math.abs(value.longitude) <= 180;
}

export function loadGoogleMaps(): Promise<MapsLibrary> {
  const host = window as MapsWindow;
  if (authorizationFailed) return Promise.reject(new GoogleMapsError("authorization"));
  if (host.google?.maps?.Map) return Promise.resolve(host.google.maps);
  if (pending) return pending;
  const key = import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY?.trim();
  if (!key) return Promise.reject(new GoogleMapsError("missing-key"));
  pending = new Promise<MapsLibrary>((resolve, reject) => {
    const script = document.createElement("script");
    let settled = false;
    const fail = (kind: "authorization" | "connection" = "connection") => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      script.remove();
      delete host.__posGoogleMapsReady;
      pending = null;
      reject(new GoogleMapsError(kind));
    };
    const timeout = window.setTimeout(fail, 15000);
    const previousAuthFailure = host.gm_authFailure;
    host.gm_authFailure = () => {
      authorizationFailed = true;
      fail("authorization");
      window.dispatchEvent(new Event("pos-google-maps-error"));
      previousAuthFailure?.();
    };
    host.__posGoogleMapsReady = () => {
      if (settled) return;
      if (!host.google?.maps?.Map) { fail(); return; }
      settled = true;
      window.clearTimeout(timeout);
      delete host.__posGoogleMapsReady;
      resolve(host.google.maps);
    };
    const query = new URLSearchParams({ key, callback: "__posGoogleMapsReady", loading: "async", v: "quarterly", language: "es", region: "PE", auth_referrer_policy: "origin" });
    script.src = `https://maps.googleapis.com/maps/api/js?${query}`;
    script.async = true;
    script.onerror = () => fail();
    document.head.append(script);
  });
  return pending;
}
