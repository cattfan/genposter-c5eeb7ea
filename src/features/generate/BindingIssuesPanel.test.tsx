import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Entity, PageTemplate, Slot } from "@/models";
import { BindingIssuesPanel } from "./BindingIssuesPanel";

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
    entityId: "e-1",
    name: "Cafe A",
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

describe("BindingIssuesPanel", () => {
  it("does not render the success banner when all bindings are valid", () => {
    const html = renderToStaticMarkup(
      <BindingIssuesPanel
        template={makeTemplate([
          makeSlot({ slotId: "name", name: "Name", bindingPath: "entity.name" }),
        ])}
        entity={makeEntity({ name: "Cafe A" })}
      />,
    );

    expect(html).toBe("");
  });

  it("still renders binding issues when validation finds a problem", () => {
    const html = renderToStaticMarkup(
      <BindingIssuesPanel
        template={makeTemplate([
          makeSlot({ slotId: "phone", name: "Phone", bindingPath: "entity.phone" }),
        ])}
        entity={makeEntity({ phone: "" })}
      />,
    );

    expect(html).toContain("Phone");
    expect(html.length).toBeGreaterThan(0);
  });
});
