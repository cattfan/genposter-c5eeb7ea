# Technical Design — Design UX Redesign

## Overview

Tài liệu thiết kế kỹ thuật cho việc tái thiết kế UI/UX của Design Workspace và Pack Generate. Triển khai theo 3 pha độc lập, mỗi pha merge được và app vẫn chạy bình thường sau mỗi pha.

## Nguyên tắc kiến trúc

1. **Không đụng data model.** Mọi thay đổi chỉ ở lớp presentation. Các type trong `src/models/index.ts`, schema IndexedDB, engine logic giữ nguyên.
2. **Additive trước, replace sau.** Tạo component UX mới trong `src/components/ux/`, áp dụng song song với component cũ. Chỉ xoá cũ khi đã chuyển hết và test kỹ.
3. **Chia pha theo rủi ro.** Pha A (thấp — tokens, primitives), Pha B (trung — inspector, canvas), Pha C (cao — redesign PackTabContent và DesignWorkspace layout chính).
4. **Theme-aware.** Dùng CSS variables từ `src/styles.css`, không hard-code màu.
5. **Keyboard-first.** Mọi chức năng mới phải có phím tắt hoặc truy cập qua Command Palette.

## Kiến trúc tổng thể

```
src/
├── components/
│   ├── ux/                    # NEW - UX primitives dùng chung
│   │   ├── CollapsiblePanel   # Panel thu gọn/mở rộng (Req 3)
│   │   ├── InspectorSection   # Accordion section (Req 6)
│   │   ├── NumberField        # Input số có công thức (Req 6.6)
│   │   ├── StepIndicator      # Wizard steps (Req 11)
│   │   ├── EmptyState         # Placeholder nhất quán
│   │   ├── Kbd                # Hiển thị phím tắt
│   │   └── ShortcutsDialog    # Bảng phím tắt (Req 10.5)
│   ├── AppShell.tsx           # MODIFIED - wire shortcuts hotkey
│   └── CommandPalette.tsx     # KEEP - đã có sẵn
├── features/
│   ├── editor/
│   │   ├── DesignWorkspace    # REFACTOR dần (Pha B)
│   │   ├── EditorCanvas       # REFACTOR (Pha B)
│   │   └── Inspector/         # NEW folder, chia nhỏ inspector
│   └── generate/
│       ├── PackTabContent     # REFACTOR (Pha C) — chia thành sub-components
│       ├── GenerateWizard     # NEW (Pha C) — wrapper 3 bước
│       └── BindingPanel       # NEW (Pha C) — tách logic bind panel
└── styles.css                 # MODIFIED - thêm tokens và utilities
```

## Design Tokens (Pha A)

**Spacing scale** (đã thêm):
```
--spacing-1:  4px   --spacing-5:  20px
--spacing-2:  8px   --spacing-6:  24px
--spacing-3:  12px  --spacing-8:  32px
--spacing-4:  16px  --spacing-12: 48px
```

**Typography scale** (đã thêm):
```
--text-xs:   12px    --text-lg:   16px
--text-sm:   13px    --text-xl:   18px
--text-base: 14px    --text-2xl:  24px
```

**Shadow scale** (đã thêm):
```
--shadow-sm: 0 1px 2px    rgba(foreground, 6%)
--shadow-md: 0 4px 12px   rgba(foreground, 10%)
--shadow-lg: 0 12px 32px  rgba(foreground, 14%)
```

Màu sắc đã dùng oklch từ trước và có light/dark, không cần thay đổi.

## UX Primitives (Pha A — DONE)

### CollapsiblePanel
Panel trái/phải có thể thu gọn, lưu `{collapsed, width}` trong localStorage theo `storageKey`.
- Props: `storageKey`, `side`, `title`, `collapsedIcon`, `defaultWidth`, `minWidth`, `maxWidth`.
- Handle resize bằng kéo thanh chia.
- Khi thu gọn, hiện thanh 40px chỉ icon.

### InspectorSection
Accordion section, ghi nhớ open/closed per-key.
- Props: `storageKey`, `title`, `icon`, `defaultOpen`, `badge`, `children`.
- Lưu `ux:inspector:{storageKey}` trong localStorage.

### NumberField
Input số UX chuẩn:
- Shift+Arrow = bước 10, Alt+Arrow = 0.1.
- Công thức: `100+20`, `50*2`, `200/2`.
- Props: `value`, `onChange`, `min`, `max`, `step`, `suffix`, `allowFloat`, `mixed`, `prefix`.

### StepIndicator
Wizard 3 bước cho Pack Generate.
- Props: `steps[]`, `current`, `completed[]`, `onStepClick`.
- Hiển thị số bước / check icon khi đã xong.

### EmptyState
Placeholder nhất quán khi không có data.
- Props: `icon`, `title`, `description`, `action`, `compact`.

### Kbd
Hiển thị phím tắt với symbol Mac nếu trên Mac (⌘⌥⇧).

### ShortcutsDialog + useShortcutsDialogHotkey
Dialog liệt kê phím tắt, mở bằng `?` toàn cục hoặc qua Command Palette.

## Pha B — Design Workspace Inspector

### Mục tiêu
Giảm scroll, tăng khả năng tìm thuộc tính nhanh. Hiện Inspector là một stack dài — khó scan.

### Thiết kế
1. **Wrap mỗi InspectorSection cũ bằng UX InspectorSection mới** để có thể collapse. Giữ storageKey = tên section (ví dụ "transform", "text-style", "fill").
2. **Section mặc định mở theo loại khối:**
   - Text: "Kiểu chữ" + "Màu chữ" mở
   - Image: "Viền & bo góc" + "Hiệu ứng" mở
   - Shape: "Màu nền" + "Viền" mở
   - Multi-select: chỉ "Vị trí & kích thước" mở
3. **Thay các ô số plain bằng NumberField** cho X/Y/W/H/rotation/fontSize.
4. **Thêm label tiếng Việt** nhất quán cho các nhóm.

### API thay đổi
Không. Inspector cũ giữ nguyên props; chỉ nâng cấp component con.

### Risks
- Inspector lớn, có risk break nếu refactor cùng lúc. Làm incremental: 1 section/lần, verify bằng build + manual smoke test.

## Pha C — Pack Generate Wizard

### Mục tiêu
Chia Pack Generate 3900 dòng thành 3 màn hình tuần tự để người dùng không bị choáng.

### Thiết kế

```
┌─────────────────────────────────────────────┐
│ [1. Chọn khuôn] > [2. Đổ dữ liệu] > [3. Xem]│  ← StepIndicator
├─────────────────────────────────────────────┤
│                                             │
│  Bước 1: Grid các PackTemplate              │
│     (hiện tại: dropdown trong header)       │
│                                             │
│  Bước 2: CollapsiblePanel trái (layers)     │
│          Canvas (BindCanvas hiện tại)       │
│          CollapsiblePanel phải (fields)     │
│                                             │
│  Bước 3: Grid thumbnails theo Bộ N          │
│          Nút "Xuất ZIP" theo bộ hoặc tất cả │
│                                             │
└─────────────────────────────────────────────┘
```

### Components mới
- `GenerateWizard.tsx` — orchestrator, chứa state step + navigation.
- `GenerateStepPack.tsx` — bước 1 (chọn pack template).
- `GenerateStepBind.tsx` — bước 2 (wrap BindCanvas + binding panel).
- `GenerateStepReview.tsx` — bước 3 (review + export).

### Migration strategy
1. Đầu tiên tạo các sub-component nhưng chưa kết nối.
2. Tái sử dụng state + handlers từ PackTabContent (pass props xuống).
3. Sau khi sub-components stable, thay PackTabContent bằng GenerateWizard.
4. Giữ PackTabContent.tsx cũ làm rollback ít nhất 1 release.

## Migration & Backward Compatibility

- **IndexedDB schemas:** KHÔNG đổi. Test: mở app với data cũ, tất cả template/entity/job hiện đầy đủ.
- **LocalStorage keys mới:** `ux:panel:*`, `ux:inspector:*` — không xung đột với `cpg_*` cũ.
- **Feature flag (optional):** `VITE_NEW_UI=1` có thể dùng để bật/tắt GenerateWizard khi dev. Không bắt buộc cho Pha A.

## Testing Strategy

### Pha A (DONE)
- TypeScript + ESLint pass.
- Manual: refresh app, verify `?` mở ShortcutsDialog.
- Manual: Command Palette (Ctrl+K) có entry "Xem danh sách phím tắt".

### Pha B
- Manual: mở một template, click các text/image/shape slot, verify inspector sections open/close đúng loại.
- Manual: đổi giá trị NumberField bằng Shift+Arrow, Alt+Arrow, công thức.

### Pha C
- E2E: tạo 1 pack → chọn bước 1 → bind bước 2 → export bước 3.
- Verify ZIP structure giữ nguyên spec zip-download-structure.
- Regression: đảm bảo các preset đã lưu load được ở bước 2.

## Performance Considerations

- CollapsiblePanel dùng state local, không re-render cây khi đổi width.
- InspectorSection lazy render content (chỉ mount children khi open).
- Pack Generate Step 3: giữ virtualization đã có khi >40 trang.

## Rollout Plan

| Pha | Thời gian ước | Files changed | Risk |
|-----|---------------|---------------|------|
| A   | 1 turn (done) | +7 new, 2 mod | Low  |
| B   | 3-5 turns     | ~8 inspector  | Med  |
| C   | 5-8 turns     | ~15 pack/gen  | High |

Mỗi turn cần verify: `tsc --noEmit`, `eslint`, manual smoke test workflow chính.
