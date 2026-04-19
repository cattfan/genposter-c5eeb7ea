import { useRef, useCallback } from "react";
import type { PageTemplate, Slot } from "@/models";

export function NumField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <label className="text-xs text-muted-foreground">{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="h-8 w-full border rounded px-2 text-sm"
      />
    </div>
  );
}

export function Canvas({
  template,
  zoom,
  selectedSlotId,
  onSelect,
  onUpdateSlot,
  onDeleteSlot,
}: {
  template: PageTemplate;
  zoom: number;
  selectedSlotId: string | null;
  onSelect: (id: string | null) => void;
  onUpdateSlot: (slotId: string, patch: Partial<Slot>) => void;
  onDeleteSlot?: (slotId: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={ref}
      className="relative shadow-2xl"
      style={{
        width: template.canvas.width * zoom,
        height: template.canvas.height * zoom,
        background: template.canvas.background ?? "#fff",
      }}
      onMouseDown={(e) => {
        if (e.target === ref.current) onSelect(null);
      }}
    >
      {template.slots
        .slice()
        .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
        .map((slot) => (
          <SlotEditor
            key={slot.slotId}
            slot={slot}
            zoom={zoom}
            selected={slot.slotId === selectedSlotId}
            onSelect={() => onSelect(slot.slotId)}
            onUpdate={(patch) => onUpdateSlot(slot.slotId, patch)}
            onDelete={() => onDeleteSlot?.(slot.slotId)}
            template={template}
          />
        ))}
    </div>
  );
}

type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

function SlotEditor({
  slot,
  zoom,
  selected,
  onSelect,
  onUpdate,
  onDelete,
  template,
}: {
  slot: Slot;
  zoom: number;
  selected: boolean;
  onSelect: () => void;
  onUpdate: (patch: Partial<Slot>) => void;
  onDelete: () => void;
  template: PageTemplate;
}) {
  const startMove = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onSelect();
      const startX = e.clientX;
      const startY = e.clientY;
      const orig = { x: slot.x, y: slot.y };
      const onMove = (ev: MouseEvent) => {
        const dx = (ev.clientX - startX) / zoom;
        const dy = (ev.clientY - startY) / zoom;
        onUpdate({ x: Math.round(orig.x + dx), y: Math.round(orig.y + dy) });
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [slot, zoom, onSelect, onUpdate],
  );

  const startResize = useCallback(
    (e: React.MouseEvent, handle: Handle) => {
      e.stopPropagation();
      e.preventDefault();
      onSelect();
      const startX = e.clientX;
      const startY = e.clientY;
      const orig = { x: slot.x, y: slot.y, w: slot.width, h: slot.height };
      const onMove = (ev: MouseEvent) => {
        const dx = (ev.clientX - startX) / zoom;
        const dy = (ev.clientY - startY) / zoom;
        let { x, y, w, h } = orig;
        if (handle.includes("e")) w = Math.max(20, orig.w + dx);
        if (handle.includes("s")) h = Math.max(20, orig.h + dy);
        if (handle.includes("w")) {
          w = Math.max(20, orig.w - dx);
          x = orig.x + (orig.w - w);
        }
        if (handle.includes("n")) {
          h = Math.max(20, orig.h - dy);
          y = orig.y + (orig.h - h);
        }
        onUpdate({
          x: Math.round(x),
          y: Math.round(y),
          width: Math.round(w),
          height: Math.round(h),
        });
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [slot, zoom, onSelect, onUpdate],
  );

  const baseStyle: React.CSSProperties = {
    position: "absolute",
    left: slot.x * zoom,
    top: slot.y * zoom,
    width: slot.width * zoom,
    height: slot.height * zoom,
    transform: slot.rotation ? `rotate(${slot.rotation}deg)` : undefined,
    cursor: "move",
    outline: selected ? "2px solid hsl(var(--primary))" : "1px dashed rgba(0,0,0,0.15)",
    outlineOffset: 0,
    boxSizing: "border-box",
  };

  let content: React.ReactNode = null;
  if (slot.kind === "text") {
    const s = slot.style ?? {};
    content = (
      <div
        style={{
          color: s.color ?? "#0f172a",
          fontSize: (s.fontSize ?? 24) * zoom,
          fontWeight: s.fontWeight ?? 500,
          lineHeight: s.lineHeight ?? 1.2,
          textAlign: s.textAlign ?? "left",
          textTransform: s.textTransform ?? "none",
          letterSpacing: (s.letterSpacing ?? 0) * zoom,
          whiteSpace: "pre-wrap",
          width: "100%",
          height: "100%",
          overflow: "hidden",
        }}
      >
        {slot.staticText}
      </div>
    );
  } else if (slot.kind === "image") {
    content = slot.staticImage ? (
      <img
        src={slot.staticImage}
        alt=""
        style={{
          width: "100%",
          height: "100%",
          objectFit: (slot.style?.fit === "stretch"
            ? "fill"
            : slot.style?.fit ?? "cover") as React.CSSProperties["objectFit"],
          borderRadius: (slot.style?.borderRadius ?? 0) * zoom,
        }}
      />
    ) : (
      <div className="w-full h-full bg-muted/50 grid place-items-center text-xs text-muted-foreground">
        Image (bind data)
      </div>
    );
  } else if (slot.kind === "shape") {
    const fill = slot.style?.fill ?? "#000";
    if (slot.shapeKind === "triangle") {
      content = (
        <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
          <polygon points="50,0 100,100 0,100" fill={fill} />
        </svg>
      );
    } else if (slot.shapeKind === "line" || slot.shapeKind === "divider") {
      content = (
        <div
          style={{
            width: "100%",
            height: Math.max(2, (slot.style?.strokeWidth ?? 2) * zoom),
            background: fill,
            marginTop: `calc(50% - ${Math.max(1, (slot.style?.strokeWidth ?? 2) * zoom) / 2}px)`,
          }}
        />
      );
    } else {
      content = (
        <div
          style={{
            width: "100%",
            height: "100%",
            background: fill,
            borderRadius:
              slot.shapeKind === "circle" ? "50%" : (slot.style?.borderRadius ?? 0) * zoom,
          }}
        />
      );
    }
  } else if (slot.kind === "section") {
    const sec = template.sections.find((s) => s.sectionId === slot.sectionRefId);
    content = (
      <div className="w-full h-full bg-accent/30 border-2 border-dashed border-accent grid place-items-center text-accent-foreground text-xs p-2 text-center">
        📦 Section: {sec?.title ?? "(chưa gán)"}
      </div>
    );
  }

  // 8 resize handles
  const handles: { h: Handle; style: React.CSSProperties; cursor: string }[] = [
    { h: "nw", style: { left: -5, top: -5 }, cursor: "nwse-resize" },
    { h: "n", style: { left: "50%", top: -5, marginLeft: -5 }, cursor: "ns-resize" },
    { h: "ne", style: { right: -5, top: -5 }, cursor: "nesw-resize" },
    { h: "e", style: { right: -5, top: "50%", marginTop: -5 }, cursor: "ew-resize" },
    { h: "se", style: { right: -5, bottom: -5 }, cursor: "nwse-resize" },
    { h: "s", style: { left: "50%", bottom: -5, marginLeft: -5 }, cursor: "ns-resize" },
    { h: "sw", style: { left: -5, bottom: -5 }, cursor: "nesw-resize" },
    { h: "w", style: { left: -5, top: "50%", marginTop: -5 }, cursor: "ew-resize" },
  ];

  return (
    <div
      style={baseStyle}
      onMouseDown={startMove}
      onKeyDown={(e) => {
        if ((e.key === "Delete" || e.key === "Backspace") && selected) {
          e.preventDefault();
          onDelete();
        }
      }}
      tabIndex={selected ? 0 : -1}
    >
      {content}
      {selected && (
        <>
          {handles.map((hd) => (
            <div
              key={hd.h}
              onMouseDown={(e) => startResize(e, hd.h)}
              style={{
                position: "absolute",
                width: 10,
                height: 10,
                background: "white",
                border: "2px solid hsl(var(--primary))",
                cursor: hd.cursor,
                borderRadius: 2,
                zIndex: 10,
                ...hd.style,
              }}
            />
          ))}
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            style={{
              position: "absolute",
              right: -12,
              top: -32,
              background: "hsl(var(--destructive))",
              color: "white",
              border: "none",
              borderRadius: 4,
              padding: "2px 8px",
              fontSize: 11,
              cursor: "pointer",
              zIndex: 11,
              boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
            }}
            title="Xoá block (Delete)"
          >
            ✕ Xoá
          </button>
        </>
      )}
    </div>
  );
}
