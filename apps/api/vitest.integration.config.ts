import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 20_000,
    // Mỗi file tạo 3 database + chạy migration: giới hạn số file chạy song song để MySQL không quá tải.
    hookTimeout: 60_000,
    maxWorkers: 4,
  },
});
