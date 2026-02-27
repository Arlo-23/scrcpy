const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('scrcpy', {
    // Window controls
    minimize: () => ipcRenderer.send('window-minimize'),
    maximize: () => ipcRenderer.send('window-maximize'),
    close: () => ipcRenderer.send('window-close'),

    // ADB
    runAdb: (args) => ipcRenderer.invoke('run-adb', args),

    // scrcpy process
    spawnScrcpy: (args) => ipcRenderer.invoke('spawn-scrcpy', args),
    killScrcpy: () => ipcRenderer.invoke('kill-scrcpy'),

    // Events from main
    onScrcpyLog: (cb) => ipcRenderer.on('scrcpy-log', (e, data) => cb(data)),
    onScrcpyStatus: (cb) => ipcRenderer.on('scrcpy-status', (e, status) => cb(status)),

    // Settings
    saveSettings: (data) => ipcRenderer.invoke('save-settings', data),
    loadSettings: () => ipcRenderer.invoke('load-settings'),

    // File picker
    pickFile: (opts) => ipcRenderer.invoke('pick-file', opts),

    // Assets path
    getAssetsPath: () => ipcRenderer.invoke('get-assets-path'),
});
