import { contextBridge, ipcRenderer } from 'electron';
import type { ElectronAPI } from '../shared/preload-api';

const api: ElectronAPI = {
  getAppVersion: () => ipcRenderer.invoke('get-app-version') as Promise<string>,
};

contextBridge.exposeInMainWorld('api', api);
