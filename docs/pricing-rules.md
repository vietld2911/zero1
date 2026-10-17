# Quy tắc tính học phí

> Trạng thái: **ĐÃ CHỐT** — @vietld duyệt 2026-10-08.
> Mọi nơi (chuyển lead → học viên, tái phí, xem trước trên form) gọi **một hàm duy nhất phía server**; giao diện không tự tính.

## 1. Hệ thống cũ đang tính thế nào (đã đọc code)

Thành phần:
- **Giá gói**: giá riêng của chi nhánh (`branch_packages`) nếu có, không thì giá gốc của gói.
- **Chương trình khuyến mại** (một chương trình / lần đăng ký): giảm `%` (có thể có mức trần `max_discount`) hoặc giảm số tiền cố định; có hạn hiệu lực.
- **Giảm thêm**: số tiền + lý do, phải duyệt.
- **Học bổng**: **không phải tiền** — là **tháng học tặng thêm**, 1 tháng = 4 buổi. Gói có "học bổng mặc định" (được cấp ngay); vượt mức đó phải duyệt.
- **Quà tặng**: vật phẩm trong kho, giao ngay / khi đóng tiền / khi hoàn thành.

Sai lệch tìm thấy — cùng một khách hàng, mỗi màn hình ra một số khác nhau:

| Nơi tính | Trần % | Làm tròn | Giảm tiền cố định | Hạn KM | Giảm thêm đã duyệt | Học bổng vượt mức |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Backend `computeTuitionFee` (lead, học thử) | ✔ | ✔ | ✔ | ✔ | **✘ không trừ** | chờ duyệt ✔ |
| `leads.html` | ✔ | ✔ | ✔ | — | ✘ | — |
| `students.html` | **✘** | ✘ | ✔ | — | ✘ | chỉ cảnh báo |
| `renewals.html` + `renewalModel` | **✘** | ✔ | ✔ | **✘** | ✘ | **✘ cấp hết, không duyệt** |
| `trial-calendar.html` | **✘** | ✘ | **✘ luôn 0đ** (so `'fixed'`, DB lưu `'amount'`) | — | ✘ | chỉ cảnh báo |

Ngoài ra tái phí cộng tháng học bổng vào hạn học nhưng **không cộng buổi học bổng**.

## 2. Đề xuất quy tắc mới

### 2.1 Thứ tự tính (một công thức cho mọi luồng)

```
Giá niêm yết   = giá chi nhánh (nếu đang áp dụng) ?? giá gốc của gói
Giảm KM        = %: round(Giá niêm yết × % / 100), tối đa bằng mức trần
                 số tiền cố định: giá trị KM
                 (luôn ≤ Giá niêm yết)
Giảm thêm      = số tiền xin giảm (chỉ tính khi ĐÃ DUYỆT)
Phải thu       = max(0, Giá niêm yết − Giảm KM − Giảm thêm)

Buổi học       = buổi của gói + (tháng học bổng được cấp × buổi/tháng)
Hạn học        = ngày bắt đầu + tháng của gói + tháng học bổng được cấp
```

- Tiền là số nguyên VNĐ, làm tròn tới đồng (`Math.round`).
- KM được áp khi: đang bật, trong hạn (theo **ngày đăng ký**, giờ Việt Nam), áp dụng cho chi nhánh và gói đó.
- **Mỗi lần đăng ký tối đa 1 chương trình KM** (như hệ thống cũ).
- "Buổi / tháng học bổng" thành cấu hình `crm.scholarship.sessions_per_month`, mặc định **4**.

### 2.2 Duyệt

| Khoản | Cấp ngay | Phải duyệt |
|---|---|---|
| Học bổng | ≤ học bổng mặc định của gói | Phần vượt mức |
| Giảm thêm | — | Toàn bộ |

Người duyệt: CM nếu tổng giá trị xin duyệt ≤ `crm.approval.cm_limit` (mặc định 2.000.000đ), vượt → AM.
Giá trị quy đổi của tháng học bổng để so hạn mức = `giá niêm yết / số tháng của gói × số tháng vượt`.

### 2.3 Chốt giá

Khi tạo đăng ký, hệ thống **lưu cứng toàn bộ chi tiết** (giá niêm yết, từng khoản giảm, KM nào, học bổng bao nhiêu, ai duyệt) vào đăng ký. Sửa giá gói / KM sau đó **không làm đổi** các đăng ký cũ.

## 3. Quyết định đã chốt (@vietld, 2026-10-08)

| Câu hỏi | Chốt |
|---|---|
| Gói học phí gắn với gì | **Môn học + số buổi + số tháng hiệu lực.** Cấp độ bắt đầu chọn khi đăng ký |
| Khi nào chuyển sang LMS xếp lớp | **Khi có khoản thu đầu tiên được xác nhận** (cọc hoặc đóng đủ); phần còn lại là công nợ |
| Đăng ký đang chờ duyệt có được thu tiền | **Được thu cọc**; duyệt xong số phải thu tự cập nhật; thu dư → cảnh báo hoàn / bù trừ |
| Buổi / tháng học bổng | **4**, cấu hình được (`crm.scholarship.sessions_per_month`) |

Ngoài ra: học bổng là số tháng nhập trực tiếp khi đăng ký (không còn danh mục "chương trình học bổng" riêng); quà tặng quản lý tồn kho **theo chi nhánh**.
