import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['core/**/*.ts', 'agents/**/*.ts', 'meta/**/*.ts'],
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 60,
        statements: 60,
      },
    },
  },
  resolve: {
    alias: {
      '@core': new URL('./core', import.meta.url).pathname,
      '@agents': new URL('./agents', import.meta.url).pathname,
      '@recipes': new URL('./recipes', import.meta.url).pathname,
      '@meta': new URL('./meta', import.meta.url).pathname,
    },
  },
});
