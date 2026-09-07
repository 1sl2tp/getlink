# GETLINK — Price Tracker

Theo dõi giá sản phẩm từ link web, bắt đầu với Bách Hóa XANH.

## Mục tiêu dữ liệu

Mỗi sản phẩm được chuẩn hóa thành 3 lớp:

1. Giá nguồn — giá hiện tại trên website nguồn.
2. Ưu đãi — nội dung/giá khuyến mãi nếu phát hiện được.
3. Giá của mình — dữ liệu do mình sở hữu, scraper không tự ghi đè.

Ngoài ra lưu nguồn, nhóm, nhánh, tên, quy cách, trạng thái theo dõi, ảnh, link gốc, thời điểm kiểm tra và lịch sử giá.

## Cách chạy

Sau khi merge workflow vào main:

1. Mở Actions → BHX price tracker.
2. Chọn Run workflow.
3. Dán URL sản phẩm hoặc URL danh mục.
4. Có thể nhập Giá của mình và chọn Theo dõi.
5. Workflow chạy Playwright, cập nhật data/products.json + data/products.csv và commit kết quả về main.

Workflow cũng chạy theo lịch để cập nhật lại các sản phẩm đã đánh dấu watch=true.

## Owner dữ liệu

Scraper được phép cập nhật:
- source
- group
- branch
- name
- packaging
- competitor price
- promotion
- image
- last_checked_at
- history

User-owned, scraper chỉ thay khi có lệnh rõ ràng:
- my_price
- watch
- short_name
- note

## Lưu ý

- Không bypass CAPTCHA/anti-bot.
- Không rotate IP.
- Parser ưu tiên JSON-LD/meta trước rồi mới fallback DOM/text.
- GitHub Pages là giao diện tĩnh; việc scrape chạy bằng GitHub Actions.
