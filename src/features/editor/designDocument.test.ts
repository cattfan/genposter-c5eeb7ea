import { describe, expect, it } from "vitest";

import type { DesignDocument, PageTemplate } from "@/models";
import { designDocumentToPageTemplate, pageTemplateToDesignDocument } from "./designDocument";

function baseTemplate(): PageTemplate {
  return {
    pageTemplateId: "page-1",
    name: "Page 1",
    type: "cover",
    canvas: { width: 1080, height: 1350, background: "#fff" },
    slots: [
      {
        slotId: "old-group",
        kind: "group",
        x: 100,
        y: 100,
        width: 320,
        height: 220,
      },
      {
        slotId: "image-1",
        kind: "image",
        groupId: "old-group",
        x: 120,
        y: 120,
        width: 160,
        height: 120,
      },
      {
        slotId: "name-1",
        kind: "text",
        groupId: "old-group",
        x: 300,
        y: 130,
        width: 180,
        height: 40,
        staticText: "Tên",
      },
    ],
    sections: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("designDocumentToPageTemplate", () => {
  it("keeps the current editor group instead of stale legacy group metadata", () => {
    const template = baseTemplate();
    const document = pageTemplateToDesignDocument(template, "template");
    const regroupedDocument: DesignDocument = {
      ...document,
      elements: document.elements.map((element) => {
        if (element.elementId === "old-group") {
          return { ...element, elementId: "new-group", children: ["image-1", "name-1"] };
        }
        if (element.elementId === "image-1" || element.elementId === "name-1") {
          return { ...element, parentId: "new-group" };
        }
        return element;
      }),
    };

    const nextTemplate = designDocumentToPageTemplate(regroupedDocument, template);
    const image = nextTemplate.slots.find((slot) => slot.slotId === "image-1");
    const text = nextTemplate.slots.find((slot) => slot.slotId === "name-1");

    expect(nextTemplate.slots.some((slot) => slot.slotId === "new-group" && slot.kind === "group"))
      .toBe(true);
    expect(image?.groupId).toBe("new-group");
    expect(text?.groupId).toBe("new-group");
  });

  it("preserves bindingPath for non legacy_template binding sources", () => {
    const template = baseTemplate();
    const document = pageTemplateToDesignDocument(template, "template");
    const documentWithEntityBinding: DesignDocument = {
      ...document,
      elements: document.elements.map((element) =>
        element.elementId === "name-1"
          ? {
              ...element,
              binding: {
                source: "entity",
                path: "entity.name",
                fallbackText: "Tên quán",
              },
            }
          : element,
      ),
    };

    const nextTemplate = designDocumentToPageTemplate(documentWithEntityBinding, template);
    const text = nextTemplate.slots.find((slot) => slot.slotId === "name-1");
    expect(text?.bindingPath).toBe("entity.name");
  });

  it("preserves dataSources from base template across save", () => {
    const template: PageTemplate = {
      ...baseTemplate(),
      dataSources: {
        primary: {
          id: "primary",
          kind: "sheet",
          label: "Quán ăn",
          sheetName: "Quán ăn Đà Lạt",
        },
      },
    };
    const document = pageTemplateToDesignDocument(template, "template");
    const nextTemplate = designDocumentToPageTemplate(document, template);
    expect(nextTemplate.dataSources?.primary?.sheetName).toBe("Quán ăn Đà Lạt");
  });
});
