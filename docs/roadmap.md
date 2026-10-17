# Lộ trình sau GĐ6

GĐ0–6 đã xong (architecture.md §10). Các giai đoạn dưới đây chốt với @vietld ngày 2026-10-18. Số `#` là số ý tưởng trong danh sách đề xuất CRM.

Trạng thái: ⬜ chưa làm · 🟨 đang phân tích / đang làm · ✅ xong

| GĐ | Nội dung | Trạng thái |
|---|---|---|
| 7 | Trạng thái lead S1–S5 (phễu tuyển sinh) — thiết kế kỹ thuật: [gd7-lead-stages.md](gd7-lead-stages.md) | 🟨 chốt nghiệp vụ, chưa code |
| 8 | Nhật ký thao tác (#22) — làm sớm để các tính năng sau đều ghi vết | ⬜ |
| 9 | Tài chính: tự xác nhận chuyển khoản (#8), lịch đóng tiền nhiều đợt + nhắc nợ (#9), hoàn tiền / chuyển phí / bảo lưu có phí (#10) | ⬜ |
| 10 | Chăm sóc: cảnh báo nguy cơ nghỉ học (#13), lịch chăm sóc định kỳ + khảo sát hài lòng (#14), báo cáo học tập tháng gửi phụ huynh (#16) | ⬜ |
| 11 | Gọi điện qua tổng đài ảo, ghi âm, tự lưu nhật ký gọi (#7) | ⬜ |
| 12 | Dự báo doanh thu từ phễu S1–S5 (#18) — cần số liệu tỉ lệ chuyển giai đoạn của GĐ7 | ⬜ |

## GĐ7 — Trạng thái lead S1–S5

Yêu cầu của @vietld:

| Mã | Ý nghĩa |
|---|---|
| S1 | Lead mới, chưa khai thác |
| S2 | Đã khai thác |
| S3 | Đã hẹn trial thành công |
| S4 | Đã lên trial và được tư vấn |
| S5 | Đã đăng ký |

Hiện tại (để đối chiếu): `NEW → CONTACTING → SCHEDULED → ATTENDED / NO_SHOW → CONVERTED`, cộng `LOST`. Trạng thái tự đổi theo lịch hẹn; chuyển đổi lead → `CONVERTED`.

Câu hỏi cần chốt:

1. S1 → S2: "đã khai thác" là gọi được và nói chuyện được, hay chỉ cần đã gọi (kể cả không nghe máy)?
2. S3: tính cả lịch trải nghiệm (EXPERIENCE) lẫn học thử trong buổi LMS (TRIAL), hay chỉ học thử?
3. S4: "đã tư vấn" có phải là một bước riêng, cần ghi kết quả tư vấn, hay cứ đến buổi trial là S4?
4. S5: tính lúc tạo đăng ký hay lúc phụ huynh đóng tiền đợt đầu?
5. Hẹn mà không đến (no-show), huỷ lịch, lead thất bại thì xếp vào đâu?
6. Có cho chuyển trạng thái tay, nhảy cóc (vd. khách đến thẳng S1 → S5), lùi trạng thái không?
7. Báo cáo: tỉ lệ chuyển giữa các giai đoạn, thời gian nằm ở mỗi giai đoạn, theo sale / nguồn / chi nhánh.

Đã chốt (2026-10-18):

- S1 → S2 khi nói chuyện được với phụ huynh và phụ huynh quan tâm. Không nghe máy / bận → vẫn ở S1.
- S3 tính cả lịch trải nghiệm và học thử. Đặt lịch ngay trong cuộc gọi đầu → S1 lên thẳng S3.
- S5 tính lúc tạo đăng ký.
- Mỗi bước có trạng thái con theo chữ cái (S1A, S1B, S1C…) — đang thảo luận bảng chi tiết.

Bảng trạng thái (chốt 2026-10-18 — mã cố định trong code; A = đang xử lý, B = chờ việc cụ thể, C = dừng ở bước này):

| Mã | Ý nghĩa | Vào trạng thái này |
|---|---|---|
| S1A | Lead mới, chưa gọi | tạo lead |
| S1B | Chưa liên lạc được (không nghe, máy bận) hoặc phụ huynh bận, cần tư vấn sau | tự động khi ghi cuộc gọi không nghe / bận; hoặc chọn tay |
| S1C | Không có nhu cầu / sai số (dừng) | chọn tay + lý do; ghi cuộc gọi "sai số" → tự động |
| S2A | Quan tâm, chưa đặt lịch | tự động khi ghi cuộc gọi đã nói chuyện; hoặc chọn tay |
| S2B | Đang cân nhắc (học phí, lịch, hỏi ý gia đình) | chọn tay |
| S2C | Đã tư vấn, từ chối (dừng) | chọn tay + lý do |
| S3A | Đã đặt lịch, chờ đến | tự động khi đặt lịch trải nghiệm / học thử (từ S1 hay S2 đều lên thẳng) |
| S3B | Phụ huynh đã xác nhận sẽ đến | tự động khi xác nhận lịch |
| S3C | Không đến — cần hẹn lại | tự động khi điểm danh vắng |
| S4A | Đã trial + tư vấn, đang cân nhắc | tự động khi điểm danh có mặt |
| S4B | Hẹn ngày đóng phí | chọn tay + ngày hẹn |
| S4C | Từ chối sau trial (dừng) | chọn tay + lý do |
| S5A | Đã đăng ký, chờ đóng tiền | tự động khi tạo đăng ký |
| S5B | Đã đóng tiền | tự động khi khoản thu đầu tiên được xác nhận |

Quy tắc:

- S1B không tự đóng. Lead S1B được khai thác lại trong 3–4 tháng (cài đặt, mặc định 120 ngày kể từ lần gọi đầu).
- Lead đã dừng (S1C, S2C, S4C) mở lại được; chỉ SL trở lên (SL, CM, AM, ADMIN).
- Không tự lùi bước: huỷ lịch hẹn → lead vẫn ở S3; sale khai thác lại thì tự chọn trạng thái mới.
- Lên S3 / S4A / S5 chỉ qua nghiệp vụ thật (đặt lịch, điểm danh, tạo đăng ký) — không chọn tay để phễu không bị "làm đẹp".
- Lưu thời điểm lead đạt mỗi bước lần đầu (S2, S3, S4, S5) để báo cáo phễu không đổi khi lead lùi / dừng.

- S1B quá hạn khai thác (mặc định 120 ngày từ lần gọi đầu) → vào danh sách "quá hạn khai thác" để SL quyết định chia lại / đóng; không tự đổi trạng thái.
- Huỷ đăng ký khi lead ở S5 → lead về S5A, đánh dấu "đăng ký đã huỷ"; sale chọn lại trạng thái.
- Mỗi cuộc gọi bắt buộc ghi chú và chọn trạng thái lead sau cuộc gọi. Đổi trạng thái không qua cuộc gọi cũng bắt buộc ghi chú.
