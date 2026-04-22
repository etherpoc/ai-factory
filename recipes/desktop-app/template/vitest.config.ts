import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const alias = {
  '@shared': path.resolve(__dirname, 'src/shared'),
  '@renderer': path.resolve(__dirname, 'src/renderer'),
};

export default defineConfig({
  plugins: [react()],
  resolve: { alias },
  test: {
    // Use file-level @vitest-environment docblock for per-file env.
    // renderer tests set // @vitest-environment jsdom
    // main tests run in the default node environment
    environment: 'node',
    setupFiles: ['tests/setup-global.ts'],
    alias,
  },
});
