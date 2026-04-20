

## Tính năng "Tạo combo mẫu" (multi-template pack)

User chọn **cả 2 hướng** + **AI tự suy ra role mỗi page** + **không giới hạn số ảnh**.

## Phần A — AI dựng combo từ nhiều ảnh (1 lần upload → cả pack)

### A1. Server function mới `aiGenerateComboFromImagesServer`
File: `src/server/aiTemplate.ts` (thêm vào).

Input: `{ images: Array<{ dataUrl: string; hint?: string }> }` (validate mỗi ảnh ≤6MB, tổng ≤30MB để khỏi vỡ payload).

Pipeline 2 bước:
- **Bước 1 — classify roles**: 1 lần gọi AI với tất cả ảnh thumbnail + tool `classify_pages` → trả `Array<{index, role: "cover"|"utilities"|"day"|"outro"|"other", dayNumber?, suggestedName, packTheme}>`. Để AI nhìn tổng thể đoán ra 6 ảnh là 4N3Đ Đà Lạt.
- **Bước 2 — gen layout từng page**: lặp `aiGenerateTemplateFromImageServer` (đã có) cho từng ảnh, **truyền thêm hint role** vào prompt để AI biết "ảnh này là Cover/Day 1/Utilities" → layout chuẩn hơn (vd day page tự thêm badge `NGÀY {{day}} - $...`).
- Trả về `{ ok, pages: Array<{layoutJson, role, dayNumber?, suggestedName}>, packMeta: {name, goal, tone, cta} }`.

Concurrency: chạy `Promise.all` nhưng giới hạn 3 song song để không vượt rate-limit.

### A2. Parser → tạo Pack + Pages
File mới: `src/features/ai/comboFromImages.ts`.

`buildComboFromAiResult(result)` →
- Với mỗi page: gọi `aiLayoutToTemplate(layout, suggestedName)` để ra `PageTemplate`.
- Nếu `role === "day"` và `dayNumber` có → set `sections[].filterRules = [{field:"day", op:"eq", value: dayNumber}]` + `layoutMode: "zigzag"` (chèn vào page nếu AI chưa tạo section).
- Sắp xếp theo thứ tự: cover → utilities → day asc → outro → other.
- Tạo `PackTemplate` từ `packMeta` với `orderedPages` đúng thứ tự.
- `db.transaction` write tất cả pageTemplates + packTemplate.

### A3. UI "AI dựng combo" trong /templates
File: `src/routes/templates.tsx`.

Thêm nút **"AI dựng combo từ nhiều ảnh"** cạnh nút "AI dựng từ ảnh" hiện tại:
- Multi-file input (`accept="image/*" multiple`).
- Modal preview thumbnail + cho user nhập **packName** (optional, AI tự đặt nếu trống).
- Progress bar: "Phân loại ảnh..." → "Dựng page 1/N..." → "Tạo pack..."
- Xong → toast + navigate `/packs` mở pack vừa tạo trong builder.

## Phần B — Pack Builder UI mạnh hơn

File: `src/routes/packs.tsx` (rewrite phần builder, giữ list cũ).

### B1. Drag-drop sắp xếp page
- Dùng `@dnd-kit/core` + `@dnd-kit/sortable` (đã có trong stack shadcn ecosystem; cần `add_dependency` nếu chưa có).
- Mỗi page item: thumbnail mini (dùng `PageRenderer` scale nhỏ như trang /templates), tên, badge role nếu có (cover/day/outro), nút xoá / lên / xuống.
- Drag để đổi thứ tự `orderedPages`.

### B2. Picker template với search & filter
- Thay `flex-wrap gap` bằng list có search box + filter theo `type` (cover/itinerary/board/mixed).
- Click "+ Thêm" → push vào `orderedPages` (cho phép trùng template trong cùng pack).

### B3. Preview cả pack dạng strip
- Section riêng dưới builder: hiển thị **strip ngang** tất cả page theo `orderedPages` ở scale 0.15, scroll horizontal — designer thấy được flow tổng thể.
- Click 1 thumbnail → mở `/templates/$id/edit` ở tab mới.

### B4. Lưu nhiều phiên bản combo
- Nút "Duplicate pack" → clone `PackTemplate` với id mới, đặt tên `"... (copy)"`. Designer có thể giữ nhiều variant cùng data nguồn.

### B5. Pack metadata mở rộng
- Thêm field `description?: string` vào `PackTemplate` model + textarea trong builder.
- Hiển thị `goal/tone/cta` thành các chip có nút edit inline thay vì input rời.

## Files đụng tới

**Sửa:**
- `src/models/index.ts` — thêm `PackTemplate.description?: string`
- `src/server/aiTemplate.ts` — thêm `aiGenerateComboFromImagesServer` (classify + gen pages concurrent)
- `src/routes/templates.tsx` — nút "AI dựng combo từ nhiều ảnh" + modal upload nhiều ảnh
- `src/routes/packs.tsx` — rewrite builder: drag-drop, search picker, strip preview, duplicate

**Tạo mới:**
- `src/features/ai/comboFromImages.ts` — parser AI result → PageTemplate[] + PackTemplate
- `src/features/packs/PackBuilder.tsx` — component builder tách riêng (drag-drop, preview strip)
- `src/features/packs/PackPagePreview.tsx` — thumbnail page mini dùng chung

**Dependency mới:**
- `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` (nếu chưa có)

## Thứ tự triển khai
1. **A1+A2** — server fn classify + gen + parser (nền tảng AI combo)
2. **A3** — UI upload nhiều ảnh trong /templates
3. **B5** — model `PackTemplate.description` (cần trước builder)
4. **B1+B2+B3** — pack builder mới với drag-drop + preview strip
5. **B4** — duplicate pack

