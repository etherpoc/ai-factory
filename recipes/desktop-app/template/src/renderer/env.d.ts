/// <reference types="vite/client" />

declare global {
  interface Window {
    api: import('../shared/preload-api').ElectronAPI;
  }
}

export {};
