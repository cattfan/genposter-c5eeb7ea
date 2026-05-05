import { nanoid } from "nanoid";
import { SAFE_MARGIN_X, SAFE_MARGIN_Y } from "@/lib/safeZone";
import type {
  CanvasSize,
  DataBindingRef,
  DesignDocument,
  DesignElement,
  DesignFrameElement,
  DesignGuide,
  DesignPage,
  DesignShapeElement,
  DesignTextElement,
  EditorMode,
  PageTemplate,
  Section,
  Slot,
} from "@/models";

const DEFAULT_DOCUMENT_SETTINGS: DesignDocument["documentSettings"] = {
  gridSize: 8,
  snapToGrid: false,
  showGrid: false,
  showSafeZone: false,
  showGuides: false,
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function cloneDesignDocument(document: DesignDocument): DesignDocument {
  return clone(document);
}

export function createDesignPage(params: {
  pageId?: string;
  name: string;
  canvas: CanvasSize;
}): DesignPage {
  const { pageId = nanoid(), name, canvas } = params;
  const guides: DesignGuide[] = [
    {
      guideId: nanoid(),
      axis: "x",
      value: Math.round(canvas.width / 2),
      locked: true,
    },
    {
      guideId: nanoid(),
      axis: "y",
      value: Math.round(canvas.height / 2),
      locked: true,
    },
  ];

  return {
    pageId,
    name,
    width: canvas.width,
    height: canvas.height,
    background: canvas.background,
    backgroundImage: canvas.backgroundImage,
    safeZone: {
      top: Math.round(canvas.height * SAFE_MARGIN_Y),
      right: Math.round(canvas.width * SAFE_MARGIN_X),
      bottom: Math.round(canvas.height * SAFE_MARGIN_Y),
      left: Math.round(canvas.width * SAFE_MARGIN_X),
    },
    guides,
  };
}

export function createBlankDesignDocument(params?: {
  designDocumentId?: string;
  name?: string;
  mode?: EditorMode;
  page?: Partial<DesignPage>;
}): DesignDocument {
  const pageId = params?.page?.pageId ?? nanoid();
  const page = createDesignPage({
    pageId,
    name: params?.page?.name ?? "Page 1",
    canvas: {
      width: params?.page?.width ?? 1080,
      height: params?.page?.height ?? 1350,
      background: params?.page?.background ?? "#ffffff",
      backgroundImage: params?.page?.backgroundImage,
    },
  });

  return {
    designDocumentId: params?.designDocumentId ?? nanoid(),
    name: params?.name ?? "Untitled Design",
    pages: [page],
    elements: [],
    activePageId: pageId,
    mode: params?.mode ?? "design",
    documentSettings: clone(DEFAULT_DOCUMENT_SETTINGS),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    version: 1,
  };
}

function isGeneratedCoverBackgroundSlot(slot: Slot, canvas: CanvasSize) {
  if (slot.kind !== "image" || slot.bindingPath !== "asset.cover") return false;
  const name = slot.name.toLowerCase();
  const coversCanvas =
    slot.x <= canvas.width * 0.05 &&
    slot.y <= canvas.height * 0.05 &&
    slot.width >= canvas.width * 0.84 &&
    slot.height >= canvas.height * 0.84;
  return slot.isUploadedBackground || name.includes("mood_background") || coversCanvas;
}

function staticImageForTemplateSlot(slot: Slot, canvas: CanvasSize): string | undefined {
  return isGeneratedCoverBackgroundSlot(slot, canvas) ? undefined : slot.staticImage;
}

function slotBindingToRef(slot: Slot, canvas: CanvasSize): DataBindingRef | undefined {
  if (!slot.bindingPath) return undefined;
  return {
    source: "legacy_template",
    path: slot.bindingPath,
    fallbackText: slot.staticText,
    fallbackImage: staticImageForTemplateSlot(slot, canvas),
    meta: {
      allowedAssetRoles: slot.allowedAssetRoles,
      overflowRule: slot.overflowRule,
      visibilityRule: slot.visibilityRule,
    },
  };
}

function slotToElement(slot: Slot, pageId: string, canvas: CanvasSize): DesignElement {
  const staticImage = staticImageForTemplateSlot(slot, canvas);
  const common = {
    elementId: slot.slotId,
    pageId,
    kind: "shape",
    name: slot.name,
    x: slot.x,
    y: slot.y,
    width: slot.width,
    height: slot.height,
    rotation: slot.rotation,
    zIndex: slot.zIndex,
    locked: slot.locked,
    hidden: !!slot.style?.hidden,
    style: slot.style ? clone(slot.style) : undefined,
    binding: slotBindingToRef(slot, canvas),
    meta: {
      legacy: {
        slotKind: slot.kind,
        groupId: slot.groupId,
        sectionId: slot.sectionId,
        pageId: slot.pageId,
        sectionRefId: slot.sectionRefId,
        repeaterCount: slot.repeaterCount,
        repeaterItemHeight: slot.repeaterItemHeight,
        repeaterGap: slot.repeaterGap,
        isUploadedBackground: slot.isUploadedBackground,
      },
    },
  } satisfies Partial<DesignElement>;

  if (slot.kind === "text") {
    const element: DesignTextElement = {
      ...common,
      kind: "text",
      text: slot.staticText ?? "Text",
      textRuns:
        slot.textRuns?.length
          ? clone(slot.textRuns)
          : slot.staticText && slot.staticText.length > 0
          ? [
              {
                start: 0,
                end: slot.staticText.length,
                style: slot.style ? clone(slot.style) : {},
              },
            ]
          : [],
    };
    return element;
  }

  if (slot.kind === "image") {
    return {
      ...common,
      kind: "image",
      src: staticImage,
      crop: slot.crop ? clone(slot.crop) : undefined,
    };
  }

  if (slot.kind === "shape") {
    const element: DesignShapeElement = {
      ...common,
      kind: "shape",
      shapeKind: slot.shapeKind,
      src: staticImage,
      crop: slot.crop ? clone(slot.crop) : undefined,
      text: slot.staticText,
      textRuns: slot.textRuns ? clone(slot.textRuns) : undefined,
    };
    return element;
  }

  const frame: DesignFrameElement = {
    ...common,
    kind: "frame",
    background: slot.style?.background,
    padding: slot.style?.padding,
  };
  return frame;
}

function bindingRefToSlot(
  binding: DataBindingRef | undefined,
): Pick<Slot, "bindingPath" | "allowedAssetRoles" | "overflowRule" | "visibilityRule"> {
  if (!binding || binding.source !== "legacy_template") {
    return {
      bindingPath: undefined,
      allowedAssetRoles: undefined,
      overflowRule: undefined,
      visibilityRule: undefined,
    };
  }

  return {
    bindingPath: binding.path,
    allowedAssetRoles: binding.meta?.allowedAssetRoles as Slot["allowedAssetRoles"] | undefined,
    overflowRule: binding.meta?.overflowRule as Slot["overflowRule"] | undefined,
    visibilityRule: binding.meta?.visibilityRule as Slot["visibilityRule"] | undefined,
  };
}

function elementToSlot(element: DesignElement): Slot {
  const legacyMeta = (element.meta?.legacy ?? {}) as Record<string, unknown>;
  const binding = bindingRefToSlot(element.binding);
  const style = clone(element.style ?? {});
  if (element.hidden) {
    style.hidden = true;
  }

  if (element.kind === "text") {
    return {
      slotId: element.elementId,
      kind: "text",
      name: element.name,
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
      rotation: element.rotation,
      zIndex: element.zIndex,
      locked: element.locked,
      groupId: legacyMeta.groupId as string | undefined,
      staticText: element.text,
      textRuns: element.textRuns ? clone(element.textRuns) : undefined,
      style,
      ...binding,
    };
  }

  if (element.kind === "image") {
    return {
      slotId: element.elementId,
      kind: "image",
      name: element.name,
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
      rotation: element.rotation,
      zIndex: element.zIndex,
      locked: element.locked,
      groupId: legacyMeta.groupId as string | undefined,
      staticImage: element.src,
      crop: element.crop ? clone(element.crop) : undefined,
      isUploadedBackground: legacyMeta.isUploadedBackground as boolean | undefined,
      style,
      ...binding,
    };
  }

  if (element.kind === "shape") {
    return {
      slotId: element.elementId,
      kind: "shape",
      name: element.name,
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
      rotation: element.rotation,
      zIndex: element.zIndex,
      locked: element.locked,
      groupId: legacyMeta.groupId as string | undefined,
      shapeKind: element.shapeKind,
      staticText: element.text,
      textRuns: element.textRuns ? clone(element.textRuns) : undefined,
      staticImage: element.src,
      crop: element.crop ? clone(element.crop) : undefined,
      style,
      ...binding,
    };
  }

  return {
    slotId: element.elementId,
    kind: (legacyMeta.slotKind as Slot["kind"]) ?? "section",
    name: element.name,
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
    rotation: element.rotation,
    zIndex: element.zIndex,
    locked: element.locked,
    groupId: legacyMeta.groupId as string | undefined,
    sectionRefId: legacyMeta.sectionRefId as string | undefined,
    style,
    ...binding,
  };
}

function collectSections(document: DesignDocument, fallbackSections: Section[] = []): Section[] {
  const baseMap = new Map(fallbackSections.map((section) => [section.sectionId, clone(section)]));
  for (const element of document.elements) {
    const legacyMeta = (element.meta?.legacy ?? {}) as Record<string, unknown>;
    const sectionId = legacyMeta.sectionRefId as string | undefined;
    if (!sectionId) continue;
    if (baseMap.has(sectionId)) continue;
    baseMap.set(sectionId, {
      sectionId,
      title: element.name ?? "Section",
      maxItems: 6,
      minItems: 1,
      imageMode: "section_mood",
      partnerMode: "balanced_partner",
      listStyle: "dot",
      layoutMode: "stack",
    });
  }
  return Array.from(baseMap.values());
}

export function pageTemplateToDesignDocument(
  template: PageTemplate,
  mode: EditorMode = "template",
): DesignDocument {
  const page = createDesignPage({
    pageId: template.pageTemplateId,
    name: template.name,
    canvas: template.canvas,
  });

  return {
    designDocumentId: template.pageTemplateId,
    name: template.name,
    pages: [page],
    elements: template.slots.map((slot) => slotToElement(slot, page.pageId, template.canvas)),
    activePageId: page.pageId,
    mode,
    sourcePageTemplateId: template.pageTemplateId,
    documentSettings: clone(DEFAULT_DOCUMENT_SETTINGS),
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
    version: 1,
  };
}

export function designDocumentToPageTemplate(
  document: DesignDocument,
  baseTemplate?: PageTemplate,
): PageTemplate {
  const activePage =
    document.pages.find((page) => page.pageId === document.activePageId) ?? document.pages[0];
  const pageId = document.sourcePageTemplateId ?? baseTemplate?.pageTemplateId ?? nanoid();
  const elements = document.elements
    .filter((element) => element.pageId === activePage.pageId)
    .slice()
    .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));

  return {
    pageTemplateId: pageId,
    name: document.name,
    type: baseTemplate?.type ?? "cover",
    canvas: {
      width: activePage.width,
      height: activePage.height,
      background: activePage.background,
      backgroundImage: activePage.backgroundImage,
    },
    slots: elements.map(elementToSlot),
    sections: collectSections(document, baseTemplate?.sections),
    stylePreset: baseTemplate?.stylePreset,
    validationRules: baseTemplate?.validationRules
      ? clone(baseTemplate.validationRules)
      : undefined,
    updatedAt: Date.now(),
    createdAt: baseTemplate?.createdAt ?? document.createdAt,
    thumbnail: baseTemplate?.thumbnail,
    cardGroups: baseTemplate?.cardGroups ? clone(baseTemplate.cardGroups) : undefined,
  };
}
