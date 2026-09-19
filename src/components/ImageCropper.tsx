import { Minus, Plus, X } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

type Point = { x: number; y: number };

type ImageCropperProps = {
  file: File;
  onCancel: () => void;
  onSave: (blob: Blob, previewUrl: string) => void | boolean | Promise<void | boolean>;
  aspectRatio?: number | "original";
  title?: string;
  saveLabel?: string;
  backdropClassName?: string;
  busy?: boolean;
  disabled?: boolean;
  error?: string | null;
  onBusyChange?: (busy: boolean) => void;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function ImageCropper({
  file, onCancel, onSave, aspectRatio = 1, title = "Ajusta el encuadre",
  saveLabel = "Usar imagen", backdropClassName = "", busy = false,
  disabled = false, error: uploadError, onBusyChange,
}: ImageCropperProps) {
  const titleId = useId();
  const helpId = useId();
  const [sourceUrl, setSourceUrl] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [decodeError, setDecodeError] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ start: Point; offset: Point } | null>(null);
  const [imageSize, setImageSize] = useState({ width: 1, height: 1 });
  const [frameSize, setFrameSize] = useState(480);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const mountedRef = useRef(false);
  const lifetimeRef = useRef<object | null>(null);
  const busyChangeRef = useRef(onBusyChange);
  busyChangeRef.current = onBusyChange;
  const ratio = aspectRatio === "original" ? imageSize.width / imageSize.height : Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1;
  const locked = saving || busy || disabled;

  useLayoutEffect(() => {
    lifetimeRef.current = {};
    dragRef.current = null;
    return () => { lifetimeRef.current = null; };
  }, [file, disabled, ratio]);

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    setLoaded(false);
    setError(null);
    setDecodeError(false);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    try {
      const nextUrl = URL.createObjectURL(file);
      setSourceUrl(nextUrl);
      return () => URL.revokeObjectURL(nextUrl);
    } catch {
      setSourceUrl("");
      setDecodeError(true);
      setError("No se pudo abrir la imagen. Vuelve a intentarlo o elige otro archivo.");
    }
  }, [file, loadAttempt]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) setFrameSize(entry.contentRect.width);
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  // The host owns DialogPortal/useDialogSurface, including top-dialog Escape.
  const frameHeight = frameSize / ratio;
  const baseScale = Math.max(frameSize / imageSize.width, frameHeight / imageSize.height);
  const renderedWidth = imageSize.width * baseScale * zoom;
  const renderedHeight = imageSize.height * baseScale * zoom;
  function normalizedOffset(next: Point, nextZoom = zoom) {
    const maxX = Math.max(0, (imageSize.width * baseScale * nextZoom - frameSize) / 2);
    const maxY = Math.max(0, (imageSize.height * baseScale * nextZoom - frameHeight) / 2);
    return {
      x: clamp(next.x, -maxX, maxX),
      y: clamp(next.y, -maxY, maxY),
    };
  }
  const visibleOffset = normalizedOffset(offset);

  function changeZoom(nextZoom: number) {
    if (locked || !loaded) return;
    const next = clamp(nextZoom, 1, 3);
    setZoom(next);
    setOffset(normalizedOffset(offset, next));
  }

  async function exportImage() {
    const image = imageRef.current;
    if (!image || !loaded || locked || savingRef.current) return;
    const lifetime = lifetimeRef.current;
    savingRef.current = true;
    setSaving(true);
    busyChangeRef.current?.(true);
    setError(null);
    try {
      const scale = baseScale * zoom;
      const sourceWidth = Math.min(imageSize.width, frameSize / scale);
      const sourceHeight = Math.min(imageSize.height, frameHeight / scale);
      const centerX = imageSize.width / 2 - visibleOffset.x / scale;
      const centerY = imageSize.height / 2 - visibleOffset.y / scale;
      const sourceX = clamp(centerX - sourceWidth / 2, 0, imageSize.width - sourceWidth);
      const sourceY = clamp(centerY - sourceHeight / 2, 0, imageSize.height - sourceHeight);
      const canvas = document.createElement("canvas");
      canvas.width = aspectRatio === "original" ? Math.min(2048, sourceWidth, 2048 * ratio) : 1024;
      canvas.height = Math.max(1, Math.round(canvas.width / ratio));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("No se pudo preparar la imagen");
      context.drawImage(
        image,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        0,
        0,
        canvas.width,
        canvas.height,
      );
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (result) => result ? resolve(result) : reject(new Error("No se pudo exportar la imagen")),
          "image/webp",
          0.86,
        );
      });
      if (lifetime !== lifetimeRef.current || !mountedRef.current) return;
      // Catalog keeps this URL as its draft preview; other hosts must release it.
      const previewUrl = URL.createObjectURL(blob);
      try {
        if (await onSave(blob, previewUrl) === false) throw new Error("No se pudo guardar la imagen");
      } catch (cause) {
        URL.revokeObjectURL(previewUrl);
        throw cause;
      }
    } catch {
      if (mountedRef.current && lifetime === lifetimeRef.current) {
        setError("No se pudo preparar o guardar la imagen. Conservamos el recorte; vuelve a intentarlo.");
      }
    } finally {
      savingRef.current = false;
      if (mountedRef.current) {
        setSaving(false);
        busyChangeRef.current?.(false);
      }
    }
  }

  return (
    <div className={`cropper-backdrop ${backdropClassName}`.trim()} role="presentation">
      <section className="cropper-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={helpId} aria-busy={saving || busy || undefined} tabIndex={-1}>
        <header>
          <div>
            {title === "Ajusta el encuadre" && <span className="menu-kicker">Imagen de producto</span>}
            <h2 id={titleId}>{title}</h2>
          </div>
          <button className="menu-icon-button" type="button" disabled={locked} onClick={onCancel} aria-label="Cerrar editor de imagen">
            <X />
          </button>
        </header>
        <p id={helpId}>Arrastra la imagen o usa las flechas del teclado para encuadrar. Ajusta el zoom para acercarla.</p>
        <div
          ref={frameRef}
          className="cropper-frame"
          style={{ aspectRatio: ratio, ...(aspectRatio === "original" ? { maxWidth: `min(450px, ${56 * ratio}dvh)`, marginInline: "auto" } : {}) }}
          tabIndex={locked || !loaded ? -1 : 0}
          role="group"
          aria-label="Encuadre de imagen"
          onKeyDown={(event) => {
            if (locked || !loaded) return;
            const step = event.shiftKey ? 30 : 10;
            const movement: Record<string, Point> = {
              ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 },
              ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step },
            };
            const delta = movement[event.key];
            if (!delta) return;
            event.preventDefault();
            setOffset(normalizedOffset({ x: visibleOffset.x + delta.x, y: visibleOffset.y + delta.y }));
          }}
          onPointerDown={(event) => {
            if (locked || !loaded || event.button !== 0) return;
            event.currentTarget.focus();
            event.currentTarget.setPointerCapture(event.pointerId);
            dragRef.current = { start: { x: event.clientX, y: event.clientY }, offset: visibleOffset };
          }}
          onPointerMove={(event) => {
            if (!dragRef.current || locked) return;
            setOffset(normalizedOffset({
              x: dragRef.current.offset.x + event.clientX - dragRef.current.start.x,
              y: dragRef.current.offset.y + event.clientY - dragRef.current.start.y,
            }));
          }}
          onPointerUp={() => { dragRef.current = null; }}
          onPointerCancel={() => { dragRef.current = null; }}
          onLostPointerCapture={() => { dragRef.current = null; }}
        >
          {sourceUrl && !decodeError && <img
            key={sourceUrl}
            ref={imageRef}
            src={sourceUrl}
            alt="Vista para recortar"
            draggable={false}
            onLoad={(event) => {
              if (!event.currentTarget.naturalWidth || !event.currentTarget.naturalHeight) {
                setDecodeError(true);
                setError("No se pudo leer la imagen. Reintenta o elige otro archivo.");
                return;
              }
              setImageSize({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              });
              setOffset({ x: 0, y: 0 });
              setLoaded(true);
              setError(null);
            }}
            onError={() => {
              setLoaded(false);
              setDecodeError(true);
              setError("No se pudo leer la imagen. Reintenta o elige otro archivo.");
            }}
            style={{
              width: renderedWidth,
              height: renderedHeight,
              transform: `translate(-50%, -50%) translate(${visibleOffset.x}px, ${visibleOffset.y}px)`,
            }}
          />}
          <div className="cropper-grid" aria-hidden="true" />
        </div>
        {(error || uploadError) && <div className="cropper-error" role="alert">{error || uploadError}</div>}
        {decodeError && <button className="button button-secondary" type="button" disabled={locked} onClick={() => setLoadAttempt((attempt) => attempt + 1)}>Reintentar carga</button>}
        <div className="cropper-zoom" style={{ gridTemplateColumns: "44px minmax(0, 1fr) 44px" }}>
          <button className="menu-icon-button" type="button" aria-label="Reducir zoom" disabled={locked || !loaded || zoom <= 1} onClick={() => changeZoom(zoom - 0.1)}><Minus /></button>
          <input
            type="range"
            min="1"
            max="3"
            step="0.01"
            value={zoom}
            disabled={locked || !loaded}
            onChange={(event) => changeZoom(Number(event.target.value))}
            aria-label="Zoom de imagen"
          />
          <button className="menu-icon-button" type="button" aria-label="Aumentar zoom" disabled={locked || !loaded || zoom >= 3} onClick={() => changeZoom(zoom + 0.1)}><Plus /></button>
        </div>
        <footer>
          <button className="button button-secondary" type="button" disabled={locked} onClick={onCancel}>Cancelar</button>
          <button className="button button-primary" type="button" disabled={locked || !loaded} onClick={() => void exportImage()}>
            {saving || busy ? "Guardando..." : saveLabel}
          </button>
        </footer>
      </section>
    </div>
  );
}
