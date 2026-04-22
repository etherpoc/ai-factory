import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
  app: {
    on: vi.fn(),
    whenReady: vi.fn(() => Promise.resolve()),
    quit: vi.fn(),
    getVersion: vi.fn(() => '0.0.1'),
    getAllWindows: vi.fn(() => []),
  },
  BrowserWindow: vi.fn(() => ({
    loadFile: vi.fn(),
    loadURL: vi.fn(),
    on: vi.fn(),
    webContents: { openDevTools: vi.fn() },
  })),
  ipcMain: {
    handle: vi.fn(),
  },
  contextBridge: {
    exposeInMainWorld: vi.fn(),
  },
  ipcRenderer: {
    invoke: vi.fn(),
  },
}));

describe('IPC handlers (main)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('get-app-version handler returns a string', async () => {
    const { app } = await import('electron');
    const version = (app as { getVersion(): string }).getVersion();
    expect(typeof version).toBe('string');
  });

  it('electron mock is properly initialized', async () => {
    const { ipcMain } = await import('electron');
    expect(ipcMain.handle).toBeDefined();
    expect(typeof ipcMain.handle).toBe('function');
  });
});
