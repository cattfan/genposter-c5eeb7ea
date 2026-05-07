// CanvasRuler: Horizontal + vertical ruler around the design canvas.
// Drag from ruler to create guides. Drag guide off canvas to delete it.
import { useCallback, useRef, useState } from "react";
import type { DesignGuide } from "@/models";

const RULER_SIZE = 24;
const TICK_MAJOR = 100;
const TICK_MINOR = 50;

interface CanvasRulerProps {
  pageWidth: number;
  pageHeight: number;
  scale: number;
  guides: DesignGuide[];
  onAddGuide: (axis: "x" | "y", value: number) => void;
  onRemoveGuide: (guideId: string) => void;
}

type PointerSessionHandlers = {
  onMove?: (event: PointerEvent) => void;
  onEnd?: (event: PointerEvent | Event) => void;
  onCancel?: (event: PointerEvent | Event) => void;
};

function startPointerSession(
  event: React.PointerEvent<HTMLElement>,
  { onMove, onEnd, onCancel }: PointerSessionHandlers,
) {
  const target = event.currentTarget;
  const pointerId = event.pointerId;
  let ended = false;
  try {
    target.setPointerCapture(pointerId);
  } catch {
    // Ignore browsers that release capture early.
  }

  const cleanup = () => {
    target.removeEventListener("pointermove", handleMove);
    target.removeEventListener("pointerup", handleEnd);
    target.removeEventListener("pointercancel", handleCancel);
    target.removeEventListener("lostpointercapture", handleCancel);
    window.removeEventListener("blur", handleCancel);
    try {
      if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
    } catch {
      // Already released.
    }
  };

  const finish = (handler: PointerSessionHandlers["onEnd"], nextEvent: PointerEvent | Event) => {
    if (ended) return;
    ended = true;
    cleanup();
    handler?.(nextEvent);
  };

  function handleMove(nextEvent: PointerEvent) {
    if (nextEvent.pointerId !== pointerId) return;
    onMove?.(nextEvent);
  }

  function handleEnd(nextEvent: PointerEvent) {
    if (nextEvent.pointerId !== pointerId) return;
    finish(onEnd, nextEvent);
  }

  function handleCancel(nextEvent: PointerEvent | Event) {
    if (nextEvent instanceof PointerEvent && nextEvent.pointerId !== pointerId) return;
    finish(onCancel ?? onEnd, nextEvent);
  }

  target.addEventListener("pointermove", handleMove);
  target.addEventListener("pointerup", handleEnd);
  target.addEventListener("pointercancel", handleCancel);
  target.addEventListener("lostpointercapture", handleCancel);
  window.addEventListener("blur", handleCancel);
}

export function CanvasRuler({
  pageWidth,
  pageHeight,
  scale,
  guides,
  onAddGuide,
  onRemoveGuide,
}: CanvasRulerProps) {
  const [dragAxis, setDragAxis] = useState<"x" | "y" | null>(null);
  const [dragValue, setDragValue] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const startDrag = useCallback(
    (axis: "x" | "y", e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setDragAxis(axis);
      const container = containerRef.current;
      if (!container) return;
      const canvasEl = container.querySelector("[data-design-canvas]") as HTMLElement | null;
      if (!canvasEl) return;

      const onMove = (ev: PointerEvent) => {
        const rect = canvasEl.getBoundingClientRect();
        if (axis === "x") {
          const val = (ev.clientX - rect.left) / scale;
          setDragValue(val);
        } else {
          const val = (ev.clientY - rect.top) / scale;
          setDragValue(val);
        }
      };
      const onUp = (ev: PointerEvent | Event) => {
        setDragAxis(null);
        setDragValue(null);
        const rect = canvasEl.getBoundingClientRect();
        const clientX = ev instanceof PointerEvent ? ev.clientX : 0;
        const clientY = ev instanceof PointerEvent ? ev.clientY : 0;
        let val: number;
        if (axis === "x") {
          val = (clientX - rect.left) / scale;
        } else {
          val = (clientY - rect.top) / scale;
        }
        // Only add if within canvas bounds
        if (val > 0 && (axis === "x" ? val < pageWidth : val < pageHeight)) {
          onAddGuide(axis, Math.round(val));
        }
      };
      startPointerSession(e, { onMove, onEnd: onUp, onCancel: onUp });
    },
    [scale, pageWidth, pageHeight, onAddGuide],
  );

  const handleGuideDrag = useCallback(
    (guide: DesignGuide, e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const container = containerRef.current;
      if (!container) return;
      const canvasEl = container.querySelector("[data-design-canvas]") as HTMLElement | null;
      if (!canvasEl) return;

      const onMove = (ev: PointerEvent) => {
        const rect = canvasEl.getBoundingClientRect();
        if (guide.axis === "x") {
          const val = (ev.clientX - rect.left) / scale;
          setDragAxis("x");
          setDragValue(val);
        } else {
          const val = (ev.clientY - rect.top) / scale;
          setDragAxis("y");
          setDragValue(val);
        }
      };
      const onUp = (ev: PointerEvent | Event) => {
        setDragAxis(null);
        setDragValue(null);
        const rect = canvasEl.getBoundingClientRect();
        const clientX = ev instanceof PointerEvent ? ev.clientX : 0;
        const clientY = ev instanceof PointerEvent ? ev.clientY : 0;
        let val: number;
        if (guide.axis === "x") {
          val = (clientX - rect.left) / scale;
        } else {
          val = (clientY - rect.top) / scale;
        }
        // If dragged off canvas, remove guide
        if (val <= 0 || (guide.axis === "x" ? val >= pageWidth : val >= pageHeight)) {
          onRemoveGuide(guide.guideId);
        }
      };
      startPointerSession(e, { onMove, onEnd: onUp, onCancel: onUp });
    },
    [scale, pageWidth, pageHeight, onRemoveGuide],
  );

  // Generate tick marks
  const hTicks: number[] = [];
  const vTicks: number[] = [];
  for (let i = 0; i <= pageWidth; i += TICK_MINOR) hTicks.push(i);
  for (let i = 0; i <= pageHeight; i += TICK_MINOR) vTicks.push(i);

  return (
    <div ref={containerRef} className="pointer-events-auto">
      {/* Corner square */}
      <div
        className="absolute bg-muted/80"
        style={{ left: 0, top: 0, width: RULER_SIZE, height: RULER_SIZE, zIndex: 40 }}
      />
      {/* Horizontal ruler */}
      <div
        className="absolute bg-muted/60"
        style={{
          left: RULER_SIZE,
          top: 0,
          width: pageWidth * scale,
          height: RULER_SIZE,
          zIndex: 40,
          overflow: "hidden",
        }}
        onPointerDown={(e) => startDrag("x", e)}
      >
        <svg width={pageWidth * scale} height={RULER_SIZE} className="block">
          {hTicks.map((val) => {
            const isMajor = val % TICK_MAJOR === 0;
            return (
              <g key={`h-${val}`}>
                <line
                  x1={val * scale}
                  y1={isMajor ? 4 : RULER_SIZE / 2}
                  x2={val * scale}
                  y2={RULER_SIZE}
                  stroke="currentColor"
                  strokeWidth={0.5}
                  opacity={0.4}
                />
                {isMajor ? (
                  <text
                    x={val * scale + 3}
                    y={12}
                    fontSize={9}
                    fill="currentColor"
                    opacity={0.5}
                  >
                    {val}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>
      {/* Vertical ruler */}
      <div
        className="absolute bg-muted/60"
        style={{
          left: 0,
          top: RULER_SIZE,
          width: RULER_SIZE,
          height: pageHeight * scale,
          zIndex: 40,
          overflow: "hidden",
        }}
        onPointerDown={(e) => startDrag("y", e)}
      >
        <svg width={RULER_SIZE} height={pageHeight * scale} className="block">
          {vTicks.map((val) => {
            const isMajor = val % TICK_MAJOR === 0;
            return (
              <g key={`v-${val}`}>
                <line
                  x1={isMajor ? 4 : RULER_SIZE / 2}
                  y1={val * scale}
                  x2={RULER_SIZE}
                  y2={val * scale}
                  stroke="currentColor"
                  strokeWidth={0.5}
                  opacity={0.4}
                />
                {isMajor ? (
                  <text
                    x={3}
                    y={val * scale + 3}
                    fontSize={9}
                    fill="currentColor"
                    opacity={0.5}
                    transform={`rotate(-90, 3, ${val * scale + 3})`}
                  >
                    {val}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Dragging guide preview */}
      {dragAxis !== null && dragValue !== null ? (
        <div
          className="pointer-events-none absolute"
          style={{
            ...(dragAxis === "x"
              ? { left: dragValue * scale + RULER_SIZE, top: RULER_SIZE, width: 1, height: pageHeight * scale }
              : { left: RULER_SIZE, top: dragValue * scale + RULER_SIZE, width: pageWidth * scale, height: 1 }),
            background: "rgba(56,189,248,0.9)",
            zIndex: 50,
          }}
        />
      ) : null}

      {/* Existing guide markers on rulers */}
      {guides.map((guide) => (
        <div
          key={guide.guideId}
          className="absolute cursor-move"
          style={{
            ...(guide.axis === "x"
              ? {
                  left: guide.value * scale + RULER_SIZE - 4,
                  top: 2,
                  width: 8,
                  height: RULER_SIZE - 4,
                }
              : {
                  left: 2,
                  top: guide.value * scale + RULER_SIZE - 4,
                  width: RULER_SIZE - 4,
                  height: 8,
                }),
            zIndex: 41,
          }}
          onPointerDown={(e) => handleGuideDrag(guide, e)}
        >
          <div
            className="size-full rounded-sm bg-primary/60"
            style={{ minWidth: 4, minHeight: 4 }}
          />
        </div>
      ))}
    </div>
  );
}
