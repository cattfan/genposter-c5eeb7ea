// Skeleton placeholder cho loading states nhất quán.
// Dùng khi fetching từ IndexedDB hoặc network.

import { cn } from "@/lib/utils";

interface SkeletonProps {
  className?: string;
  /** Độ rộng (tailwind class như w-full, w-32) */
  width?: string;
  /** Độ cao (tailwind class như h-4, h-8) */
  height?: string;
  /** Shape: rounded | circle | rectangle */
  shape?: "rounded" | "circle" | "rectangle";
}

export function Skeleton({
  className,
  width,
  height,
  shape = "rounded",
}: SkeletonProps) {
  const shapeClass =
    shape === "circle" ? "rounded-full" : shape === "rounded" ? "rounded-md" : "";
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className={cn(
        "animate-pulse bg-muted",
        shapeClass,
        width,
        height,
        className,
      )}
    />
  );
}

/** Skeleton group dùng khi hiển thị list loading */
export function SkeletonList({
  count = 3,
  height = "h-12",
  className,
}: {
  count?: number;
  height?: string;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} height={height} width="w-full" />
      ))}
    </div>
  );
}
