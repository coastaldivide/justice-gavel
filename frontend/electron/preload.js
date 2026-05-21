/**
 * electron/preload.js — Secure context bridge
 * Exposes only specific safe APIs to the renderer process.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Platform detection
  platform: process.platform,
  isElectron: true,

  // Native notifications
  showNotification: (title, body) => ipcRenderer.send('show-notification', { title, body }),

  // Open external URLs in default browser
  openExternal: (url) => ipcRenderer.send('open-external', url),

  // App version
  getVersion: () => ipcRenderer.invoke('get-version'),
});
