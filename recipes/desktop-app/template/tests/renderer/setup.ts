import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

Object.assign(window, {
  api: {
    getAppVersion: vi.fn<[], Promise<string>>().mockResolvedValue('0.0.1'),
  } satisfies Window['api'],
});
