// Layers Panel — danh sách element của page hiện tại, giống Canva "Position" panel.
//
// Tính năng:
// - List elements sort theo zIndex (trên → dưới)
// - Mỗi row: icon kind + tên element (editable) + eye (hide) + lock
// - Click row → select element trên canvas
// - Drag-drop reorder → đổi zIndex
// - Highlight row khi element đang selected
// - Multi-select (Shift+click)

import { useCallback, useRef, useState } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Eye,
  EyeOff,
  GripVertical,
  Image as ImageIcon,
  Lock,
  Shapes,
  Square,
  Table2,
  Type,
  Unlock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { DesignElement } from "@/models";

function kindIcon(kind: DesignElement["kind"]) {
  switch (kind) {
    case "text":
      return <Type className="size-3.5" />;
    case "image":
      return <ImageIcon className="size-3.5" />;
    case "shape":
    case "frame":
      return <Square className="size-3.5" />;
    case "group":
      return <Shapes className="size-3.5" />;
    case "table":
      return <Table2 className="size-3.5" />;
    default:
      return <Square className="size-3.5" />;
  }
}

function elementLabel(element: DesignElement): string {
  if (element.name?.trim()) return element.name.trim();
  if (element.kind === "text" && element.text) {
    return element.text.slice(0, 24) || "Chữ";
  }
  switch (element.kind) {
    case "text":
      return "Chữ";
    case "image":
      return "Ảnh";
    case "shape":
      return "Hình";
    case "group":
      return "Nhóm";
    case "frame":
      return "Khung";
    case "table":
      return "Bảng";
    case "icon":
    case "svg":
      return "Icon";
    default:
      return "Element";
  }
}

interface SortableLayerRowProps {
  element: DesignElement;
  isSelected: boolean;
  onSelect: (id: string, multi: boolean) => void;
  onToggleHidden: (id: string) => void;
  onToggleLocked: (id: string) => void;
  onRename: (id: string, name: string) => void;
}

function SortableLayerRow({
  element,
  isSelected,
  onSelect,
  onToggleHidden,
  onToggleLocked,
  onRename,
}: SortableLayerRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: element.elementId });
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const isHidden = element.hidden || element.style?.hidden;
  const isLocked = element.locked;

  const handleDoubleClick = () => {
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const handleBlur = () => {
    setEditing(false);
    const value = inputRef.current?.value.trim();
    if (value && value !== elementLabel(element)) {
      onRename(element.elementId, value);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      (e.target as HTMLInputElement).blur();
    } else if (e.key === "Escape") {
      setEditing(false);
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group flex items-center gap-1 rounded-md px-1.5 py-1 text-xs transition-colors",
        isSelected
          ? "bg-primary/10 text-primary ring-1 ring-primary/30"
          : "hover:bg-muted/60",
        isHidden && "opacity-50",
      )}
      onClick={(e) => onSelect(element.elementId, e.shiftKey)}
    >
      {/* Drag handle */}
      <button
        type="button"
        className="cursor-grab touch-none text-muted-foreground opacity-0 group-hover:opacity-100"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-3.5" />
      </button>

      {/* Kind icon */}
      <span className="shrink-0 text-muted-foreground">{kindIcon(element.kind)}</span>

      {/* Name */}
      {editing ? (
        <input
          ref={inputRef}
          className="min-w-0 flex-1 rounded border bg-background px-1 py-0.5 text-xs outline-none focus:ring-1 focus:ring-primary"
          defaultValue={elementLabel(element)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          autoFocus
        />
      ) : (
        <span
          className="min-w-0 flex-1 truncate"
          onDoubleClick={handleDoubleClick}
        >
          {elementLabel(element)}
        </span>
      )}

      {/* Actions */}
      <button
        type="button"
        className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
        onClick={(e) => {
          e.stopPropagation();
          onToggleHidden(element.elementId);
        }}
        title={isHidden ? "Hiện" : "Ẩn"}
      >
        {isHidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
      </button>
      <button
        type="button"
        className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
        onClick={(e) => {
          e.stopPropagation();
          onToggleLocked(element.elementId);
        }}
        title={isLocked ? "Mở khoá" : "Khoá"}
      >
        {isLocked ? <Lock className="size-3.5" /> : <Unlock className="size-3.5" />}
      </button>
    </div>
  );
}

interface LayersPanelProps {
  /** Elements của active page, đã sort theo render order (bottom → top). */
  elements: DesignElement[];
  /** IDs đang selected trên canvas. */
  selectedIds: string[];
  /** Callback khi user click chọn element trong layers. */
  onSelect: (ids: string[], primaryId?: string | null) => void;
  /** Callback khi user reorder qua drag-drop. */
  onReorder: (activeId: string, overId: string) => void;
  /** Toggle hidden. */
  onToggleHidden: (id: string) => void;
  /** Toggle locked. */
  onToggleLocked: (id: string) => void;
  /** Rename element. */
  onRename: (id: string, name: string) => void;
}

export function LayersPanel({
  elements,
  selectedIds,
  onSelect,
  onReorder,
  onToggleHidden,
  onToggleLocked,
  onRename,
}: LayersPanelProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const selectedSet = new Set(selectedIds);

  // Reverse: layers panel hiển thị top element ở trên (giống Canva/Figma).
  const reversed = [...elements].reverse();
  const ids = reversed.map((el) => el.elementId);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      onReorder(String(active.id), String(over.id));
    },
    [onReorder],
  );

  const handleSelect = useCallback(
    (id: string, multi: boolean) => {
      if (multi) {
        const next = selectedSet.has(id)
          ? selectedIds.filter((sid) => sid !== id)
          : [...selectedIds, id];
        onSelect(next, id);
      } else {
        onSelect([id], id);
      }
    },
    [selectedIds, selectedSet, onSelect],
  );

  if (elements.length === 0) {
    return (
      <div className="p-3 text-center text-xs text-muted-foreground">
        Trang trống. Thêm element từ panel bên trái.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5 p-2">
      <div className="mb-1 flex items-center justify-between px-1">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Layers ({elements.length})
        </span>
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {reversed.map((element) => (
            <SortableLayerRow
              key={element.elementId}
              element={element}
              isSelected={selectedSet.has(element.elementId)}
              onSelect={handleSelect}
              onToggleHidden={onToggleHidden}
              onToggleLocked={onToggleLocked}
              onRename={onRename}
            />
          ))}
        </SortableContext>
      </DndContext>
    </div>
  );
}
