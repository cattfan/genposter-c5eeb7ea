// Context menu (chuột phải) dùng chung cho cả SlotEditor (canvas)
// và item trong panel Layers. Bọc children — khi user chuột phải sẽ mở menu.

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { Slot } from "@/models";
import {
  ChevronsUp,
  ChevronUp,
  ChevronDown,
  ChevronsDown,
  Copy,
  Pencil,
  Lock,
  Unlock,
  Eye,
  EyeOff,
  Trash2,
  Scissors,
  ClipboardPaste,
} from "lucide-react";

export interface SlotMenuActions {
  bringToFront: () => void;
  bringForward: () => void;
  sendBackward: () => void;
  sendToBack: () => void;
  duplicate: () => void;
  rename: () => void;
  toggleLock: () => void;
  toggleHidden: () => void;
  remove: () => void;
  copy: () => void;
  cut: () => void;
  paste: () => void;
  canPaste: boolean;
}

export function SlotContextMenu({
  slot,
  actions,
  children,
  asChild = true,
}: {
  slot: Slot;
  actions: SlotMenuActions;
  children: React.ReactNode;
  asChild?: boolean;
}) {
  const isBg = !!slot.isUploadedBackground;
  const isLocked = !!slot.locked || isBg;
  const isHidden = !!slot.style?.hidden;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild={asChild}>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-60">
        <ContextMenuItem onSelect={actions.bringToFront} disabled={isBg}>
          <ChevronsUp className="size-4 mr-2" /> Đưa lên trên cùng
          <ContextMenuShortcut>Ctrl+Shift+]</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onSelect={actions.bringForward} disabled={isBg}>
          <ChevronUp className="size-4 mr-2" /> Đưa lên 1 cấp
          <ContextMenuShortcut>Ctrl+]</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onSelect={actions.sendBackward} disabled={isBg}>
          <ChevronDown className="size-4 mr-2" /> Đưa xuống 1 cấp
          <ContextMenuShortcut>Ctrl+[</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onSelect={actions.sendToBack} disabled={isBg}>
          <ChevronsDown className="size-4 mr-2" /> Đưa xuống dưới cùng
          <ContextMenuShortcut>Ctrl+Shift+[</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={actions.duplicate} disabled={isBg}>
          <Copy className="size-4 mr-2" /> Nhân bản
          <ContextMenuShortcut>Ctrl+D</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onSelect={actions.copy}>
          <Copy className="size-4 mr-2" /> Copy
          <ContextMenuShortcut>Ctrl+C</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onSelect={actions.cut} disabled={isBg}>
          <Scissors className="size-4 mr-2" /> Cắt
          <ContextMenuShortcut>Ctrl+X</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onSelect={actions.paste} disabled={!actions.canPaste}>
          <ClipboardPaste className="size-4 mr-2" /> Dán
          <ContextMenuShortcut>Ctrl+V</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={actions.rename}>
          <Pencil className="size-4 mr-2" /> Đổi tên
          <ContextMenuShortcut>F2</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onSelect={actions.toggleLock}>
          {isLocked ? <Unlock className="size-4 mr-2" /> : <Lock className="size-4 mr-2" />}
          {isLocked ? "Mở khoá" : "Khoá"}
          <ContextMenuShortcut>Ctrl+L</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onSelect={actions.toggleHidden}>
          {isHidden ? <Eye className="size-4 mr-2" /> : <EyeOff className="size-4 mr-2" />}
          {isHidden ? "Hiện" : "Ẩn"}
          <ContextMenuShortcut>Ctrl+H</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={actions.remove} className="text-destructive focus:text-destructive" disabled={isBg}>
          <Trash2 className="size-4 mr-2" /> Xoá
          <ContextMenuShortcut>Del</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
