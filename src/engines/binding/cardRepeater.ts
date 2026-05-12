// Card Repeater: mở rộng các slot có groupId được khai báo trong PageTemplate.cardGroups
// thành N "card" — mỗi card là 1 bản clone offset, gán cho 1 entity trong pool.

import type { CardGroupConfig, Entity, PageTemplate, Slot } from "@/models";

export interface ExpandedSlot extends Slot {
  /** Slot gốc trong template (id không đổi cho card index 0). */
  originalSlotId: string;
  /** Thứ tự render ổn định để giữ layering khi slot được expand. */
  renderOrder: number;
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

export interface EntityBindingTarget {
  targetId: string;
  slotIds: string[];
  candidateEntities: Entity[];
}

function slotSourceValue(value: string | undefined): string | undefined {
  if (!value || value === "__all__") return undefined;
  return value;
}

function entityMatchesSlotSource(entity: Entity, slot: Slot): boolean {
  const config = slot.dataSourceConfig;
  if (!config) return true;
  const selectedSheet = slotSourceValue(config.selectedSheet);
  const filterMoHinh = slotSourceValue(config.filterMoHinh);
  const filterPhongCach = slotSourceValue(config.filterPhongCach);
  if (selectedSheet && entity.sheetName !== selectedSheet) return false;
  if (filterMoHinh && entity.categoryMain !== filterMoHinh) return false;
  if (filterPhongCach && entity.categorySub !== filterPhongCach) return false;
  return true;
}

function filterPoolForSlots(pool: Entity[], slots: Slot[]): Entity[] {
  const scopedSlots = slots.filter((slot) => slot.dataSourceConfig);
  if (scopedSlots.length === 0) return pool;
  let next = pool;
  for (const slot of scopedSlots) {
    next = next.filter((entity) => entityMatchesSlotSource(entity, slot));
  }
  return next;
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
function bboxOfGroup(
  slots: Slot[],
  groupId: string,
): { x: number; y: number; w: number; h: number } | null {
  const items = slots.filter((s) => s.groupId === groupId);
  if (items.length === 0) return null;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const s of items) {
    minX = Math.min(minX, s.x);
    minY = Math.min(minY, s.y);
    maxX = Math.max(maxX, s.x + s.width);
    maxY = Math.max(maxY, s.y + s.height);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function normalizeSlotToken(value: string | undefined): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0111/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function semanticItemIndexFromSlot(slot: Slot): number | undefined {
  const source = normalizeSlotToken(
    [slot.name, slot.staticText, slot.bindingPath].filter(Boolean).join(" "),
  );
  const structuralMatch = source.match(
    /(?:^|_)(?:list_line|line|row|item|text|composite|block)_(\d+)(?:_|$)/,
  );
  if (structuralMatch) {
    const index = Number(structuralMatch[1]);
    if (Number.isFinite(index) && index > 0) return index;
  }
  const match = source.match(
    /(?:^|_)(?:name|ten|ten_quan|title|address|dia_chi|phone|sdt|hotline|price|gia|openinghours|opening_hours|hours|gio_mo_cua|category|categorymain|category_main|mo_hinh|categorysub|category_sub|subcategory|phong_cach|style|signaturedish|signature_dish|mon_an_noi_bat|mon_noi_bat|description|desc|mo_ta|image|hero_image)_(\d+)(?:_|$)/,
  );
  if (!match) return undefined;
  const index = Number(match[1]);
  return Number.isFinite(index) && index > 0 ? index : undefined;
}

function isEntityDataBinding(slot: Slot): boolean {
  const path = slot.bindingPath;
  return (
    !!path &&
    path.startsWith("entity.") &&
    !path.startsWith("entity.list:") &&
    !path.startsWith("entity.compose:")
  );
}

function canonicalEntityBindingPath(slot: Slot): string | undefined {
  if (!isEntityDataBinding(slot)) return undefined;
  return slot.bindingPath?.trim().toLowerCase();
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function splitClusterByRepeatedEntityRows(
  key: string,
  slots: Slot[],
): Array<{ key: string; slots: Slot[] }> {
  const entitySlots = slots.filter(isEntityDataBinding);
  if (entitySlots.length <= 1) return [{ key, slots }];

  const counts = new Map<string, number>();
  for (const slot of entitySlots) {
    const path = canonicalEntityBindingPath(slot);
    if (!path) continue;
    counts.set(path, (counts.get(path) ?? 0) + 1);
  }

  const hasRepeatedField = Array.from(counts.values()).some((count) => count > 1);
  if (!hasRepeatedField) return [{ key, slots }];

  const medianHeight = median(entitySlots.map((slot) => Math.max(1, slot.height)));
  const rowThreshold = Math.max(8, medianHeight * 0.35);
  const sorted = slots.slice().sort((a, b) => {
    const centerA = a.y + a.height / 2;
    const centerB = b.y + b.height / 2;
    return centerA - centerB || a.x - b.x;
  });
  const rows: Array<{ centerY: number; slots: Slot[] }> = [];

  for (const slot of sorted) {
    const centerY = slot.y + slot.height / 2;
    const row = rows.find((item) => Math.abs(item.centerY - centerY) <= rowThreshold);
    if (row) {
      row.slots.push(slot);
      row.centerY =
        row.slots.reduce((sum, item) => sum + item.y + item.height / 2, 0) / row.slots.length;
    } else {
      rows.push({ centerY, slots: [slot] });
    }
  }

  if (rows.length <= 1) return [{ key, slots }];

  return rows.map((row, index) => ({
    key: `${key}__row_${index}`,
    slots: row.slots.sort((a, b) => a.x - b.x || a.y - b.y),
  }));
}

function splitClusterByRepeatedAnchors(
  key: string,
  slots: Slot[],
): Array<{ key: string; slots: Slot[] }> {
  const entitySlots = slots.filter(isEntityDataBinding);
  if (entitySlots.length <= 1) return [{ key, slots }];

  const counts = new Map<string, number>();
  for (const slot of entitySlots) {
    const path = canonicalEntityBindingPath(slot);
    if (!path) continue;
    counts.set(path, (counts.get(path) ?? 0) + 1);
  }

  const anchorPath =
    Array.from(counts.entries())
      .filter(([, count]) => count > 1)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? undefined;
  if (!anchorPath) return [{ key, slots }];

  const anchors = entitySlots
    .filter((slot) => canonicalEntityBindingPath(slot) === anchorPath)
    .sort((a, b) => a.y - b.y || a.x - b.x);
  if (anchors.length <= 1) return [{ key, slots }];

  const out = anchors.map((anchor, index) => ({
    key: `${key}__anchor_${index}`,
    anchor,
    slots: [] as Slot[],
  }));

  for (const slot of slots) {
    let best = out[0];
    let bestDistance = Infinity;
    for (const cluster of out) {
      const dy = Math.abs(slot.y + slot.height / 2 - (cluster.anchor.y + cluster.anchor.height / 2));
      const dx = Math.abs(slot.x + slot.width / 2 - (cluster.anchor.x + cluster.anchor.width / 2));
      const distance = dy * 3 + dx;
      if (distance < bestDistance) {
        best = cluster;
        bestDistance = distance;
      }
    }
    best.slots.push(slot);
  }

  return out.map((cluster) => ({
    key: cluster.key,
    slots: cluster.slots.sort((a, b) => a.y - b.y || a.x - b.x),
  }));
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
  const clusterAlongAxis = (
    items: Slot[],
    axis: "x" | "y",
    prefix: string,
  ): Array<{ key: string; slots: Slot[] }> => {
    if (items.length === 0) return [];
    const sorted = items.slice().sort((a, b) => {
      const primary = axis === "y" ? a.y - b.y : a.x - b.x;
      if (primary !== 0) return primary;
      return axis === "y" ? a.x - b.x : a.y - b.y;
    });
    const sizes = sorted.map((s) => (axis === "y" ? s.height : s.width)).sort((a, b) => a - b);
    const medianSize = sizes[Math.floor(sizes.length / 2)] ?? 80;
    const gapThreshold = medianSize * 0.6;

    const out: Array<{ key: string; slots: Slot[] }> = [];
    let current: Slot[] = [];
    let currentEnd = -Infinity;
    let idx = 0;

    for (const s of sorted) {
      const start = axis === "y" ? s.y : s.x;
      const end = axis === "y" ? s.y + s.height : s.x + s.width;
      if (current.length === 0 || start - currentEnd < gapThreshold) {
        current.push(s);
        currentEnd = Math.max(currentEnd, end);
      } else {
        out.push({ key: `${prefix}_${idx++}`, slots: current });
        current = [s];
        currentEnd = end;
      }
    }

    if (current.length > 0) {
      out.push({ key: `${prefix}_${idx++}`, slots: current });
    }

    return out;
  };

  const splitSpatiallyByAxis = (
    items: Slot[],
    prefix: string,
  ): Array<{ key: string; slots: Slot[] }> => {
    if (items.length <= 1) return [{ key: prefix, slots: items }];
    const bbox = bboxOfGroup(items, items[0]?.groupId ?? "") ?? {
      x: Math.min(...items.map((s) => s.x)),
      y: Math.min(...items.map((s) => s.y)),
      w: Math.max(...items.map((s) => s.x + s.width)) - Math.min(...items.map((s) => s.x)),
      h: Math.max(...items.map((s) => s.y + s.height)) - Math.min(...items.map((s) => s.y)),
    };
    const vertical = clusterAlongAxis(items, "y", `${prefix}__row`);
    const horizontal = clusterAlongAxis(items, "x", `${prefix}__col`);
    if (vertical.length <= 1 && horizontal.length <= 1) return [{ key: prefix, slots: items }];
    if (vertical.length > 1 && horizontal.length <= 1) return vertical;
    if (horizontal.length > 1 && vertical.length <= 1) return horizontal;
    return bbox.h >= bbox.w ? vertical : horizontal;
  };

  const splitSpatially = (items: Slot[], prefix: string): Array<{ key: string; slots: Slot[] }> => {
    if (items.length <= 1) return [{ key: prefix, slots: items }];

    const indexed = new Map<number, Slot[]>();
    const unindexed: Slot[] = [];
    for (const item of items) {
      const itemIndex = semanticItemIndexFromSlot(item);
      if (itemIndex == null) {
        unindexed.push(item);
        continue;
      }
      const bucket = indexed.get(itemIndex) ?? [];
      bucket.push(item);
      indexed.set(itemIndex, bucket);
    }

    if (indexed.size > 0) {
      const out: Array<{ key: string; slots: Slot[] }> = [];
      for (const [itemIndex, bucket] of Array.from(indexed.entries()).sort((a, b) => a[0] - b[0])) {
        out.push({ key: `${prefix}__item_${itemIndex}`, slots: bucket });
      }
      if (unindexed.length > 0) {
        out.push(...splitSpatiallyByAxis(unindexed, `${prefix}__free`));
      }
      return out;
    }

    return splitSpatiallyByAxis(items, prefix);
  };

  const bindable = slots.filter((s) => {
    if (!s.bindingPath) return false;
    if (s.bindingPath.startsWith("entity.list:")) return false;
    if (!s.bindingPath.startsWith("entity.") && !s.bindingPath.startsWith("asset.")) return false;
    if (s.groupId && excludeGroupIds.has(s.groupId)) return false;
    return true;
  });
  if (bindable.length === 0) return [];

  const explicitDataGroups = new Map<string, Slot[]>();
  const explicitDataGroupSlotIds = new Set<string>();
  for (const slot of bindable) {
    if (!slot.dataGroupId) continue;
    const groupSlots = explicitDataGroups.get(slot.dataGroupId) ?? [];
    groupSlots.push(slot);
    explicitDataGroups.set(slot.dataGroupId, groupSlots);
    explicitDataGroupSlotIds.add(slot.slotId);
  }
  const explicitClusters = Array.from(explicitDataGroups.entries()).flatMap(
    ([groupId, groupSlots]) =>
      splitSpatially(groupSlots, `dataGroup:${groupId}`).flatMap((cluster) =>
        splitClusterByRepeatedEntityRows(cluster.key, cluster.slots).flatMap((rowCluster) =>
          splitClusterByRepeatedAnchors(rowCluster.key, rowCluster.slots),
        ),
      ),
  );
  const autoBindable = bindable.filter((slot) => !explicitDataGroupSlotIds.has(slot.slotId));

  // Bước 1: nhóm theo groupId nếu có
  const byGroup = new Map<string, Slot[]>();
  const noGroup: Slot[] = [];
  for (const s of autoBindable) {
    if (s.groupId) {
      const arr = byGroup.get(s.groupId) ?? [];
      arr.push(s);
      byGroup.set(s.groupId, arr);
    } else {
      noGroup.push(s);
    }
  }

  const groupedClusters = new Map<string, Slot[]>();
  for (const [groupId, groupSlots] of byGroup.entries()) {
    const splits = splitSpatially(groupSlots, groupId);
    for (const split of splits) {
      for (const rowCluster of splitClusterByRepeatedEntityRows(split.key, split.slots)) {
        for (const anchorCluster of splitClusterByRepeatedAnchors(
          rowCluster.key,
          rowCluster.slots,
        )) {
          groupedClusters.set(anchorCluster.key, anchorCluster.slots);
        }
      }
    }
  }
  byGroup.clear();
  for (const [key, value] of groupedClusters.entries()) {
    byGroup.set(key, value);
  }

  // Bước 2: với slot không group, tự cluster theo gap dọc (Y)
  // Heuristic: sort theo Y, gap > medianHeight * 0.6 = ranh giới row mới
  if (noGroup.length > 0) {
    const splits = splitSpatially(noGroup, "__auto");
    for (const split of splits) {
      for (const rowCluster of splitClusterByRepeatedEntityRows(split.key, split.slots)) {
        for (const anchorCluster of splitClusterByRepeatedAnchors(
          rowCluster.key,
          rowCluster.slots,
        )) {
          byGroup.set(anchorCluster.key, anchorCluster.slots);
        }
      }
    }
  }

  // Bước 3: sort cluster theo Y trên→dưới rồi X trái→phải
  const entityRowClusters = new Map<string, Slot[]>();
  for (const [key, value] of byGroup.entries()) {
    for (const split of splitClusterByRepeatedEntityRows(key, value)) {
      entityRowClusters.set(split.key, split.slots);
    }
  }
  byGroup.clear();
  for (const [key, value] of entityRowClusters.entries()) {
    byGroup.set(key, value);
  }

  // Bước 4: dọn cluster cuối — nếu vẫn còn >=2 slot cùng canonical path trong
  // cùng cluster (ví dụ 2 "entity.name" đứng gần nhau), force-split bằng anchor.
  const finalClusters = new Map<string, Slot[]>();
  for (const [key, value] of byGroup.entries()) {
    const anchorSplits = splitClusterByRepeatedAnchors(key, value);
    if (anchorSplits.length > 1) {
      for (const split of anchorSplits) finalClusters.set(split.key, split.slots);
    } else {
      finalClusters.set(key, value);
    }
  }
  byGroup.clear();
  for (const [key, value] of finalClusters.entries()) {
    byGroup.set(key, value);
  }

  const clusters = [
    ...explicitClusters,
    ...Array.from(byGroup.entries()).map(([key, slots]) => ({ key, slots })),
  ].map(({ key, slots: ss }) => ({
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
  const originalOrder = new Map(template.slots.map((slot, index) => [slot.slotId, index]));
  const orderOf = (slotId: string, cardIndex = 0) =>
    (originalOrder.get(slotId) ?? 0) + cardIndex * template.slots.length;
  const entityBySlotId = new Map<string, Entity>();
  const cardsByGroup = new Map<string, Entity[]>();

  if (cardGroups.length === 0 && entityPool.length === 0) {
    return {
      slots: template.slots.map((s) => ({
        ...s,
        originalSlotId: s.slotId,
        renderOrder: orderOf(s.slotId),
        cardIndex: 0,
      })),
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
          renderOrder: orderOf(s.slotId),
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
    .filter(
      (s) => !consumedSlotIds.has(s.slotId) && (!s.groupId || !configuredGroupIds.has(s.groupId)),
    )
    .map((s) => ({
      ...s,
      originalSlotId: s.slotId,
      renderOrder: orderOf(s.slotId),
      cardIndex: 0,
    }));
  expanded.push(...untouched);

  // 3) cardGroups (Card Repeater rõ ràng): clone N card
  const sortedCardGroups = cardGroups.slice().sort((a, b) => {
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
          renderOrder: orderOf(s.slotId, i),
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

export function buildEntityBindingTargets(
  template: PageTemplate,
  entityPool: Entity[],
): EntityBindingTarget[] {
  const cardGroups = template.cardGroups ?? [];
  const configuredGroupIds = new Set(cardGroups.map((group) => group.groupId));
  const targets: EntityBindingTarget[] = [];

  const clusters = autoClusterSlots(template.slots, configuredGroupIds);
  for (const cluster of clusters) {
    targets.push({
      targetId: cluster.key,
      slotIds: cluster.slots.map((slot) => slot.slotId),
      candidateEntities: filterPoolForSlots(entityPool, cluster.slots),
    });
  }

  const sortedCardGroups = cardGroups.slice().sort((a, b) => {
    const boxA = bboxOfGroup(template.slots, a.groupId);
    const boxB = bboxOfGroup(template.slots, b.groupId);
    if (!boxA || !boxB) return 0;
    return boxA.y - boxB.y || boxA.x - boxB.x;
  });

  for (const group of sortedCardGroups) {
    const groupSlots = template.slots.filter((slot) => slot.groupId === group.groupId);
    const pool = filterPool(entityPool, group);
    const repeat = Math.max(1, Math.floor(group.repeatCount));

    for (let cardIndex = 0; cardIndex < repeat; cardIndex += 1) {
      targets.push({
        targetId: `${group.groupId}__card_${cardIndex}`,
        slotIds: groupSlots.map((slot) =>
          cardIndex === 0 ? slot.slotId : `${slot.slotId}__c${cardIndex}`,
        ),
        candidateEntities: filterPoolForSlots(pool, groupSlots),
      });
    }
  }

  return targets;
}
