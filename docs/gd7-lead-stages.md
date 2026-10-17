# GĐ7 — Trạng thái lead S1–S5: kế hoạch triển khai

Nghiệp vụ đã chốt với @vietld nằm ở `docs/roadmap.md` (mục GĐ7) — đọc trước. File này là thiết kế kỹ thuật để làm. Khi làm xong: đánh dấu ✅ ở roadmap, thêm dòng vào `docs/architecture.md` §11, xoá hoặc giữ file này làm tài liệu.

Làm trên nhánh `gd7-lead-stages`, push nhánh đó, **không merge vào `main`** — @vietld xem lại trước.

> **Đã làm (2026-10-18)** — giữ file này làm tài liệu. Khác / bổ sung so với thiết kế:
> - Lỗi mới: `LEAD_ENROLLED` (409, lead S5 chưa huỷ đăng ký mà chọn trạng thái khác), `LEAD_HAS_APPOINTMENT` (409, có lịch chờ mà chọn dưới S3), `LEAD_NOT_STOPPED` (409, mở lại lead chưa dừng). Chọn S3 / S4A / S5, S4B / S4C khi chưa đạt S4, thiếu lý do dừng, S4B thiếu ngày → 400.
> - `GET /crm/leads`: `stopped=false` bỏ lead đã dừng (tab S1–S5 trên giao diện); sắp xếp thêm `statusChangedAt`, `firstCalledAt`.
> - `statusAfter` của cuộc gọi: log theo `call_log_id`; cuộc gọi giữ nguyên trạng thái → trạng thái gần nhất trước cuộc gọi.
> - Đăng ký mới cho học viên mà lead nguồn đang có đánh dấu huỷ **hoặc** đã bị chọn lùi dưới S5 → S5A.
> - Lịch hẹn của lead đã dừng (dữ liệu cũ) được điểm danh → không tự đổi trạng thái.
> - Thông báo `crm.lead.s1b_stale` mở `/leads?stale=true`.

## 1. Hiện trạng (trước GĐ7)

- `leads.status` ∈ `NEW, CONTACTING, SCHEDULED, ATTENDED, NO_SHOW, CONVERTED, LOST` (`apps/api/src/contexts/crm/db/schema.ts`, `LEAD_STATUSES`).
- `leads.service.ts`: `OPEN_STATUSES`; `logCall` đổi NEW → CONTACTING; `update` (PATCH) cho đổi tay NEW / CONTACTING / LOST (LOST cần `lostReason`); `lockForConvert` chặn CONVERTED / LOST.
- `appointments.service.ts`: `syncLeadStatus` suy trạng thái từ lịch hẹn (có lịch chờ → SCHEDULED, lịch gần nhất đến / vắng → ATTENDED / NO_SHOW, huỷ hết → CONTACTING).
- `enrollments.service.ts` `convertLead`: đặt `CONVERTED`.
- Nơi khác dùng trạng thái: `follow-up-job.ts` (OPEN_STATUSES), `reports/reports.service.ts` (phễu `overview` ~dòng 189–235, KPI ~dòng 339), `leads.routes.ts` (schema, `status-counts`, `check-phone`, lịch hẹn), `leads.excel.ts`, `scripts/seed-demo.ts`, test integration (`sales.test.ts`, `reports.test.ts`, `integrations.test.ts`, `teaching.test.ts`), web `apps/crm-web/src/features/leads/*`, `features/labels.ts`, dashboard / báo cáo CRM.

## 2. Dữ liệu

`LEAD_STATUSES = ['S1A','S1B','S1C','S2A','S2B','S2C','S3A','S3B','S3C','S4A','S4B','S4C','S5A','S5B']`.

Hằng số dùng chung (đặt trong `modules/leads/stages.ts`):

- `stageOf(status)` = số sau chữ S (1–5).
- `STOPPED = ['S1C','S2C','S4C']` — lead đã dừng. **S3C không phải dừng** (không đến, cần hẹn lại).
- `OPEN` = không thuộc STOPPED và stage < 5.
- `MANUAL = ['S1B','S1C','S2A','S2B','S2C','S4B','S4C']` — trạng thái người dùng được chọn. S4B / S4C chỉ chọn được khi lead đã từng đạt S4 (`reachedS4At` khác null).
- STOPPED cần `lostReason`. S4B cần `nextFollowUpAt` (ngày hẹn đóng phí).

Bảng `leads` thêm cột:

| Cột | Ý nghĩa |
|---|---|
| `status` | varchar(20), mặc định `S1A` |
| `status_changed_at` | lần đổi trạng thái gần nhất |
| `first_called_at` | lần gọi đầu tiên (tính hạn 120 ngày của S1B) |
| `reached_s2_at` … `reached_s5_at` | lần đầu đạt mỗi bước; đặt khi lên bước đó và **điền luôn các bước thấp hơn còn trống** (S1 → S3 thẳng thì S2 cũng có mốc) để phễu không bị hụt; không bao giờ xoá |
| `enrollment_cancelled_at` | đánh dấu "đăng ký đã huỷ" (lead S5A); xoá khi đổi trạng thái tay hoặc khi có đăng ký mới |

Bảng mới `lead_status_logs`: `id, lead_id, from_status (null khi tạo), to_status, source ('CREATE'|'CALL'|'MANUAL'|'REOPEN'|'APPOINTMENT'|'ENROLLMENT'|'PAYMENT'), note, call_log_id, actor_id (null = hệ thống), created_at`; index `(lead_id, created_at)`.

`lead_call_logs.note` thành bắt buộc ở API (cột giữ nullable cho dữ liệu cũ).

Migration `apps/api/drizzle/crm/0005_*.sql` (sinh bằng `db:generate`, rồi viết thêm UPDATE chuyển dữ liệu cũ):

| Cũ | Mới |
|---|---|
| NEW | S1A |
| CONTACTING | S2A nếu có cuộc gọi TALKED / CALL_BACK, ngược lại S1B |
| SCHEDULED | S3A |
| ATTENDED | S4A |
| NO_SHOW | S3C |
| CONVERTED | S5B nếu học viên (`converted_student_id`) có đăng ký `activated_at` khác null, ngược lại S5A |
| LOST | S4C nếu từng có lịch ATTENDED; S2C nếu từng có lịch hẹn hoặc cuộc gọi TALKED; còn lại S1C |

Mốc: `first_called_at` = MIN(`called_at`); `reached_s2_at` = cuộc gọi TALKED / CALL_BACK đầu tiên, hoặc lịch hẹn đầu tiên; `reached_s3_at` = `created_at` của lịch hẹn đầu tiên; `reached_s4_at` = `scheduled_at` của lịch ATTENDED đầu tiên; `reached_s5_at` = `created_at` của đăng ký đầu tiên của học viên. Sau đó điền mốc thấp hơn còn trống. `status_changed_at` = `updated_at`.

## 3. Đổi trạng thái

Một hàm duy nhất `transition(tx, lead, to, { source, note, actorId, callLogId })` trong `leads.service.ts`: cập nhật `status`, `status_changed_at`, mốc reached, `version + 1`, ghi `lead_status_logs`. Không đổi thì không ghi log.

Tự động (không bao giờ tự lùi bước):

| Sự kiện | Đổi khi | Thành |
|---|---|---|
| Tạo lead (tay, import, API) | luôn | S1A (ghi log CREATE) |
| Đặt lịch trải nghiệm / học thử | stage ≤ 3 | S3A |
| Đổi giờ lịch trải nghiệm | stage = 3 | S3A |
| Xác nhận lịch | stage = 3 | S3B |
| Lịch → NO_SHOW (tay hoặc LMS báo) | stage = 3 | S3C |
| Lịch → ATTENDED (tay hoặc LMS báo) | stage ≤ 3 | S4A |
| Huỷ lịch / LMS từ chối khách | — | giữ nguyên |
| Chuyển đổi lead → học viên | luôn | S5A |
| Đăng ký được kích hoạt (khoản thu đầu xác nhận) | lead có `converted_student_id` = học viên và đang S5A | S5B |
| Huỷ đăng ký | lead ở stage 5, học viên không còn đăng ký nào khác chưa huỷ | S5A + `enrollment_cancelled_at` |
| Tạo đăng ký mới cho học viên (`createForStudent`) mà lead nguồn đang có `enrollment_cancelled_at` | | S5A, xoá đánh dấu |

Thay cho `syncLeadStatus` trong `appointments.service.ts`. Lead ở STOPPED → đặt lịch bị chặn `LEAD_CLOSED` như cũ.

Thủ công:

- `POST /crm/leads/:id/calls` — body `{ outcome, note (bắt buộc, ≥ 3 ký tự), status (bắt buộc), lostReason?, nextFollowUpAt? }`. `status` ∈ MANUAL ∪ {trạng thái hiện tại}. Lead STOPPED → `LEAD_CLOSED`. Lead stage 5 chưa bị đánh dấu huỷ đăng ký → chỉ được giữ nguyên trạng thái. Lead đang có lịch hẹn chờ (SCHEDULED / CONFIRMED) → không chọn được trạng thái dưới S3 (lỗi, gợi ý huỷ lịch trước). Cập nhật `first_called_at` nếu trống, `last_contacted_at`, `next_follow_up_at`.
  - Gợi ý mặc định ở giao diện (API không ép): NO_ANSWER / BUSY / CALL_BACK → S1B; WRONG_NUMBER → S1C; TALKED → S2A. Ở bước 3–5 mặc định giữ nguyên.
- `POST /crm/leads/:id/status` (quyền `crm.leads.write`) — `{ status, note (bắt buộc), lostReason?, nextFollowUpAt? }`, cùng quy tắc như trên, source MANUAL.
- `POST /crm/leads/:id/reopen` (quyền mới `crm.leads.reopen`: ADMIN, AM, CM, SL) — chỉ cho lead STOPPED; `{ status ∈ MANUAL không thuộc STOPPED, note }`, source REOPEN.
- `PATCH /crm/leads/:id`: bỏ `status` / `lostReason` khỏi body (chỉ sửa thông tin).
- Lên S3 / S4A / S5 **không** chọn tay được.

## 4. S1B quá hạn khai thác

- Cài đặt `crm.leads.s1b_window_days` (`contexts/crm/settings.ts`, mặc định 120, cho ghi đè theo chi nhánh).
- `GET /crm/leads?stale=true` → S1B có `first_called_at` cũ hơn N ngày.
- Job hằng ngày (giờ làm việc, xem `follow-up-job.ts`): mỗi chi nhánh có lead S1B quá hạn → thông báo SL + CM chi nhánh "N lead S1B quá hạn khai thác", `dedupeKey` theo chi nhánh + ngày.
- Không tự đổi trạng thái; SL chia lại hoặc đóng (S1C).

## 5. API đọc

- `Lead` thêm `statusChangedAt, firstCalledAt, reachedS2At…reachedS5At, enrollmentCancelled (boolean), stale (boolean)`.
- `LeadDetail` thêm `statusLogs[]` (`fromStatus, toStatus, source, note, actorName, createdAt`); cuộc gọi kèm trạng thái sau cuộc gọi (lấy từ log theo `call_log_id`).
- `GET /crm/leads`: `status` nhận nhiều mã; thêm `stage` (1–5, nhiều giá trị), `stopped=true`, `stale=true`.
- `status-counts` trả đủ 14 mã.

## 6. Báo cáo

`reports.service.ts` `overview.funnel` (lead tạo trong kỳ): `contacted` = có `reached_s2_at`, `appointed` = `reached_s3_at`, `attended` = `reached_s4_at`, `converted` = `reached_s5_at`, `lost` = STOPPED. Nguồn và KPI: `converted` = có `reached_s5_at`. Cập nhật mô tả trong `reports.routes.ts` và `docs/reports-kpi.md`.

## 7. Giao diện CRM (`apps/crm-web/src/features/leads`)

- `labels.ts`: nhãn + màu cho 14 mã (hiển thị "S2A · Quan tâm").
- Danh sách: tab S1 · S2 · S3 · S4 · S5 · Đã dừng (kèm số đếm); trong mỗi tab có chip lọc trạng thái con; bộ lọc "S1B quá hạn" cho SL trở lên; cột trạng thái hiện mã + nhãn.
- Chi tiết lead: badge trạng thái; dialog **Ghi cuộc gọi** (kết quả gọi → tự gợi ý trạng thái, chọn trạng thái dạng nút, ghi chú bắt buộc, lý do khi chọn trạng thái dừng, ngày khi S4B / hẹn gọi lại); nút **Đổi trạng thái** (cùng form, không có kết quả gọi); nút **Mở lại** cho lead đã dừng (chỉ người có `crm.leads.reopen`); cảnh báo "Đăng ký đã huỷ — chọn lại trạng thái"; dòng thời gian lịch sử trạng thái.
- Form sửa lead bỏ chọn trạng thái.
- Dashboard / báo cáo CRM: đổi nhãn phễu theo S2–S5.
- Kiểm tra 375px không cuộn ngang.

## 8. Dữ liệu demo và test

- `scripts/seed-demo.ts`: cuộc gọi phải có `note` + `status`; tạo đủ các trạng thái S1A … S5B và vài lead dừng, vài lead S1B quá hạn (lùi `first_called_at` trong DB như cách đang lùi `next_follow_up_at`).
- Sửa test cũ dùng trạng thái cũ (`sales.test.ts`, `reports.test.ts`, `integrations.test.ts`, …).
- Test mới (integration): luồng tự động S1A → S3A → S3B → S4A → S5A → S5B; S1 lên thẳng S3; cuộc gọi thiếu ghi chú / thiếu trạng thái → 400; chọn S3/S4A/S5 tay → 400; S4B khi chưa đạt S4 → lỗi; dừng thiếu lý do → 400; lead dừng không ghi được cuộc gọi; SALE mở lại → 403, SL mở lại được; huỷ lịch giữ S3; huỷ đăng ký → S5A + đánh dấu, đăng ký lại → bỏ đánh dấu; mốc reached đúng khi nhảy cóc; S1B quá hạn hiện trong `stale=true` và job gửi thông báo một lần; phễu báo cáo theo mốc.
- Chạy đủ: typecheck, lint, unit, integration; `npm run api-client:generate`.
