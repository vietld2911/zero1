# Vai trò & phân quyền

## 1. Vai trò

| Mã | Tên | Thay cho (hệ cũ) | CRM | LMS | Phạm vi dữ liệu mặc định |
|---|---|---|:-:|:-:|---|
| `ADMIN` | Quản trị hệ thống | ADMIN, CHU | ✔ | ✔ | Toàn hệ thống |
| `AM` | Arena Manager — quản lý khu vực | GDV | ✔ | ✔ | Các chi nhánh được gán |
| `CM` | Center Manager — quản lý cơ sở, phụ trách 3 team | BM, QLCS | ✔ | ✔ | Chi nhánh của mình |
| `SL` | Sale Leader | HOEC | ✔ | | Đội của mình (bản thân + cấp dưới) |
| `SALE` | Nhân viên kinh doanh | EC, SALE | ✔ | | Lead / học viên mình phụ trách |
| `CS` | Customer Service — chăm sóc khách hàng | CM, HOCM | ✔ | ✔ | Chi nhánh của mình |
| `TL` | Teaching Leader | (mới) | | ✔ | Chi nhánh của mình (lớp, GV, TA) |
| `TEACHER` | Giáo viên | TEACHER, TEACHER_PLUS | | ✔ | Lớp / buổi mình dạy |
| `TA` | Trợ giảng | TA | | ✔ | Lớp / buổi mình trợ giảng |

Bỏ hẳn: `GDV`, `CHU`, `QLCS`, `BM`, `HOEC`, `HOCM`, `OM`, `EC`, `TEACHER_PLUS`, `ACCOUNTANT`. `PH` (phụ huynh) không phải nhân sự — sẽ là loại tài khoản riêng khi làm API phụ huynh (giai đoạn 6).

### Cơ cấu tổ chức (chốt 2026-10-08)

```
ADMIN ─ AM (nhiều cơ sở)
          └─ CM (một cơ sở — phụ trách cả 3 team)
               ├─ Team Kinh doanh:  SL → SALE      (nhiều SL = nhiều nhóm sale)
               ├─ Team Vận hành:    CS             (kiểm soát chất lượng, báo cáo thẳng CM; sau này có OM)
               └─ Team Học thuật:   TL → TEACHER, TA
```

| | Vai trò | Chi nhánh | Quản lý trực tiếp hợp lệ |
|---|---|---|---|
| Ngoài cơ sở | `ADMIN` | Không cần | — |
| | `AM` | Nhiều | `ADMIN` |
| Trong cơ sở | `CM` | Đúng một | `AM` |
| Kinh doanh | `SL` | Đúng một | `CM` |
| | `SALE` | Đúng một | `SL` |
| Vận hành | `CS` | Đúng một | `CM` |
| Học thuật | `TL` | Đúng một | `CM` |
| | `TEACHER`, `TA` | Đúng một | `TL` |

API kiểm tra khi tạo / sửa nhân sự: nhân sự cơ sở gán hơn một chi nhánh → `VALIDATION_ERROR`; quản lý sai vai trò hoặc khác chi nhánh → `MANAGER_INVALID`. Quản lý trực tiếp không bắt buộc (cơ sở mới chưa có SL / TL). Cơ cấu nằm ở `contexts/core/modules/access/catalog.ts` (`team`, `multiBranch`, `managerRoles`), API trả `team` trong nhân sự và vai trò. Thêm `OM` sau này: một vai trò mới thuộc team Vận hành, CS đổi `managerRoles` thành `['OM', 'CM']`.

Không có role kế toán: **xác nhận thanh toán** do `CS` và `CM` làm (có audit log).

## 2. Phạm vi dữ liệu (data scope)

Middleware `scope` tính một lần mỗi request và gắn vào `req.scope`:

| Scope | Ý nghĩa | Role |
|---|---|---|
| `ALL` | Không lọc | ADMIN |
| `BRANCHES` | `branch_id IN (chi nhánh được gán)` | AM, CM, CS, TL |
| `TEAM` | `owner_id IN (bản thân + toàn bộ cấp dưới)` trong chi nhánh được gán | SL |
| `OWN` | `owner_id = bản thân` | SALE |
| `TEACHING` | Lớp/buổi có `teacher_id` hoặc `ta_id` = bản thân | TEACHER, TA |

Repository áp scope qua `applyScope(query, scope, { branchCol, ownerCol, teacherCols })` — không viết điều kiện lọc bằng tay trong từng truy vấn.

## 3. Ma trận quyền

Ký hiệu: ✔ có quyền (trong phạm vi dữ liệu của mình) · ◐ có điều kiện (xem ghi chú) · trống = không.

### Core
| Permission | ADMIN | AM | CM | SL | SALE | CS | TL | TEACHER | TA |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `core.branches.manage` | ✔ | | | | | | | | |
| `core.users.read` | ✔ | ✔ | ✔ | ✔ | | ✔ | ✔ | | |
| `core.users.manage` | ✔ | ◐¹ | ◐¹ | | | | | | |
| `core.roles.manage` (chỉnh quyền của vai trò) | ✔ | | | | | | | | |
| `core.settings.manage` | ✔ | | | | | | | | |
| `core.timekeeping.self` (chấm công bản thân) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `core.timekeeping.read` (xem công người khác) | ✔ | ✔ | ✔ | ✔ | | | ✔ | | |
| `core.timekeeping.adjust` (duyệt / sửa công) | ✔ | ✔ | ✔ | | | | | | |

¹ AM tạo/sửa user trong chi nhánh mình quản lý, không tạo được ADMIN/AM. CM tạo/sửa user trong chi nhánh mình, không tạo được ADMIN/AM/CM.

### CRM
| Permission | ADMIN | AM | CM | SL | SALE | CS |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| `crm.leads.read` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `crm.leads.write` (tạo / sửa / call log / lịch hẹn) | ✔ | | ✔ | ✔ | ✔ | ✔ |
| `crm.leads.import` | ✔ | | ✔ | ✔ | | |
| `crm.leads.assign` | ✔ | ✔ | ✔ | ✔ | | |
| `crm.leads.delete` | ✔ | | ✔ | | | |
| `crm.students.read` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `crm.students.write` (hồ sơ, phụ huynh, giấy tờ) | ✔ | | ✔ | ✔ | ✔ | ✔ |
| `crm.students.status` (bảo lưu / nghỉ / đổi người phụ trách) | ✔ | | ✔ | | | ✔ |
| `crm.enrollments.create` (convert / tái phí) | ✔ | | ✔ | ✔ | ✔ | ✔ |
| `crm.payments.confirm` | ✔ | | ✔ | | | ✔ |
| `crm.approvals.review` | ✔ | ◐² | ◐² | | | |
| `crm.catalog.manage` (gói, giá gốc) | ✔ | | | | | |
| `crm.catalog.branch_prices` | ✔ | ✔ | | | | |
| `crm.promotions.manage` (chương trình, học bổng) | ✔ | ✔ | | | | |
| `crm.promotions.stock` (nhập/xuất kho quà) | ✔ | ✔ | ✔ | | | |
| `crm.kpi.manage` (đặt mục tiêu) | ✔ | ✔ | ✔ | ◐³ | | |
| `crm.reports.read` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `crm.payment_accounts.manage` | ✔ | ✔ | | | | |

² CM duyệt giảm giá đến ngưỡng `crm.approval.cm_limit` (setting); vượt ngưỡng chuyển AM.
³ SL đặt mục tiêu cho SALE trong đội.

### LMS
| Permission | ADMIN | AM | CM | CS | TL | TEACHER | TA |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `lms.curriculum.manage` (môn, cấp độ) | ✔ | | | | | | |
| `lms.learners.read` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `lms.rooms.manage` | ✔ | | ✔ | | ✔ | | |
| `lms.classes.manage` (tạo lớp, gán GV/TA, sinh buổi) | ✔ | | ✔ | | ✔ | | |
| `lms.classes.place` (xếp HV vào lớp, chuyển lớp) | ✔ | | ✔ | ✔ | ✔ | | |
| `lms.sessions.reschedule` (dời buổi, đổi GV dạy thay) | ✔ | | ✔ | ✔ | ✔ | | |
| `lms.attendance.record` | ✔ | | ✔ | | ✔ | ✔ | ✔ |
| `lms.attendance.correct` (sửa sau khi buổi đã chốt) | ✔ | | ✔ | | ✔ | | |
| `lms.feedback.write` | ✔ | | | | ✔ | ✔ | ✔ |
| `lms.assignments.manage` (giao bài) | ✔ | | | | ✔ | ✔ | |
| `lms.assignments.grade` | ✔ | | | | ✔ | ✔ | ✔ |
| `lms.materials.manage` | ✔ | | | | ✔ | ✔ | |
| `lms.learners.promote` (lên lớp) | ✔ | | ✔ | | ✔ | | |
| `lms.reports.read` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |

AM xem toàn bộ LMS trong khu vực nhưng không thao tác vận hành lớp (giao cho CM/TL).

## 4. Truy cập app

- Đăng nhập CRM chỉ khi role có ít nhất một permission `crm.*`; tương tự LMS. Role không có quyền app nào → màn "Không có quyền truy cập ứng dụng này" kèm link sang app còn lại.
- Ma trận trên là **seed mặc định**; ADMIN chỉnh `role_permissions` được, không cần sửa code.
