

## Hiểu yêu cầu

1. **Layer controls đầy đủ** cho mọi block (text, shape, image, section): nút "lên 1 cấp / xuống 1 cấp / lên trên cùng / xuống dưới cùng" + **menu chuột phải** (context menu) trong cả canvas và panel Layers.
2. Bổ sung **bộ tính năng designer kiểu Figma / Canva / Photoshop**, UX phải tốt.

Hiện tại đã có: Undo/Redo, font picker, text styling đầy đủ, gradient, stroke, crop ảnh, transform/flip/rotate, opacity, lock cho upload-bg, Z + / − (chỉ ±1, không có "to front/back"). **Thiếu**: context menu, ẩn/hiện/khoá layer rõ ràng, multi-select, align/distribute, snap & smart guides, group, duplicate/paste shortcut chuẩn, mũi tên = nudge, đổi tên layer, drag-reorder layer.

---

## A. Layer system (yêu cầu chính)

### A1. Bổ sung 4 thao tác Z-order
Thêm helper `bringForward / sendBackward / bringToFront / sendToBack` (làm việc theo **thứ tự thực** trong mảng + chuẩn hoá `zIndex` để tránh lệch).

### A2. Context menu chuột phải (Radix `ContextMenu` đã có)
Bọc mỗi `SlotEditor` (canvas) và mỗi item trong panel **Layers** bằng `ContextMenu`:
- Đưa lên trên cùng (Ctrl+Shift+])
- Đưa lên 1 cấp (Ctrl+])
- Đưa xuống 1 cấp (Ctrl+[)
- Đưa xuống dưới cùng (Ctrl+Shift+[)
- ─────
- Nhân bản (Ctrl+D)
- Đổi tên (F2)
- Khoá / Mở khoá (Ctrl+L)
- Ẩn / Hiện (Ctrl+H)
- Xoá (Delete)

### A3. Panel Layers nâng cấp
Mỗi row có:
- Icon kiểu block (Type/Image/Square/…)
- Tên layer (có thể đổi tên — `slot.name`)
- Toggle Eye / EyeOff (visibility) → dùng field mới `style.hidden`
- Toggle Lock / Unlock
- Drag-reorder bằng kéo thả (cập nhật zIndex theo thứ tự mới)
- Nút hiện đã có: xoá

### A4. Toolbar trên block khi chọn
Thêm nhóm 4 nút order ngay cạnh nút "Xoá" hiện có ở góc selection: ⤒ ⤴ ⤵ ⤓.

---

## B. Bộ tính năng kiểu Figma / Canva / Photoshop (UX tốt)

### B1. Multi-select + group
- Shift+Click block để cộng/dồn `selectedSlotIds: string[]`.
- Marquee (kéo chuột trên vùng trống) chọn nhiều block (bbox-intersect).
- Khi chọn nhiều → bao quanh bằng bounding box chung; kéo = di chuyển cả nhóm; Delete xoá tất cả.
- Group / Ungroup (Ctrl+G / Ctrl+Shift+G) — gắn `groupId` (đã có ở model).

### B2. Snap & Smart Guides (đỉnh trải nghiệm Figma)
Khi kéo/resize 1 block:
- Snap mép & tâm với canvas + các block khác (ngưỡng ~6px màn hình).
- Vẽ đường gióng đỏ realtime + hiển thị **khoảng cách** giữa các slot (Figma-style).
- Giữ **Shift** = giữ tỉ lệ khi resize / di chuyển theo trục dọc-ngang.
- Giữ **Alt** = nhân bản trong lúc kéo.

### B3. Align & Distribute toolbar
Khi chọn ≥1 block, hiện toolbar 6 nút align (so với canvas hoặc bbox nhóm) + 2 nút distribute (ngang/dọc khi ≥3).

### B4. Nudge bằng phím mũi tên
- Mũi tên = ±1 px, Shift+Mũi tên = ±10 px (đã chuẩn industry).

### B5. Copy / Paste / Duplicate
- Ctrl+C, Ctrl+V, Ctrl+D (có rồi), Ctrl+X — clipboard nội bộ (in-memory), paste offset +24/+24.

### B6. Đổi tên layer + auto-name
- `slot.name?: string`. Nếu trống → suy ra "Text · "Văn bản…"", "Shape · Tròn", "Image · file.png".
- Double-click vào tên trong panel Layers = đổi tên (F2 cũng được).

### B7. Visibility & Lock thực sự
- `style.hidden` → editor render mờ + canvas xuất bản bỏ qua.
- `slot.locked` → không cho move/resize/delete (đang chỉ áp cho upload-bg).

### B8. Rulers + grid + safe area (gọn nhẹ)
- Toggle hiện thước (px) trên-trái canvas.
- Toggle grid (8/16/32 px) làm overlay.
- Toggle safe area (margin %).

### B9. Zoom-to-fit / Zoom-to-selection / 100%
- Phím `1` = 100%, `0` = fit, `2` = fit selection.

### B10. Color eyedropper + recent colors
- Dùng `EyeDropper API` (Chromium) khi pick màu — fallback ẩn nếu không hỗ trợ.
- Lưu 8 màu vừa dùng vào localStorage, hiện dưới color input.

---

## C. Phạm vi triển khai (chia 2 đợt)

**Đợt 1 — Layer hoàn chỉnh + UX cốt lõi (ưu tiên cao)**
1. Z-order: 4 thao tác + context menu (canvas + panel) + nút trong toolbar selection.
2. Panel Layers: đổi tên (F2 / double-click), eye-toggle, lock-toggle, drag-reorder.
3. Phím tắt order: Ctrl+] / Ctrl+[ / Ctrl+Shift+] / Ctrl+Shift+[, F2, Ctrl+H, Ctrl+L.
4. Nudge mũi tên (±1 / ±10 với Shift).
5. Copy/Paste/Cut clipboard nội bộ.

**Đợt 2 — Designer pro**
6. Multi-select (Shift-click + marquee) + group/ungroup.
7. Snap & smart guides + Shift giữ tỉ lệ + Alt-drag duplicate.
8. Align/Distribute toolbar.
9. Rulers / grid / safe area / zoom-to-fit / zoom-to-selection.
10. Eyedropper + recent colors.

---

## D. Files đụng tới

- **Sửa**: 
  - `src/models/index.ts` — thêm `Slot.name?`, `SlotStyle.hidden?`.
  - `src/features/editor/EditorPage.tsx` — context menu trong panel Layers, đổi tên, drag-reorder, phím tắt mới, clipboard, multi-select state, align toolbar render.
  - `src/features/editor/EditorCanvas.tsx` — context menu trên SlotEditor, snap guides overlay, marquee select, Shift/Alt khi drag/resize, nudge phím mũi tên, ẩn block khi `hidden`, khoá khi `locked`.
  - `src/features/render/PageRenderer.tsx` — bỏ qua block `hidden`.
  - `src/features/generate/BindCanvas.tsx` — bỏ qua block `hidden`.
- **Tạo mới**:
  - `src/features/editor/layerOps.ts` — `bringForward / sendBackward / bringToFront / sendToBack` + chuẩn hoá zIndex.
  - `src/features/editor/AlignToolbar.tsx` — 6 align + 2 distribute.
  - `src/features/editor/SmartGuides.tsx` — overlay guides.
  - `src/features/editor/SlotContextMenu.tsx` — `ContextMenu` chia sẻ giữa canvas và panel Layers.
  - `src/features/editor/useClipboard.ts` — copy/paste/cut nội bộ.

---

## E. Sơ đồ thao tác Z-order

```text
slots (theo zIndex tăng dần)  =  [bg=0] [shape=1] [text=2] [logo=3]
chọn "shape", bringForward    →  [bg=0] [text=1] [shape=2] [logo=3]
chọn "shape", bringToFront    →  [bg=0] [text=1] [logo=2] [shape=3]
chọn "shape", sendToBack      →  [shape=0] [bg=1] [text=2] [logo=3]
                                  (upload-bg vẫn ưu tiên dưới khi render canvas)
```

Sau mỗi thao tác → chuẩn hoá lại zIndex thành chuỗi liên tiếp 0..N để tránh tích luỹ số lớn.

