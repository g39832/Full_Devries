const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('api', {
    //Authentication Functions
    checkFirstRun : () => ipcRenderer.invoke('check-first-run'),
    setInitialPassword: (password) => ipcRenderer.invoke('set-initial-password', password),
    verifyPassword: (password) => ipcRenderer.invoke('verify-password',password),
    loginSuccess: () => ipcRenderer.send('login-success'),


    //CRm Dashboard Functions
    saveClient: (client) => ipcRenderer.invoke('save-client', client),
    searchClients: (term) => ipcRenderer.invoke('serch-clients', term),
    updateProject: (data) => ipcRenderer.invoke('update-project', data)
});