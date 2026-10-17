# Triển khai production

Một VPS chạy Docker: MariaDB 10.11 + API + Caddy (phục vụ CRM/LMS, HTTPS tự động) + container sao lưu. File ở `deploy/`.

```
crm.<domain>  ─┐                      ┌─ /api/*, /files/* → api:4000
lms.<domain>  ─┼─ Caddy (80/443) ─────┤─ còn lại → file tĩnh CRM / LMS (SPA)
api.<domain>  ─┘                      └─ api.<domain> → api:4000 (tích hợp, app phụ huynh, /docs)
```

CRM và LMS gọi API cùng origin (`/api`), cookie đăng nhập đặt ở domain cha (`COOKIE_DOMAIN=.<domain>`) nên đăng nhập một lần dùng cả 2 app.

## 1. Chuẩn bị

- VPS Ubuntu 22.04+ (tối thiểu 2 vCPU / 4 GB RAM), mở cổng 80, 443 (TCP + UDP).
- Cài Docker Engine + Compose plugin: `curl -fsSL https://get.docker.com | sh`.
- DNS: 3 bản ghi A `crm`, `lms`, `api` trỏ về IP VPS (chờ phân giải xong trước khi chạy — Caddy cần để lấy chứng chỉ).

## 2. Lần đầu

```bash
git clone <repo> zero1 && cd zero1/deploy
cp .env.production.example .env
nano .env        # domain, mật khẩu DB, JWT_ACCESS_SECRET (openssl rand -base64 48), SMTP, TELEGRAM_BOT_TOKEN
docker compose up -d --build
docker compose logs -f api           # chờ "Đã kết nối database"
docker compose exec api node dist/cli/seed.js   # tạo ADMIN đầu tiên (SEED_ADMIN_EMAIL; mật khẩu in ra nếu bỏ trống SEED_ADMIN_PASSWORD)
```

Mở `https://crm.<domain>`, đăng nhập ADMIN, đổi mật khẩu, tạo chi nhánh và nhân sự.

API tự chạy migration mỗi lần khởi động (đã chạy rồi thì bỏ qua) và đồng bộ vai trò / quyền.

## 3. Cập nhật phiên bản

```bash
cd zero1 && git pull
cd deploy && docker compose up -d --build
```

Trước khi cập nhật bản có migration lớn: chạy sao lưu tay (mục 4).

## 4. Sao lưu & khôi phục

Container `backup` dump 3 database mỗi ngày lúc `BACKUP_HOUR` giờ (mặc định 2h sáng) vào `deploy/backups/`, giữ `BACKUP_KEEP_DAYS` ngày. Nên đồng bộ thư mục này ra ngoài VPS (rclone / Google Drive / S3).

```bash
# Sao lưu tay
docker compose exec db sh -c 'mariadb-dump -uroot -p"$MARIADB_ROOT_PASSWORD" --single-transaction --databases zero1_core zero1_crm zero1_lms' | gzip > backups/manual_$(date +%F).sql.gz
# Khôi phục (dừng API trước)
docker compose stop api
gunzip -c backups/<file>.sql.gz | docker compose exec -T db sh -c 'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD"'
docker compose start api
```

File tải lên (khi không dùng Cloudinary) nằm trong volume `zero1_uploads`: `docker run --rm -v zero1_uploads:/u -v $PWD/backups:/b alpine tar czf /b/uploads_$(date +%F).tgz -C /u .`

## 5. Telegram & tích hợp

Xem [events.md §6–7](events.md#6-gửi-ra-ngoài-webhook--telegram). Token bot đặt trong `deploy/.env` rồi `docker compose up -d api`.

## 6. Vận hành

| Việc | Lệnh |
|---|---|
| Xem log | `docker compose logs -f api` |
| Trạng thái | `docker compose ps` · `curl https://api.<domain>/api/v1/health` |
| Đối soát CRM ↔ LMS | chạy `npm run db:reconcile` từ máy dev trỏ DB production (qua SSH tunnel) |
| Khởi động lại | `docker compose restart api` |

Lưu ý: chỉ chạy **một** instance API (việc định kỳ — nhắc gọi lại, gửi webhook — chạy trong process).
