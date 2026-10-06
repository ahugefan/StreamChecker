const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('appInfo', { name: 'Twitch Live Checker' });

// Renderer fetches the local API port + session key once via IPC, rather
// than them being embedded in the page URL or a global env var.
contextBridge.exposeInMainWorld('serverAPI', {
  getInfo: () => ipcRenderer.invoke('get-server-info')
});

contextBridge.exposeInMainWorld('navAPI', {
  goToDashboard: () => ipcRenderer.invoke('go-to-dashboard')
});

contextBridge.exposeInMainWorld('fileAPI', {
  chooseStreamersFile: () => ipcRenderer.invoke('choose-streamers-file')
});

contextBridge.exposeInMainWorld('soundAPI', {
  choose: () => ipcRenderer.invoke('choose-sound-file'),
  getCustom: () => ipcRenderer.invoke('get-custom-sound'),
  reset: () => ipcRenderer.invoke('reset-sound')
});

contextBridge.exposeInMainWorld('electronAPI', {
  exportStreamers: (streamers) => ipcRenderer.invoke('export-streamers', streamers)
});

contextBridge.exposeInMainWorld('clipAPI', {
  copy: (text) => ipcRenderer.invoke('copy-to-clipboard', text)
});
