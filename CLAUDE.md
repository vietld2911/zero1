# Zero1 — hướng dẫn cho Claude

## Người dùng

- Gọi người dùng là **@vietld**, trả lời **tiếng Việt**, báo cáo ngắn gọn.
- @vietld tự chạy app để test: **không bật / tắt server dev** của họ (cổng 3306, 4000, 5173, 5174). Cần chạy thử thì dùng cổng khác (API 4199, web 5199 / 5198) và tắt khi xong.
- Chỉ commit / push khi được yêu cầu.

## Dự án

Viết lại hệ thống cũ thành 2 sản phẩm **CRM** (tuyển sinh, học phí, KPI) và **LMS** (lớp, buổi, điểm danh) trên nền **Core** dùng chung (đăng nhập, nhân sự, chi nhánh, phân quyền). Một API, 3 database, 2 web React.

Đọc trước khi làm:

- `docs/architecture.md` — nguồn sự thật: ranh giới context, stack, cấu trúc thư mục, §11 nhật ký quyết định.
- `docs/roadmap.md` — các giai đoạn tiếp theo và quyết định đã chốt với @vietld.
- `docs/api-conventions.md`, `docs/roles-permissions.md`, `docs/events.md`, `docs/reports-kpi.md`, `docs/pricing-rules.md`.

Quy tắc chính:

- `apps/api/src/contexts/{core,crm,lms}`: CRM và LMS **không import nhau** (ESLint chặn). Chỉ dùng chung `core/contract` và `contracts/events`. Trao đổi CRM ↔ LMS qua sự kiện outbox.
- Route khai báo bằng `route({...})` (`platform/http/route.ts`) — vừa gắn Express vừa sinh OpenAPI. Đổi API xong chạy `npm run api-client:generate` để sinh lại `packages/api-client/src/schema.d.ts`.
- Sửa schema Drizzle → `npm run db:generate -w @zero1/api` sinh migration trong `apps/api/drizzle/<context>/`; cần chuyển dữ liệu cũ thì viết thêm câu UPDATE vào cuối file SQL vừa sinh.
- Dev DB là MariaDB 10.4 (XAMPP) — tránh SQL chỉ MySQL 8 mới có. Production dùng MariaDB 10.11.
- Giờ lưu UTC trong DB, trả API theo +07:00 (`toApiInstant`). Ngày VN: helper trong `platform/time.ts`.
- Code, comment, thông báo lỗi, tài liệu viết tiếng Việt, theo giọng văn sẵn có.
- Quyết định mới → thêm một dòng vào `docs/architecture.md` §11; xong một giai đoạn → cập nhật cột trạng thái trong `docs/roadmap.md`.

## Kiểm tra

```bash
npm run typecheck
npm run lint
npm test                                   # unit
npm run test:integration -w @zero1/api     # cần MariaDB/MySQL; mỗi file test tự tạo + xoá database z1t_*
```

Integration test đọc `DB_HOST / DB_PORT / DB_USER / DB_PASSWORD` từ biến môi trường (hoặc `apps/api/.env`) và cần `JWT_ACCESS_SECRET` ≥ 32 ký tự. Môi trường chưa có DB thì cài MariaDB (vd. `apt-get install -y mariadb-server`, chạy `mysqld`, tạo user có quyền CREATE DATABASE), rồi chạy với các biến đó. Dữ liệu demo: `npm run db:seed` rồi `npm run db:seed-demo` (mật khẩu demo `Zero1@2026`).

Giao diện: kiểm tra ở khổ điện thoại 375px (không được có thanh cuộn ngang) và máy tính.
