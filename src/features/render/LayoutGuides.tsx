import { SAFE_MARGIN_X, SAFE_MARGIN_Y } from "@/lib/safeZone";

export function LayoutGuides({
  width,
  height,
  scale = 1,
  showBleed = true,
  showTrim = true,
  showSafeZone = true,
}: {
  width: number;
  height: number;
  scale?: number;
  showBleed?: boolean;
  showTrim?: boolean;
  showSafeZone?: boolean;
}) {
  const bleedInset = 2;
  const trimInset = 8;
  const safeLeft = width * SAFE_MARGIN_X * scale;
  const safeTop = height * SAFE_MARGIN_Y * scale;
  const safeWidth = width * (1 - SAFE_MARGIN_X * 2) * scale;
  const safeHeight = height * (1 - SAFE_MARGIN_Y * 2) * scale;

  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        zIndex: 10,
      }}
    >
      {showBleed ? (
        <div
          style={{
            position: "absolute",
            inset: bleedInset,
            border: "1px solid rgba(220, 38, 38, 0.45)",
            boxSizing: "border-box",
          }}
        />
      ) : null}
      {showTrim ? (
        <div
          style={{
            position: "absolute",
            inset: trimInset,
            border: "1px dashed rgba(14, 116, 144, 0.55)",
            boxSizing: "border-box",
          }}
        />
      ) : null}
      {showSafeZone ? (
        <div
          style={{
            position: "absolute",
            left: safeLeft,
            top: safeTop,
            width: safeWidth,
            height: safeHeight,
            border: "1px solid rgba(34, 197, 94, 0.5)",
            background: "rgba(34, 197, 94, 0.04)",
            boxSizing: "border-box",
          }}
        />
      ) : null}
    </div>
  );
}
