// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/renderer/App';

// Mock window.api since preload does not run in jsdom
Object.assign(window, {
  api: {
    getAppVersion: vi.fn<[], Promise<string>>().mockResolvedValue('0.0.1'),
  } satisfies Window['api'],
});

afterEach(() => {
  cleanup();
});

describe('App (renderer)', () => {
  it('renders app-title element', () => {
    render(<App />);
    const titles = screen.getAllByTestId('app-title');
    expect(titles.length).toBeGreaterThanOrEqual(1);
    expect(titles[0]).toBeInTheDocument();
  });

  it('app-title contains expected text', () => {
    render(<App />);
    const title = screen.getAllByTestId('app-title')[0];
    expect(title).toHaveTextContent(/UAF Desktop App/);
  });
});
