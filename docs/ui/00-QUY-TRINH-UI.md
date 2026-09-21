# 00 · QUY TRÌNH SỬA UI

**CARD:** UI-WORKFLOW  
**VERSION:** UI-CARD-V1  
**PHẠM VI:** Chỉ UI/UX, layout, interaction, responsive, PWA shell. Không mô tả database, API hay nghiệp vụ dữ liệu.

## Thứ tự đọc bắt buộc

1. `00-QUY-TRINH-UI.md`
2. `01-THE-CHUNG-UI.md`
3. `02-THE-RULE-UI.md`
4. `10-THE-<DU-AN>-UI.md`

Không sửa UI chỉ dựa vào ảnh nhìn thấy trước khi xác định owner.

## Quy trình 8 bước

1. **Xác định tầng:** P0 Platform → P1 Shell → P2 Screen/Workspace → P3 Component → P4 Control.
2. **Xác định owner:** file/module nào đang sở hữu kích thước, scroll, focus, overlay, event hoặc visual rule gây ra hiện tượng.
3. **Kiểm tra cha trước con:** nếu geometry của P3 sai do P1/P2 thì sửa P1/P2; cấm vá P3 để che lỗi cha.
4. **Kiểm tra các chế độ liên quan:** mobile touch, desktop fine-pointer, browser và PWA nếu dự án có PWA.
5. **Ghi phạm vi:** cái gì phải thay đổi và cái gì bắt buộc không được thay đổi.
6. **Sửa tại owner nhỏ nhất đúng tầng:** không thêm override/global handler nếu owner hiện tại có thể sửa trực tiếp.
7. **Verify:** kích thước nhỏ/lớn, Safari/Chrome phù hợp, keyboard/focus/scroll, trạng thái rỗng/loading/error và thao tác chính của vùng.
8. **Cập nhật thẻ dự án chỉ khi ownership thay đổi.** Không ghi nhật ký dài theo từng pixel.

## Mẫu ghi trước khi sửa

```text
UI-LAYER:
OWNER:
PROBLEM:
CHANGE:
MUST-STAY:
VERIFY:
```

## Điều kiện hoàn thành

Một thay đổi UI chỉ được coi là xong khi:
- owner rõ;
- không tạo owner thứ hai cho cùng trách nhiệm;
- không làm phát sinh breakpoint/z-index/global event tùy tiện;
- cha và các con trực tiếp vẫn đúng;
- project card vẫn mô tả đúng cấu trúc sau thay đổi.
