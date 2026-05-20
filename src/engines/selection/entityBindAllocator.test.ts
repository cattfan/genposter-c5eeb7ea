import { describe, expect, it } from "vitest";
import type { Entity, PageTemplate } from "@/models";
import { allocateEntityBindingsForTemplate } from "@/engines/selection/entityBindAllocator";
import { buildEntityBindingTargets } from "@/engines/binding/cardRepeater";

const baseEntity = {
  partnerFlag: false,
  partnerPriority: 0,
  partnerType: "none",
  campaignTags: [],
  seoKeywords: [],
  status: "active",
  sheetName: "Quan_an",
} satisfies Omit<Entity, "entityId" | "name" | "address">;

function entity(entityId: string, name: string, address: string): Entity {
  return {
    ...baseEntity,
    entityId,
    name,
    address,
  };
}

const template = {
  pageTemplateId: "tpl",
  name: "Trang test",
  type: "mixed",
  canvas: { width: 1080, height: 1080 },
  sections: [],
  createdAt: 1,
  updatedAt: 1,
  slots: [
    {
      slotId: "name-1",
      kind: "text",
      x: 0,
      y: 0,
      width: 100,
      height: 30,
      bindingPath: "entity.name",
      dataGroupId: "group-1",
    },
    {
      slotId: "address-1",
      kind: "text",
      x: 0,
      y: 35,
      width: 100,
      height: 30,
      bindingPath: "entity.address",
      dataGroupId: "group-1",
    },
    {
      slotId: "name-2",
      kind: "text",
      x: 0,
      y: 120,
      width: 100,
      height: 30,
      bindingPath: "entity.name",
      dataGroupId: "group-2",
    },
    {
      slotId: "address-2",
      kind: "text",
      x: 0,
      y: 155,
      width: 100,
      height: 30,
      bindingPath: "entity.address",
      dataGroupId: "group-2",
    },
  ],
} satisfies PageTemplate;

const threeGroupTemplate = {
  ...template,
  slots: [
    ...template.slots,
    {
      slotId: "name-3",
      kind: "text",
      x: 0,
      y: 240,
      width: 100,
      height: 30,
      bindingPath: "entity.name",
      dataGroupId: "group-3",
    },
    {
      slotId: "address-3",
      kind: "text",
      x: 0,
      y: 275,
      width: 100,
      height: 30,
      bindingPath: "entity.address",
      dataGroupId: "group-3",
    },
  ],
} satisfies PageTemplate;

describe("entityBindAllocator", () => {
  it("treats a visual group as one entity target even when slots are spatially separated", () => {
    const visualGroupTemplate = {
      ...template,
      slots: [
        {
          slotId: "image-1",
          kind: "image",
          groupId: "visual-card-1",
          x: 0,
          y: 0,
          width: 100,
          height: 40,
          bindingPath: "asset.cover",
        },
        {
          slotId: "name-1",
          kind: "text",
          groupId: "visual-card-1",
          x: 150,
          y: 0,
          width: 100,
          height: 30,
          bindingPath: "entity.name",
        },
        {
          slotId: "address-1",
          kind: "text",
          groupId: "visual-card-1",
          x: 150,
          y: 120,
          width: 100,
          height: 30,
          bindingPath: "entity.address",
        },
      ],
    } satisfies PageTemplate;

    const targets = buildEntityBindingTargets(visualGroupTemplate, [
      entity("e1", "Cafe A", "Address A"),
    ]);

    expect(targets).toHaveLength(1);
    expect(targets[0]?.targetId).toBe("visual-card-1");
    expect(new Set(targets[0]?.slotIds)).toEqual(
      new Set(["image-1", "name-1", "address-1"]),
    );
  });

  it("creates one entity target per visual group and assigns all slots in a group together", () => {
    const visualGroupsTemplate = {
      ...template,
      slots: [
        {
          slotId: "image-1",
          kind: "image",
          groupId: "visual-card-1",
          x: 0,
          y: 0,
          width: 100,
          height: 40,
          bindingPath: "asset.cover",
        },
        {
          slotId: "name-1",
          kind: "text",
          groupId: "visual-card-1",
          x: 150,
          y: 0,
          width: 100,
          height: 30,
          bindingPath: "entity.name",
        },
        {
          slotId: "address-1",
          kind: "text",
          groupId: "visual-card-1",
          x: 150,
          y: 120,
          width: 100,
          height: 30,
          bindingPath: "entity.address",
        },
        {
          slotId: "image-2",
          kind: "image",
          groupId: "visual-card-2",
          x: 0,
          y: 260,
          width: 100,
          height: 40,
          bindingPath: "asset.cover",
        },
        {
          slotId: "name-2",
          kind: "text",
          groupId: "visual-card-2",
          x: 150,
          y: 260,
          width: 100,
          height: 30,
          bindingPath: "entity.name",
        },
        {
          slotId: "address-2",
          kind: "text",
          groupId: "visual-card-2",
          x: 150,
          y: 380,
          width: 100,
          height: 30,
          bindingPath: "entity.address",
        },
      ],
    } satisfies PageTemplate;

    const e1 = entity("e1", "Cafe A", "Address A");
    const e2 = entity("e2", "Cafe B", "Address B");
    const targets = buildEntityBindingTargets(visualGroupsTemplate, [e1, e2]);
    const result = allocateEntityBindingsForTemplate({
      template: visualGroupsTemplate,
      orderedEntities: [e1, e2],
      partnerQuota: 0,
      prioritizePartner: false,
      batchState: { usedEntityIds: new Set<string>(), usedEntityKeys: new Set<string>() },
    });
    const entityBySlotId = new Map(
      result.items.map((item) => [item.slotId, item.entityId]),
    );

    expect(targets).toHaveLength(2);
    expect(targets.map((target) => target.targetId)).toEqual([
      "visual-card-1",
      "visual-card-2",
    ]);
    expect(new Set(targets[0]?.slotIds)).toEqual(
      new Set(["image-1", "name-1", "address-1"]),
    );
    expect(new Set(targets[1]?.slotIds)).toEqual(
      new Set(["image-2", "name-2", "address-2"]),
    );
    expect(entityBySlotId.get("image-1")).toBe("e1");
    expect(entityBySlotId.get("name-1")).toBe("e1");
    expect(entityBySlotId.get("address-1")).toBe("e1");
    expect(entityBySlotId.get("image-2")).toBe("e2");
    expect(entityBySlotId.get("name-2")).toBe("e2");
    expect(entityBySlotId.get("address-2")).toBe("e2");
  });

  it("keeps spatial heuristic splitting for ungrouped slots", () => {
    const ungroupedTemplate = {
      ...template,
      slots: [
        {
          slotId: "name-1",
          kind: "text",
          x: 0,
          y: 0,
          width: 100,
          height: 30,
          bindingPath: "entity.name",
        },
        {
          slotId: "name-2",
          kind: "text",
          x: 0,
          y: 120,
          width: 100,
          height: 30,
          bindingPath: "entity.name",
        },
      ],
    } satisfies PageTemplate;

    const targets = buildEntityBindingTargets(ungroupedTemplate, [
      entity("e1", "Cafe A", "Address A"),
      entity("e2", "Cafe B", "Address B"),
    ]);

    expect(targets).toHaveLength(2);
    expect(targets.map((target) => target.slotIds)).toEqual([["name-1"], ["name-2"]]);
  });

  it("does not assign the same venue name to multiple groups on one page", () => {
    const duplicateA = entity("e1", "Tiệm nướng Hoàng Hôn", "Hẻm 118 Đồi Dã Chiến");
    const duplicateB = entity("e2", "Tiem nuong Hoang Hon", "Đường Hoa Cẩm Tú Cầu");
    const unique = entity("e3", "Tiệm nướng Xóm Lèo", "60 Lý Tự Trọng");

    const result = allocateEntityBindingsForTemplate({
      template,
      orderedEntities: [duplicateA, duplicateB, unique],
      partnerQuota: 0,
      prioritizePartner: false,
      batchState: { usedEntityIds: new Set<string>(), usedEntityKeys: new Set<string>() },
    });

    expect(result.assignedEntities.map((item) => item.entityId)).toEqual(["e1", "e3"]);
  });

  it("leaves later groups unassigned instead of repeating a venue in the same bundle", () => {
    const duplicateA = entity("e1", "Tiệm nướng Hoàng Hôn", "Hẻm 118 Đồi Dã Chiến");
    const duplicateB = entity("e2", "Tiem nuong Hoang Hon", "Đường Hoa Cẩm Tú Cầu");
    const unique = entity("e3", "Tiệm nướng Xóm Lèo", "60 Lý Tự Trọng");

    const result = allocateEntityBindingsForTemplate({
      template: threeGroupTemplate,
      orderedEntities: [duplicateA, duplicateB, unique],
      partnerQuota: 0,
      prioritizePartner: false,
      batchState: { usedEntityIds: new Set<string>(), usedEntityKeys: new Set<string>() },
    });

    expect(result.assignedEntities.map((item) => item.entityId)).toEqual(["e1", "e3"]);
    expect(result.warnings).toContain('Page "Trang test": khong du entity de gan du lieu.');
  });
});
