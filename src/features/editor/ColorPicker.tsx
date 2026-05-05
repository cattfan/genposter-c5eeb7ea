// Enhanced ColorPicker with swatches, recent colors, and hex input.
import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";

const SWATCHES = [
  "#000000", "#434343", "#666666", "#999999", "#b7b7b7", "#cccccc", "#d9d9d9", "#efefef", "#f3f3f3", "#ffffff",
  "#980000", "#ff0000", "#ff9900", "#ffff00", "#00ff00", "#00ffff", "#4a86e8", "#0000ff", "#9900ff", "#ff00ff",
  "#e6b8af", "#f4cccc", "#fce5cd", "#fff2cc", "#d9ead3", "#d0e0e3", "#c9daf8", "#cfe2f3", "#d9d2e9", "#ead1dc",
  "#dd7e6b", "#ea9999", "#f9cb9c", "#ffe599", "#b6d7a8", "#a2c4c9", "#a4c2f4", "#9fc5e8", "#b4a7d6", "#d5a6bd",
  "#cc4125", "#e06666", "#f6b26b", "#ffd966", "#93c47d", "#76a5af", "#6d9eeb", "#6fa8dc", "#8e7cc3", "#c27ba0",
  "#a61c00", "#cc0000", "#e69138", "#f1c232", "#6aa84f", "#45818e", "#3c78d8", "#3d85c6", "#674ea7", "#a64d79",
  "#85200c", "#990000", "#b45f06", "#bf9000", "#38761d", "#134f5c", "#1155cc", "#0b5394", "#351c75", "#741b47",
];

const MAX_RECENT = 12;

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  className?: string;
}

export function ColorPicker({ value, onChange, className }: ColorPickerProps) {
  const [recent, setRecent] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("genposter-recent-colors") ?? "[]");
    } catch {
      return [];
    }
  });
  const [hexInput, setHexInput] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setHexInput(value);
  }, [value]);

  const addRecent = (color: string) => {
    const next = [color, ...recent.filter((c) => c !== color)].slice(0, MAX_RECENT);
    setRecent(next);
    try {
      localStorage.setItem("genposter-recent-colors", JSON.stringify(next));
    } catch { /* ignore */ }
  };

  const handlePick = (color: string) => {
    addRecent(color);
    onChange(color);
  };

  const handleHexCommit = () => {
    let hex = hexInput.trim();
    if (!hex.startsWith("#")) hex = "#" + hex;
    if (/^#[0-9a-fA-F]{3,8}$/.test(hex)) {
      addRecent(hex);
      onChange(hex);
    } else {
      setHexInput(value);
    }
  };

  return (
    <div className={`space-y-2 ${className ?? ""}`}>
      {/* Native color input + hex */}
      <div className="flex items-center gap-2">
        <label className="relative flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded border">
          <input
            type="color"
            value={value}
            onChange={(e) => handlePick(e.target.value)}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
          <div
            className="size-6 rounded-sm"
            style={{ background: value }}
          />
        </label>
        <Input
          ref={inputRef}
          value={hexInput}
          onChange={(e) => setHexInput(e.target.value)}
          onBlur={handleHexCommit}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleHexCommit();
          }}
          className="h-8 flex-1 font-mono text-xs"
          placeholder="#000000"
        />
      </div>

      {/* Recent colors */}
      {recent.length > 0 ? (
        <div>
          <p className="mb-1 text-[10px] uppercase text-muted-foreground">Gần đây</p>
          <div className="flex flex-wrap gap-1">
            {recent.map((color) => (
              <button
                key={color}
                className="size-5 rounded-sm border hover:scale-110 transition-transform"
                style={{ background: color }}
                onClick={() => handlePick(color)}
                title={color}
              />
            ))}
          </div>
        </div>
      ) : null}

      {/* Swatches */}
      <div>
        <p className="mb-1 text-[10px] uppercase text-muted-foreground">Mẫu màu</p>
        <div className="flex flex-wrap gap-0.5">
          {SWATCHES.map((color) => (
            <button
              key={color}
              className="size-4 rounded-sm border border-transparent hover:border-foreground/30 transition-colors"
              style={{ background: color }}
              onClick={() => handlePick(color)}
              title={color}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
