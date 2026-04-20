// Card Repeater: mở rộng các slot có groupId được khai báo trong PageTemplate.cardGroups
// thành N "card" — mỗi card là 1 bản clone offset, gán cho 1 entity trong pool.

import type { CardGroupConfig, Entity, PageTemplate, Slot } from "@/models";

export interface ExpandedSlot extends Slot {
  /** Slot gốc trong template (id không đổi cho card index 0). */
  originalSlotId: string;
  /** Index card trong group (0 = bản gốc). */
  cardIndex: number;
  /** Group config nguồn. */
  cardGroupId?: string;
  /** Entity gán riêng cho card này — renderer ưu tiên dùng entity này. */
  __cardEntityId?: string;
}

export interface ExpandResult {
  slots: ExpandedSlot[];
  /** Map slotId (sau khi clone, có suffix) → entity được gán. */
  entityBySlotId: Map<string, Entity>;
  /** Map slotId gốc → cardEntities[] để UI hiển thị tên. */
  cardsByGroup: Map<string, Entity[]>;
}

/**
 * Filter pool entity theo cardGroup.entitySource.
 */
function filterPool(pool: Entity[], cfg: CardGroupConfig): Entity[] {
  let arr = pool;
  if (cfg.entitySource?.sheetName) {
    arr = arr.filter((e) => e.sheetName === cfg.entitySource!.sheetName);
  }
  if (cfg.entitySource?.filterRules?.length) {
    arr = arr.filter((e) => {
      for (const rule of cfg.entitySource!.filterRules!) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const v = (e as any)[rule.field] ?? e.metadata?.[rule.field];
        if (v == null) return false;
        switch (rule.op) {
          case "eq":
            if (String(v) !== String(rule.value)) return false;
            break;
          case "contains":
            if (!String(v).toLowerCase().includes(String(rule.value).toLowerCase())) return false;
            break;
          case "in": {
            const list = Array.isArray(rule.value) ? rule.value : [String(rule.value)];
            if (!list.map(String).includes(String(v))) return false;
            break;
          }
          case "gte":
            if (!(Number(v) >= Number(rule.value))) return false;
            break;
          case "lte":
            if (!(Number(v) <= Number(rule.value))) return false;
            break;
        }
      }
      return true;
    });
  }
  return arr;
}

/**
 * Tính bbox (min/max) của tất cả slot trong 1 group.
 */
function bboxOfGroup(slots: Slot[], groupId: string): { x: number; y: number; w: number; h: number } | null {
  const items = slots.filter((s) => s.groupId === groupId);
  if (items.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of items) {
    minX = Math.min(minX, s.x);
    minY = Math.min(minY, s.y);
    maxX = Math.max(maxX, s.x + s.width);
    maxY = Math.max(maxY, s.y + s.height);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * Expand 1 PageTemplate theo cardGroups + auto group-binding.
 *
 * Quy tắc:
 * - cardGroups cấu hình rõ ràng: clone N card, mỗi card ăn 1 entity kế tiếp trong pool.
 * - group thường (có groupId, chưa bật cardGroups): nếu có bind entity/asset thì cả group sẽ ăn 1 entity riêng,
 *   lần lượt theo thứ tự trên xuống / trái sang phải. Điều này sửa case user vẽ tay 4 card riêng nhưng muốn 4 quán khác nhau.
 * - slot không thuộc group nào giữ nguyên, fallback dùng entity của page như cũ.
 */
export function expandPageWithCardGroups(
  template: PageTemplate,
  entityPool: Entity[],
): ExpandResult {
  const cardGroups = template.cardGroups ?? [];
  const entityBySlotId = new Map<string, Entity>();
  const cardsByGroup = new Map<string, Entity[]>();

  if (cardGroups.length === 0 && entityPool.length === 0) {
    return {
      slots: template.slots.map((s) => ({ ...s, originalSlotId: s.slotId, cardIndex: 0 })),
      entityBySlotId,
      cardsByGroup,
    };
  }

  const configuredGroupIds = new Set(cardGroups.map((g) => g.groupId));
  let cursor = 0;

  const sortedCardGroups = cardGroups
    .slice()
    .sort((a, b) => {
      const boxA = bboxOfGroup(template.slots, a.groupId);
      const boxB = bboxOfGroup(template.slots, b.groupId);
      if (!boxA || !boxB) return 0;
      return boxA.y - boxB.y || boxA.x - boxB.x;
    });

  const expanded: ExpandedSlot[] = [];

  // 1) Group thường chưa bật card repeater: mỗi group ăn 1 entity riêng
  const autoGroupIds = Array.from(
    new Set(
      template.slots
        .filter((s) => s.groupId && !configuredGroupIds.has(s.groupId))
        .map((s) => s.groupId as string),
    ),
  )
    .filter((groupId) => {
      const groupSlots = template.slots.filter((s) => s.groupId === groupId);
      return groupSlots.some(
        (s) => !!s.bindingPath && (s.bindingPath.startsWith("entity.") || s.bindingPath.startsWith("asset.")),
      );
    })
    .sort((a, b) => {
      const boxA = bboxOfGroup(template.slots, a);
      const boxB = bboxOfGroup(template.slots, b);
      if (!boxA || !boxB) return 0;
      return boxA.y - boxB.y || boxA.x - boxB.x;
    });

  const autoGroupIdSet = new Set(autoGroupIds);

  for (const groupId of autoGroupIds) {
    const ent = entityPool.length > 0 ? entityPool[cursor % entityPool.length] : undefined;
    const groupSlots = template.slots.filter((s) => s.groupId === groupId);
    const cardEntities = ent ? [ent] : [];

    for (const s of groupSlots) {
      const cloned: ExpandedSlot = {
        ...s,
        originalSlotId: s.slotId,
        cardIndex: 0,
        cardGroupId: groupId,
        __cardEntityId: ent?.entityId,
      };
      expanded.push(cloned);
      if (ent) entityBySlotId.set(s.slotId, ent);
    }

    cardsByGroup.set(groupId, cardEntities);
    cursor += 1;
  }

  // 2) Slot ngoài mọi group hoặc group không bind entity/asset giữ nguyên
  const untouched: ExpandedSlot[] = template.slots
    .filter((s) => !s.groupId || (!configuredGroupIds.has(s.groupId) && !autoGroupIdSet.has(s.groupId)))
    .map((s) => ({ ...s, originalSlotId: s.slotId, cardIndex: 0 }));
  expanded.push(...untouched);

  // 3) Group có Card Repeater cấu hình: clone N card, consume entity tuần tự
  for (const cfg of sortedCardGroups) {
    const bbox = bboxOfGroup(template.slots, cfg.groupId);
    if (!bbox) continue;
    const groupSlots = template.slots.filter((s) => s.groupId === cfg.groupId);
    const pool = filterPool(entityPool, cfg);
    const repeat = Math.max(1, Math.floor(cfg.repeatCount));
    const dx = cfg.direction === "horizontal" ? bbox.w + cfg.gap : 0;
    const dy = cfg.direction === "vertical" ? bbox.h + cfg.gap : 0;

    const cardEntities: Entity[] = [];
    for (let i = 0; i < repeat; i++) {
      const ent = pool.length > 0 ? pool[(cursor + i) % pool.length] : undefined;
      if (ent) cardEntities.push(ent);

      for (const s of groupSlots) {
        const newId = i === 0 ? s.slotId : `${s.slotId}__c${i}`;
        const cloned: ExpandedSlot = {
          ...s,
          slotId: newId,
          x: s.x + dx * i,
          y: s.y + dy * i,
          originalSlotId: s.slotId,
          cardIndex: i,
          cardGroupId: cfg.groupId,
          __cardEntityId: ent?.entityId,
        };
        expanded.push(cloned);
        if (ent) entityBySlotId.set(newId, ent);
      }
    }

    cardsByGroup.set(cfg.groupId, cardEntities);
    cursor += repeat;
  }

  return { slots: expanded, entityBySlotId, cardsByGroup };
}
