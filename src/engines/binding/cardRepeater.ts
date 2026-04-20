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
 * Cluster các slot CÓ bindingPath theo vị trí (Y nếu vertical, X nếu horizontal).
 * Mỗi cluster sẽ ăn 1 entity riêng.
 *
 * Ưu tiên groupId nếu đã có; nếu không, dùng heuristic gap.
 */
function autoClusterSlots(
  slots: Slot[],
  excludeGroupIds: Set<string>,
): Array<{ key: string; slots: Slot[] }> {
  const bindable = slots.filter((s) => {
    if (!s.bindingPath) return false;
    if (!s.bindingPath.startsWith("entity.") && !s.bindingPath.startsWith("asset.")) return false;
    if (s.groupId && excludeGroupIds.has(s.groupId)) return false;
    return true;
  });
  if (bindable.length === 0) return [];

  // Bước 1: nhóm theo groupId nếu có
  const byGroup = new Map<string, Slot[]>();
  const noGroup: Slot[] = [];
  for (const s of bindable) {
    if (s.groupId) {
      const arr = byGroup.get(s.groupId) ?? [];
      arr.push(s);
      byGroup.set(s.groupId, arr);
    } else {
      noGroup.push(s);
    }
  }

  // Bước 2: với slot không group, tự cluster theo gap dọc (Y)
  // Heuristic: sort theo Y, gap > medianHeight * 0.6 = ranh giới row mới
  if (noGroup.length > 0) {
    const sorted = noGroup.slice().sort((a, b) => a.y - b.y || a.x - b.x);
    const heights = sorted.map((s) => s.height).sort((a, b) => a - b);
    const medianH = heights[Math.floor(heights.length / 2)] ?? 80;
    const gapThreshold = medianH * 0.6;

    let currentRow: Slot[] = [];
    let currentBottom = -Infinity;
    let rowIdx = 0;
    for (const s of sorted) {
      if (currentRow.length === 0 || s.y - currentBottom < gapThreshold) {
        currentRow.push(s);
        currentBottom = Math.max(currentBottom, s.y + s.height);
      } else {
        if (currentRow.length > 0) {
          byGroup.set(`__autorow_${rowIdx++}`, currentRow);
        }
        currentRow = [s];
        currentBottom = s.y + s.height;
      }
    }
    if (currentRow.length > 0) {
      byGroup.set(`__autorow_${rowIdx++}`, currentRow);
    }
  }

  // Bước 3: sort cluster theo Y trên→dưới rồi X trái→phải
  const clusters = Array.from(byGroup.entries()).map(([key, ss]) => ({
    key,
    slots: ss,
    minY: Math.min(...ss.map((s) => s.y)),
    minX: Math.min(...ss.map((s) => s.x)),
  }));
  clusters.sort((a, b) => a.minY - b.minY || a.minX - b.minX);

  return clusters.map((c) => ({ key: c.key, slots: c.slots }));
}

/**
 * Expand 1 PageTemplate theo cardGroups + auto group-binding.
 *
 * Quy tắc:
 * - cardGroups cấu hình rõ ràng: clone N card, mỗi card ăn 1 entity kế tiếp trong pool.
 * - Slot có bindingPath nhưng KHÔNG nằm trong cardGroups: tự cluster theo groupId hoặc theo vị trí Y.
 *   Mỗi cluster ăn 1 entity riêng (sửa case "cả page chỉ hiện 1 quán").
 * - slot không bind / không bind entity-asset → giữ nguyên, dùng entity của page.
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
  const expanded: ExpandedSlot[] = [];
  const consumedSlotIds = new Set<string>();

  // 1) Auto-cluster: slot có bindingPath chưa thuộc cardGroups → mỗi cluster ăn 1 entity
  if (entityPool.length > 0) {
    const clusters = autoClusterSlots(template.slots, configuredGroupIds);
    for (const cluster of clusters) {
      const ent = entityPool[cursor % entityPool.length];
      const cardEntities = ent ? [ent] : [];
      for (const s of cluster.slots) {
        consumedSlotIds.add(s.slotId);
        const cloned: ExpandedSlot = {
          ...s,
          originalSlotId: s.slotId,
          cardIndex: 0,
          cardGroupId: cluster.key,
          __cardEntityId: ent?.entityId,
        };
        expanded.push(cloned);
        if (ent) entityBySlotId.set(s.slotId, ent);
      }
      cardsByGroup.set(cluster.key, cardEntities);
      cursor += 1;
    }
  }

  // 2) Slot không bị consumed và không thuộc cardGroups → giữ nguyên
  const untouched: ExpandedSlot[] = template.slots
    .filter((s) => !consumedSlotIds.has(s.slotId) && (!s.groupId || !configuredGroupIds.has(s.groupId)))
    .map((s) => ({ ...s, originalSlotId: s.slotId, cardIndex: 0 }));
  expanded.push(...untouched);

  // 3) cardGroups (Card Repeater rõ ràng): clone N card
  const sortedCardGroups = cardGroups
    .slice()
    .sort((a, b) => {
      const boxA = bboxOfGroup(template.slots, a.groupId);
      const boxB = bboxOfGroup(template.slots, b.groupId);
      if (!boxA || !boxB) return 0;
      return boxA.y - boxB.y || boxA.x - boxB.x;
    });

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
