# Implementation Tasks — Design UX Redesign

## Pha A — Design Tokens & Primitives ✅ DONE

- [x] 1. Mở rộng `src/styles.css` với spacing scale, typography scale, shadow scale
- [x] 2. Thêm utility classes: `.focus-ring`, `.inspector-section`, `.ux-panel`, `.ux-kbd`, `.ux-number-input`
- [x] 3. Tạo `src/components/ux/CollapsiblePanel.tsx`
- [x] 4. Tạo `src/components/ux/InspectorSection.tsx`
- [x] 5. Tạo `src/components/ux/NumberField.tsx`
- [x] 6. Tạo `src/components/ux/StepIndicator.tsx`
- [x] 7. Tạo `src/components/ux/EmptyState.tsx`
- [x] 8. Tạo `src/components/ux/Kbd.tsx`
- [x] 9. Tạo `src/components/ux/ShortcutsDialog.tsx` + hook riêng `useShortcutsDialogHotkey.ts`
- [x] 10. Tạo `src/components/ux/index.ts` (barrel export)
- [x] 11. Wire ShortcutsDialog vào `AppShell.tsx` (phím "?" + command palette entry)

**Deliverable:** App chạy được, `?` mở dialog phím tắt, tokens mới sẵn sàng dùng.

## Pha B — Design Workspace Inspector Refactor

### B.1 — Chuẩn bị
- [ ] 12. Đọc toàn bộ Inspector hiện có trong `DesignWorkspace.tsx` (quanh dòng 6715+)
- [ ] 13. Lập danh sách tất cả InspectorSection hiện có và mapping sang section mới
- [ ] 14. Tạo `src/features/editor/Inspector/` folder (chuẩn bị chia nhỏ)

### B.2 — Upgrade InspectorSection wrapper
- [ ] 15. Tạo `src/features/editor/Inspector/InspectorSectionCard.tsx` — wrapper mới dùng UX InspectorSection
- [ ] 16. Tạo prop `collapsible?: boolean` trong InspectorSection cũ trong DesignWorkspace (backward compat)
- [ ] 17. Wire collapsible cho 5 sections lớn nhất: Transform, Text Style, Fill, Border, Effects
- [ ] 18. Test: click từng section verify open/close và ghi nhớ trạng thái sau reload

### B.3 — NumberField replacement
- [ ] 19. Xác định các ô `<Input type="number">` trong Inspector (dùng grep)
- [ ] 20. Thay X/Y/W/H/rotation bằng NumberField với prefix/suffix (W, H, °, px)
- [ ] 21. Thay fontSize, letterSpacing, lineHeight bằng NumberField
- [ ] 22. Test: Shift+Arrow = 10 step, Alt+Arrow = 0.1, nhập công thức `100+20`

### B.4 — Empty state khi không chọn
- [ ] 23. Inspector hiển thị EmptyState "Chọn khối để chỉnh" khi không có slot được chọn
- [ ] 24. Inspector hiển thị "Đang chọn N khối" khi multi-select

### B.5 — Verify Pha B
- [ ] 25. `npx tsc --noEmit` pass
- [ ] 26. `npx eslint src/features/editor src/features/generate --max-warnings=0` pass
- [ ] 27. Manual: tạo template mới, chỉnh text/image/shape, verify UX cải thiện
- [ ] 28. Commit + push

**Deliverable:** Inspector có accordion collapse, NumberField nhập công thức, EmptyState.

## Pha C — Pack Generate Wizard Refactor

### C.1 — Chuẩn bị
- [ ] 29. Phân tích PackTabContent: liệt kê props và state chính
- [ ] 30. Định nghĩa `GenerateWizardContext` type (share state giữa 3 bước)
- [ ] 31. Tạo `src/features/generate/wizard/` folder

### C.2 — Step 1 — Chọn khuôn
- [ ] 32. Tạo `GenerateStepPack.tsx`: grid các PackTemplate với thumbnail
- [ ] 33. Hiển thị `selectedPack` state từ parent
- [ ] 34. Nút "Tiếp tục" disable nếu chưa chọn

### C.3 — Step 2 — Đổ dữ liệu
- [ ] 35. Tạo `GenerateStepBind.tsx`: layout 3 panel (trái=layers/fields, giữa=canvas, phải=binding panel)
- [ ] 36. Dùng CollapsiblePanel cho panel trái và phải
- [ ] 37. Empty state khi chưa chọn slot: "Bấm khối để chọn"
- [ ] 38. Progress bar "N/M khối đã bind"

### C.4 — Step 3 — Xem & xuất
- [ ] 39. Tạo `GenerateStepReview.tsx`: grid theo nhóm Bộ N
- [ ] 40. Filter bar: Tất cả / Đã chọn / Có lỗi / Có đối tác
- [ ] 41. Nút "Xuất ZIP bộ này" mỗi bộ + "Xuất ZIP tất cả" toàn trang
- [ ] 42. Preserve: virtualization khi >40 trang

### C.5 — Wizard orchestrator
- [ ] 43. Tạo `GenerateWizard.tsx`: StepIndicator + state step + step content
- [ ] 44. Step enablement: Step 2 cần pack đã chọn; Step 3 cần đã generate
- [ ] 45. Persist current step trong sessionStorage

### C.6 — Rollout
- [ ] 46. Thêm feature flag `VITE_NEW_UI=1` trong `generate.tsx` để toggle PackTabContent vs GenerateWizard
- [ ] 47. Default flag off; enable khi test xong
- [ ] 48. Smoke test: workflow đầy đủ tạo 40 pages → bind → export ZIP
- [ ] 49. Verify zip-download-structure requirements vẫn pass
- [ ] 50. Commit + push + release notes

**Deliverable:** Pack Generate có wizard 3 bước, panel collapse, empty states, dễ dùng hơn.

## Follow-up & Polish (optional)

- [ ] 51. Virtualize layers list trong DesignWorkspace (nếu >100 khối)
- [ ] 52. Dark mode audit: kiểm tra tương phản ở mọi panel
- [ ] 53. Screen reader audit: aria-label cho nút icon-only
- [ ] 54. Performance profile với React DevTools: Profiler trên Pack Generate
- [ ] 55. Document cho team: README trong `src/components/ux/` giải thích cách dùng
