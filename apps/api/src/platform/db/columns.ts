import { sql } from 'drizzle-orm';
import { bigint, char, customType, datetime } from 'drizzle-orm/mysql-core';

/**
 * Cột JSON chạy được trên cả MySQL lẫn MariaDB.
 * MariaDB lưu JSON dạng LONGTEXT nên driver trả về chuỗi — `json()` gốc của Drizzle
 * sẽ đưa nguyên chuỗi lên tầng nghiệp vụ. Kiểu này luôn parse.
 */
export const jsonb = customType<{ data: unknown; driverData: string | object }>({
  dataType() {
    return 'json';
  },
  toDriver(value) {
    return JSON.stringify(value);
  },
  fromDriver(value) {
    return typeof value === 'string' ? JSON.parse(value) : value;
  },
});

/** Khóa ULID (docs/architecture.md §8). */
export const ulid = (name: string) => char(name, { length: 26 });

/** Thời điểm UTC, độ chính xác mili-giây. */
export const instant = (name: string) => datetime(name, { mode: 'date', fsp: 3 });

/** Tiền VNĐ, số nguyên. Giới hạn an toàn của number (2^53) dư cho mọi khoản học phí. */
export const money = (name: string) => bigint(name, { mode: 'number' });

export const timestamps = {
  createdAt: instant('created_at').notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  updatedAt: instant('updated_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP(3)`)
    .$onUpdate(() => new Date()),
};
