import { describe, expect, it } from "vitest";
import type { Entity, PackTemplate, PageTemplate, RenderedPage } from "@/models";
import { entityContentKey } from "@/engines/selection/entityBindAllocator";
import { generatePackJob } from "@/engines/selection/generate";

const entityBase = {
  partnerFlag: false,
  partnerPriority: 0,
  partnerType: "none",
  campaignTags: [],
  seoKeywords: [],
  status: "active",
  sheetName: "Quan_an",
} satisfies Omit<Entity, "entityId" | "name" | "address">;

function entity(entityId: string, name: string, address: string): Entity {
  return { ...entityBase, entityId, name, address };
}

function template(pageTemplateId: string, targetCount = 1): PageTemplate {
  return {
    pageTemplateId,
    name: pageTemplateId,
    type: "mixed",
    canvas: { width: 1080, height: 1080 },
    sections: [],
    createdAt: 1,
    updatedAt: 1,
    slots: Array.from({ length: targetCount }, (_, index) => ({
      slotId: `${pageTemplateId}-name-${index + 1}`,
      kind: "text",
      x: 0,
      y: index * 120,
      width: 100,
      height: 30,
      bindingPath: "entity.name",
      dataGroupId: `group-${index + 1}`,
    })),
  };
}

function assignedContentKeys(page: RenderedPage, entities: Entity[]): string[] {
  const entityById = new Map(entities.map((item) => [item.entityId, item]));
  const keys: string[] = [];
  for (const item of page.items) {
    if (!item.entityId) continue;
    const matched = entityById.get(item.entityId);
    if (matched) keys.push(entityContentKey(matched));
  }
  return keys;
}

describe("generatePackJob entity allocation", () => {
  it("does not repeat the same venue inside one generated bundle", () => {
    const pageA = template("page-a");
    const pageB = template("page-b");
    const pack: PackTemplate = {
      packTemplateId: "pack",
      name: "Pack",
      orderedPages: [pageA.pageTemplateId, pageB.pageTemplateId],
      requiredPages: [pageA.pageTemplateId, pageB.pageTemplateId],
      optionalPages: [],
      createdAt: 1,
      updatedAt: 1,
    };
    const entities = [
      entity("e1", "Tiem nuong Hoang Hon", "Hem 118 Doi Da Chien"),
      entity("e2", "Tiem-nuong   Hoang Hon", "Duong Hoa Cam Tu Cau"),
      entity("e3", "Tiem nuong Xom Leo", "60 Ly Tu Trong"),
    ];

    const result = generatePackJob({
      pack,
      pageTemplates: [pageA, pageB],
      entities: [],
      assets: [],
      mode: "one-entity-per-pack",
      entityPool: entities,
    });

    const pagesPerBundle = pack.orderedPages.length;
    for (let start = 0; start < result.pages.length; start += pagesPerBundle) {
      const bundle = result.pages.slice(start, start + pagesPerBundle);
      const keys = bundle.flatMap((page) => assignedContentKeys(page, entities));
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("does not repeat entities when multiple pages use the same data source", () => {
    const pageA = template("page-a");
    const pageB = template("page-b");
    const pack: PackTemplate = {
      packTemplateId: "pack",
      name: "Pack",
      orderedPages: [pageA.pageTemplateId, pageB.pageTemplateId],
      requiredPages: [pageA.pageTemplateId, pageB.pageTemplateId],
      optionalPages: [],
      createdAt: 1,
      updatedAt: 1,
    };
    const entities = [
      { ...entity("h1", "Homestay 1", "Address 1"), sheetName: "Homestay" },
      { ...entity("h2", "Homestay 2", "Address 2"), sheetName: "Homestay" },
      { ...entity("h3", "Homestay 3", "Address 3"), sheetName: "Homestay" },
    ];

    const result = generatePackJob({
      pack,
      pageTemplates: [pageA, pageB],
      entities: [],
      assets: [],
      mode: "one-entity-per-pack",
      entityPool: entities,
      batchCount: 2,
      pageConfigs: {
        [pageA.pageTemplateId]: { selectedSheet: "Homestay" },
        [pageB.pageTemplateId]: { selectedSheet: "Homestay" },
      },
    });

    expect(result.pages).toHaveLength(4);
    const pagesPerBundle = pack.orderedPages.length;
    for (let start = 0; start < result.pages.length; start += pagesPerBundle) {
      const bundle = result.pages.slice(start, start + pagesPerBundle);
      const keys = bundle.flatMap((page) => assignedContentKeys(page, entities));
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("leaves extra groups unassigned instead of repeating a venue in one bundle", () => {
    const pageA = template("page-a", 2);
    const pack: PackTemplate = {
      packTemplateId: "pack",
      name: "Pack",
      orderedPages: [pageA.pageTemplateId],
      requiredPages: [pageA.pageTemplateId],
      optionalPages: [],
      createdAt: 1,
      updatedAt: 1,
    };
    const entities = [
      entity("e1", "Tiem nuong Hoang Hon", "Hem 118 Doi Da Chien"),
      entity("e2", "Tiem-nuong   Hoang Hon", "Duong Hoa Cam Tu Cau"),
    ];

    const result = generatePackJob({
      pack,
      pageTemplates: [pageA],
      entities: [],
      assets: [],
      mode: "one-entity-per-pack",
      entityPool: entities,
    });

    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]?.items).toHaveLength(1);
    expect(result.pages[0]?.warnings).toContain('Page "page-a": khong du entity de gan du lieu.');
  });

  it("uses batchCount as requested bundle count", () => {
    const pageA = template("page-a");
    const pageB = template("page-b");
    const pack: PackTemplate = {
      packTemplateId: "pack",
      name: "Pack",
      orderedPages: [pageA.pageTemplateId, pageB.pageTemplateId],
      requiredPages: [pageA.pageTemplateId, pageB.pageTemplateId],
      optionalPages: [],
      createdAt: 1,
      updatedAt: 1,
    };
    const entities = [
      entity("e1", "Cafe 1", "Address 1"),
      entity("e2", "Cafe 2", "Address 2"),
      entity("e3", "Cafe 3", "Address 3"),
      entity("e4", "Cafe 4", "Address 4"),
      entity("e5", "Cafe 5", "Address 5"),
      entity("e6", "Cafe 6", "Address 6"),
      entity("e7", "Cafe 7", "Address 7"),
      entity("e8", "Cafe 8", "Address 8"),
      entity("e9", "Cafe 9", "Address 9"),
      entity("e10", "Cafe 10", "Address 10"),
    ];

    const result = generatePackJob({
      pack,
      pageTemplates: [pageA, pageB],
      entities: [],
      assets: [],
      mode: "one-entity-per-pack",
      entityPool: entities,
      batchCount: 5,
    });

    expect(result.pages).toHaveLength(10);
  });

  it("supports different source filters for separate data groups on one page", () => {
    const pageA: PageTemplate = {
      ...template("page-a", 0),
      slots: [
        {
          slotId: "breakfast-name",
          kind: "text",
          x: 0,
          y: 0,
          width: 100,
          height: 30,
          bindingPath: "entity.name",
          dataGroupId: "breakfast",
          dataSourceConfig: {
            selectedSheet: "Quan_an",
            filterMoHinh: "An sang",
          },
        },
        {
          slotId: "lunch-name",
          kind: "text",
          x: 0,
          y: 120,
          width: 100,
          height: 30,
          bindingPath: "entity.name",
          dataGroupId: "lunch",
          dataSourceConfig: {
            selectedSheet: "Quan_an",
            filterMoHinh: "An trua",
          },
        },
        {
          slotId: "dinner-name",
          kind: "text",
          x: 0,
          y: 240,
          width: 100,
          height: 30,
          bindingPath: "entity.name",
          dataGroupId: "dinner",
          dataSourceConfig: {
            selectedSheet: "Quan_an",
            filterMoHinh: "An toi",
          },
        },
      ],
    };
    const pack: PackTemplate = {
      packTemplateId: "pack",
      name: "Pack",
      orderedPages: [pageA.pageTemplateId],
      requiredPages: [pageA.pageTemplateId],
      optionalPages: [],
      createdAt: 1,
      updatedAt: 1,
    };
    const entities = [
      { ...entity("e1", "Mì sáng", "Address 1"), categoryMain: "An sang" },
      { ...entity("e2", "Cơm trưa", "Address 2"), categoryMain: "An trua" },
      { ...entity("e3", "Lẩu tối", "Address 3"), categoryMain: "An toi" },
      { ...entity("e4", "Cafe", "Address 4"), categoryMain: "Cafe" },
    ];

    const result = generatePackJob({
      pack,
      pageTemplates: [pageA],
      entities: [],
      assets: [],
      mode: "one-entity-per-pack",
      entityPool: entities,
      batchCount: 1,
    });

    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slotId: "breakfast-name", entityId: "e1" }),
        expect.objectContaining({ slotId: "lunch-name", entityId: "e2" }),
        expect.objectContaining({ slotId: "dinner-name", entityId: "e3" }),
      ]),
    );
  });
});
