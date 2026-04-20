// Seed pack "Lịch trình du lịch" linh hoạt:
//   - 1 page Cover
//   - 1 page Tiện ích (3 section: di chuyển / homestay / tiện ích khác)
//   - 1 page Ngày zigzag (template stand-alone) — designer nhân bản cho mỗi ngày.

import { nanoid } from "nanoid";
import { db } from "./db";
import type { PackTemplate, PageTemplate, Slot, Section } from "@/models";

function ms(s: Partial<Slot> & Pick<Slot, "kind" | "x" | "y" | "width" | "height">): Slot {
  return { slotId: nanoid(), rotation: 0, zIndex: 1, ...s } as Slot;
}

export function makeFlexCover(): PageTemplate {
  return {
    pageTemplateId: nanoid(),
    name: "Cover - Lịch trình du lịch",
    type: "cover",
    canvas: { width: 1080, height: 1350, background: "#0a0a0a" },
    slots: [
      ms({
        kind: "image",
        x: 0,
        y: 0,
        width: 1080,
        height: 1350,
        staticImage: "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1200",
        zIndex: 0,
        style: { fit: "cover", overlayColor: "rgba(0,0,0,0.45)" },
      }),
      ms({
        kind: "shape",
        shapeKind: "badge",
        x: 80,
        y: 200,
        width: 380,
        height: 80,
        zIndex: 2,
        style: { fill: "#dc2626" },
      }),
      ms({
        kind: "text",
        x: 80,
        y: 200,
        width: 380,
        height: 80,
        staticText: "ĐÀ LẠT",
        zIndex: 3,
        style: {
          fontFamily: "Be Vietnam Pro",
          fontSize: 44,
          fontWeight: 800,
          color: "#ffffff",
          textAlign: "center",
          textTransform: "uppercase",
          padding: 18,
        },
      }),
      ms({
        kind: "text",
        x: 60,
        y: 320,
        width: 960,
        height: 360,
        staticText: "GỢI Ý LỊCH TRÌNH\n4N3Đ",
        zIndex: 3,
        style: {
          fontFamily: "Be Vietnam Pro",
          fontSize: 110,
          fontWeight: 900,
          color: "#ffffff",
          textAlign: "center",
          lineHeight: 1.05,
          textTransform: "uppercase",
        },
      }),
      ms({
        kind: "text",
        x: 60,
        y: 1180,
        width: 960,
        height: 60,
        staticText: "Lưu lại để đi nhé!",
        zIndex: 3,
        style: {
          fontFamily: "Be Vietnam Pro",
          fontSize: 32,
          fontWeight: 500,
          color: "#fde68a",
          textAlign: "center",
        },
      }),
    ],
    sections: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function makeFlexUtilities(): PageTemplate {
  const sTrans = nanoid();
  const sHome = nanoid();
  const sOther = nanoid();
  const sec = (sectionId: string, title: string, value: string): Section => ({
    sectionId,
    title,
    maxItems: 3,
    minItems: 1,
    imageMode: "anchor_entity",
    listStyle: "dot",
    sortRule: "partner_first",
    partnerMode: "priority_partner",
    layoutMode: "stack",
    filterRules: [{ field: "category", op: "eq", value }],
  });
  return {
    pageTemplateId: nanoid(),
    name: "Tiện ích - Di chuyển / Homestay / Khác",
    type: "board",
    canvas: { width: 1080, height: 1350, background: "#fffbeb" },
    slots: [
      ms({
        kind: "text",
        x: 60,
        y: 50,
        width: 960,
        height: 80,
        staticText: "TIỆN ÍCH",
        zIndex: 2,
        style: {
          fontFamily: "Be Vietnam Pro",
          fontSize: 56,
          fontWeight: 900,
          color: "#0f172a",
          textAlign: "center",
          textTransform: "uppercase",
        },
      }),
      ms({ kind: "section", sectionRefId: sTrans, x: 60, y: 160, width: 960, height: 360, zIndex: 1 }),
      ms({ kind: "section", sectionRefId: sHome, x: 60, y: 540, width: 960, height: 380, zIndex: 1 }),
      ms({ kind: "section", sectionRefId: sOther, x: 60, y: 940, width: 960, height: 360, zIndex: 1 }),
    ],
    sections: [
      sec(sTrans, "🚗 Di chuyển", "transport"),
      sec(sHome, "🏡 Homestay", "homestay"),
      sec(sOther, "✨ Tiện ích khác", "other"),
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function makeFlexDayPage(dayNumber: number, total = 690): PageTemplate {
  const sectionId = nanoid();
  return {
    pageTemplateId: nanoid(),
    name: `Ngày ${dayNumber} - Zigzag`,
    type: "itinerary",
    canvas: { width: 1080, height: 1350, background: "#fef3c7" },
    slots: [
      ms({
        kind: "shape",
        shapeKind: "badge",
        x: 60,
        y: 60,
        width: 700,
        height: 100,
        zIndex: 1,
        style: { fill: "#dc2626" },
      }),
      ms({
        kind: "text",
        x: 60,
        y: 60,
        width: 700,
        height: 100,
        staticText: `NGÀY ${dayNumber} - $${total}`,
        zIndex: 2,
        style: {
          fontFamily: "Be Vietnam Pro",
          fontSize: 48,
          fontWeight: 800,
          color: "#ffffff",
          textAlign: "center",
          padding: 24,
          textTransform: "uppercase",
        },
      }),
      ms({
        kind: "section",
        sectionRefId: sectionId,
        x: 60,
        y: 200,
        width: 960,
        height: 1100,
        zIndex: 1,
      }),
    ],
    sections: [
      {
        sectionId,
        title: `Lịch trình ngày ${dayNumber}`,
        maxItems: 6,
        minItems: 3,
        imageMode: "anchor_entity",
        listStyle: "number",
        sortRule: "none",
        partnerMode: "priority_partner",
        layoutMode: "zigzag",
        filterRules: [{ field: "day", op: "eq", value: dayNumber }],
      },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export async function seedTravelFlexPack(): Promise<{ packId: string; pageIds: string[] }> {
  const cover = makeFlexCover();
  const utils = makeFlexUtilities();
  const day1 = makeFlexDayPage(1);
  const pack: PackTemplate = {
    packTemplateId: nanoid(),
    name: "Lịch trình du lịch (linh hoạt)",
    goal: "Tour 4N3Đ kiểu Đà Lạt — designer thêm page Ngày tuỳ ý",
    tone: "thân thiện, dễ lưu",
    cta: "Lưu lại để đi nhé!",
    orderedPages: [cover.pageTemplateId, utils.pageTemplateId, day1.pageTemplateId],
    requiredPages: [cover.pageTemplateId],
    optionalPages: [],
    captionProfile: { mode: "save_post", seoKeywords: ["du lịch", "lịch trình"] },
    exportDefaults: { format: "png", scale: 2 },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  await db.transaction("rw", [db.pageTemplates, db.packTemplates], async () => {
    await db.pageTemplates.bulkPut([cover, utils, day1]);
    await db.packTemplates.put(pack);
  });

  return {
    packId: pack.packTemplateId,
    pageIds: [cover.pageTemplateId, utils.pageTemplateId, day1.pageTemplateId],
  };
}

/**
 * Nhân bản 1 page Ngày từ template gốc — gán dayNumber mới và update filterRules.
 */
export async function cloneDayPage(sourcePageId: string, newDayNumber: number, total = 690): Promise<string> {
  const src = await db.pageTemplates.get(sourcePageId);
  if (!src) throw new Error("Page template gốc không tồn tại");
  const fresh = makeFlexDayPage(newDayNumber, total);
  // Giữ layout slots/sections của bản gốc, chỉ thay text header + filterRules nếu có.
  const cloned: PageTemplate = {
    ...src,
    pageTemplateId: fresh.pageTemplateId,
    name: `Ngày ${newDayNumber}`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    slots: src.slots.map((s) => {
      if (s.kind === "text" && /NG[ÀA]Y\s*\d+/i.test(s.staticText ?? "")) {
        return { ...s, slotId: nanoid(), staticText: `NGÀY ${newDayNumber} - $${total}` };
      }
      return { ...s, slotId: nanoid() };
    }),
    sections: src.sections.map((sec) => ({
      ...sec,
      sectionId: nanoid(),
      title: `Lịch trình ngày ${newDayNumber}`,
      filterRules: (sec.filterRules ?? []).map((r) =>
        r.field === "day" ? { ...r, value: newDayNumber } : r,
      ),
    })),
  };
  // Cập nhật sectionRefId trong slots cho khớp section mới
  const oldToNew = new Map<string, string>();
  src.sections.forEach((s, i) => oldToNew.set(s.sectionId, cloned.sections[i].sectionId));
  cloned.slots = cloned.slots.map((s) =>
    s.kind === "section" && s.sectionRefId && oldToNew.has(s.sectionRefId)
      ? { ...s, sectionRefId: oldToNew.get(s.sectionRefId)! }
      : s,
  );
  await db.pageTemplates.put(cloned);
  return cloned.pageTemplateId;
}
