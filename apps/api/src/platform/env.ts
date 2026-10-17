import { z } from 'zod';

const csv = z
  .string()
  .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean));

// Tên database được nối vào câu lệnh CREATE DATABASE nên chỉ cho phép ký tự an toàn.
const dbName = z.string().regex(/^[A-Za-z0-9_]{1,64}$/, 'Chỉ gồm chữ, số, gạch dưới');

export const DbEnvSchema = z.object({
  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().default(''),
  DB_NAME_CORE: dbName.default('zero1_core'),
  DB_NAME_CRM: dbName.default('zero1_crm'),
  DB_NAME_LMS: dbName.default('zero1_lms'),
});

const EnvSchema = DbEnvSchema.extend({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  // Không có giá trị mặc định: thiếu secret thì server không khởi động.
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET phải dài tối thiểu 32 ký tự'),

  CORS_ORIGINS: csv.default([]),
  /** Đặt true khi chạy sau reverse proxy (nginx) để lấy đúng IP người dùng. */
  TRUST_PROXY: z.stringbool().default(false),
  /** Domain cha của 2 app (vd `.zero1.edu.vn`) để refresh-token cookie dùng chung. Bỏ trống khi dev. */
  COOKIE_DOMAIN: z.string().optional(),

  /** Dùng để tạo link trong email (đặt lại mật khẩu…). */
  CRM_WEB_URL: z.url().default('http://localhost:5173'),
  LMS_WEB_URL: z.url().default('http://localhost:5174'),

  // Email (SMTP) — cấu hình qua môi trường để mật khẩu SMTP không nằm trong DB.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: z.stringbool().default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().default('Zero1 <no-reply@zero1.local>'),

  /** Thư mục lưu file khi không dùng Cloudinary (giấy tờ, học liệu…). */
  UPLOAD_DIR: z.string().default('uploads'),
  /** cloudinary://<key>:<secret>@<cloud> — đặt thì lưu file lên Cloudinary. */
  CLOUDINARY_URL: z.string().optional(),

  /** Bot Telegram gửi thông báo nội bộ (tạo bot qua @BotFather). Bỏ trống → không gửi Telegram. */
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  /** Cho webhook gửi tới địa chỉ nội bộ (localhost, 10.x, 192.168.x…). Mặc định chỉ bật khi dev. */
  WEBHOOK_ALLOW_PRIVATE: z.stringbool().optional(),

  /** Tài khoản ADMIN đầu tiên do `npm run db:seed` tạo. */
  SEED_ADMIN_EMAIL: z.email().default('admin@zero1.local'),
  SEED_ADMIN_PASSWORD: z.string().min(8).optional(),
});

export type Env = z.infer<typeof EnvSchema>;
export type DbEnv = z.infer<typeof DbEnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return parseEnv(EnvSchema, source);
}

/** Chỉ đọc cấu hình DB — dùng cho script migrate. */
export function loadDbEnv(source: NodeJS.ProcessEnv = process.env): DbEnv {
  return parseEnv(DbEnvSchema, source);
}

function parseEnv<S extends z.ZodType>(schema: S, source: NodeJS.ProcessEnv): z.output<S> {
  // `KEY=` trong .env cho ra chuỗi rỗng — coi như không đặt để giá trị mặc định / optional áp dụng.
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== ''));
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Cấu hình môi trường không hợp lệ:\n${lines.join('\n')}`);
  }
  return parsed.data;
}
