# Zero1 — CRM + LMS

Hai sản phẩm tách biệt trên một nền dùng chung:

- **CRM** (`apps/crm-web`): tuyển sinh, học viên, học phí, KPI
- **LMS** (`apps/lms-web`): lớp học, buổi học, điểm danh, bài tập
- **API** (`apps/api`): một server, ba context `core` / `crm` / `lms`, ba database

Thiết kế: [docs/architecture.md](docs/architecture.md) · [lộ trình](docs/roadmap.md) · [vai trò & quyền](docs/roles-permissions.md) · [quy ước API](docs/api-conventions.md) · [sự kiện](docs/events.md) · [báo cáo & KPI](docs/reports-kpi.md) · [triển khai](docs/deploy.md)

## Yêu cầu

- Node ≥ 24
- MySQL 8 hoặc MariaDB ≥ 10.4 (dev dùng được XAMPP)

## Chạy lần đầu

```bash
npm install
cp apps/api/.env.example apps/api/.env      # điền DB_* và JWT_ACCESS_SECRET (lệnh sinh secret có trong file)
npm run db:migrate                          # tạo zero1_core / zero1_crm / zero1_lms + bảng
npm run db:seed                             # vai trò, quyền, tài khoản ADMIN đầu tiên (in mật khẩu tạm một lần)
npm run db:seed-demo                        # (tuỳ chọn) dữ liệu demo: nhân sự, lớp, lead, học viên, điểm danh… — mật khẩu Zero1@2026
```

## Phát triển

```bash
npm run dev:api     # http://localhost:4000      — tài liệu API: http://localhost:4000/docs
npm run dev:crm     # http://localhost:5173
npm run dev:lms     # http://localhost:5174
```

Hai web app proxy `/api` và `/files` (file tải lên) sang `localhost:4000`; API chạy cổng khác thì đặt `API_PROXY_TARGET=http://localhost:xxxx` trước `npm run dev:crm` / `dev:lms`.

Sau khi kéo code mới có migration: `npm run db:migrate` (chạy được cả khi server đang chạy). Vai trò / quyền mới tự đồng bộ khi API khởi động.

Script chạy cả ở production nằm trong `apps/api/src/cli/` (`migrate`, `seed` → `dist/cli/*.js` sau build); script chỉ dùng khi dev ở `apps/api/scripts/`.

## Kiểm tra

```bash
npm run typecheck
npm run lint                                  # gồm luật cấm CRM ↔ LMS import nhau
npm test                                      # unit test
npm run test:integration -w @zero1/api        # cần DB theo apps/api/.env (tự tạo & xoá database tạm)
npm run db:reconcile                          # đối soát số liệu CRM ↔ LMS trên DB đang dùng
```

## Khi đổi API

```bash
npm run api-client:generate     # xuất openapi.json → sinh lại packages/api-client/src/schema.d.ts
npm run db:generate -w @zero1/api   # sau khi sửa schema Drizzle → sinh migration
```

## Production

```bash
npm run build                    # API → apps/api/dist, web → apps/*/dist
```

Triển khai bằng Docker (3 subdomain crm. / lms. / api.): [docs/deploy.md](docs/deploy.md).
