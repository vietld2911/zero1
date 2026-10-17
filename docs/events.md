# Danh mục sự kiện

Sự kiện là kênh **duy nhất** CRM và LMS trao đổi trạng thái, đồng thời là nguồn cho webhooks (thông báo phụ huynh, Zalo OA, …).

## 1. Cơ chế

1. Service ghi thay đổi nghiệp vụ **và** một dòng `outbox_events` trong **cùng transaction** (cùng database của context).
2. Dispatcher đọc outbox của cả 3 database, phát tới các handler trong process và tới webhooks; đánh dấu `published_at`.
3. Giao **ít nhất một lần** ⇒ handler phải idempotent: ghi `event_id` vào `processed_events` của database bên nhận trong cùng transaction xử lý; gặp lại thì bỏ qua.
4. Thứ tự chỉ đảm bảo trong cùng `aggregateId`.

Kiểu dữ liệu `data` của từng sự kiện nằm ở `apps/api/src/contracts/events/` — nơi duy nhất CRM và LMS cùng import được.

Bên nhận dùng **ảnh chụp đầy đủ** khi có thể: ghi đè theo ID và bỏ qua sự kiện có ID (ULID) cũ hơn bản đang lưu, nên thứ tự đến không quan trọng.

## 2. Envelope

```json
{
  "id": "01JABC...",                       // ULID, cũng là khóa idempotency
  "type": "lms.attendance.recorded",
  "version": 1,
  "occurredAt": "2026-10-07T18:30:00.000+07:00",
  "source": "lms",
  "aggregateId": "01J...",                 // ID thực thể gốc
  "branchId": "01J...",
  "actorId": "01J...",                     // user gây ra, null nếu hệ thống
  "data": { }
}
```

Đổi cấu trúc `data` theo kiểu phá vỡ → tăng `version`, phát song song bản cũ trong thời gian chuyển tiếp.

## 3. Sự kiện CRM

Kiểu `data` chính xác: `apps/api/src/contracts/events/crm.ts`.

| Type | Khi nào | `data` | Ai nghe |
|---|---|---|---|
| `crm.enrollment.activated` | Khoản thu đầu tiên được xác nhận (hoặc phải thu = 0) — Telegram | `enrollmentId, enrollmentCode, studentId, studentCode, branchId, type (NEW/RENEWAL), subjectId, startLevelId, sessionsPurchased, student { fullName, birthDate, gender, avatarUrl }` | LMS: tạo learner + quyền học (entitlement), đưa vào chờ xếp lớp |
| `crm.enrollment.adjusted` | Duyệt / từ chối ưu đãi làm đổi số buổi | `enrollmentId, studentId, sessionsPurchased` | LMS: cập nhật số buổi của quyền học |
| `crm.enrollment.cancelled` | Huỷ đăng ký | `enrollmentId, studentId, reason` | LMS: khoá quyền học, rời lớp |
| `crm.student.updated` | Sửa hồ sơ (tên, ngày sinh, giới tính, ảnh, chi nhánh) | `studentId, branchId, fullName, birthDate, gender, avatarUrl` | LMS: cập nhật learner |
| `crm.student.status_changed` | Bảo lưu / nghỉ / học lại | `studentId, from, to, effectiveDate, reason` | LMS: bảo lưu → tạm dừng trong lớp; nghỉ → rời lớp; học lại → trở lại lớp |
| `crm.trial.booked` | Đặt lịch học thử vào buổi LMS | `appointmentId, leadId, lmsSessionId, branchId, guest { childName, birthYear, parentName, parentPhone }` | LMS: thêm khách học thử (hoặc từ chối → `lms.trial.rejected`) |
| `crm.trial.cancelled` | Huỷ lịch học thử | `appointmentId, lmsSessionId` | LMS: gỡ khách chưa điểm danh |
| `crm.payment.confirmed` | Xác nhận một khoản thu | `paymentId, enrollmentId, studentId, amount, method` + (tuỳ chọn) `enrollmentCode, studentName, studentCode` | Webhooks (biên nhận cho phụ huynh) · Telegram |
| `crm.lead.created` | Tạo lead (tay, import Excel, API) | `leadId, childName, parentName, parentPhone, source, ownerId, via (MANUAL/IMPORT/API)` | Webhooks · Telegram (bỏ qua lead import) |
| `crm.lead.converted` | Lead thành học viên | `leadId, studentId, enrollmentId, ownerId` | Báo cáo, thông báo |

## 4. Sự kiện LMS

Kiểu `data` chính xác: `apps/api/src/contracts/events/lms.ts`.

| Type | Khi nào | `data` | Ai nghe |
|---|---|---|---|
| `lms.level.changed` | Tạo / sửa / ngừng / đổi thứ tự cấp độ, hoặc sửa môn chứa nó | Ảnh chụp đầy đủ: `levelId, subjectId, subjectCode, subjectName, code, name, sessionsCount, sessionMinutes, sortOrder, isActive` | CRM: bảng `catalog_levels` (bản sao để tạo gói học phí) |
| `lms.learner.placed` | Xếp / chuyển lớp | `learnerId, enrollmentId, classId, classCode, className, fromClassId` | CRM: lớp hiện tại của học viên |
| `lms.learner.promoted` | Lên cấp độ | `learnerId, fromLevelId, toLevelId, toLevelName` | CRM: cấp độ hiện tại, gợi ý tái phí |
| `lms.session.finalized` | Chốt điểm danh — một sự kiện tóm tắt cho cả buổi | `sessionId, classId, classCode, className, indexNo, sessionStartsAt, teacherId, counts { PRESENT, LATE, ABSENT, EXCUSED }, absent [{ learnerId, fullName, status }]` | Telegram (báo vắng cho nhóm cơ sở) · Webhooks |
| `lms.attendance.recorded` | Chốt điểm danh — mỗi học viên một sự kiện | `sessionId, classId, learnerId, enrollmentId, status, consumesSession, sessionStartsAt` | CRM: `session_usages` → số buổi đã học · Webhooks |
| `lms.attendance.corrected` | Sửa điểm danh buổi đã chốt | như trên + `fromStatus` | CRM: trừ / trả lại buổi |
| `lms.trial.checked` | GV điểm danh khách học thử | `appointmentId, lmsSessionId, result (ATTENDED/NO_SHOW), note`, `childName` (tuỳ chọn) | CRM: cập nhật lịch hẹn + trạng thái lead · Telegram |
| `lms.trial.rejected` | Không nhận được khách (buổi đã qua / huỷ / hết chỗ / khác chi nhánh), hoặc buổi bị huỷ | `appointmentId, lmsSessionId, reason` | CRM: huỷ lịch hẹn, ghi lý do |
| `lms.feedback.published` | GV lưu nhận xét mới / sửa nội dung | `sessionId, learnerId, comment` | Webhooks |
| `lms.assignment.graded` | Chấm bài | `assignmentId, learnerId, score, maxScore` | Webhooks |
| `lms.class.completed` | Lớp kết thúc | `classId, learnerIds[]` | CRM: danh sách tái phí (GĐ5) |

## 5. Sự kiện Core

| Type | `data` | Ai nghe |
|---|---|---|
| `core.user.deactivated` | `userId, role, branchIds` | CRM: cảnh báo lead/HV chưa có người phụ trách · LMS: cảnh báo lớp chưa có GV |
| `core.timekeeping.checked_in` / `checked_out` | `entryId, userId, branchId, at, source` | Mở rộng chấm công sau này |

## 6. Gửi ra ngoài: webhook & Telegram

Cấu hình ở **Cài đặt → Tích hợp** (quyền `core.integrations.manage`, chỉ ADMIN). Mỗi đích chọn sự kiện (`*` = tất cả) và chi nhánh (trống = mọi chi nhánh). Mọi sự kiện ở §3–4 đều gửi được qua webhook; Telegram chỉ có mẫu tin cho 5 sự kiện: `crm.lead.created`, `crm.enrollment.activated`, `crm.payment.confirmed`, `lms.session.finalized`, `lms.trial.checked`. Tin Telegram che SĐT (`0912 *** 678`).

Mỗi sự kiện khớp đích → một dòng `integration_deliveries`; job `core.integrations.deliver` (mỗi phút) gửi và thử lại sau 1, 5, 15, 60, 180, 360 phút khi lỗi mạng / 408 / 429 / 5xx. Lỗi 4xx khác → `FAILED` ngay. Xem lịch sử và gửi lại tay ở tab Tích hợp. Lịch sử chỉ lưu mã HTTP, không lưu nội dung phản hồi của đích.

### Webhook

`POST <url>`, `Content-Type: application/json`, timeout 10 giây, phản hồi 2xx = thành công.

```json
{ "id": "01J...", "type": "crm.payment.confirmed", "version": 1, "occurredAt": "2026-10-09T10:15:00.000+07:00", "branchId": "01J...", "data": { } }
```

| Header | Ý nghĩa |
|---|---|
| `X-Zero1-Event` | type sự kiện |
| `X-Zero1-Delivery` | ID bản giao cho đích này (giữ nguyên khi thử lại). Bên nhận khử trùng theo `id` trong body |
| `X-Zero1-Timestamp` | giây Unix lúc ký |
| `X-Zero1-Signature` | `sha256=` + HMAC-SHA256 hex của `"<timestamp>.<body thô>"` với secret `whsec_…` của đích (hiện một lần khi tạo) |

Kiểm tra chữ ký (Node):

```js
const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(`${req.headers['x-zero1-timestamp']}.${rawBody}`).digest('hex');
const ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(req.headers['x-zero1-signature']))
  && Math.abs(Date.now() / 1000 - Number(req.headers['x-zero1-timestamp'])) < 300;
```

Production chặn URL trỏ về địa chỉ nội bộ / dành riêng (localhost, 10.x, 192.168.x, 169.254.x, IPv6 nội bộ, IPv4 lồng trong IPv6…) — kiểm tra cả lúc lưu lẫn lúc kết nối (chống DNS rebinding), không theo redirect — trừ khi đặt `WEBHOOK_ALLOW_PRIVATE=true`.

### Telegram

1. Tạo bot qua @BotFather, đặt token vào `TELEGRAM_BOT_TOKEN`, khởi động lại API.
2. Thêm bot vào nhóm của chi nhánh, lấy chat ID của nhóm (vd gửi tin trong nhóm rồi mở `https://api.telegram.org/bot<token>/getUpdates`; nhóm có ID âm `-100…`).
3. Tab Tích hợp → Thêm đích Telegram → nhập chat ID, chọn sự kiện + chi nhánh → **Gửi thử**.

## 7. API cho hệ thống ngoài & phụ huynh

- **API key** (Cài đặt → Tích hợp): dạng `z1_…`, hiện một lần. Gửi `X-Api-Key: z1_…` (hoặc `Authorization: Bearer z1_…`). Key có danh sách quyền (không gồm quyền quản trị Core) và phạm vi chi nhánh; mọi route `/api/v1/crm/*`, `/api/v1/lms/*` hợp quyền đều dùng được. Tài liệu: `https://api.<domain>/docs`.
- **Phụ huynh** (`/api/v1/parent/*`, tag `parent` trong /docs): nhân sự cấp mã 6 số ở hồ sơ học viên (mục Phụ huynh → Cấp mã app phụ huynh, hiệu lực 7 ngày) → phụ huynh `POST /parent/auth/activate { phone, code, password }` → `login` / `refresh` / `logout`. Đọc: `/parent/me`, `/parent/children`, `/parent/children/:id/tuition`, `/parent/children/:id/learning`. Con của tài khoản = mọi học viên có phụ huynh mang SĐT đó (tự cập nhật khi sửa phụ huynh / tạo học viên mới). Token phụ huynh không gọi được API nhân sự và ngược lại.
