# Zero1 — Kiến trúc hệ thống (CRM + LMS)

> Tài liệu chuẩn cho việc xây lại hệ thống. Mọi thay đổi kiến trúc phải cập nhật file này trước khi code.
> Liên quan: [roles-permissions.md](roles-permissions.md) · [api-conventions.md](api-conventions.md) · [events.md](events.md)

## 1. Phạm vi

Hệ thống gồm **2 sản phẩm tách biệt** dùng chung một lớp nền:

| Phần | Người dùng chính | Trả lời câu hỏi |
|---|---|---|
| **CRM** | SALE, SL, CS, CM, AM | Bao nhiêu khách, chuyển đổi ra sao, thu được bao nhiêu tiền, ai đạt KPI, ai sắp hết buổi |
| **LMS** | TEACHER, TA, TL, CS, CM | Hôm nay lớp nào học, ai vắng, bài tập đã nộp/chấm chưa, lớp đang ở buổi mấy |
| **Core** (nền dùng chung) | Tất cả | Đăng nhập, chi nhánh, nhân sự & cây quản lý, chấm công, thông báo, cấu hình |

**Không làm:** bàn giao Kit, chuyển dữ liệu từ hệ thống cũ (bắt đầu với DB trắng), app mobile (web responsive là đủ; API thiết kế sẵn cho mobile sau), gọi điện SignalWire.

## 2. Tổng quan

```
   crm.<domain> (React SPA)            lms.<domain> (React SPA)
            │                                   │
            └──────────────┬────────────────────┘
                           ▼   HTTPS /api/v1/...
              ┌────────────────────────────┐
              │   API server (1 process)   │
              │ ┌──────┐ ┌──────┐ ┌──────┐ │
              │ │ core │ │ crm  │ │ lms  │ │ ◀── event bus (outbox)
              │ └──┬───┘ └──┬───┘ └──┬───┘ │
              └────┼────────┼────────┼─────┘
                   ▼        ▼        ▼
              zero1_core zero1_crm zero1_lms     (3 database trên cùng MySQL/MariaDB)
```

- **1 server API** chạy cả 3 phần trong 1 process. Ranh giới giữa các phần được cưỡng chế bằng code và DB (mục 3), nên khi cần có thể tách CRM/LMS thành service riêng mà không viết lại nghiệp vụ.
- **2 frontend riêng** (React SPA), deploy tĩnh ở 2 subdomain. Đăng nhập một lần dùng cả hai (cùng refresh-token cookie trên domain cha).

## 3. Quy tắc ranh giới (bắt buộc)

1. **Mỗi phần một database** và **một connection pool riêng**. Repository của CRM chỉ nhận được handle `crmDb` nên không thể JOIN sang `zero1_lms` hay đặt khóa ngoại chéo.
2. **Hướng phụ thuộc:** `crm → core`, `lms → core`. **Cấm** `crm ↔ lms` import nhau (luật ESLint `no-restricted-imports`).
3. Mỗi context chỉ công khai thư mục `contract/` (interface đọc dữ liệu + định nghĩa sự kiện). Code bên ngoài không được import vào `modules/` của context khác.
4. CRM ↔ LMS trao đổi **chỉ qua sự kiện** ([events.md](events.md)). Dữ liệu phía kia cần dùng thường xuyên thì lưu **bản sao (projection)** cập nhật từ sự kiện.
5. Tham chiếu chéo là **ID trơn** (ví dụ `packages.level_id` trong CRM trỏ tới `levels.id` của LMS), không có FK; được kiểm tra hợp lệ qua contract khi ghi.

## 4. Sở hữu dữ liệu

| Dữ liệu | Chủ sở hữu | Bên còn lại giữ gì |
|---|---|---|
| User, chi nhánh, cây quản lý, chấm công | Core | Đọc qua `core/contract` |
| Lead, lịch hẹn, call log | CRM | LMS chỉ thấy "khách học thử" trong buổi (`trial_guests`) |
| Học viên (hồ sơ khách hàng, phụ huynh, hợp đồng, giấy tờ, trạng thái kinh doanh) | CRM | LMS giữ `learners`: tên, ngày sinh, ảnh, chi nhánh, trạng thái học |
| Gói học phí (theo **môn** + số buổi), giá, KM, học bổng, đăng ký, thanh toán | CRM | LMS giữ `learner_entitlements` (số buổi được học theo từng đăng ký) |
| **Số buổi đã dùng** | LMS là nguồn gốc (điểm danh) | CRM giữ `enrollments.sessions_used` cập nhật từ sự kiện |
| Chương trình học (môn, cấp độ, số buổi/cấp) | LMS | CRM giữ bản sao `catalog_levels`; gói tham chiếu `subject_id`, đăng ký chọn cấp độ bắt đầu |
| Lớp, buổi, điểm danh, nhận xét, bài tập, học liệu | LMS | CRM chỉ nhận sự kiện tổng hợp |

## 5. Luồng liên thông chính

1. **Đăng ký học:** CRM xác nhận **khoản thu đầu tiên** của đăng ký → `crm.enrollment.activated` → LMS tạo/cập nhật `learner` + `learner_entitlement` → học viên vào danh sách **chờ xếp lớp**.
2. **Xếp lớp:** LMS (TL/CS/CM) xếp lớp → `lms.learner.placed` → CRM hiển thị lớp hiện tại trên hồ sơ học viên.
3. **Điểm danh:** LMS ghi điểm danh → `lms.attendance.recorded` → CRM tăng `sessions_used`; khi còn ≤ ngưỡng (setting `crm.renewal.remaining_threshold`) → vào danh sách cần tái phí + thông báo SALE/CS.
4. **Trạng thái học viên:** CRM bảo lưu/nghỉ → `crm.student.status_changed` → LMS tạm rút khỏi lớp, ngừng tính buổi.
5. **Học thử:** CRM đặt lịch học thử vào một buổi LMS mở slot (`sessions.trial_capacity`) → `crm.trial.booked` → LMS thêm `trial_guest` → giáo viên điểm danh khách thử → `lms.trial.checked` → CRM cập nhật lịch hẹn (ATTENDED/NO_SHOW).

Quy tắc tính buổi (trạng thái điểm danh nào bị trừ buổi) là cấu hình `lms.attendance.consuming_statuses`, mặc định `PRESENT, LATE, ABSENT` (vắng có phép `EXCUSED` không trừ).

## 6. Stack

| Lớp | Công nghệ |
|---|---|
| Ngôn ngữ | TypeScript (strict) toàn bộ |
| API | Node 24 · Express 5 · zod · `@asteasolutions/zod-to-openapi` · Drizzle ORM (mysql2) · pino · vitest + supertest |
| DB | MySQL 8 / MariaDB ≥ 10.6 cho production (dev chạy được trên MariaDB 10.4 của XAMPP). utf8mb4, timezone lưu UTC |
| Web | React 19 · Vite · React Router · TanStack Query · TanStack Table · React Hook Form + zod · ECharts |
| UI | Tailwind + shadcn/ui (Radix), theme brand ở `packages/ui` |
| Monorepo | npm workspaces |
| Tích hợp | Cloudinary (file) · SMTP (email) · Telegram · VietQR · docxtemplater (phiếu đăng ký) · exceljs (import/export) |

## 7. Cấu trúc thư mục

```
zero1/
├─ apps/
│  ├─ api/
│  │  ├─ src/
│  │  │  ├─ platform/       env · db (3 pool) · http (errors, validate, paginate) · auth · events (outbox, bus) · openapi · logger
│  │  │  ├─ integrations/   cloudinary · mailer · telegram · vietqr · docx · excel
│  │  ├─ contracts/events/  kiểu dữ liệu sự kiện công bố — CRM và LMS cùng import, không phụ thuộc gì
│  │  │  ├─ contexts/
│  │  │  │  ├─ core/   auth · users · branches · org-tree · settings · notifications · timekeeping · audit · webhooks · api-keys
│  │  │  │  ├─ crm/    leads · appointments · call-logs · students · packages · promotions · pricing
│  │  │  │  │          enrollments · payments · approvals · renewals · kpi · reports · dashboard
│  │  │  │  └─ lms/    curriculum · learners · rooms · classes · sessions · attendance · trial-guests
│  │  │  │             feedback · assignments · materials · dashboard
│  │  │  │     ├─ <context>/contract/          ← phần DUY NHẤT context khác được import
│  │  │  │     ├─ <context>/db/schema.ts       ← bảng Drizzle của context
│  │  │  │     └─ <context>/modules/<module>/  routes · controller · service · repo · schema(zod)
│  │  │  └─ main.ts
│  │  ├─ drizzle/{core,crm,lms}/              migration theo từng database
│  │  └─ tests/
│  ├─ crm-web/src/   app/ (router, providers) · features/<module>/ · pages/
│  └─ lms-web/src/   app/ · features/<module>/ · pages/
├─ packages/
│  ├─ ui/            tokens · components · AppShell · logo — không biết gì về API
│  ├─ api-client/    sinh từ OpenAPI (types + fetch client, ApiError)
│  ├─ web-core/      phần ứng dụng dùng chung 2 app: phiên đăng nhập, API client, router từ danh sách module,
│  │                 usePermission · <RequirePermission>, trang Core dùng chung (pages/staff, branches, timekeeping, settings)
│  └─ config/        tsconfig (base / node / react)
├─ eslint.config.js  luật ranh giới context (import-x/no-restricted-paths)
├─ docs/
└─ Image/            logo gốc
```

Mỗi app khai báo màn hình bằng dữ liệu (`apps/*-web/src/modules.ts`): menu, route và màn "đang xây dựng" sinh từ đó. Khi làm xong một module, chỉ cần thêm `page: () => import('./features/<module>/page')` — route tự tải lười thành chunk riêng.

## 8. Database

ID: ULID `CHAR(26)` (sắp xếp được theo thời gian, không lộ số lượng). Tiền: `BIGINT` VNĐ. Thời gian: `DATETIME(3)` UTC. Mọi bảng nghiệp vụ có `created_at`, `updated_at`; bảng cần thì có `deleted_at` (xóa mềm).

### zero1_core
| Bảng | Ghi chú |
|---|---|
| `branches` | Chi nhánh (center) |
| `users` | 1 user = 1 role; `manager_id` tạo cây quản lý; `status` ACTIVE/LOCKED |
| `user_branches` | User ↔ nhiều chi nhánh (AM nhiều, còn lại thường 1), `is_primary` |
| `roles`, `permissions`, `role_permissions` | Seed sẵn, ADMIN chỉnh được |
| `refresh_tokens`, `password_resets` | Lưu hash, xoay vòng |
| `settings` | Key–value JSON, có `scope` (global / branch) |
| `notifications` | Thông báo trong app |
| `timekeeping_entries` | Chấm công: `work_date`, `check_in_at/out_at`, `source` (WEB/MOBILE/DEVICE/MANUAL), `meta` JSON (IP, toạ độ, thiết bị) |
| `timekeeping_adjustments` | Yêu cầu sửa công + duyệt |
| `audit_logs` | Ai làm gì, trước/sau |
| `api_keys`, `webhook_subscriptions`, `webhook_deliveries` | Tích hợp ngoài (giai đoạn 6) |
| `outbox_events`, `processed_events` | Sự kiện |

Chấm công mở rộng sau (chưa tạo bảng, đã dành chỗ trong API `/core/timekeeping/*`): ca làm việc, lịch làm, nghỉ phép, máy chấm công, xuất bảng công.

### zero1_crm
| Bảng | Ghi chú |
|---|---|
| `leads` | Thông tin con + phụ huynh, nguồn, `owner_id` (SALE), `status` theo máy trạng thái |
| `lead_appointments` | Trải nghiệm / học thử: `type`, `scheduled_at`, `lms_session_id`, `status` |
| `lead_call_logs` | Kết quả gọi, hẹn gọi lại |
| `students` | Hồ sơ khách hàng: `code`, `owner_id` (SALE), `care_id` (CS), `status` |
| `guardians` | Phụ huynh (nhiều người / học viên), dùng cho thông báo phụ huynh sau này |
| `student_documents`, `student_status_logs` | |
| `packages`, `package_branch_prices` | Gói học phí (`level_id`, `sessions`, `base_price`) + giá theo chi nhánh |
| `promotion_programs`, `promotion_items`, `promotion_stock_moves`, `scholarships` | |
| `enrollments` | Đăng ký mới / tái phí; chốt cứng giá: `list_price`, các khoản giảm, `final_price`, `pricing_snapshot`; `sessions_purchased`, `sessions_used` |
| `enrollment_gifts` | Quà tặng: giao / trả |
| `discount_approvals` | Duyệt học bổng & giảm giá thêm |
| `payments` | Các lần thu tiền (cho phép trả nhiều đợt) |
| `branch_payment_accounts` | Tài khoản nhận tiền theo chi nhánh (nguồn duy nhất cho VietQR) |
| `kpi_targets` | Mục tiêu theo user × tháng × chỉ số |
| `session_usages` | Mỗi dòng = 1 buổi đã trừ (từ sự kiện LMS), đảm bảo trừ đúng 1 lần |
| `outbox_events`, `processed_events` | |

### zero1_lms
| Bảng | Ghi chú |
|---|---|
| `subjects`, `levels` | Chương trình học, `levels.sessions_count` |
| `learners` | Projection học viên (cùng ID với CRM `students`) |
| `learner_entitlements` | Quyền học theo từng đăng ký: cấp độ, số buổi, đã dùng |
| `learner_level_history` | Lịch sử lên lớp |
| `rooms` | Phòng học theo chi nhánh |
| `classes` | `level_id`, `teacher_id`, `ta_id`, `room_id`, lịch tuần (JSON), `capacity`, `status` |
| `class_learners` | HV trong lớp (vào/ra) |
| `sessions` | Buổi học: số thứ tự, giờ, GV/TA/phòng thực tế, `status`, `trial_capacity`, ghi chú buổi |
| `attendance` | Điểm danh HV theo buổi |
| `trial_guests` | Khách học thử trong buổi |
| `session_feedbacks` | Nhận xét từng HV từng buổi |
| `assignments`, `assignment_submissions` | Bài tập, bài nộp, điểm |
| `materials` | Học liệu theo cấp độ / lớp |
| `outbox_events`, `processed_events` | |

## 9. Giao diện

**Brand:** chủ đạo navy `#13233F`; nhấn lấy từ logo: cyan `#00B4F0`, lime `#A6E22E` (dùng tiết kiệm). Màu trạng thái (success/warning/danger/info) tách riêng khỏi màu brand. Logo: `logo.png` (trắng — dùng trên nền navy: sidebar, màn đăng nhập), `logo_black.png` (đen — dùng trên nền sáng, file docx).

**CRM — trực quan kinh doanh:** phễu tuyển sinh, doanh thu thực/mục tiêu, tiền thu/dự kiến, công nợ, xếp hạng KPI, danh sách sắp tái phí, so sánh kỳ trước; bộ lọc thời gian / chi nhánh dùng chung cho cả trang.

**LMS — rõ thông số lớp học:** màn "Hôm nay" (dòng thời gian các buổi, trạng thái điểm danh), trang lớp (tiến độ buổi x/y, tỉ lệ đi học, tỉ lệ nộp bài, nhận xét còn thiếu), cảnh báo vắng nhiều, hàng chờ chấm bài, khối lượng giảng dạy.

**Responsive:** mọi màn dùng được trên điện thoại; riêng điểm danh & nhận xét (GV/TA) được thiết kế ưu tiên điện thoại.

## 10. Lộ trình

| GĐ | Nội dung | Kết quả kiểm chứng |
|---|---|---|
| 0 | Monorepo, `platform/` của API (env, 3 DB, lỗi, OpenAPI, outbox), `packages/ui`, khung 2 app | API `/health` + `/docs` chạy; 2 app hiển thị layout brand |
| 1 | Core: auth/SSO, users, role-permission, scope, chi nhánh, cây quản lý, settings, chấm công | Đăng nhập dùng chung 2 app; phân quyền + phạm vi dữ liệu có test |
| 2 | LMS: chương trình học | CRM tạo gói được |
| 3 | CRM bán hàng: gói & giá → KM, học bổng → pricing (có test) → leads → lịch hẹn → đăng ký, thanh toán, QR, phiếu docx → duyệt giảm giá | Lead → thu tiền chạy trọn; phát `crm.enrollment.activated` |
| 4 | LMS vận hành: learners → phòng, lớp, xếp lớp → buổi → điểm danh, nhận xét → bài tập, học liệu → học thử | Vận hành lớp đầy đủ; phát `lms.attendance.recorded` |
| 5 | Nối vòng: trừ buổi, tái phí, KPI, báo cáo, dashboard CRM & LMS, thông báo | Số liệu 2 bên khớp |
| 6 | Webhooks, API key, Telegram/email theo sự kiện, API phụ huynh, deploy | Sẵn sàng tích hợp thông báo phụ huynh |

## 11. Quyết định đã chốt

| Ngày | Quyết định |
|---|---|
| 2026-10-07 | Tách CRM / LMS hoàn toàn, Core dùng chung cho đăng nhập – tổ chức – chấm công |
| 2026-10-07 | 1 server API, 3 database, 2 frontend React |
| 2026-10-07 | Bộ role mới: ADMIN, AM, CM, SL, SALE, CS, TL, TEACHER, TA (xem roles-permissions.md) |
| 2026-10-07 | Chấm công nằm ở Core, thiết kế bảng/API để mở rộng |
| 2026-10-07 | Bỏ: bàn giao Kit, bảng legacy (trải nghiệm, học thử cũ), gói trùng, 21 bảng `hrm_*`, SignalWire |
| 2026-10-07 | Không chuyển dữ liệu cũ; không làm app mobile (web responsive) |
| 2026-10-07 | Học phí tính duy nhất ở `crm/pricing`; tài khoản VietQR chỉ lấy từ `branch_payment_accounts` |
| 2026-10-07 | TypeScript 5.9 (TS 7 chưa tương thích typescript-eslint / openapi-typescript) |
| 2026-10-07 | Mọi kết nối DB đặt `time_zone = '+00:00'` — tránh `NOW()` lệch 7 giờ so với dữ liệu app ghi (đã có integration test) |
| 2026-10-07 | Route khai báo bằng `route({...})` (`platform/http/route.ts`): một khai báo vừa gắn Express vừa sinh OpenAPI; route cần quyền mà thiếu guards thì server không khởi động |
| 2026-10-08 | GĐ1 xong: Core (đăng nhập, nhân sự, chi nhánh, phân quyền, cài đặt, chấm công) — 32 unit + 55 integration test |
| 2026-10-08 | SMTP cấu hình qua biến môi trường (không lưu mật khẩu SMTP trong DB); trang Cài đặt chỉ hiện trạng thái + gửi thử |
| 2026-10-08 | Cột JSON dùng `jsonb` (platform/db/columns) — `json()` của Drizzle trả chuỗi trên MariaDB; ESLint chặn import `json` |
| 2026-10-08 | Schema đã đặt tên mà cần `| null` dùng `nullableRef()` — `.nullable()` làm sai component OpenAPI (có test chặn) |
| 2026-10-08 | Bảng dữ liệu dùng `DataTable` tự viết (phân trang phía server) thay TanStack Table cho tới khi cần sắp xếp / ẩn cột phía client |
| 2026-10-08 | Cấu hình nghiệp vụ: mỗi context tự khai báo (`contexts/<ctx>/settings.ts`), Core lưu, kiểm tra theo schema, cho phép ghi đè theo chi nhánh |
| 2026-10-08 | GĐ2 xong: chương trình học (môn, cấp độ, thứ tự lên lớp) ở LMS; CRM giữ bản sao `catalog_levels` qua sự kiện `lms.level.changed` |
| 2026-10-08 | Form trong dialog gắn `key` theo bản ghi (mở lại = form mới) thay vì reset trong useEffect — theo React Compiler |
| 2026-10-08 | GĐ3 (phần 1): gói học phí theo môn + giá chi nhánh, khuyến mại, quà tặng & kho theo chi nhánh, tính học phí một công thức (`crm/pricing`, quy tắc: pricing-rules.md) |
| 2026-10-08 | Core cung cấp `BranchDirectory` qua `core/contract` để CRM/LMS kiểm tra chi nhánh mà không đọc DB của Core |
| 2026-10-08 | GĐ3 xong: lead (trùng SĐT, import Excel, phân công, gọi điện), lịch hẹn trải nghiệm / học thử, chuyển đổi → học viên + đăng ký (giá chốt cứng, Idempotency-Key), thu tiền nhiều đợt + xác nhận, VietQR theo chi nhánh, phiếu đăng ký docx, duyệt ưu đãi CM / AM |
| 2026-10-08 | GĐ4 xong: phòng, lớp + lịch tuần, sinh buổi (cảnh báo trùng GV / phòng), xếp / chuyển lớp, điểm danh (lưu nháp → chốt, sửa cần TL / CM), nhận xét theo tiêu chí, khách học thử, bài tập + chấm điểm, học liệu theo cấp độ, lên cấp độ |
| 2026-10-08 | Học viên xếp lớp trong ngày vẫn có tên ở buổi cùng ngày (so theo ngày giờ VN), không có tên ở các buổi trước ngày xếp lớp |
| 2026-10-08 | Refresh token: trong 10 giây ân hạn, token vừa xoay vẫn đổi được phiên mới nếu phiên còn sống — CRM và LMS khác origin, dùng chung cookie nên không khoá chung được; phiên đã đăng xuất thì vẫn từ chối (có test) |
| 2026-10-08 | Tên component OpenAPI phải duy nhất (có test quét `.openapi('Name')`) — buổi học LMS là `ClassSession`, phiên đăng nhập là `Session` |
| 2026-10-08 | Giá trị gộp thời gian từ SQL (`MIN(startsAt)`…) giải mã bằng `.mapWith(<cột>)` — tự parse chuỗi DATETIME sẽ lệch múi giờ (có test) |
| 2026-10-08 | Cơ cấu: ADMIN / AM ngoài cơ sở (nhiều chi nhánh); nhân sự cơ sở thuộc đúng một chi nhánh; CM quản lý 3 team Kinh doanh (SL → SALE), Vận hành (CS), Học thuật (TL → GV / TA) — API chặn sai chi nhánh / sai quản lý (roles-permissions.md §1) |
| 2026-10-09 | Doanh thu = tiền đã thu (khoản thu đã xác nhận, theo ngày thu); đăng ký mới tính cho sale, tái phí tính cho CS chăm sóc (`credit_user_id`, chốt lúc tạo). KPI một chỉ tiêu: mục tiêu doanh thu tháng (reports-kpi.md) |
| 2026-10-09 | GĐ5 xong: tổng quan kinh doanh, doanh số & KPI (+ Excel), tái phí, báo cáo học tập, thông báo trong app (chuông), việc định kỳ nhắc gọi lại / chốt điểm danh, `npm run db:reconcile` đối soát CRM ↔ LMS |
| 2026-10-09 | Thông báo đi qua `core/contract.notifications`, gửi sau khi transaction xong (khác database); lỗi gửi thông báo không làm hỏng nghiệp vụ |
| 2026-10-09 | Phụ huynh đăng nhập bằng SĐT + mã kích hoạt 6 số do nhân sự cấp (Core giữ tài khoản, CRM đồng bộ danh sách con theo SĐT phụ huynh); token phụ huynh tách khỏi token nhân sự |
| 2026-10-09 | Webhook ký HMAC-SHA256, thử lại theo lịch 1–360 phút; Telegram chỉ cho nhóm nội bộ (5 sự kiện, che SĐT); API key cho hệ thống ngoài: quyền + chi nhánh riêng, không có quyền quản trị Core |
| 2026-10-09 | GĐ6 xong: webhooks, Telegram, API key, API phụ huynh (con, học phí, học tập), đóng gói Docker (Caddy 3 subdomain, MariaDB, sao lưu hằng ngày) — chưa deploy |
| 2026-10-18 | Sửa theo đợt test 17/10: lượt nhập mã phụ huynh giữ bằng UPDATE nguyên tử; giới hạn đăng nhập (nhân sự, phụ huynh) chỉ đếm lần sai, theo IP + tài khoản đã chuẩn hoá, theo tài khoản và theo IP; webhook chặn địa chỉ nội bộ cả IPv6 / IPv4 lồng trong IPv6, kiểm tra IP lúc kết nối, không trả nội dung phản hồi của đích |
| 2026-10-18 | Idempotency-Key gửi song song: request chậm hơn trả kết quả của request đã ghi (không 500); ngày thu không ở tương lai; lịch gọi lại phải ở tương lai |
| 2026-10-18 | Không nhận xét học viên vắng (ABSENT / EXCUSED) — nhận xét gửi tới phụ huynh. Buổi không có học viên không tính "quá hạn chốt điểm danh", chốt được buổi rỗng; kết thúc / huỷ lớp → đóng các buổi đã qua không có học viên |
| 2026-10-18 | Font giao diện: Exo 2 (@fontsource/exo-2, có bộ ký tự tiếng Việt) thay Be Vietnam Pro |
| 2026-10-18 | GĐ7 — trạng thái lead S1A…S5B (`crm/modules/leads/stages.ts`). Mọi lần đổi đi qua một hàm `transition` (`leads.service.ts`): ghi `lead_status_logs`, mốc lần đầu đạt S2–S5 (điền luôn bước thấp hơn, không bao giờ xoá). Tự động không lùi bước; S3 / S4A / S5 chỉ qua lịch hẹn, điểm danh, đăng ký. Đổi tay qua ghi cuộc gọi / `POST /crm/leads/:id/status` (ghi chú bắt buộc), mở lại lead dừng cần quyền `crm.leads.reopen`; PATCH lead không đổi trạng thái. Phễu báo cáo tính theo mốc reached. Lead đã chuyển đổi mà bị chọn lùi bước rồi học viên đăng ký mới → về S5A (mở rộng quy tắc "đăng ký lại xoá đánh dấu huỷ"). Migration dữ liệu cũ: mốc bước thấp không muộn hơn mốc bước cao |
