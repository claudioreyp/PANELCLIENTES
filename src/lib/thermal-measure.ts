const MEASURE_TIMEOUT_MS = 10_000;
const ROUNDING_GUARD_DOTS = 2;
const STABLE_READINGS = 3;

export type ThermalMeasurement = { heightCssPx: number; widthCssPx: number; pageHeightDots: number };

export function thermalRasterHeight(heightCssPx: number, paperWidth: 58 | 80): ThermalMeasurement {
  if (![58, 80].includes(paperWidth) || !Number.isFinite(heightCssPx) || heightCssPx <= 0) {
    throw new Error("No se pudo medir el documento de impresion.");
  }
  // QZ WebAppModel converts its intermediate 72/in points to 96/in CSS pixels.
  const widthCssPx = paperWidth * 96 / 25.4;
  const rasterWidth = paperWidth === 58 ? 384 : 576;
  const pageHeightDots = Math.ceil(heightCssPx * rasterWidth / widthCssPx) + ROUNDING_GUARD_DOTS;
  if (!Number.isSafeInteger(pageHeightDots) || pageHeightDots > 2_147_483_647) {
    throw new Error("El documento excede la altura admitida por QZ.");
  }
  return { heightCssPx, widthCssPx, pageHeightDots };
}

/** Measures only; it cannot claim a job, connect to QZ or print. */
export function measureThermalDocument(html: string, paperWidth: 58 | 80, signal: AbortSignal): Promise<ThermalMeasurement> {
  signal.throwIfAborted();
  const { widthCssPx } = thermalRasterHeight(1, paperWidth);
  const source = new DOMParser().parseFromString(html, "text/html");
  if (source.querySelectorAll(".thermal-document").length !== 1) {
    return Promise.reject(new Error("El documento de impresion no tiene un contenido termico unico."));
  }
  // The generated receipt is self-contained. Never execute scripts or fetch data while measuring.
  const policy = source.createElement("meta");
  policy.httpEquiv = "Content-Security-Policy";
  policy.content = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'";
  source.head.prepend(policy);

  return new Promise<ThermalMeasurement>((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.title = "Medicion de documento termico";
    frame.setAttribute("aria-hidden", "true");
    frame.setAttribute("sandbox", "allow-same-origin");
    frame.tabIndex = -1;
    Object.assign(frame.style, {
      position: "fixed", left: "-10000px", top: "0", width: `${widthCssPx}px`, height: "1px",
      border: "0", padding: "0", margin: "0", opacity: "0", pointerEvents: "none",
    });
    let done = false;
    let animation = 0;
    let previousHeight = -1;
    let stable = 0;
    const finish = (error?: unknown, measurement?: ThermalMeasurement) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      window.cancelAnimationFrame(animation);
      signal.removeEventListener("abort", abort);
      frame.removeEventListener("load", loaded);
      frame.removeEventListener("error", failed);
      frame.remove();
      if (error !== undefined) reject(error);
      else resolve(measurement!);
    };
    const abort = () => finish(signal.reason ?? new DOMException("Medicion cancelada", "AbortError"));
    const failed = () => finish(new Error("No se pudo cargar el documento para medir su altura."));
    const timer = window.setTimeout(() => finish(new Error("No se pudo estabilizar la altura del documento a tiempo.")), MEASURE_TIMEOUT_MS);
    const loaded = async () => {
      try {
        const doc = frame.contentDocument;
        const root = doc?.querySelector<HTMLElement>(".thermal-document");
        if (!doc || !root) throw new Error("No se pudo leer el documento de impresion.");
        // Preserve fractional CSS width even when the iframe viewport rounds to integer pixels.
        doc.documentElement.style.width = `${widthCssPx}px`;
        doc.body.style.width = `${widthCssPx}px`;
        await doc.fonts?.ready;
        await Promise.all([...doc.images].map((img) => img.decode()));
        if (done) return;
        const sample = () => {
          if (done) return;
          try {
            if (!frame.isConnected) throw new Error("Se interrumpio la medicion del documento.");
            const rect = root.getBoundingClientRect();
            const style = frame.contentWindow!.getComputedStyle(root);
            const borders = parseFloat(style.borderTopWidth || "0") + parseFloat(style.borderBottomWidth || "0");
            const height = rect.top + Math.max(rect.height, root.scrollHeight + borders);
            if (rect.top < 0 || Math.abs(rect.width - widthCssPx) > 1 || root.scrollWidth > root.clientWidth + 1) {
              throw new Error("El contenido no cabe en el ancho termico configurado.");
            }
            const measurement = thermalRasterHeight(height, paperWidth);
            stable = Math.abs(height - previousHeight) < 0.01 ? stable + 1 : 1;
            previousHeight = height;
            if (stable >= STABLE_READINGS) finish(undefined, measurement);
            else animation = window.requestAnimationFrame(sample);
          } catch (error) { finish(error); }
        };
        animation = window.requestAnimationFrame(sample);
      } catch (error) { finish(error); }
    };
    signal.addEventListener("abort", abort, { once: true });
    frame.addEventListener("load", loaded, { once: true });
    frame.addEventListener("error", failed, { once: true });
    frame.srcdoc = `<!doctype html>${source.documentElement.outerHTML}`;
    if (signal.aborted) abort();
    else {
      try { document.body.appendChild(frame); }
      catch (error) { finish(error); }
    }
  });
}
