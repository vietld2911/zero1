# Báo cáo, KPI, tái phí, thông báo

Quy tắc số liệu của giai đoạn 5 (chốt 2026-10-09). Code: `contexts/crm/modules/reports`, `contexts/lms/modules/reports`, `contexts/core/modules/notifications`.

## 1. Doanh thu

- **Doanh thu = tiền đã thu thực tế**: tổng khoản thu ở trạng thái *đã xác nhận*, tính vào **ngày thu** (`paid_at`, giờ Việt Nam). Khoản thu chờ xác nhận chưa tính.
- **Người được tính** (`enrollments.credit_user_id`, chốt lúc tạo đăng ký):
  - Đăng ký mới → sale phụ trách học viên.
  - Tái phí → **CS chăm sóc** học viên. Học viên chưa có CS mà người tạo là CS → người tạo; nếu không → sale.
- Doanh thu của đăng ký không có người được tính, hoặc người đã nghỉ, hiện ở mục “Chưa gán người”.
- **Còn phải thu** = phải thu − đã thu của các đăng ký đang chờ thu / đang hiệu lực (số hiện tại, không theo kỳ).

## 2. Kỳ so sánh

| Kỳ đang xem | So với |
|---|---|
| Bắt đầu từ mùng 1 (tháng này, tháng trước…) | Cùng số ngày đầu tháng trước. Xem tháng 10 vào ngày 9/10 → so 1–9/10 với 1–9/9 |
| Khoảng khác (7 ngày, 30 ngày, tuỳ chọn) | Khoảng liền trước cùng độ dài |

Kỳ chưa kết thúc chỉ so phần đã qua (`previousPeriod`, có unit test).

## 3. KPI

- Một chỉ tiêu: **mục tiêu doanh thu tháng** cho mỗi sale, SL, CS (`kpi_targets`).
- Ai đặt: SL đặt cho sale trong nhóm mình; CM / AM / ADMIN đặt cho sale, SL, CS trong chi nhánh.
- Bảng KPI nhóm theo cơ cấu: mỗi SL một nhóm kinh doanh (SL + sale dưới quyền), CS là team Vận hành (tái phí).
- Ai xem: SALE thấy số của mình, SL thấy nhóm, CM / CS / AM theo chi nhánh. Xuất Excel theo đúng phạm vi đó.

## 4. Tái phí

- **Cần tái phí**: học viên đang học có đăng ký gần nhất (a) đã học hết, (b) còn ≤ ngưỡng buổi (cài đặt `crm.renewal.remaining_threshold`, mặc định 4, theo chi nhánh), hoặc (c) hết hạn trong 30 ngày tới, và chưa có đăng ký mới.
- **Tỉ lệ tái phí tháng** = đã tái phí trong tháng ÷ (đã tái phí trong tháng + đang cần tái phí).

## 5. Phễu tuyển sinh

Lead **nhận trong kỳ**, đếm theo bước đã đi tới đến nay: đã liên hệ (khác “Mới”), có lịch hẹn, đã đến (có lịch hẹn “Đã đến”), đăng ký, thất bại.

## 6. Báo cáo học tập (LMS)

Theo tháng, theo lớp mình thấy (GV / TA: lớp mình dạy):
- Buổi đã dạy, giờ dạy, dạy thay, buổi trợ giảng, buổi quá giờ chưa chốt điểm danh.
- Tỉ lệ đi học = (có mặt + đi muộn) ÷ lượt điểm danh của buổi đã chốt.
- Tỉ lệ nhận xét = lượt có mặt được nhận xét ÷ lượt có mặt.
- Nộp bài = bài đã nộp / đã chấm ÷ (số bài giao trong tháng × sĩ số).

## 7. Thông báo trong app

Chuông ở thanh trên cùng của cả hai app; thông báo của app kia mở sang app đó. Lưu 90 ngày.

| Loại | Gửi cho | Khi nào |
|---|---|---|
| `crm.lead.assigned` | Sale được giao | Tạo lead giao cho người khác, phân công, import Excel |
| `crm.lead.follow_up_due` | Sale phụ trách | Đến hạn gọi lại (7:00–21:00, mỗi lịch nhắc một lần) |
| `crm.trial.attended` / `no_show` / `cancelled` | Sale phụ trách | GV điểm danh khách học thử / LMS không nhận khách |
| `crm.approval.requested` | CM hoặc AM của chi nhánh | Đăng ký cần duyệt ưu đãi |
| `crm.approval.reviewed` | Người xin | Được duyệt / bị từ chối |
| `crm.payment.pending` | CS, CM của chi nhánh | Khoản thu chờ xác nhận |
| `lms.learner.waiting` | CM, CS, TL của chi nhánh | Học viên đóng tiền, chờ xếp lớp |
| `lms.trial.booked` | GV của buổi | Có khách học thử vào buổi |
| `lms.attendance.overdue` | GV của buổi | Buổi kết thúc quá 2 giờ chưa chốt (mỗi buổi một lần) |

Việc định kỳ chạy trong process API (`platform/jobs.ts`), chạy lại an toàn nhờ `dedupe_key`.

## 8. Đối soát CRM ↔ LMS

`npm run db:reconcile` so sánh: quyền học có đủ cho đăng ký đã kích hoạt, số buổi mua / đã học hai bên, sổ trừ buổi CRM, trạng thái học viên. Báo kèm số sự kiện chưa gửi (chênh lệch tạm thời). Thoát mã 1 nếu có chênh lệch.
