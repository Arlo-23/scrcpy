const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { spawn, exec } = require('child_process');
const fs = require('fs');

const isPackaged = app.isPackaged;
const ASSETS_PATH = isPackaged
    ? path.join(process.resourcesPath, 'assets')
    : path.join(__dirname, '..', 'assets');
const SCRCPY_EXE = path.join(ASSETS_PATH, 'scrcpy.exe');
const ADB_EXE = path.join(ASSETS_PATH, 'adb.exe');
const SETTINGS_FILE = path.join(app.getPath('userData'), 'scrcpy-settings.json');

let mainWindow = null;
let scrcpyProcess = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 900,
        minHeight: 600,
        frame: false,
        transparent: false,
        backgroundColor: '#0d0d1a',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
        icon: path.join(ASSETS_PATH, 'icon.png'),
        title: 'scrcpy GUI',
    });

    mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

    // Open links in default browser
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });

    mainWindow.on('closed', () => {
        if (scrcpyProcess) scrcpyProcess.kill();
        mainWindow = null;
    });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (!mainWindow) createWindow(); });

// ── IPC: Window controls ──────────────────────────────────────────────────────
ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
});
ipcMain.on('window-close', () => mainWindow?.close());

// ── IPC: ADB commands ─────────────────────────────────────────────────────────
ipcMain.handle('run-adb', async (event, args) => {
    return new Promise((resolve, reject) => {
        const cmd = `"${ADB_EXE}" ${args.join(' ')}`;
        exec(cmd, { timeout: 10000 }, (err, stdout, stderr) => {
            if (err && !stdout) resolve({ ok: false, output: stderr || err.message });
            else resolve({ ok: true, output: stdout });
        });
    });
});

// ── IPC: Spawn scrcpy ─────────────────────────────────────────────────────────
ipcMain.handle('spawn-scrcpy', async (event, args) => {
    if (scrcpyProcess) {
        scrcpyProcess.kill();
        scrcpyProcess = null;
    }

    return new Promise((resolve) => {
        // Log for debugging
        console.log('Spawning:', SCRCPY_EXE, args.join(' '));

        scrcpyProcess = spawn(`"${SCRCPY_EXE}"`, args, {
            cwd: ASSETS_PATH,
            env: { ...process.env, PATH: ASSETS_PATH + ';' + process.env.PATH },
            shell: true
        });

        scrcpyProcess.stdout.on('data', (data) => {
            mainWindow?.webContents.send('scrcpy-log', { type: 'stdout', text: data.toString() });
        });

        scrcpyProcess.stderr.on('data', (data) => {
            console.error('scrcpy stderr:', data.toString());
            mainWindow?.webContents.send('scrcpy-log', { type: 'stderr', text: data.toString() });
        });

        scrcpyProcess.on('spawn', () => {
            mainWindow?.webContents.send('scrcpy-status', 'running');
            resolve({ ok: true });
        });

        scrcpyProcess.on('error', (err) => {
            console.error('scrcpy spawn error:', err);
            mainWindow?.webContents.send('scrcpy-status', 'error');
            mainWindow?.webContents.send('scrcpy-log', { type: 'error', text: err.message });
            scrcpyProcess = null;
            resolve({ ok: false, error: err.message });
        });

        scrcpyProcess.on('exit', (code) => {
            console.log('scrcpy exited with code:', code);
            mainWindow?.webContents.send('scrcpy-status', 'stopped');
            mainWindow?.webContents.send('scrcpy-log', { type: 'info', text: `scrcpy exited with code ${code}` });
            scrcpyProcess = null;
        });
    });
});

// ── IPC: Kill scrcpy ──────────────────────────────────────────────────────────
ipcMain.handle('kill-scrcpy', async () => {
    if (scrcpyProcess) {
        scrcpyProcess.kill();
        scrcpyProcess = null;
        return { ok: true };
    }
    return { ok: false, error: 'No process running' };
});

// ── IPC: Settings persistence ─────────────────────────────────────────────────
ipcMain.handle('save-settings', async (event, data) => {
    try {
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2), 'utf-8');
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e.message };
    }
});

ipcMain.handle('load-settings', async () => {
    try {
        if (fs.existsSync(SETTINGS_FILE)) {
            const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8');
            return { ok: true, data: JSON.parse(raw) };
        }
        return { ok: true, data: null };
    } catch (e) {
        return { ok: false, data: null, error: e.message };
    }
});

// ── IPC: File dialog ──────────────────────────────────────────────────────────
ipcMain.handle('pick-file', async (event, opts) => {
    const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Save Recording',
        defaultPath: opts?.defaultPath || 'recording.mp4',
        filters: [
            { name: 'MP4 Video', extensions: ['mp4'] },
            { name: 'MKV Video', extensions: ['mkv'] },
        ],
    });
    return result;
});

// ── IPC: Get assets path ──────────────────────────────────────────────────────
ipcMain.handle('get-assets-path', () => ASSETS_PATH);
