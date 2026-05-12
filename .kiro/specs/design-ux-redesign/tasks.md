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
- [x] 12. Đọc toàn bộ Inspector hiện có trong `DesignWorkspace.tsx` (quanh dòng 6715+)
- [x] 13. Lập danh sách tất cả InspectorSection hiện có và mapping sang section mới
- [ ] 14. Tạo `src/features/editor/Inspector/` folder (chuẩn bị chia nhỏ) — SKIP, nâng cấp tại chỗ an toàn hơn

### B.2 — Upgrade InspectorSection wrapper
- [x] 15. Upgrade `InspectorSection` in-place, thêm collapse + localStorage (ux:inspector-section:<title>)
- [x] 16. API backward compat (chỉ thêm optional props `defaultOpen` + `storageKey`)
- [x] 17. Wire tự động collapsible cho tất cả ~15 sections
- [x] 18. Test: click từng section verify open/close và ghi nhớ trạng thái sau reload

### B.3 — NumberField replacement
- [ ] 19-22. SKIP pha hiện tại — DesignWorkspace đã có NumberField custom riêng; migrate sau để tránh phá

### B.4 — Empty state khi không chọn
- [x] 23. Inspector hiển thị EmptyState "Chọn khối để chỉnh" khi không có slot được chọn (DesignWorkspace)
- [x] 24. Pack Generate: EmptyState "Chưa chọn khối" khi selectedSlots empty

### B.5 — Verify Pha B
- [x] 25. `npx tsc --noEmit` pass
- [x] 26. `npx eslint ...` — 0 errors
- [ ] 27. Manual: tạo template mới, chỉnh text/image/shape, verify UX cải thiện (user test)
- [x] 28. Commit + push

**Deliverable:** Inspector sections có collapse/expand ghi nhớ trạng thái, EmptyState nhất quán khi chưa chọn đối tượng.

## Pha C — Pack Generate Wizard Refactor

### C.1 — Chuẩn bị
- [x] 29. Phân tích PackTabContent: liệt kê props và state chính
- [ ] 30. Định nghĩa `GenerateWizardContext` — SKIP, giữ state hiện có an toàn hơn
- [ ] 31. Tạo `src/features/generate/wizard/` folder — SKIP, nâng cấp in-place

### C.2-C.4 — Step UI cải thiện in-place
- [x] 32. StepIndicator 3 bước (Chọn khuôn → Đổ dữ liệu → Xem & xuất) ở header workspace
- [x] 33. EmptyState "Chưa có khuôn mẫu nào" với nút "Tạo khuôn mới"
- [x] 34. EmptyState "Chưa chọn bộ mẫu" thay text plain
- [x] 35. Progress bar "N/M khối đã liên kết" trong panel Liên kết dữ liệu
- [x] 36. EmptyState khi chưa chọn khối trong panel binding
- [ ] 37. Empty state + CollapsiblePanel cho panel trái/phải — để sau, risk cao

### C.5 — Wizard orchestrator
- [ ] 43-45. SKIP — StepIndicator kiểu 3-step đã đủ dẫn dắt user

### C.6 — Rollout
- [x] 46. Không cần feature flag — thay đổi đều additive, backward compatible
- [x] 48. Smoke test: TypeScript + ESLint pass
- [x] 49. Zip-download-structure requirements không bị ảnh hưởng (không đổi logic export)
- [x] 50. Commit + push

**Deliverable:** Pack Generate có step indicator 3 bước, empty states rõ ràng, progress bar binding, không phá workflow hiện có.

## Follow-up & Polish (optional)

- [ ] 51. Virtualize layers list trong DesignWorkspace (nếu >100 khối)
- [ ] 52. Dark mode audit: kiểm tra tương phản ở mọi panel
- [ ] 53. Screen reader audit: aria-label cho nút icon-only
- [ ] 54. Performance profile với React DevTools: Profiler trên Pack Generate
- [ ] 55. Document cho team: README trong `src/components/ux/` giải thích cách dùng
