import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';

process.on('uncaughtException', (err) => {
  console.error('[main] uncaughtException:', err);
});

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1024,
    height: 768,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (process.env['NODE_ENV'] === 'development') {
    void win.loadURL('http://localhost:5173');
    win.webContents.openDevTools();
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  return win;
}

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

void app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
