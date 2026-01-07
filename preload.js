const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    checkFirstRun: () => ipcRenderer.invoke('check-first-run'),
    setInitialPassword: (password) => ipcRenderer.invoke('set-initial-password', password),
    verifyPassword: (password) => ipcRenderer.invoke('verify-password', password),
    loginSuccess: () => ipcRenderer.send('login-success'),

    saveClient: (client) => ipcRenderer.invoke('save-client', client),
    searchClients: (term) => ipcRenderer.invoke('search-clients', term),
    updateProject: (data) => ipcRenderer.invoke('update-project', data),
    deleteClient: (id) => ipcRenderer.invoke('delete-client', id) // New
});
