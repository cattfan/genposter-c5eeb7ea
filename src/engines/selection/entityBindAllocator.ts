import type { Entity, RenderedItem } from "@/models";
import { buildEntityBindingTargets } from "@/engines/binding/cardRepeater";
import type { PageTemplate } from "@/models";

export interface EntityBindBatchState {
  usedEntityIds: Set<string>;
}

export interface AllocateEntityBindingsResult {
  items: RenderedItem[];
  assignedEntities: Entity[];
  warnings: string[];
}

function sortByName(entities: Entity[]): Entity[] {
  return entities.slice().sort((a, b) => a.name.localeCompare(b.name, "vi"));
}

function sortPartnersByPriority(entities: Entity[]): Entity[] {
  const buckets = new Map<number, Entity[]>();
  for (const entity of entities) {
    const priority = Number(entity.partnerPriority ?? 0);
    const bucket = buckets.get(priority) ?? [];
    bucket.push(entity);
    buckets.set(priority, bucket);
  }

  return Array.from(buckets.entries())
    .sort((a, b) => b[0] - a[0])
    .flatMap(([, bucket]) => sortByName(bucket));
}

export function buildEntityAllocationOrder(
  entities: Entity[],
  prioritizePartner: boolean,
): Entity[] {
  const partners = sortPartnersByPriority(entities.filter((entity) => entity.partnerFlag));
  const others = sortByName(entities.filter((entity) => !entity.partnerFlag));
  return prioritizePartner ? [...partners, ...others] : sortByName([...partners, ...others]);
}

function pickEntityFromList(
  candidates: Entity[],
  pageUsedIds: Set<string>,
  batchState: EntityBindBatchState,
  unusedFirst: boolean,
): Entity | undefined {
  const filtered = candidates.filter((entity) => !pageUsedIds.has(entity.entityId));
  if (unusedFirst) {
    return filtered.find((entity) => !batchState.usedEntityIds.has(entity.entityId));
  }
  return filtered[0];
}

function pickEntityByPartnerMode(params: {
  candidates: Entity[];
  pageUsedIds: Set<string>;
  batchState: EntityBindBatchState;
  partnerMode: "partner" | "non-partner" | "any";
}): Entity | undefined {
  const { candidates, pageUsedIds, batchState, partnerMode } = params;
  const pool =
    partnerMode === "partner"
      ? candidates.filter((entity) => entity.partnerFlag)
      : partnerMode === "non-partner"
        ? candidates.filter((entity) => !entity.partnerFlag)
        : candidates;

  return (
    pickEntityFromList(pool, pageUsedIds, batchState, true) ??
    pickEntityFromList(pool, pageUsedIds, batchState, false)
  );
}

export function allocateEntityBindingsForTemplate(params: {
  template: PageTemplate;
  orderedEntities: Entity[];
  pageOwner?: Entity;
  partnerQuota: number;
  prioritizePartner: boolean;
  batchState: EntityBindBatchState;
}): AllocateEntityBindingsResult {
  const { template, orderedEntities, pageOwner, partnerQuota, batchState } = params;
  const targets = buildEntityBindingTargets(template, orderedEntities);
  const warnings: string[] = [];

  if (targets.length === 0) {
    return { items: [], assignedEntities: [], warnings };
  }

  const clampedQuota = Math.max(0, Math.min(Math.floor(partnerQuota || 0), targets.length));
  const pageUsedIds = new Set<string>();
  const assignments = new Map<string, Entity | null>();
  let remainingPartnerQuota = clampedQuota;

  if (pageOwner) {
    const ownerTarget = targets.find((target) =>
      target.candidateEntities.some((entity) => entity.entityId === pageOwner.entityId),
    );
    const canAssignOwnerWithoutBreakingQuota = pageOwner.partnerFlag
      ? remainingPartnerQuota > 0
      : targets.length - 1 >= remainingPartnerQuota;

    if (ownerTarget && canAssignOwnerWithoutBreakingQuota) {
      assignments.set(ownerTarget.targetId, pageOwner);
      pageUsedIds.add(pageOwner.entityId);
      if (pageOwner.partnerFlag) remainingPartnerQuota -= 1;
    }
  }

  const unassignedTargets = () => targets.filter((target) => !assignments.has(target.targetId));

  while (unassignedTargets().length > 0) {
    const remainingTargets = unassignedTargets();
    const target = remainingTargets[0];

    let chosen = pickEntityByPartnerMode({
      candidates: target.candidateEntities,
      pageUsedIds,
      batchState,
      partnerMode: remainingPartnerQuota > 0 ? "partner" : "any",
    });

    if (!chosen && remainingPartnerQuota > 0) {
      warnings.push(
        `Page "${template.name}": khong du doi tac de dat quota ${clampedQuota}/trang.`,
      );
      chosen = pickEntityByPartnerMode({
        candidates: target.candidateEntities,
        pageUsedIds,
        batchState,
        partnerMode: "any",
      });
    }

    if (!chosen) {
      warnings.push(
        `Page "${template.name}": khong du entity de gan du lieu.`,
      );
      assignments.set(target.targetId, null);
      continue;
    }

    assignments.set(target.targetId, chosen);
    pageUsedIds.add(chosen.entityId);
    if (chosen.partnerFlag && remainingPartnerQuota > 0) {
      remainingPartnerQuota -= 1;
    }
  }

  const items: RenderedItem[] = [];
  const assignedEntities: Entity[] = [];

  for (const target of targets) {
    const entity = assignments.get(target.targetId);
    if (!entity) continue;

    assignedEntities.push(entity);
    for (const slotId of target.slotIds) {
      items.push({
        slotId,
        entityId: entity.entityId,
        partnerFlag: entity.partnerFlag,
        partnerPriority: entity.partnerPriority,
        reasonCodes: [`entity_bind:${target.targetId}`],
      });
    }
  }

  for (const entityId of pageUsedIds) {
    batchState.usedEntityIds.add(entityId);
  }

  return { items, assignedEntities, warnings };
}
