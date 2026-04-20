

## Mục tiêu

1. **Bỏ icon emoji màu mè**: thay 🔗 / ⚡ / 📦 / ✕ / ⚠ / 🪧 / 1️⃣ / 📷 / 🟦 ... bằng icon Lucide đơn sắc (`Link2`, `Sparkles`, `Package`, `X`, `AlertTriangle`, `Image`, `Square`, `Circle`, `Triangle`, `Minus`, `MousePointerClick` ...).
2. **Trang Tạo nội dung phải có canvas tương tác**: hiện canvas template thật như editor; user click vào block → chọn trường data → preview cập nhật. Bind chỉ tạm thời cho lần generate, **không** ghi đè template.
3. **Bỏ UI bind trong editor** (theo yêu cầu): editor chỉ dùng để chỉnh hình ảnh/layout, không còn dropdown bind.

## Thay đổi chính

### A. Trang `/generate` — canvas click-to-bind tạm thời

**File chỉnh: `src/routes/generate.tsx`** + tạo mới `src/features/generate/BindCanvas.tsx`, `src/features/generate/useBindOverrides.ts`.

- **Layout 3 cột (tab "Theo entity")**:
  ```
  ┌──────────────┬──────────────────────┬──────────────┐
  │ Cấu hình     │ Canvas tương tác     │ Panel binding│
  │ - Template   │ (template scale fit) │ (block đang  │
  │ - Lọc entity │ click block ở đây    │  chọn)       │
  │ - Preview    │                      │              │
  │   entity     │                      │              │
  └──────────────┴──────────────────────┴──────────────┘
  ```
- **`BindCanvas`**: render template ở scale ~0.5, mỗi slot là 1 div bắt `onClick`; slot đang chọn có viền primary, slot đã có override-binding có viền dashed. Không cho kéo/resize — chỉ chọn.
- **Panel binding bên phải**:
  - Nếu slot là `text`: `Select` các trường `entity.name / address / phone / priceRange / style / openingHours / categoryMain / categorySub` + nút "Xoá liên kết".
  - Nếu slot là `image`: `Select` `Ảnh chính | Ảnh role: facade / food_closeup / space / portrait / square_thumb / section_image` + nút "Xoá liên kết".
  - Hiển thị preview giá trị thực tế với entity đang preview.
- **`useBindOverrides`**: state `Record<slotId, bindingPath>` lưu trong React state (không vào DB). Hàm `applyOverrides(template, overrides)` trả về 1 template ảo có `bindingPath` đã merge để truyền vào `PageRenderer` & generate.
- **Preview entity**: dropdown "Xem trước với entity" để chọn 1 entity từ `filteredEntities`, canvas + panel preview update theo entity đó.
- **Generate**: dùng template-ảo (đã merge overrides) → render từng card cho mỗi entity (giữ logic hiện tại).
- **Empty state mới**: bỏ "1️⃣ 2️⃣ 3️⃣"; dùng card hướng dẫn đơn giản với 3 step rõ ràng kèm icon Lucide (`MousePointerClick`, `Filter`, `Sparkles`).

### B. Bỏ UI bind trong editor

**File chỉnh: `src/features/editor/EditorPage.tsx`, `EditorCanvas.tsx`.**

- Xoá dropdown "Nguồn dữ liệu / Nguồn ảnh" trong panel phải của editor.
- Xoá viền tím dashed + chip "🔗" trên canvas editor và icon 🔗 trong layer list.
- `bindingPath` đã có sẵn trong template vẫn được tôn trọng khi render generate (làm override mặc định), nhưng editor không tạo mới được.
- Giữ nguyên các tính năng hình ảnh: filter, crop, flip, rotate, undo/redo.

### C. Quét sạch icon emoji → Lucide đơn sắc

| Vị trí cũ | Mới |
|---|---|
| `🔗 entity.name` chip | `<Link2 className="size-3" />` + text |
| `⚡ Generate theo entity` | `<Zap className="size-4" />` |
| `📦 Pack template` / Export | `<Package />` |
| `✕ Xoá` button trên slot | `<X />` |
| `⚠` cảnh báo | `<AlertTriangle />` |
| `📷` placeholder ảnh | `<ImageIcon />` |
| `🪧 / 🟦 / ⚪ / 🔺 / ➖` shape buttons | `<Image>` `<Square>` `<Circle>` `<Triangle>` `<Minus>` |
| `1️⃣ 2️⃣ 3️⃣` step | bullet số đơn sắc + icon hành động |

Quét cả `EditorPage.tsx`, `EditorCanvas.tsx`, `generate.tsx`, `PageRenderer.tsx`, `routes/templates.tsx`, `routes/data.tsx`.

## Files dự kiến chỉnh / tạo

- **Chỉnh**: `src/routes/generate.tsx`, `src/features/editor/EditorPage.tsx`, `src/features/editor/EditorCanvas.tsx`, `src/features/render/PageRenderer.tsx`, `src/routes/templates.tsx` (nếu có emoji), `src/routes/data.tsx` (nếu có emoji).
- **Tạo**: `src/features/generate/BindCanvas.tsx`, `src/features/generate/useBindOverrides.ts`.

## Sơ đồ luồng mới

```text
[Editor]   chỉ chỉnh hình/layout, không bind
   │
   ▼ lưu template
[Tạo nội dung]
   ├─ chọn template + lọc entity
   ├─ canvas tương tác: click block → panel chọn trường data
   │     (overrides trong RAM, KHÔNG lưu lại template)
   ├─ chọn 1 entity để preview real-time
   └─ Generate → for each entity: render(template + overrides, entity)
```

