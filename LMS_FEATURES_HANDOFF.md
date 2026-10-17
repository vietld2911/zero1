# LMS Project — Bản bàn giao toàn bộ chức năng

> Dán file này vào prompt mới để AI nắm toàn cảnh dự án. Graph tri thức đầy đủ: `graphify-out/graph.json`, `graphify-out/GRAPH_REPORT.md`, `graphify-out/graph.html`.

## 1. Tổng quan
- **Stack:** Node.js/Express (ESM) + MySQL (có lớp tương thích pg trong `config/database.js`) + Frontend Vanilla JS SPA (không framework). Version 3.0.0.
- **Root:** `D:/Lms/lms-project` — `backend/` (entry `server.js`, toàn bộ route ở `routes/index.js`), `frontend/` (21 trang trong `pages/` + `index.html` dashboard + `login.html`), `database/lms (2).sql` (schema).
- **Kiến trúc backend:** route → middleware (`authenticate`, `authorize(permission)`, `authorizeRole(...roles)`, validators express-validator, rate limit login) → controller → model (kế thừa `BaseModel`). Lọc dữ liệu theo chi nhánh qua `utils/branchHelper.getBranchFilter()` (dùng ở 47 chỗ).
- **Frontend dùng chung:** `js/app.js` (`api`, `auth`, `ui.toast`, `modal`, `form`, `branch`, `theme`, `loading`), `js/reactive.js` (`notify`, `validate`, `animate`, ghi đè `loading.buttonStart/End`), `js/crud-mixin.js` (`createCrud()` — hiện gần như không trang nào dùng), `js/sidebar.js` (`buildSidebar()`, topbar, đổi mật khẩu), `js/config.js` (API base URL). Mỗi trang: `auth.checkAuth` → `buildSidebar` → load data qua `api`.
- **Dịch vụ ngoài:** Cloudinary (upload file/avatar/tài liệu), Telegram (thông báo điểm danh), SMTP email (tạo tài khoản, reset mật khẩu), docxtemplater (phiếu đăng ký, biên bản bàn giao kit), VietQR (QR thanh toán), cron 08:00 hằng ngày (cảnh báo học thử).

## 2. Vai trò (roles)
ADMIN, GDV (giám đốc vùng), CHU (chủ), QLCS (quản lý cơ sở), BM, HOEC, HOCM, OM, CM, EC, SALE, TEACHER, TEACHER_PLUS, TA, ACCOUNTANT, PH (phụ huynh). Có cây quản lý cấp trên/cấp dưới (subordinates).

## 3. Chức năng theo module (API `/api/...` + trang frontend)

| # | Module | Trang | Chức năng chính |
|---|---|---|---|
| 1 | **Auth** | `login.html` | Đăng nhập (JWT, rate limit), `me`, đổi mật khẩu, cập nhật hồ sơ |
| 2 | **Dashboard theo role** | `index.html` | `/dashboard/{admin,owner,qlcs,hoec,om,cm,ec,teacher,ta,sale}` — mỗi role 1 renderer + biểu đồ |
| 3 | **Chi nhánh** | `branches.html`, `admin-settings.html` | CRUD chi nhánh, thống kê, gán user ↔ nhiều chi nhánh |
| 4 | **Người dùng** | `users.html` | CRUD user theo permission, lấy roles/managers/by-role, reset mật khẩu |
| 5 | **Cây quản lý** | `users.html`, `reports.html` | Cấp dưới, doanh thu/thống kê cấp dưới, cây team, set manager |
| 6 | **Leads (KH tiềm năng)** — gộp Trải nghiệm + Học thử | `leads.html`, `trial-calendar.html` | CRUD, check trùng SĐT, import Excel + template, bulk assign / assign, lịch theo tháng, đặt lịch trải nghiệm, xác nhận lịch, điểm danh có mặt / no-show, hoàn thành buổi, call log, báo cáo học thử + export, **convert sang học viên** |
| 7 | **Trải nghiệm (legacy)** | `experience.html` | CRUD, theo tháng, convert → học viên |
| 8 | **Học thử (legacy)** | `trial.html` | CRUD, convert, check-in học thử hôm nay (EC/Teacher) |
| 9 | **Học viên** | `students.html` | CRUD, thống kê, đổi trạng thái, xác nhận thanh toán (QR), chuyển người phụ trách, avatar, tài liệu đính kèm (Cloudinary), phiếu đăng ký (form + preview docx), tái phí |
| 10 | **Lớp học** | `classes.html` | CRUD, thống kê, thêm/xóa học viên, lên lớp (promote), điểm danh từ lớp |
| 11 | **Buổi học** | `sessions.html` | CRUD, sinh buổi tự động (generate), buổi hôm nay, dời lịch, feedback từng buổi |
| 12 | **Điểm danh** | `attendance.html` | Điểm danh theo buổi, báo cáo theo lớp, cảnh báo học viên vắng nhiều, gửi Telegram |
| 13 | **Bài tập** | `assignments.html` | CRUD, xem bài nộp, chấm điểm |
| 14 | **Thư viện file** | `files.html` | Upload tối đa 10 file (Cloudinary), xem, xóa |
| 15 | **Môn học / Cấp độ** | `admin-settings.html` | CRUD subjects (ADMIN), levels (GDV/ADMIN) |
| 16 | **Thông báo** | (topbar) | Danh sách, đánh dấu đã đọc / đọc tất cả |
| 17 | **Gói học phí** | `packages.html`, `tuition-packages.html` | CRUD gói, giá theo chi nhánh (đơn lẻ + bulk), tính số buổi. `/tuition-packages` là alias của `/packages` |
| 18 | **Khuyến mại** | `promotions.html` | Chương trình KM; vật phẩm + tồn kho + lịch sử kho + cảnh báo sắp hết; tặng quà cho lead (giao/trả); học bổng; áp KM cho lead; duyệt giảm giá thêm |
| 19 | **Duyệt học bổng** | `promotions.html` | Kiểm tra, gửi yêu cầu, duyệt / từ chối |
| 20 | **Báo cáo Sale & KPI** | `reports.html` | Báo cáo cá nhân/team/tổng hợp, xếp hạng doanh thu & KPI, doanh thu dự kiến, danh sách đóng đủ, tính lại báo cáo, đặt KPI target (đơn + bulk) |
| 21 | **Tái phí (Renewals)** | `renewals.html`, `students.html` | Danh sách HV cần tái phí, tạo tái phí, lịch sử, báo cáo |
| 22 | **Chấm công nhân viên** | `reports.html` | Check-in/out, danh sách, báo cáo, tổng hợp cấp dưới, export, admin check-in hộ |
| 23 | **Cổng phụ huynh (PH)** | (API, dùng cho app mobile) | Danh sách con, dashboard, chi tiết, điểm danh, buổi học, bài tập, feedback; admin liên kết/hủy liên kết PH ↔ HV |
| 24 | **Bàn giao Kit** (ADMIN) | `kit-handover.html` | CRUD, cập nhật trạng thái, xuất biên bản docx |
| 25 | **Cài đặt hệ thống** | `admin-settings.html` | Cấu hình thanh toán (ngân hàng/QR), SMTP + test kết nối, key-value settings |
| 26 | **Gọi điện SignalWire** | — | Controller có sẵn nhưng route đang **comment (tắt)** |

## 4. Luồng nghiệp vụ cốt lõi
1. **Lead → Học viên:** tạo lead (import/nhập tay) → gán EC → gọi điện (call log) → đặt lịch trải nghiệm → xác nhận → điểm danh / no-show → hoàn thành → convert (chọn gói + KM + học bổng → tính học phí) → QR VietQR → xác nhận thanh toán → phiếu đăng ký docx.
2. **Vận hành lớp:** tạo lớp → thêm HV → generate buổi → điểm danh (Telegram) → feedback → bài tập/chấm điểm → lên lớp → tái phí.
3. **Quản trị doanh số:** KPI target → tính báo cáo sale → xếp hạng → dashboard theo role.

## 5. Vấn đề đã biết (từ graph + CODE_REVIEW_REPORT.md)
- **Logic tính học phí (gói + KM + học bổng) bị lặp ở 6 chỗ**: leads, students, trial, trial-calendar, renewals → nên gom về 1 helper.
- **Tài khoản ngân hàng VietQR hardcode** (`970422-0866766189`) trong `students.html` và `trial-calendar.html`, trong khi `leads.html` đọc cấu hình theo chi nhánh → 2 nguồn cấu hình lệch nhau.
- `packages.html` và `tuition-packages.html` trùng chức năng (endpoint alias).
- Các hàm trùng lặp giữa trang: `downloadEnrollmentForm` (3 bản), `markNoShow`, `confirmPaymentReceived`, `submitRenewal`, `saveAttendance`, `escapeHtml`/`esc`.
- `createCrud()` được load ở mọi trang nhưng hầu như không dùng.
- `enrollmentController` bị comment trong routes (thiếu `docx`, `node-fetch`); phiếu đăng ký hiện chạy qua `studentController`.
- Bảng legacy (`experience_schedules`, `trial_students`, `trial_class_students`) còn tồn tại song song với `leads`.
- Code review: JWT secret fallback `'secret'` (Critical), `API_BASE` hardcode, XSS qua `innerHTML`, token trong `localStorage`, N+1 query ở `dashboardController`, thiếu CSRF, thiếu index DB.
- Dòng route `/sale-reports/full-paid` bị khai báo 2 lần.

## 6. Liên quan
- App mobile: `lms-mobile` (Expo/React Native) dùng chung backend này, đặc biệt Parent Portal.
