
# Kế hoạch xây dựng — Content Pack Generator (tiếng Việt, local-first)

## 1. Định hướng tổng thể
- **Stack**: React + TypeScript + TanStack Router (đã có sẵn), TailwindCSS, shadcn/ui, Zustand cho state, Dexie cho IndexedDB.
- **Render PNG**: HTML/CSS + `html-to-image` (WYSIWYG editor = renderer, đảm bảo preview giống ảnh xuất).
- **Editor**: Canvas kéo thả tự do (free-form), zoom/pan, snap guide, resize/rotate/group, property panel.
- **Khổ ảnh**: cho phép tự nhập khi tạo template; gợi ý preset 1080×1350, 1080×1920, 1080×1080.
- **Caption**: chỉ generator local rules tiếng Việt; màn Cài đặt vẫn để chỗ trống cho API key sau này.
- **Không auth, không backend, không cloud DB.** Toàn bộ dữ liệu trong IndexedDB; export/import JSON.
- **UI 100% tiếng Việt.**

## 2. Kiến trúc thư mục
```
src/
  models/           # types: Entity, Asset, Slot, Section, PageTemplate, PackTemplate, Job, Manifest, Caption
  storage/          # Dexie DB, repositories, import/export project JSON
  features/
    editor/         # canvas free-form, blocks, property panel, snap, zoom
    templates/      # CRUD page templates
    packs/          # pack builder
    data/           # CSV/JSON import, Google Sheets CSV fetch, normalize, mapping UI, entity/asset viewer
    generate/       # selection engine, scoring, anti-repeat, asset-safe binding, preview, health score
    reports/        # manifest, partners summary/csv
    captions/       # rules-based VN caption generator
    history/        # job history
  engines/
    selection/      # PartnerAwareSelectionEngine (priorityShuffleV2)
    scoring/
    binding/        # asset-safe binding
    render/         # html-to-image + ZIP
    normalize/      # field aliases
  utils/
  routes/           # TanStack routes
  components/ui/    # shadcn
```

## 3. Data model (TypeScript) — các entity chính
Entity, Asset (gắn entityId), Slot, Section, PageTemplate (canvas+elements+slots+sections), PackTemplate (orderedPages, captionProfile), GenerationJob, RenderManifest (preview vs final), CaptionVariant — đúng theo spec bạn đã liệt kê.

## 4. Các màn hình (routes)
1. `/` Dashboard — danh sách project local, tạo mới, mở demo, import/export project JSON.
2. `/templates` — list page templates, tạo/sửa/duplicate/xóa.
3. `/templates/$id/edit` — Page Template Editor (canvas free-form).
4. `/packs` — list & builder ghép page templates thành pack.
5. `/data` — import CSV/JSON/ảnh, paste Google Sheet link, mapping fields, xem entities/assets normalize.
6. `/generate` — chọn pack, cấu hình, chạy engine, preview pages với health score, pin/exclude/regenerate, tick chọn export.
7. `/reports` — partners summary/CSV, manifest preview vs final, caption variants, copy/export.
8. `/history` — danh sách job local.
9. `/settings` — caption provider (chỉ local Phase 1, có chỗ cho API key), reset data, import/export.

## 5. Page Template Editor (free-form)
- Canvas SVG/HTML với zoom (Ctrl+wheel), pan (space-drag).
- Blocks: Text, Image, Shape (rect/circle/line), Badge, Icon, Divider, Group, Section container, Slot repeater, Section list repeater, Card panel, Section title pill, Price badge, Bullet list.
- Thao tác: select, multi-select, drag, resize 8 handle, rotate, snap-to-edge/center, align, z-index, lock, group/ungroup, duplicate, delete.
- Property panel: text style đầy đủ (font, size, weight, color, line-height, letter-spacing, align, shadow, stroke, max-lines, overflow), image style (cover/contain, radius, shadow, overlay, allowedAssetRoles), binding path tới data field.
- Component preset có sẵn: Cover title, Subtitle, Price badge, Rounded thumb, Itinerary item, Section title pill, Board panel, Bullet list item, Hotline row, Address row.

## 6. Data import & Normalize
- Parser CSV (papaparse), JSON, ảnh local → IndexedDB blob.
- Google Sheets: nhận link share → tự convert sang `export?format=csv` & `gviz/tq?tqx=out:csv`; nếu fail hiển thị hướng dẫn publish CSV bằng tiếng Việt.
- Normalize: field alias map (partner/name/address/image/category…), tách asset theo entityId, gán role mặc định, phát hiện ảnh URL/local.
- Mapping UI: bảng cột nguồn ↔ field chuẩn, preview 5 dòng đầu.

## 7. Engines (logic thật, không mock)
- **PartnerAwareSelectionEngine (priorityShuffleV2)**: filter theo pack/page/section intent → scoring → áp partner mode (`strict_partner` / `priority_partner` / `balanced_partner`) → anti-repeat 4 mức (entity trong page, giữa pages, asset, semantic) → trả về kèm reason codes.
- **Scoring**: partner boost, category/subcategory match, section match, campaign match, asset quality, diversity, repetition penalty, conflict penalty.
- **Asset-safe binding**: chọn entity TRƯỚC, asset chỉ được lấy trong pool thuộc entityId đó. Mọi binding log assetId. Có debug overlay hiện entityId/assetId/partner.
- **Validation & Health Score**: data/image/layout validation, overflow policy (shrink/ellipsis/max-lines/hard-fail), health 0–100 và trạng thái accepted/rejected/needs_fix.

## 8. Preview & Export
- 2 lớp preview: Structural (data/section/partner đủ chưa) + Visual (thumbnail thật).
- Filter: tất cả / đang chọn / có lỗi / có đối tác. Tick từng page hoặc tất cả. Regenerate riêng từng page.
- Manual override: pin/exclude entity & asset, lock section.
- Export: PNG từng page (html-to-image), ZIP tất cả selected (jszip), project JSON, reports, captions.

## 9. Reports & Captions
- `partners_summary.txt` (đọc nhanh), `partners_detailed.csv`, `render_manifest.json` (preview), `final_export_manifest.json` (chỉ pages selected).
- Caption generator local rules tiếng Việt: 4 mode (`save_post`, `newbie_guide`, `review_pack`, `partner_soft`). Headline UPPERCASE <90 ký tự, body <300, đúng 5 hashtag (3 cố định: #riviudalat #dalat #dalatreview + 2 động từ pack). Đọc từ `final_export_manifest`, **không** đọc raw sheet. 3–5 variants/lần.

## 10. Demo seed
- 1 project demo với: 3 page template (cover, itinerary day, board mixed-section), 1 pack template, ~12 entities (quán ăn/cafe/homestay/thuê xe/checkin) trong đó 4 entity là đối tác, ~30 assets có entityId. Mở app là generate được ngay.

## 11. Phase build
- **Phase 1** (lớn nhất): models + Dexie storage + seed demo + page editor free-form + pack builder + data import/normalize + entity/asset viewer.
- **Phase 2**: selection engine + partner logic + asset-safe binding + preview + health score + export PNG/ZIP.
- **Phase 3**: reports/manifests + caption generator + manual overrides + job history + polish.

## 12. Rủi ro & quyết định đã chốt
- Editor free-form là phần nặng nhất → dùng cấu trúc element-tree đơn giản (absolute positioning) thay vì SVG phức tạp; đủ cho social image, vẫn export pixel-perfect qua html-to-image.
- Google Sheets không OAuth → chỉ hoạt động với sheet đã publish/public; có hướng dẫn rõ ràng tiếng Việt khi fail.
- html-to-image cần font load xong trước khi snapshot → preload + `document.fonts.ready` trước export.
- IndexedDB blob ảnh có thể lớn → có nút "Dọn dẹp dữ liệu" trong Cài đặt.

## 13. Tiêu chí hoàn thành
Đáp ứng đủ 13 tiêu chí trong spec: tạo/sửa template, ghép pack, import data + Google Sheet, normalize, generate preview nhiều page, partner priority chạy đúng, không lệch ảnh entity, chọn page export, xuất PNG/ZIP/report/captions, UI tiếng Việt, không auth, lưu local, có demo sẵn.
