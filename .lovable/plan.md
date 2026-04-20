

## Vấn đề
Tab "Pack template (nâng cao)" hiện render slot `staticText` thô ("Tên quán", "Địa chỉ"…) vì:
- `generatePackJob` không resolve `bindingPath` của text/image slot — chỉ xử lý `sections` cũ + 1 hero cover.
- `PageRenderer` cho pack KHÔNG nhận `entity` prop nên `resolveTextBinding` không chạy.
- Tab pack thiếu UI filter sheet, bind, AI suggest như tab entity.

## Giải pháp — đồng bộ tab Pack với tab Entity

### 1. Mở rộng `generatePackJob` (`src/engines/selection/generate.ts`)
Thêm input mới:
```ts
{
  mode: "one-entity-per-pack" | "one-entity-per-page",
  entityPool: Entity[],   // đã filter sẵn từ UI
  bindOverrides: BindOverride[], // override binding per-page (designer/AI)
}
```
- **Mode `one-entity-per-pack`**: chọn N entity → với mỗi entity sinh đủ pack (orderedPages.length pages). Mỗi `RenderedPage` lưu `entityId` để renderer biết.
- **Mode `one-entity-per-page`**: lặp orderedPages, mỗi page lấy 1 entity từ pool theo round-robin (ưu tiên đối tác).
- Lưu `entityId` vào `RenderedPage` (bổ sung field optional vào model `RenderedPage`).

### 2. `PageRenderer` cho pack
Trong `generate.tsx` (tab pack), khi map `filteredPages` → truyền thêm prop `entity={entityMap.get(p.entityId)}` để text/image bindings tự resolve (cơ chế đã có sẵn trong renderer).

### 3. UI tab Pack (`src/routes/generate.tsx` tab `value="pack"`)
Layout 3 cột giống tab entity:

**Cột trái — Cấu hình** (copy nguyên từ tab entity):
- Pack template select
- Toggle chế độ: "1 entity / nguyên pack" ↔ "Mỗi page 1 entity"
- Sheet, Mô hình, Phong cách, đối tác, max pages
- Nút Generate + Debug

**Cột giữa — Canvas bind từng page**:
- Tab ngang chọn page trong pack (page 1, page 2, page 3…)
- `BindCanvas` của page đang xem → click slot để bind
- Nút "AI gợi ý bind cho page này" (dùng `aiSuggestBindings` sẵn có)
- Nút "AI gợi ý bind cho TẤT CẢ pages" (loop từng page)
- Bind override lưu per-page vào store mới `usePackBindOverrides` (mở rộng từ `useBindOverrides`).

**Cột phải — Sheet fields & preview**:
- `SheetFieldsPanel` (đã có) — click field → bind cho slot đang chọn ở page hiện tại
- Preview entity dropdown để xem trước

### 4. Kết quả render
Lưới pages giữ nguyên cấu trúc cũ NHƯNG:
- Mỗi card hiển thị tên entity được bind vào
- Truyền `entity` prop vào `PageRenderer` ⇒ text/image bindings hiển thị đúng dữ liệu
- Group theo entity nếu mode `one-entity-per-pack` (vd "Quán ABC: page 1, 2, 3, 4")
- Export ZIP giữ nguyên, đổi tên file theo slug entity

### 5. Files thay đổi
- `src/models/index.ts` — thêm `entityId?: string` vào `RenderedPage`
- `src/engines/selection/generate.ts` — extend `GenerateInput` + 2 mode
- `src/features/generate/jobStore.ts` — không đổi (chỉ lưu job)
- `src/features/generate/usePackBindOverrides.ts` (mới) — Map<pageTemplateId, BindOverride[]>
- `src/routes/generate.tsx` — viết lại nội dung TabsContent `value="pack"` (~250 LoC)

### 6. Thứ tự triển khai
1. Mở rộng model + `generatePackJob` 2 mode
2. `usePackBindOverrides` hook
3. UI tab pack 3 cột + truyền entity vào PageRenderer
4. Tích hợp AI suggest bind (per-page và bulk)
5. Test: chọn pack 4 page, mode "1 entity nguyên pack", filter sheet Choi_dem, bind text, generate → xem text "Tên quán" đổi thành tên thật

