console.log("🔥 PRELOAD IS RUNNING 🔥");

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  checkFirstRun: () => ipcRenderer.invoke('check-first-run'),
  setInitialPassword: pw => ipcRenderer.invoke('set-initial-password', pw),
  verifyPassword: pw => ipcRenderer.invoke('verify-password', pw),
  loginSuccess: () => ipcRenderer.send('login-success'),
  saveClient: c => ipcRenderer.invoke('save-client', c),
  searchClients: t => ipcRenderer.invoke('search-clients', t),
  updateProject: d => ipcRenderer.invoke('update-project', d),
  deleteClient: id => ipcRenderer.invoke('delete-client', id),
  uploadPdf: data => ipcRenderer.invoke('upload-pdf', data),
  openFolder: id => ipcRenderer.send('open-client-folder', id),
});
