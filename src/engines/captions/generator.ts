// Caption generator local rules tiếng Việt

import { nanoid } from "nanoid";
import type {
  CaptionMode,
  CaptionVariant,
  Entity,
  GenerationJob,
  PackTemplate,
} from "@/models";

const FIXED_TAGS = ["#riviudalat", "#dalat", "#dalatreview"];

export interface CaptionInput {
  job: GenerationJob;
  pack: PackTemplate;
  entities: Entity[];
  mode?: CaptionMode;
  count?: number;
}

export function generateCaptions(input: CaptionInput): CaptionVariant[] {
  const { job, pack, entities, mode = pack.captionProfile?.mode ?? "save_post", count = 4 } = input;

  // Chỉ lấy entity từ final selected pages
  const selectedPages = job.pages.filter((p) => p.selected);
  const entityIds = new Set<string>();
  selectedPages.forEach((p) =>
    p.items.forEach((it) => {
      if (it.entityId) entityIds.add(it.entityId);
    }),
  );
  const usedEntities = entities.filter((e) => entityIds.has(e.entityId));
  const partners = usedEntities.filter((e) => e.partnerFlag);
  const cats = Array.from(new Set(usedEntities.map((e) => e.categoryMain).filter(Boolean)));

  const dynamicTags = buildDynamicTags(cats as string[], usedEntities);

  const variants: CaptionVariant[] = [];
  for (let i = 0; i < count; i++) {
    const tpl = TEMPLATES[mode][i % TEMPLATES[mode].length];
    const headline = trimAt(tpl.headline(usedEntities, pack), 90).toUpperCase();
    const body = trimAt(
      tpl.body(usedEntities, pack, partners),
      300,
    );
    variants.push({
      id: nanoid(),
      headline,
      body,
      hashtags: [...FIXED_TAGS, ...dynamicTags].slice(0, 5),
      mode,
      sourceManifestPageIds: selectedPages.map((p) => p.pageFile),
    });
  }
  return variants;
}

function buildDynamicTags(cats: string[], ents: Entity[]): string[] {
  const tagPool: string[] = [];
  if (cats.includes("cafe")) tagPool.push("#cafedalat");
  if (cats.includes("quan_an")) tagPool.push("#andalat");
  if (cats.includes("homestay")) tagPool.push("#homestaydalat");
  if (cats.includes("thue_xe")) tagPool.push("#thuexedalat");
  if (cats.includes("checkin")) tagPool.push("#checkindalat");
  if (cats.includes("spa")) tagPool.push("#thugiandalat");
  if (ents.some((e) => e.partnerFlag)) tagPool.push("#riviuchatluong");
  tagPool.push("#dulichdalat", "#dalatcoivui");
  return Array.from(new Set(tagPool)).slice(0, 2);
}

function trimAt(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

type Tpl = {
  headline: (ents: Entity[], pack: PackTemplate) => string;
  body: (ents: Entity[], pack: PackTemplate, partners: Entity[]) => string;
};

const TEMPLATES: Record<CaptionMode, Tpl[]> = {
  save_post: [
    {
      headline: (ents) => `Lưu lại đi Đà Lạt với ${ents.length} điểm cực chill`,
      body: (ents, pack) => {
        const top = ents.slice(0, 3).map((e) => e.name).join(", ");
        return `Tổng hợp ${pack.name.toLowerCase()} với những địa điểm ăn uống, ở lại và checkin. Gồm ${top}... ${pack.cta ?? "Lưu lại để đi nhé!"}`;
      },
    },
    {
      headline: (ents) => `Bộ sưu tập Đà Lạt: ${ents.length} chỗ phải đi`,
      body: (ents, pack) =>
        `Mình tổng hợp ${ents.length} địa điểm cho ${pack.goal ?? "chuyến Đà Lạt cuối tuần"}. Có cafe view đẹp, quán ngon, homestay xinh. Lưu post + tag đứa hay rủ đi để lên lịch ngay!`,
    },
  ],
  newbie_guide: [
    {
      headline: () => `Newbie Đà Lạt nhất định phải biết`,
      body: (ents, pack) =>
        `Lần đầu đi Đà Lạt nên đi đâu? Mình gợi ý ${pack.name.toLowerCase()}: ${ents.slice(0, 4).map((e) => e.name).join(" • ")}. Đi theo list này khỏi lo lạc!`,
    },
  ],
  review_pack: [
    {
      headline: (ents) => `Riviu nhanh ${ents.length} điểm Đà Lạt`,
      body: (ents) =>
        `Đi rồi mới biết: ${ents
          .slice(0, 3)
          .map((e) => `${e.name}${e.priceRange ? ` (${e.priceRange})` : ""}`)
          .join(" • ")}. Bạn nào đi rồi để lại cảm nhận nhé!`,
    },
  ],
  partner_soft: [
    {
      headline: (_, pack) => `${pack.name} - Gợi ý đi nhẹ nhàng`,
      body: (ents, _pack, partners) => {
        const first = partners[0]?.name ?? ents[0]?.name ?? "Đà Lạt";
        return `Có nhiều bạn hỏi nên đi đâu, ăn gì ở Đà Lạt. Mình recommend: ${first}${
          partners.length > 1 ? ` và ${partners.length - 1} chỗ khác` : ""
        }. Mọi người tham khảo nha!`;
      },
    },
  ],
};
