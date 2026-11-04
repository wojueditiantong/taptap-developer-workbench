const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('taptapDesktop', {
  request: (path, options) => ipcRenderer.invoke('taptap:request', path, options),
  openAuth: url => ipcRenderer.invoke('taptap:open-auth', url),
  openExternal: url => ipcRenderer.invoke('taptap:open-external', url),
  officialEditor: input => ipcRenderer.invoke('taptap:official-editor', input),
  openReport: path => ipcRenderer.invoke('taptap:open-report', path),
  pickFile: kind => ipcRenderer.invoke('taptap:pick-file', kind),
  chooseWorkspace: () => ipcRenderer.invoke('taptap:choose-workspace'),
  workspace: () => ipcRenderer.invoke('taptap:workspace'),
  window: action => ipcRenderer.invoke('taptap:window', action),
  platform: process.platform,
});
