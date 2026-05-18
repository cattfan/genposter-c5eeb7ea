// Animation presets cho element — dùng cho presentation mode / video export sau này.
//
// Mỗi preset là 1 CSS @keyframes definition + config (duration, delay, easing).
// Lưu vào element.meta.animation. Không ảnh hưởng static PNG export.

export interface AnimationConfig {
  preset: string;
  duration: number; // seconds (0.3 - 2)
  delay: number; // seconds (0 - 2)
  easing: "ease" | "ease-in" | "ease-out" | "ease-in-out" | "linear" | "bounce";
}

export interface AnimationPreset {
  id: string;
  label: string;
  description: string;
  /** CSS keyframes string (không bao gồm @keyframes wrapper). */
  keyframes: string;
  /** Chỉ áp dụng cho text elements? */
  textOnly?: boolean;
  /** Default config. */
  defaults: Omit<AnimationConfig, "preset">;
}

export const ANIMATION_PRESETS: AnimationPreset[] = [
  {
    id: "fade-in",
    label: "Fade In",
    description: "Hiện dần từ trong suốt",
    keyframes: "from { opacity: 0; } to { opacity: 1; }",
    defaults: { duration: 0.6, delay: 0, easing: "ease" },
  },
  {
    id: "slide-up",
    label: "Slide Up",
    description: "Trượt lên từ dưới",
    keyframes:
      "from { opacity: 0; transform: translateY(30px); } to { opacity: 1; transform: translateY(0); }",
    defaults: { duration: 0.5, delay: 0, easing: "ease-out" },
  },
  {
    id: "slide-left",
    label: "Slide Left",
    description: "Trượt vào từ phải",
    keyframes:
      "from { opacity: 0; transform: translateX(30px); } to { opacity: 1; transform: translateX(0); }",
    defaults: { duration: 0.5, delay: 0, easing: "ease-out" },
  },
  {
    id: "scale-up",
    label: "Scale Up",
    description: "Phóng to từ nhỏ",
    keyframes:
      "from { opacity: 0; transform: scale(0.8); } to { opacity: 1; transform: scale(1); }",
    defaults: { duration: 0.4, delay: 0, easing: "ease-out" },
  },
  {
    id: "bounce",
    label: "Bounce",
    description: "Nảy lên",
    keyframes: `
      0% { opacity: 0; transform: translateY(20px); }
      60% { opacity: 1; transform: translateY(-8px); }
      80% { transform: translateY(4px); }
      100% { transform: translateY(0); }
    `,
    defaults: { duration: 0.7, delay: 0, easing: "ease-out" },
  },
  {
    id: "rotate-in",
    label: "Rotate In",
    description: "Xoay vào",
    keyframes:
      "from { opacity: 0; transform: rotate(-10deg) scale(0.9); } to { opacity: 1; transform: rotate(0) scale(1); }",
    defaults: { duration: 0.5, delay: 0, easing: "ease-out" },
  },
  {
    id: "typewriter",
    label: "Typewriter",
    description: "Gõ từng chữ (chỉ text)",
    textOnly: true,
    keyframes: `
      from { clip-path: inset(0 100% 0 0); }
      to { clip-path: inset(0 0 0 0); }
    `,
    defaults: { duration: 1.5, delay: 0, easing: "linear" },
  },
];

/**
 * Build CSS animation string từ config.
 * Dùng khi render presentation mode hoặc video export.
 */
export function buildAnimationCss(config: AnimationConfig): string {
  const preset = ANIMATION_PRESETS.find((p) => p.id === config.preset);
  if (!preset) return "";
  const name = `gp-anim-${config.preset}`;
  const easingValue =
    config.easing === "bounce"
      ? "cubic-bezier(0.34, 1.56, 0.64, 1)"
      : config.easing;
  return `${name} ${config.duration}s ${easingValue} ${config.delay}s both`;
}

/**
 * Build @keyframes CSS rule cho inject vào <style>.
 */
export function buildKeyframesRule(presetId: string): string {
  const preset = ANIMATION_PRESETS.find((p) => p.id === presetId);
  if (!preset) return "";
  return `@keyframes gp-anim-${presetId} { ${preset.keyframes} }`;
}
