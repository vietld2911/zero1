# Quy ước API

Mục tiêu: API đủ rõ để bên thứ ba (dịch vụ gửi thông báo phụ huynh, Zalo OA, app mobile) tích hợp chỉ bằng tài liệu `/docs`, không cần đọc code.

## 1. Đường dẫn

```
/api/v1/core/...    /api/v1/crm/...    /api/v1/lms/...    /api/v1/parent/... (sau)
```

- Danh từ số nhiều, kebab-case: `/crm/lead-appointments`, `/lms/class-learners`.
- Tài nguyên con: `/lms/classes/{classId}/sessions`.
- **Hành động nghiệp vụ** (không phải CRUD) là `POST` vào sub-resource dạng động từ:
  `POST /crm/leads/{id}/convert`, `POST /crm/enrollments/{id}/payments`, `POST /lms/sessions/{id}/attendance`, `POST /core/timekeeping/check-in`.
- Không lồng quá 2 cấp.

## 2. Định dạng

| Thứ | Quy ước |
|---|---|
| ID | ULID (26 ký tự) |
| Tên field JSON | camelCase |
| Thời điểm | ISO 8601 có múi giờ, server trả về `+07:00`: `2026-10-07T18:30:00.000+07:00` |
| Ngày (không giờ) | `YYYY-MM-DD` |
| Tiền | Số nguyên VNĐ (`1500000`), không dùng số thực |
| Enum | UPPER_SNAKE: `NO_SHOW`, `AWAITING_PAYMENT` |
| Null | Trả `null` rõ ràng, không bỏ field |

## 3. Response

**Một bản ghi**
```json
{ "data": { "id": "01J...", "fullName": "..." } }
```

**Danh sách**
```json
{ "data": [ ... ], "meta": { "page": 1, "pageSize": 20, "total": 134 } }
```

**Lỗi** — chuẩn RFC 7807 (`Content-Type: application/problem+json`):
```json
{
  "type": "urn:zero1:error:LEAD_PHONE_DUPLICATE",
  "title": "Số điện thoại đã tồn tại",
  "status": 409,
  "code": "LEAD_PHONE_DUPLICATE",
  "detail": "Lead 01J... đã dùng số 0901234567",
  "errors": [ { "path": "parentPhone", "message": "Trùng" } ],
  "requestId": "..."
}
```
`code` là hằng số ổn định để client xử lý; `title`/`detail` là tiếng Việt để hiển thị.

| HTTP | Khi nào |
|---|---|
| 200 / 201 / 204 | Thành công / tạo mới / không có nội dung |
| 400 | Sai định dạng / validation (`VALIDATION_ERROR`, kèm `errors[]`) |
| 401 | Chưa đăng nhập / token hết hạn (`UNAUTHENTICATED`, `TOKEN_EXPIRED`) |
| 403 | Không có quyền hoặc ngoài phạm vi dữ liệu (`FORBIDDEN`) |
| 404 | Không tồn tại **hoặc ngoài phạm vi dữ liệu** khi đọc theo ID (không tiết lộ sự tồn tại) |
| 409 | Xung đột nghiệp vụ / trùng / sai trạng thái (`INVALID_STATE_TRANSITION`) |
| 422 | Đúng định dạng nhưng vi phạm quy tắc nghiệp vụ |
| 429 | Quá giới hạn (đăng nhập, API key) |

## 4. Danh sách: phân trang, lọc, sắp xếp

```
GET /api/v1/crm/leads?page=2&pageSize=50&sort=-createdAt,fullName&status=NEW,CONTACTING&branchId=01J...&q=nguyen&createdFrom=2026-10-01&createdTo=2026-10-31
```
- `pageSize` tối đa 100 (export dùng endpoint riêng `.../export`).
- `sort`: danh sách field, `-` là giảm dần; chỉ field được khai báo trong OpenAPI.
- Lọc nhiều giá trị bằng dấu phẩy. Khoảng thời gian: `<field>From` / `<field>To`.
- `q`: tìm kiếm tự do (field cụ thể ghi trong tài liệu từng endpoint).

## 5. Ghi dữ liệu

- `POST` tạo, `PATCH` sửa một phần, `DELETE` xóa (mềm nếu bảng có `deleted_at`). Không dùng `PUT`.
- **Idempotency:** các thao tác liên quan tiền & chuyển đổi (`convert`, `payments`, `enrollments`) bắt buộc header `Idempotency-Key` (UUID do client sinh). Gửi lại cùng key trong 24h → trả lại đúng kết quả lần đầu.
- **Chống ghi đè:** bản ghi có `version`; `PATCH` gửi header `If-Match: <version>`, lệch → `409 VERSION_CONFLICT`.

## 6. Xác thực

| Loại client | Cách |
|---|---|
| Web (CRM/LMS) | `POST /core/auth/login` → access token (JWT, 15 phút) trong body + refresh token trong cookie `httpOnly; Secure; SameSite=Strict; Domain=<domain cha của 2 app>`. Gửi `Authorization: Bearer <access>`. Hết hạn → `POST /core/auth/refresh` |
| Mobile (sau này) | Như web nhưng refresh token trả trong body (`X-Client: mobile`), lưu secure storage |
| Hệ thống ngoài | `Authorization: Bearer zk_live_...` (API key) với scope hẹp, ví dụ `lms.attendance:read`, `crm.guardians:read` |

API không đọc cookie ở endpoint nghiệp vụ ⇒ không cần CSRF token. Riêng `/core/auth/refresh` kiểm `Origin` + SameSite=Strict.

## 7. Webhooks & sự kiện

- Bên ngoài đăng ký: `POST /core/webhooks { url, events: ["lms.attendance.recorded", ...], secret }`.
- Mỗi lần gửi kèm `X-Zero1-Event`, `X-Zero1-Delivery`, `X-Zero1-Signature: sha256=<HMAC(body, secret)>`.
- Thử lại theo backoff (1m, 5m, 30m, 2h, 12h); lịch sử ở `GET /core/webhooks/{id}/deliveries`.
- Payload = envelope sự kiện trong [events.md](events.md).

## 8. Tài liệu

- OpenAPI 3.1 sinh tự động từ zod schema: `GET /api/v1/openapi.json`, giao diện tại `/docs`.
- Mỗi endpoint khai báo: permission cần có, phạm vi dữ liệu áp dụng, mã lỗi có thể trả.
- `packages/api-client` sinh từ `openapi.json`; frontend không viết tay kiểu dữ liệu API.

## 9. Phiên bản

- Thay đổi tương thích (thêm field, thêm endpoint) → giữ `v1`.
- Thay đổi phá vỡ → `v2` song song tối thiểu 6 tháng; header `Deprecation` + `Sunset` trên endpoint cũ.
