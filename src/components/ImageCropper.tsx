"use client";

import {useCallback, useEffect, useRef, useState} from "react";

import {cn} from "@/lib/cn";

/** Every launchpad shows a token's picture square; 512px is sharper than any of them draws it. */
const OUTPUT = 512;
const FRAME = 232;
const MAX_ZOOM = 4;

type Fit = "fill" | "fit";

/**
 * Crop and resize a token's picture before it is uploaded.
 *
 * A square frame over the image: drag to move it, the slider to zoom. "Fill"
 * covers the square edge to edge, the way launchpads crop anyway; "Fit" keeps
 * the whole picture and pads the rest with a solid colour, for a logo that must
 * not lose its edges. What is inside the frame is exactly what is saved.
 */
export function ImageCropper({
  source,
  onCancel,
  onDone,
}: {
  /** A data URL of the picked file. */
  source: string;
  onCancel: () => void;
  onDone: (dataUrl: string) => void;
}) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [fit, setFit] = useState<Fit>("fill");
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({x: 0, y: 0});
  const [background, setBackground] = useState("#0b0b0f");
  const drag = useRef<{x: number; y: number; ox: number; oy: number} | null>(null);

  useEffect(() => {
    const element = new Image();
    element.onload = () => setImage(element);
    element.src = source;
  }, [source]);

  // The scale at zoom 1: covering the frame for Fill, fitting inside it for Fit.
  const base = image
    ? fit === "fill"
      ? Math.max(FRAME / image.width, FRAME / image.height)
      : Math.min(FRAME / image.width, FRAME / image.height)
    : 1;
  const scale = base * zoom;
  const width = image ? image.width * scale : 0;
  const height = image ? image.height * scale : 0;

  /**
   * Keep the image covering the frame in Fill — a gap at the edge would be
   * saved as a transparent strip — and free to move in Fit, within reason.
   */
  const clamp = useCallback(
    (next: {x: number; y: number}) => {
      if (fit === "fill") {
        const limitX = Math.max(0, (width - FRAME) / 2);
        const limitY = Math.max(0, (height - FRAME) / 2);
        return {
          x: Math.min(limitX, Math.max(-limitX, next.x)),
          y: Math.min(limitY, Math.max(-limitY, next.y)),
        };
      }
      const limitX = (width + FRAME) / 2 - 24;
      const limitY = (height + FRAME) / 2 - 24;
      return {
        x: Math.min(limitX, Math.max(-limitX, next.x)),
        y: Math.min(limitY, Math.max(-limitY, next.y)),
      };
    },
    [fit, width, height],
  );

  // Zooming out or switching mode can leave the image off the frame; pull it back.
  useEffect(() => setOffset((previous) => clamp(previous)), [clamp]);

  function save() {
    if (!image) return;
    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT;
    canvas.height = OUTPUT;
    const context = canvas.getContext("2d");
    if (!context) return;
    if (fit === "fit") {
      context.fillStyle = background;
      context.fillRect(0, 0, OUTPUT, OUTPUT);
    }
    const ratio = OUTPUT / FRAME;
    const drawWidth = width * ratio;
    const drawHeight = height * ratio;
    context.imageSmoothingQuality = "high";
    context.drawImage(
      image,
      OUTPUT / 2 - drawWidth / 2 + offset.x * ratio,
      OUTPUT / 2 - drawHeight / 2 + offset.y * ratio,
      drawWidth,
      drawHeight,
    );
    onDone(canvas.toDataURL("image/png"));
  }

  return (
    <div>
      <div
        className="relative mx-auto touch-none select-none overflow-hidden rounded-2xl"
        style={{
          width: FRAME,
          height: FRAME,
          background: fit === "fit" ? background : "var(--bg-input)",
          cursor: drag.current ? "grabbing" : "grab",
        }}
        onPointerDown={(event) => {
          (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
          drag.current = {x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y};
        }}
        onPointerMove={(event) => {
          if (!drag.current) return;
          setOffset(
            clamp({
              x: drag.current.ox + event.clientX - drag.current.x,
              y: drag.current.oy + event.clientY - drag.current.y,
            }),
          );
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onWheel={(event) => {
          setZoom((previous) =>
            Math.min(MAX_ZOOM, Math.max(1, previous - event.deltaY * 0.0015)),
          );
        }}
      >
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={source}
            alt=""
            draggable={false}
            className="pointer-events-none absolute left-1/2 top-1/2 max-w-none"
            style={{
              width,
              height,
              transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
            }}
          />
        ) : null}
        {/* The circle most places draw a token in, as a guide. */}
        <div className="pointer-events-none absolute inset-0 rounded-full ring-1 ring-white/40" />
      </div>

      <div className="mt-3 flex items-center gap-2.5">
        <span className="text-[11px] font-bold text-faint">Zoom</span>
        <input
          type="range"
          min={1}
          max={MAX_ZOOM}
          step={0.01}
          value={zoom}
          onChange={(event) => setZoom(Number(event.target.value))}
          aria-label="Zoom"
          className="h-1 flex-1 accent-[var(--brand-500,#6860ff)]"
        />
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-2">
        <div className="flex gap-0.5 rounded-full bg-[var(--segment-track)] p-[2px]">
          {(["fill", "fit"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={fit === mode}
              onClick={() => {
                setFit(mode);
                setZoom(1);
                setOffset({x: 0, y: 0});
              }}
              className={cn(
                "rounded-full px-3 py-1 text-[11.5px] font-extrabold transition-colors",
                fit === mode
                  ? "bg-[var(--bg-input)] text-ink shadow-tab-active"
                  : "text-faint hover:text-muted",
              )}
            >
              {mode === "fill" ? "Fill" : "Fit"}
            </button>
          ))}
        </div>
        {fit === "fit" ? (
          <label className="flex items-center gap-1.5 text-[11px] font-bold text-faint">
            Background
            <input
              type="color"
              value={background}
              onChange={(event) => setBackground(event.target.value)}
              className="h-6 w-6 cursor-pointer rounded border-0 bg-transparent p-0"
            />
          </label>
        ) : (
          <span className="text-[11px] font-semibold text-faint">Drag to move</span>
        )}
      </div>

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="h-[42px] flex-1 rounded-2xl bg-[var(--overlay-wash)] text-[13.5px] font-bold text-muted hover:text-ink"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={!image}
          className="h-[42px] flex-1 rounded-2xl bg-brand-500 text-[13.5px] font-extrabold text-white shadow-brand disabled:opacity-45"
        >
          Use image
        </button>
      </div>
      <p className="mt-2 text-center text-[10.5px] font-medium text-faint">
        Saved as a {OUTPUT}×{OUTPUT} PNG
      </p>
    </div>
  );
}
