import { describe, expect, it } from "vitest";
import type { Entity, PageTemplate, Slot } from "@/models";
import { buildMappingOverview, resolveSlotEntityFieldPath } from "./mappingOverview.utils";

function makeSlot(partial: Partial<Slot> & { slotId: string }): Slot {
  return {
    kind: "text",
    x: 0,
    y: 0,
    width: 100,
    height: 40,
    ...partial,
  } as Slot;
}

function makeTemplate(slots: Slot[]): PageTemplate {
  return {
    pageTemplateId: "tpl-1",
    name: "test",
    type: "cover",
    canvas: { width: 1080, height: 1080 },
    slots,
    sections: [],
    createdAt: 0,
    updatedAt: 0,
  };
}

function makeEntity(overrides: Partial<Entity> = {}): Entity {
  return {
    entityId: `e-${Math.random().toString(36).slice(2, 8)}`,
    name: "Quán A",
    address: "1 Yersin",
    partnerFlag: false,
    partnerPriority: 0,
    partnerType: "none",
    campaignTags: [],
    seoKeywords: [],
    status: "active",
    ...overrides,
  } as Entity;
}

describe("resolveSlotEntityFieldPath", () => {
  it("returns null for unbound slots", () => {
    expect(resolveSlotEntityFieldPath(makeSlot({ slotId: "s1" }))).toBeNull();
  });

  it("returns null for ai.rewrite and asset.* bindings", () => {
    expect(
      resolveSlotEntityFieldPath(makeSlot({ slotId: "s1", bindingPath: "ai.rewrite" })),
    ).toBeNull();
    expect(
      resolveSlotEntityFieldPath(makeSlot({ slotId: "s1", bindingPath: "asset.cover" })),
    ).toBeNull();
    expect(
      resolveSlotEntityFieldPath(
        makeSlot({ slotId: "s1", bindingPath: "asset.random" }),
      ),
    ).toBeNull();
  });

  it("returns base path for entity bindings", () => {
    expect(
      resolveSlotEntityFieldPath(makeSlot({ slotId: "s1", bindingPath: "entity.name" })),
    ).toBe("entity.name");
    expect(
      resolveSlotEntityFieldPath(
        makeSlot({ slotId: "s1", bindingPath: "entity.metadata.signatureDish" }),
      ),
    ).toBe("entity.metadata.signatureDish");
  });

  it("returns null for entity.list/compose (multi-field)", () => {
    expect(
      resolveSlotEntityFieldPath(
        makeSlot({ slotId: "s1", bindingPath: "entity.list:abc" }),
      ),
    ).toBeNull();
  });
});

describe("buildMappingOverview", () => {
  it("returns empty when template is undefined", () => {
    const result = buildMappingOverview(undefined, []);
    expect(result.rows).toEqual([]);
    expect(result.fieldsWithData).toBe(0);
    expect(result.fieldsBound).toBe(0);
  });

  it("counts data fields based on entitiesInSheet", () => {
    const template = makeTemplate([makeSlot({ slotId: "s1" })]);
    const entities = [
      makeEntity({ name: "Quán A", address: "1 Yersin", phone: undefined }),
      makeEntity({ name: "Quán B", address: "2 Hùng Vương", phone: "" }),
    ];
    const result = buildMappingOverview(template, entities);
    const nameRow = result.rows.find((row) => row.field.id === "name");
    const phoneRow = result.rows.find((row) => row.field.id === "phone");
    const addressRow = result.rows.find((row) => row.field.id === "address");
    expect(nameRow?.hasDataInSheet).toBe(true);
    expect(addressRow?.hasDataInSheet).toBe(true);
    expect(phoneRow?.hasDataInSheet).toBe(false);
  });

  it("identifies bound slots by binding path", () => {
    const template = makeTemplate([
      makeSlot({ slotId: "s1", name: "Tên quán", bindingPath: "entity.name" }),
      makeSlot({ slotId: "s2", name: "ĐC", bindingPath: "entity.address" }),
      makeSlot({ slotId: "s3", name: "Bind list", bindingPath: "entity.list:abc" }),
    ]);
    const entities = [makeEntity({ name: "Q", address: "Đà Lạt" })];
    const result = buildMappingOverview(template, entities);
    expect(
      result.rows.find((row) => row.field.id === "name")?.boundSlots.map((slot) => slot.slotId),
    ).toEqual(["s1"]);
    expect(
      result.rows.find((row) => row.field.id === "address")?.boundSlots.map((slot) => slot.slotId),
    ).toEqual(["s2"]);
  });

  it("identifies placeholder slots that are not yet bound", () => {
    const template = makeTemplate([
      makeSlot({ slotId: "s1", staticText: "{{name_0}}" }),
      makeSlot({ slotId: "s2", staticText: "{{address_0}}", bindingPath: "entity.address" }),
    ]);
    const entities = [makeEntity({ name: "A", address: "ĐC" })];
    const result = buildMappingOverview(template, entities);
    const nameRow = result.rows.find((row) => row.field.id === "name");
    const addressRow = result.rows.find((row) => row.field.id === "address");
    expect(nameRow?.placeholderSlots.map((slot) => slot.slotId)).toEqual(["s1"]);
    expect(nameRow?.boundSlots).toEqual([]);
    // Address: bị bind, không nằm trong placeholderSlots dù staticText khớp
    expect(addressRow?.placeholderSlots).toEqual([]);
    expect(addressRow?.boundSlots.map((slot) => slot.slotId)).toEqual(["s2"]);
    expect(result.hasUnboundPlaceholders).toBe(true);
  });

  it("counts fieldsWithData / fieldsBound and reports completion", () => {
    const template = makeTemplate([
      makeSlot({ slotId: "s1", bindingPath: "entity.name" }),
      makeSlot({ slotId: "s2", bindingPath: "entity.address" }),
    ]);
    const entities = [
      makeEntity({ name: "A", address: "ĐC", phone: "0900" }),
    ];
    const result = buildMappingOverview(template, entities);
    expect(result.fieldsBound).toBe(2);
    // name + address + phone đều có data
    expect(result.fieldsWithData).toBeGreaterThanOrEqual(3);
    // Phone có data nhưng chưa bind -> chưa hoàn thành
    expect(result.fieldsBound).toBeLessThan(result.fieldsWithData);
  });

  it("uses metadata for storedInMetadata fields", () => {
    const template = makeTemplate([
      makeSlot({ slotId: "s1", bindingPath: "entity.metadata.signatureDish" }),
    ]);
    const entities = [
      makeEntity({ name: "A", metadata: { signatureDish: "Bánh tráng" } }),
    ];
    const result = buildMappingOverview(template, entities);
    const row = result.rows.find((row) => row.field.id === "signatureDish");
    expect(row?.hasDataInSheet).toBe(true);
    expect(row?.boundSlots.map((slot) => slot.slotId)).toEqual(["s1"]);
  });
});
