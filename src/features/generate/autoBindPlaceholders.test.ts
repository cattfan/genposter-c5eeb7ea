import { describe, expect, it } from "vitest";
import type { PageTemplate, Slot } from "@/models";
import { autoBindPlaceholders, autoBindPlaceholdersForDrafts } from "./autoBindPlaceholders";

function makeSlot(partial: Partial<Slot> & { slotId: string; kind: Slot["kind"] }): Slot {
  return {
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

describe("autoBindPlaceholders", () => {
  it("binds {{name_0}} to entity.name", () => {
    const tpl = makeTemplate([
      makeSlot({ slotId: "s1", kind: "text", staticText: "{{name_0}}" }),
    ]);
    const result = autoBindPlaceholders(tpl);
    expect(result.changedSlotIds).toEqual(["s1"]);
    expect(result.template.slots[0].bindingPath).toBe("entity.name");
    // staticText giữ nguyên (làm fallback)
    expect(result.template.slots[0].staticText).toBe("{{name_0}}");
  });

  it("binds bare {{address}} (no index suffix)", () => {
    const tpl = makeTemplate([
      makeSlot({ slotId: "s1", kind: "text", staticText: "{{address}}" }),
    ]);
    const result = autoBindPlaceholders(tpl);
    expect(result.template.slots[0].bindingPath).toBe("entity.address");
  });

  it("binds {{phone_2}} to entity.phone", () => {
    const tpl = makeTemplate([
      makeSlot({ slotId: "s1", kind: "text", staticText: "  {{ phone_2 }}  " }),
    ]);
    const result = autoBindPlaceholders(tpl);
    expect(result.template.slots[0].bindingPath).toBe("entity.phone");
  });

  it("binds {{signature_dish_0}} to entity.metadata.signatureDish", () => {
    const tpl = makeTemplate([
      makeSlot({ slotId: "s1", kind: "text", staticText: "{{signature_dish_0}}" }),
    ]);
    const result = autoBindPlaceholders(tpl);
    expect(result.template.slots[0].bindingPath).toBe("entity.metadata.signatureDish");
  });

  it("does not bind unknown tokens", () => {
    const tpl = makeTemplate([
      makeSlot({ slotId: "s1", kind: "text", staticText: "{{unknown_token}}" }),
    ]);
    const result = autoBindPlaceholders(tpl);
    expect(result.changedSlotIds).toEqual([]);
    expect(result.template).toBe(tpl);
    expect(result.template.slots[0].bindingPath).toBeUndefined();
  });

  it("does not bind eyebrow/cta/text/section_title (no entity field)", () => {
    const tpl = makeTemplate([
      makeSlot({ slotId: "s1", kind: "text", staticText: "{{eyebrow}}" }),
      makeSlot({ slotId: "s2", kind: "text", staticText: "{{cta}}" }),
      makeSlot({ slotId: "s3", kind: "text", staticText: "{{text}}" }),
      makeSlot({ slotId: "s4", kind: "text", staticText: "{{section_title_1}}" }),
    ]);
    const result = autoBindPlaceholders(tpl);
    expect(result.changedSlotIds).toEqual([]);
  });

  it("does not overwrite an existing bindingPath", () => {
    const tpl = makeTemplate([
      makeSlot({
        slotId: "s1",
        kind: "text",
        staticText: "{{name_0}}",
        bindingPath: "entity.compose:custom",
      }),
    ]);
    const result = autoBindPlaceholders(tpl);
    expect(result.changedSlotIds).toEqual([]);
    expect(result.template.slots[0].bindingPath).toBe("entity.compose:custom");
  });

  it("ignores slots without staticText", () => {
    const tpl = makeTemplate([makeSlot({ slotId: "s1", kind: "text" })]);
    const result = autoBindPlaceholders(tpl);
    expect(result.changedSlotIds).toEqual([]);
  });

  it("ignores image slots", () => {
    const tpl = makeTemplate([
      makeSlot({ slotId: "s1", kind: "image", staticText: "{{name_0}}" }),
    ]);
    const result = autoBindPlaceholders(tpl);
    expect(result.changedSlotIds).toEqual([]);
  });

  it("does not match strings containing extra text around the placeholder", () => {
    const tpl = makeTemplate([
      makeSlot({ slotId: "s1", kind: "text", staticText: "Tên: {{name_0}}" }),
    ]);
    const result = autoBindPlaceholders(tpl);
    expect(result.changedSlotIds).toEqual([]);
  });

  it("returns same reference when no slot changes", () => {
    const tpl = makeTemplate([makeSlot({ slotId: "s1", kind: "text", staticText: "Hello" })]);
    const result = autoBindPlaceholders(tpl);
    expect(result.template).toBe(tpl);
  });

  it("autoBindPlaceholdersForDrafts aggregates changes across templates", () => {
    const drafts = {
      a: makeTemplate([makeSlot({ slotId: "s1", kind: "text", staticText: "{{name_0}}" })]),
      b: makeTemplate([
        makeSlot({ slotId: "s1", kind: "text", staticText: "{{address_0}}" }),
        makeSlot({ slotId: "s2", kind: "text", staticText: "{{phone_0}}" }),
      ]),
      c: makeTemplate([makeSlot({ slotId: "s1", kind: "text", staticText: "{{eyebrow}}" })]),
    };
    const { drafts: next, totalChanged } = autoBindPlaceholdersForDrafts(drafts);
    expect(totalChanged).toBe(3);
    expect(next.a.slots[0].bindingPath).toBe("entity.name");
    expect(next.b.slots[0].bindingPath).toBe("entity.address");
    expect(next.b.slots[1].bindingPath).toBe("entity.phone");
    // c không đổi -> giữ nguyên reference
    expect(next.c).toBe(drafts.c);
  });
});
