import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Integration test cần DB thật: chạy riêng bằng `npm run test:integration`.
    exclude: ['tests/integration/**', '**/node_modules/**'],
  },
});
