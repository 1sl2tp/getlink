# 01 · THẺ CHUNG UI

**CARD:** UI-COMMON  
**VERSION:** UI-CARD-V1  
**ÁP DỤNG:** TAPHOAXYZ · CHAT · GETLINK  
**MỤC TIÊU:** Cùng một cách tổ chức UI dù giao diện và nghiệp vụ mỗi web khác nhau.

## Cây ownership chuẩn

```text
P0 PLATFORM / DEVICE
        ↓
P1 APP SHELL
        ↓
P2 SCREEN / WORKSPACE / REGION
        ↓
P3 COMPONENT
        ↓
P4 CONTROL / ACTION STATE
```

### P0 · Platform / Device — cha gốc

Sở hữu duy nhất:
- viewport / `dvh` / safe-area;
- keyboard mobile và focus policy;
- touch, pointer, hover capability;
- browser/PWA differences;
- scroll nền, overscroll;
- share capability;
- motion/reduced-motion;
- app update/reload safety;
- layer root cho overlay.

Feature không được tự sniff Safari/iPhone/PWA nếu Platform có thể trả capability.

### P1 · App Shell — cha bố cục

Sở hữu:
- biên toàn app;
- header/navigation;
- vùng content;
- sidebar/master/detail ở desktop;
- bottom navigation;
- scroll owner cấp trang;
- global overlay root.

P1 không biết chi tiết một dòng đơn hàng hay một card sản phẩm.

### P2 · Screen / Workspace / Region — mẹ

Ví dụ: Sales, Orders, Debt, Conversation, Work, Catalog, Product Detail.

Sở hữu:
- bố cục trong screen;
- vùng list/detail/table;
- screen-level empty/loading state;
- screen scroll phụ nếu được Shell cho phép.

P2 không được sửa `body`, app viewport hoặc global overlay policy.

### P3 · Component — con

Ví dụ: OrderRow, ProductCard, CustomerRow, SourceSummary, Dialog, BottomSheet, ImageViewer.

Sở hữu box, nội dung, visual state và event của chính component.

### P4 · Control / Action state — cháu

Ví dụ: Button, QuantityControl, SearchInput, MoneyInput, InlineEditInput.

Sở hữu trạng thái tương tác nhỏ nhất. Một thao tác người dùng phải có một owner.

## Luật cha/con

- Cha quy định **không gian và luật**; con chỉ bố trí bên trong phần được cấp.
- Con không dùng CSS để bù geometry sai của cha.
- Một trục chỉ có một scroll owner chính.
- Một focus transition có một owner.
- Một overlay chỉ mount qua overlay owner.
- Mobile/desktop/PWA dùng cùng source; khác nhau do Platform + Shell quyết định.
- Không coi desktop là mobile bị kéo rộng, cũng không coi mobile là desktop bị ép nhỏ.

## Mục tiêu kiến trúc

Đọc tree là biết nơi sửa. Không cần nhớ toàn bộ lịch sử dự án.
