const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('pluginBridge', Object.freeze({
  request: (action, value) => ipcRenderer.invoke('notes-plugin:request', { action, value }),
  onEvent: callback => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('notes-plugin:event', listener);
    return () => ipcRenderer.removeListener('notes-plugin:event', listener);
  },
}));
