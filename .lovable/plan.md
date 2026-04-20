

## Hiểu 2 lỗi

### 1) Ảnh nền vẫn không hiện ở `/generate`
Mở `EditorPage.save()` (dòng 532-542): mỗi lần bấm **Lưu** đang **xoá luôn** `canvas.background` và `canvas.backgroundImage` (đặt thành `undefined`).
- Nếu template được tạo với `canvas.backgroundImage` nào đó (vd seed cũ, hoặc set qua URL) → bị wipe.
- Nhưng ảnh nền hiện tại được lưu dưới dạng **slot ảnh có `isUploadedBackground:true` + `staticImage: "idb://..."`** → vẫn nên hiện.

Còn nguyên nhân thực ở screenshot user gửi (`image-9.png`): block ảnh nền ở trên cùng (frame to) hiển thị **icon ảnh hỏng** (📄) → tức `<img src>` rỗng/sai. Đây là vì khi reload, slot này có `staticImage = "idb://<key>"` → trong `EditorCanvas` line 236 và `BindCanvas` line 165 đang fallback `useResolvedImageSrc(...) ?? slot.staticImage` — khi resolver chưa kịp trả URL thật, fallback **trả luôn chuỗi `"idb://..."`** → trình duyệt cố load → hỏng. Đồng thời nếu `idb://` đó tham chiếu đến blob đã bị xoá (vì lưu ở session khác / DB clear) → vĩnh viễn không có URL.

**Fix:**
- Trong cả 3 nơi (`EditorCanvas`, `BindCanvas`, `PageRenderer`), **không fallback về `idb://` string** — chỉ render `<img>` khi resolver đã trả URL thật. Nếu chưa có → render placeholder loading thay vì broken `<img>`.
- `EditorPage.save()` **không xoá** `canvas.background/backgroundImage` nữa (giữ nguyên những gì designer đã set).
- Bổ sung cảnh báo trong panel ảnh nếu `slot.staticImage` bắt đầu bằng `idb://` mà resolver trả `null` → hiện nút "Upload lại ảnh nền".

### 2) Trùng dữ liệu giữa các block
Hiện tại `resolveTextBinding` / `resolveImageBinding` chỉ chạy theo **từng slot** một cách độc lập — không biết slot khác đã dùng gì. Nên 2 textbox cùng bind `entity.name` đều ra "Homestay Trên Đồi", 2 block ảnh cùng bind `asset.cover` đều ra cùng 1 ảnh.

User đã chốt:
- **Text: không cho chọn trùng** (slot khác đã chiếm field thì dropdown disable lựa chọn đó).
- **Image: mỗi block 1 ảnh khác nhau** (auto-rotate asset trong cùng entity, fallback nếu hết).

**Fix text — UI cứng:**
- Trong panel binding ở `routes/generate.tsx`, tính `usedTextFields = Set<bindingPath>` từ `effectiveTpl.slots` (kind=text, đã có bindingPath, khác slot đang chọn).
- Trong dropdown text, render option `disabled` nếu `usedTextFields.has(option.value)`. Hiển thị badge "đã dùng ở block khác".
- Vẫn giữ option "Cố định" luôn enabled.

**Fix image — auto khác nhau khi render:**
- Sửa logic render trong `BindCanvas` + `PageRenderer`: thay vì gọi `resolveImageBinding` riêng từng slot, xây trước **kế hoạch bind ảnh cấp page** trong `useMemo`:
  1. Lọc danh sách shape/image slot đã có `bindingPath`, sort theo (zIndex asc, slotId).
  2. Tạo `usedAssetIds = Set` cho page hiện tại.
  3. Với mỗi slot, gọi `pickImageForSlot(bindingPath, entity, assets, usedAssetIds)`:
      - Nếu `asset.cover` → ưu tiên cover, nếu cover đã used thì lấy asset chưa used khác (theo qualityScore desc), cuối cùng fallback cover (cho phép trùng nếu hết ảnh).
      - Nếu `asset.byRole:X` → ưu tiên đúng role chưa used, sau đó role khác chưa used, cuối cùng fallback theo role gốc.
  4. Trả `Map<slotId, {src, assetId}>` để render.
- Hiển thị badge debug khi 1 ảnh phải fallback dùng lại.

**Fix text — auto khác nhau (bonus nhỏ):**
Vì user đã không cho trùng ở UI, không cần thêm logic runtime. Giữ `resolveTextBinding` y nguyên.

---

## Files đụng tới

- **Sửa**:
  - `src/storage/imageSrc.ts` — thêm helper `isPendingIdb(src, resolved)` để các nơi render biết "đang chờ resolve" vs "đã hỏng".
  - `src/features/render/PageRenderer.tsx` — bỏ fallback `idb://` ra `<img src>`; thêm `useMemo` build `slotImagePlan` (rotate asset không trùng).
  - `src/features/generate/BindCanvas.tsx` — bỏ fallback `idb://`; dùng cùng `slotImagePlan`.
  - `src/features/editor/EditorCanvas.tsx` — bỏ fallback `idb://`; placeholder "Đang tải ảnh / Ảnh nền chưa sẵn sàng".
  - `src/features/editor/EditorPage.tsx` — `save()` **không** xoá `canvas.background/backgroundImage`; thêm nút "Thay ảnh" trong panel image cho slot `isUploadedBackground` khi resolver = null.
  - `src/routes/generate.tsx` — dropdown text disable option đã dùng + nhãn "đã dùng".
- **Tạo mới**:
  - `src/engines/binding/imagePlan.ts` — `buildSlotImagePlan(template, entity, assets)` trả `Map<slotId, {src, assetId, fallback?: boolean}>` chia sẻ giữa Bind & Page renderer.

---

## Thứ tự triển khai
1. Sửa fallback `idb://` ở 3 renderer + bỏ wipe background trong save → ảnh nền hiển thị đúng/không bị nuốt sau lưu.
2. Thêm `imagePlan.ts` + thay chỗ gọi `resolveImageBinding` trong 2 renderer → ảnh không trùng.
3. Disable option text đã dùng trong panel binding.
4. Thêm placeholder/cảnh báo cho ảnh nền hỏng + nút thay ảnh.
