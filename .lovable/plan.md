

## Vấn đề & Use case

Bạn cần: 1 page chứa **N "card"** (như ảnh: 4 homestay card dọc), mỗi card gồm nhiều slot (ảnh + tên + địa chỉ + giá). Khi gen, mỗi card auto bind 1 entity khác nhau từ pool đã filter (vd 4 homestay đầu tiên của sheet `Homestay`).

Hiện tại app chặn cứng "không cho 2 textbox cùng bind `entity.name`" — đây là rào cản chính. Đồng thời chưa có khái niệm "card lặp" trong page.

## Giải pháp: Group → Card Repeater

Tận dụng `groupId` đã có sẵn trên Slot. Mỗi group = 1 "card mẫu". Gắn flag `isCardTemplate` cho group → khi render page, app tự **clone group N lần xuống dưới**, mỗi clone bind 1 entity khác.

## Plan triển khai

### Bước 1: Bỏ chặn bind trùng (fix nhanh, 1 file)

`src/routes/generate.tsx` + `src/features/generate/PackTabContent.tsx`:
- Xoá `disabled={isUsed}` ở `<SelectItem>` field text
- Đổi nhãn `(đã dùng)` → `(đã dùng ở slot khác)` để rõ là gợi ý, không phải lỗi
- Vẫn giữ logic gợi ý visual (có nhãn) để user biết

→ Sau bước này: 4 textbox cùng bind `entity.name` được, gen ra cùng hiện tên 1 quán (mirror mode).

### Bước 2: Card Group (feature mới — cho use case grid 4 card 4 quán)

**Model (`src/models/index.ts`)**:
```ts
interface PageTemplate {
  // mới:
  cardGroups?: Array<{
    groupId: string;
    repeatCount: number;     // số card sẽ clone (vd 4)
    gap: number;             // khoảng cách giữa card (px)
    direction: "vertical" | "horizontal";
    entitySource?: {
      sheetName?: string;    // pool entity từ sheet nào
      filterRules?: FilterRule[];
    };
  }>;
}
```

**Editor (`EditorPage.tsx`)**:
- Khi user chọn ≥2 slot cùng groupId → hiện panel "Biến group thành Card Repeater"
- Input: số lượng card, gap, direction, sheet nguồn
- Lưu vào `pageTemplate.cardGroups`

**Renderer mới (`src/engines/binding/cardRepeater.ts`)**:
- Trước render, scan `cardGroups`. Với mỗi group:
  - Lấy bbox của tất cả slot trong group
  - Lấy `repeatCount` entity từ pool
  - Clone slot N-1 lần, mỗi clone offset theo direction × gap, gán `__entityOverride` = entity[i]
- `PageRenderer` resolve binding theo `__entityOverride` nếu có, fallback entity gốc

**Generate (`src/engines/selection/generate.ts`)**:
- Thêm mode `"grid-cards"`: 1 page = 1 batch entity (vd page 1 = entity 1-4, page 2 = entity 5-8…)
- Hoặc giữ mode hiện tại, để cardRepeater tự ăn pool

### Bước 3: UX hỗ trợ

- Trong `BindCanvas` hiện preview các card đã clone (mờ + label "Card 2 of 4: Homestay X")
- Field panel: khi chọn slot trong card group → show indicator "Block này thuộc Card mẫu, sẽ lặp 4 lần"

## Phạm vi đề xuất

| Phase | Nội dung | Ưu tiên |
|---|---|---|
| **1** | Bỏ chặn bind trùng + đổi nhãn | Làm ngay |
| **2** | Card Group repeater (model + editor + render) | Làm tiếp sau Phase 1 |
| **3** | UX preview card lặp trong canvas | Polish cuối |

**Đề xuất**: Triển khai **Phase 1 ngay** (5 phút, fix lỗi blocking hiện tại) → bạn test xong nếu OK thì tiếp Phase 2 (~30-40 phút, feature mới).

Confirm để mình switch sang default mode và code.

