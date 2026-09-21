# 10 · THẺ UI GETLINK

**CARD:** UI-GETLINK  
**VERSION:** UI-CARD-V1  
**TRẠNG THÁI:** Production supermarket-only current structure.  
**PHẠM VI:** Chỉ UI.

## Chế độ hiển thị

- Desktop web và mobile web dùng cùng source.
- Hiện **không có PWA/service worker/manifest**.
- Có auto-update riêng bằng `version.json` + build id trong `index.html`; reload khi UI đang ở trạng thái an toàn.
- GETLINK hiện là browse/catalog; không đưa UI bán hàng/Tạp hóa legacy trở lại.

## Owner hiện tại

### P0 Platform
Hiện nằm chủ yếu trong `index.html`:
- build/version check;
- safe reload;
- focus/visibility/online handling.

Chưa có Platform module riêng. Nếu cần thêm browser-specific behavior, ưu tiên tạo owner rõ thay vì tiếp tục tăng inline script.

### P1 Shell
Hiện bị gộp trong:
- `index.html`
- `style.css`
- `app.js`

Chưa có shell module riêng.

### P2 Screen / Workspace
- catalog/search;
- source filters;
- pack/category/filter region;
- product list/grid;
- product detail;
- admin/source management nếu hiện diện.

### P3 Component
- product card;
- source chip/tab;
- search field;
- filter controls;
- product detail sections;
- image/media.

### P4 Control
- source switch;
- filter toggle;
- search input;
- view mode;
- admin edit controls khi có.

## Responsive contract hiện tại

`style.css` đang có nhiều breakpoint lịch sử. Đây là nợ UI lớn.

Rule từ giờ:
- không thêm breakpoint mới chỉ để chữa một device;
- trước tiên xác định Shell/Screen owner;
- ưu tiên quy về các mode semantic: mobile/touch, compact, desktop/fine-pointer;
- khi thay đổi hệ breakpoint phải cập nhật thẻ này và verify các nhóm viewport.

## Rule đặc biệt GETLINK

- Browse phải phản hồi tức thì; source switch không phá DOM/image cache/scroll nếu không cần.
- Product card không chứa quantity/order action.
- Hình ảnh không được méo vì card geometry; media box owner phải cố định aspect/fit policy.
- Search realtime; không bắt Enter để có kết quả.
- Background refresh không được làm grid nháy/rebuild toàn bộ nếu dữ liệu không đổi.
- Dormant legacy files `taphoa-*`, `order-management-*` không phải owner của production UI hiện tại.

## Nợ UI hiện tại

- `app.js` khoảng 240k ký tự;
- `style.css` khoảng 407k ký tự;
- shell, screen và component đang trộn trong monolith;
- breakpoint nhiều và có lịch sử patch.

Target là tách source theo owner nhưng giữ production boot nhẹ.

```text
src/
  platform/
  shell/
  components/
  features/
    catalog/
    search/
    sources/
    detail/
    admin/
  styles/
```

## Câu hỏi bắt buộc trước khi sửa

**Thay đổi này thuộc shell catalog, screen/filter, product component hay control?**  
Nếu chưa rõ thì không thêm selector/breakpoint mới.
