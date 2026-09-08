# GETLINK — Price Catalog

GETLINK là catalog giá tạp hóa lấy dữ liệu từ Bách Hóa XANH, WinMart và GO!, chuẩn hóa về một kho Supabase rồi hiển thị qua giao diện tĩnh.

## Kiến trúc hiện tại

```text
GitHub Pages / get.taphoa.xyz
        |
        v
Supabase Edge Function: getlink-api
        |
        +-- Supabase Postgres (nguồn dữ liệu chính)
        |
        +-- WinMart API
        +-- GO! API
        +-- Cloudflare Worker -> BHX API
```

### Owner từng lớp

- **GitHub**: source code, review, test, workflow, Pages.
- **GitHub Pages**: chỉ giao diện tĩnh; không giữ service-role key.
- **Supabase Edge Function**: API công khai của GETLINK, chuẩn hóa dữ liệu, phân loại, ghi/đọc database.
- **Supabase Postgres**: source of truth cho link, giá, identity, phân loại, quy tắc và preference.
- **Cloudflare Worker**: transport-only cho BHX; không lưu database và không chứa business logic.
- **GitHub Actions**: verify, smoke, deploy relay và tác vụ định kỳ. Không nằm trên đường request trực tiếp khi người dùng bấm Getlink.

## Bảo mật

- Frontend chỉ có Supabase publishable key; đây không phải service-role secret.
- Service-role key chỉ dùng trong Supabase Edge Function.
- Request ghi từ browser phải có publishable key và Origin thuộc allowlist.
- Non-browser write có thể dùng `GETLINK_INTERNAL_WRITE_KEY` nếu được cấu hình trong môi trường Edge Function.
- Supabase -> Cloudflare hỗ trợ `BHX_RELAY_SHARED_SECRET` / `RELAY_SHARED_SECRET`; token tương thích cũ chỉ là fallback cho tới khi secret thật được provision.
- Cloudflare `/bhx` và `/category` đều áp dụng cùng relay auth gate.

## CI/CD

### Verify GETLINK
Chạy khi push vào `main` và khi có pull request:

- Python unit tests
- Python compile gate
- `node --check` frontend + relay
- `deno check` Supabase Edge Function
- contract tests cho tiền, BHX, GO và name filter
- gate xác nhận frontend trỏ Supabase-only

### Smoke Supabase GETLINK
Chạy khi API/migration/config thay đổi:

- `/health`
- library search
- source manager
- xác nhận write không có trusted Origin bị chặn

### Deploy BHX Relay
Chỉ chạy khi `relay/**` hoặc workflow deploy thay đổi:

- Node syntax check
- Wrangler được pin phiên bản
- deploy Worker
- health check
- auth gate
- BHX GetCate + Ajax continuation smoke

## Nguyên tắc dữ liệu

Scraper/API được phép cập nhật dữ liệu nguồn như tên, nguồn, quy cách, giá nguồn, promotion, image, identity và thời điểm kiểm tra.

Dữ liệu người dùng như giá của mình, trạng thái quan tâm, ghi chú và các phân loại thủ công không được tự ý ghi đè bởi scraper.

## Phát triển

Kiến trúc mục tiêu là **Supabase-only cho business/data**, Cloudflare chỉ transport BHX. Không quay lại mô hình GitHub Actions scrape rồi commit JSON/CSV vào `main`.
