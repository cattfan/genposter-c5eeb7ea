import { useMemo } from "react";
import type { Asset, Entity, PageTemplate, RenderedItem } from "@/models";
import { resolveImageBinding, resolveTextBinding } from "@/engines/binding/dataBinding";
import { getAssetImageSource } from "@/engines/binding/assetImage";
import { DesignWorkspace } from "@/features/editor/DesignWorkspace";
import {
  designDocumentToPageTemplate,
  pageTemplateToDesignDocument,
} from "@/features/editor/designDocument";

export function GeneratePageEditor({
  open,
  onOpenChange,
  title,
  template,
  baseTemplate,
  entities,
  assets,
  entity,
  entityPool,
  slotItems,
  seedKey,
  preserveBindings = true,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  template: PageTemplate;
  baseTemplate: PageTemplate;
  entities: Entity[];
  assets: Asset[];
  entity?: Entity;
  entityPool?: Entity[];
  slotItems?: RenderedItem[];
  seedKey?: string;
  preserveBindings?: boolean;
  onApply: (nextTemplate: PageTemplate | null) => void;
}) {
  const editorTemplate = useMemo(
    () =>
      materializeTemplateForEditor(
        template,
        entities,
        assets,
        entity,
        entityPool,
        slotItems,
        seedKey,
      ),
    [template, entities, assets, entity, entityPool, slotItems, seedKey],
  );
  const document = useMemo(
    () => pageTemplateToDesignDocument(editorTemplate, "generated"),
    [editorTemplate],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-background">
      <DesignWorkspace
        initialDocument={document}
        mode="generated"
        contextTitle={title}
        allowMultiplePages={false}
        onClose={() => onOpenChange(false)}
        showCloseButton
        onSave={(nextDocument) => {
          const edited = designDocumentToPageTemplate(nextDocument, baseTemplate);
          onApply(
            preserveBindings
              ? mergeEditedTemplateWithSourceBindings(edited, template, editorTemplate)
              : stripTemplateBindings(edited),
          );
          onOpenChange(false);
        }}
      />
    </div>
  );
}

function materializeTemplateForEditor(
  template: PageTemplate,
  entities: Entity[],
  assets: Asset[],
  entity?: Entity,
  entityPool?: Entity[],
  slotItems?: RenderedItem[],
  seedKey?: string,
): PageTemplate {
  const entityById = new Map(entities.map((item) => [item.entityId, item]));
  const assetById = new Map(assets.map((item) => [item.assetId, item]));
  const itemBySlotId = new Map<string, RenderedItem>();
  for (const item of slotItems ?? []) {
    if (item.slotId) itemBySlotId.set(item.slotId, item);
  }

  return {
    ...template,
    slots: template.slots.map((slot) => {
      const planned = itemBySlotId.get(slot.slotId);
      const slotEntity = planned?.entityId ? entityById.get(planned.entityId) : entity;
      const plannedAsset = planned?.assetId ? assetById.get(planned.assetId) : undefined;

      if (slot.kind === "text" && slot.bindingPath) {
        return {
          ...slot,
          staticText: resolveTextBinding(
            slot.bindingPath,
            slotEntity,
            slot.staticText,
            entityPool,
            {
              entities,
              seed: `${seedKey ?? template.pageTemplateId}:${slot.slotId}:text`,
            },
          ),
        };
      }

      if (slot.kind === "image" && slot.bindingPath) {
        const resolved = slotEntity
          ? resolveImageBinding(slot.bindingPath, slotEntity, assets, slot.staticImage, {
              entities,
              seed: `${seedKey ?? template.pageTemplateId}:${slot.slotId}`,
            })
          : { src: undefined };
        return {
          ...slot,
          staticImage: getAssetImageSource(plannedAsset) ?? resolved.src ?? slot.staticImage,
        };
      }

      if (slot.kind === "shape" && slot.bindingPath && !slot.bindingPath.startsWith("asset.")) {
        return {
          ...slot,
          staticText: resolveTextBinding(
            slot.bindingPath,
            slotEntity,
            slot.staticText,
            entityPool,
            {
              entities,
              seed: `${seedKey ?? template.pageTemplateId}:${slot.slotId}:shape-text`,
            },
          ),
        };
      }

      return slot;
    }),
  };
}

function mergeEditedTemplateWithSourceBindings(
  edited: PageTemplate,
  source: PageTemplate,
  materialized: PageTemplate,
): PageTemplate {
  const sourceSlots = new Map(source.slots.map((slot) => [slot.slotId, slot]));
  const materializedSlots = new Map(materialized.slots.map((slot) => [slot.slotId, slot]));
  return {
    ...edited,
    slots: edited.slots.map((slot) => {
      const sourceSlot = sourceSlots.get(slot.slotId);
      if (!sourceSlot?.bindingPath) return slot;
      const materializedSlot = materializedSlots.get(slot.slotId);
      const textChanged =
        "staticText" in slot &&
        "staticText" in (materializedSlot ?? {}) &&
        slot.staticText !== materializedSlot?.staticText;
      const imageChanged =
        "staticImage" in slot &&
        "staticImage" in (materializedSlot ?? {}) &&
        slot.staticImage !== materializedSlot?.staticImage;

      if (textChanged || imageChanged) {
        return {
          ...slot,
          bindingPath: undefined,
          allowedAssetRoles: undefined,
          overflowRule: undefined,
          visibilityRule: undefined,
        };
      }

      return {
        ...slot,
        bindingPath: sourceSlot.bindingPath,
        allowedAssetRoles: sourceSlot.allowedAssetRoles,
        overflowRule: sourceSlot.overflowRule,
        visibilityRule: sourceSlot.visibilityRule,
        staticText: sourceSlot.staticText,
        staticImage: sourceSlot.staticImage,
      };
    }),
  };
}

function stripTemplateBindings(template: PageTemplate): PageTemplate {
  return {
    ...template,
    slots: template.slots.map((slot) => ({
      ...slot,
      bindingPath: undefined,
      allowedAssetRoles: undefined,
      overflowRule: undefined,
      visibilityRule: undefined,
    })),
  };
}
