import type { Slot } from "@/models";

const normalizeSlotCandidate = (label: string | undefined): string | null => {
  const value = label?.trim();
  if (!value) return null;
  if (/^text$/i.test(value)) return null;
  if (/^chữ$/i.test(value)) return null;
  if (/^\d+\s*,\s*\d+$/.test(value)) return null;
  if (/^image$/i.test(value)) return "Ảnh";
  return value;
};

export function normalizeSlotDisplayLabel(label: string | undefined, fallback: string): string {
  return normalizeSlotCandidate(label) ?? fallback;
}

export function buildTextSlotDisplayLabel(
  slot: Slot,
  index: number,
  options: {
    baseSlot?: Slot;
    bindingLabel?: string;
  } = {},
): string {
  return (
    normalizeSlotCandidate(slot.name) ??
    normalizeSlotCandidate(slot.staticText) ??
    normalizeSlotCandidate(options.baseSlot?.staticText) ??
    normalizeSlotCandidate(options.baseSlot?.name) ??
    normalizeSlotCandidate(options.bindingLabel) ??
    `Chữ ${index + 1}`
  );
}
