# 02 · THẺ RULE UI

**CARD:** UI-RULES  
**VERSION:** UI-CARD-V1  
**PHẠM VI:** Interaction + UI primitives + responsive/platform behavior.

## Control chuẩn

- **Button:** một tap/click = một intent. Không double-fire.
- **Row click:** chỉ select/open nếu project card quy định; không giấu hành động khác trong row.
- **Quantity:** `− 0 +`; UI phản hồi ngay; không xuống âm; không dùng row tap để tăng.
- **SearchInput:** realtime; debounce chỉ khi cần; không bắt Enter nếu không có lý do.
- **TextInput:** font-size/touch target không gây Safari zoom; focus rõ.
- **NumericInput / MoneyInput:** state giữ số thật; format chỉ là hiển thị; dùng inputmode phù hợp.
- **InlineEditInput:** VIEW → EDIT → SAVING → VIEW/ERROR; một đường save duy nhất.
- **PasswordInput:** eye button có hit-area và alignment chuẩn.
- **ComposerInput:** là control riêng; không dùng rule của input form thông thường.

## Overlay chuẩn

Phân biệt rõ:
- Popover;
- ContextMenu;
- BottomSheet;
- Dialog;
- FullscreenViewer;
- Toast.

Không gọi tất cả là popup. Overlay dùng một layer owner; cấm z-index tùy tiện rải khắp feature.

## Loading / Empty / Error

Phân biệt:
- initial loading;
- background refresh;
- action loading;
- pagination loading;
- media loading.

Có dữ liệu cũ thì giữ dữ liệu cũ khi refresh; không trắng màn hình/nháy lại toàn vùng. Empty state thuộc đúng content owner. Lỗi cục bộ báo ở vùng cục bộ.

## Share / ảnh

Feature tạo **share model**; platform/share service quyết định native share, file share hay fallback. Feature không tự viết nhánh Safari/Chrome riêng.

Image viewer là global overlay có owner riêng; zoom/navigation/close không được tranh event với screen phía dưới.

## Touch / Mouse / Keyboard

- Action thiết yếu không phụ thuộc hover, long-press hoặc double-click.
- Touch target phải đủ lớn và không chồng nhau.
- Swipe ngang chỉ dùng cho quan hệ cùng cấp và không phá scroll dọc.
- Escape/back/close phải có owner rõ.
- Khi overlay đóng, focus trả về nguồn mở nếu hợp lý.

## Mobile Safari / Chrome / PWA

Platform chịu trách nhiệm khác biệt:
- safe-area;
- keyboard/visual viewport;
- standalone mode;
- native share;
- install/update capability.

Component không tự viết user-agent branch nếu có thể dùng capability detection.

## Motion

Dùng token motion chung. Ưu tiên opacity/transform. Tránh `transition: all`. Tôn trọng `prefers-reduced-motion`.

## CSS guardrail

Không thêm nếu chưa khai báo owner:
- `100vh` thay cho platform viewport contract;
- `position: fixed` ở feature;
- z-index tùy tiện;
- breakpoint mới;
- selector global rộng để chữa một component;
- override nối tiếp chỉ để thắng specificity.

## JS guardrail

Tránh:
- document-level click handler cho feature nếu component owner xử lý được;
- cùng action có nhiều listener owner;
- DOM query xuyên screen để điều khiển component khác;
- global `window.*` mới nếu module boundary hiện tại có thể dùng import/event contract.

Mỗi thay đổi phải trả lời được: **event sinh ở đâu → owner nào nhận → state nào đổi → vùng nào render lại**.
