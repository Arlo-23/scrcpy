/* ═══════════════════════════════════════════════════════════════════════════
   scrcpy GUI — app.js
   Main renderer logic: settings, device polling, command builder, alerts
   ════════════════════════════════════════════════════════════════════════════ */

'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
const state = {
    devices: [],
    selectedSerial: null,
    scrcpyRunning: false,
    pollTimer: null,
    settings: {},
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const el = (id) => document.getElementById(id);

// ── Toast Notifications ───────────────────────────────────────────────────────
const Toaster = (() => {
    const container = el('toast-container');
    const stack = [];
    const MAX = 4;

    const ICONS = {
        success: `<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.5"/><path d="M8 12l3 3 5-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
        warning: `<svg viewBox="0 0 24 24" fill="none"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="currentColor" stroke-width="1.5"/><path d="M12 9v4M12 17h.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
        error: `<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.5"/><path d="M15 9l-6 6M9 9l6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
        info: `<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.5"/><path d="M12 16v-4M12 8h.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
    };

    function show(type = 'info', title, msg, duration = 4000) {
        // Enforce stack cap
        if (stack.length >= MAX) dismiss(stack[0]);

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.style.setProperty('--duration', duration + 'ms');
        toast.innerHTML = `
      <div class="toast-content">
        <div class="toast-icon">${ICONS[type]}</div>
        <div class="toast-body">
          <div class="toast-title">${title}</div>
          ${msg ? `<div class="toast-msg">${msg}</div>` : ''}
        </div>
        <button class="toast-close" aria-label="Dismiss">×</button>
      </div>
      <div class="toast-progress"></div>`;

        toast.querySelector('.toast-close').addEventListener('click', () => dismiss(toast));
        container.appendChild(toast);
        stack.push(toast);

        const timer = setTimeout(() => dismiss(toast), duration);
        toast._timer = timer;
        return toast;
    }

    function dismiss(toast) {
        if (!toast || toast._dismissed) return;
        toast._dismissed = true;
        clearTimeout(toast._timer);
        toast.classList.add('dismissing');
        setTimeout(() => {
            toast.remove();
            const idx = stack.indexOf(toast);
            if (idx !== -1) stack.splice(idx, 1);
        }, 300);
    }

    return { show, dismiss };
})();

// ── Sidebar Navigation ────────────────────────────────────────────────────────
function initNavigation() {
    $$('.nav-item').forEach(btn => {
        btn.addEventListener('click', () => {
            $$('.nav-item').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const tabId = 'tab-' + btn.dataset.tab;
            $$('.tab-pane').forEach(p => p.classList.remove('active'));
            el(tabId)?.classList.add('active');
        });
    });
}

// ── Window Controls ───────────────────────────────────────────────────────────
function initWindowControls() {
    el('btn-close').addEventListener('click', () => window.scrcpy.close());
    el('btn-minimize').addEventListener('click', () => window.scrcpy.minimize());
    el('btn-maximize').addEventListener('click', () => window.scrcpy.maximize());
}

// ── Device Polling ────────────────────────────────────────────────────────────
async function refreshDevices() {
    const btn = el('btn-refresh-devices');
    btn.classList.add('spinning');

    const result = await window.scrcpy.runAdb(['devices']);
    btn.classList.remove('spinning');

    if (!result.ok) return;

    const lines = result.output.trim().split('\n').slice(1); // skip header
    const newDevices = lines
        .map(line => {
            const parts = line.trim().split(/\s+/);
            if (parts.length < 2) return null;
            return { serial: parts[0], state: parts[1] };
        })
        .filter(Boolean)
        .filter(d => d.serial.length > 2);

    // Detect connection/disconnection events
    const prevSerials = state.devices.map(d => d.serial);
    const newSerials = newDevices.map(d => d.serial);

    newSerials.forEach(s => {
        if (!prevSerials.includes(s)) {
            const dev = newDevices.find(d => d.serial === s);
            if (dev.state === 'device') {
                Toaster.show('success', 'Device Connected', s);
                setStatusConnected(s);
            } else if (dev.state === 'unauthorized') {
                Toaster.show('warning', 'Authorization Required', `${s} — Allow USB debugging on device`);
            } else if (dev.state === 'offline') {
                Toaster.show('error', 'Device Offline', s);
            }
        }
    });

    prevSerials.forEach(s => {
        if (!newSerials.includes(s)) {
            Toaster.show('error', 'Device Disconnected', s, 5000);
            if (state.selectedSerial === s) {
                state.selectedSerial = null;
                setStatusDisconnected();
            }
        }
    });

    state.devices = newDevices;
    renderDeviceList();
}

function renderDeviceList() {
    const list = el('device-list');
    if (state.devices.length === 0) {
        list.innerHTML = `<div class="device-empty">
      <svg viewBox="0 0 24 24" fill="none"><path d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" stroke="currentColor" stroke-width="1.5"/></svg>
      <p>No devices detected</p>
      <small>Connect a device via USB or use WiFi below</small>
    </div>`;
        return;
    }

    list.innerHTML = state.devices.map(d => `
    <div class="device-item ${state.selectedSerial === d.serial ? 'selected' : ''}"
         data-serial="${d.serial}" role="button" tabindex="0">
      <div class="device-info">
        <span class="device-serial">${d.serial}</span>
        <span class="device-state">${d.state}</span>
      </div>
      <span class="device-badge ${d.state === 'device' ? 'authorized' : d.state === 'unauthorized' ? 'unauthorized' : 'offline'}">
        ${d.state === 'device' ? 'Ready' : d.state}
      </span>
    </div>
  `).join('');

    $$('.device-item').forEach(item => {
        item.addEventListener('click', () => {
            const serial = item.dataset.serial;
            const dev = state.devices.find(d => d.serial === serial);
            if (dev?.state !== 'device') {
                Toaster.show('warning', 'Device Not Ready', 'This device is not authorized or is offline.');
                return;
            }
            state.selectedSerial = serial;
            el('opt-serial').value = serial;
            renderDeviceList();
            setStatusConnected(serial);
            Toaster.show('info', 'Device Selected', serial);
            buildCommand();
        });
    });
}

function setStatusConnected(serial) {
    el('status-dot').className = 'status-dot connected';
    el('status-text').textContent = serial;
}
function setStatusDisconnected() {
    el('status-dot').className = 'status-dot';
    el('status-text').textContent = 'No Device';
    el('latency-badge').style.display = 'none';
}
function setStatusRunning() {
    el('status-dot').className = 'status-dot running';
    el('status-text').textContent = 'Mirroring';
}

function startPolling() {
    refreshDevices();
    state.pollTimer = setInterval(refreshDevices, 2500);
}

// ── WiFi Connection ───────────────────────────────────────────────────────────
function initWifi() {
    el('btn-wifi-connect').addEventListener('click', async () => {
        const ip = el('wifi-ip').value.trim();
        const port = el('wifi-port').value.trim() || '5555';
        if (!ip) { Toaster.show('warning', 'IP Required', 'Enter the device IP address first.'); return; }

        const target = `${ip}:${port}`;
        Toaster.show('info', 'Connecting…', target);
        const result = await window.scrcpy.runAdb(['connect', target]);

        if (result.ok && result.output.includes('connected')) {
            Toaster.show('success', 'WiFi Connected', target);
            await refreshDevices();
        } else {
            Toaster.show('error', 'Connection Failed', result.output || 'Could not reach device.');
        }
    });

    el('btn-wifi-disconnect').addEventListener('click', async () => {
        const ip = el('wifi-ip').value.trim();
        const port = el('wifi-port').value.trim() || '5555';
        if (!ip) { Toaster.show('warning', 'No IP', 'Enter an IP to disconnect.'); return; }
        const target = `${ip}:${port}`;
        await window.scrcpy.runAdb(['disconnect', target]);
        Toaster.show('info', 'Disconnected', target);
        await refreshDevices();
    });
}

// ── Sliders ───────────────────────────────────────────────────────────────────
// ── Presets & Bento Tiles ─────────────────────────────────────────────────────
function initPresets() {
    $$('.preset-group').forEach(group => {
        const targetId = group.dataset.target;
        const targetInput = el(targetId);
        const displayEl = el('display-' + targetId.replace('opt-', ''));
        const customRow = el('custom-' + targetId.replace('opt-', '') + '-row');

        const btns = group.querySelectorAll('.preset-btn');
        btns.forEach(btn => {
            btn.addEventListener('click', () => {
                const val = btn.dataset.value;

                // Update active state
                btns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                if (val === 'custom') {
                    customRow?.classList.add('visible');
                } else {
                    customRow?.classList.remove('visible');
                    targetInput.value = val;
                    if (displayEl) displayEl.textContent = val;
                    buildCommand();
                    saveSettings();
                }
            });
        });

        // Also update display on manual input change
        targetInput?.addEventListener('input', () => {
            if (displayEl) displayEl.textContent = targetInput.value;
        });
    });
}

function initSliders() {
    const sliders = [
        { id: 'opt-display-buffer', fmt: v => `${v} ms`, warn: 300, warnMsg: 'High buffering adds noticeable latency.' },
        { id: 'opt-audio-buffer', fmt: v => `${v} ms`, warn: 300, warnMsg: 'High audio buffering adds latency.' },
    ];

    sliders.forEach(({ id, fmt, warn, warnMsg }) => {
        const slider = el(id);
        const valEl = el(id + '-val');
        if (!slider) return;

        function update() {
            const val = Number(slider.value);
            const min = Number(slider.min) || 0;
            const max = Number(slider.max) || 500;
            const pct = ((val - min) / (max - min)) * 100;
            slider.style.setProperty('--pct', pct + '%');
            if (valEl) valEl.textContent = fmt(val);

            // Limit warning (debounced)
            if (warn !== null && val >= warn && warnMsg) {
                clearTimeout(slider._warnTimer);
                slider._warnTimer = setTimeout(() => {
                    if (!slider._warned || slider._warnVal !== val) {
                        slider._warned = true;
                        slider._warnVal = val;
                        Toaster.show('warning', 'Limit Alert', warnMsg, 5000);
                    }
                }, 600);
            } else {
                slider._warned = false;
            }

            buildCommand();
            saveSettings();
        }

        slider.addEventListener('input', update);
        // Only trigger update if it's actually a range slider in the DOM
        if (slider.type === 'range') update();
    });
}

// ── Toggles & Checkboxes ──────────────────────────────────────────────────────
function initToggles() {
    // Audio enable toggle
    el('opt-audio-enable').addEventListener('change', (e) => {
        el('audio-fields').style.opacity = e.target.checked ? '1' : '0.4';
        el('audio-fields').style.pointerEvents = e.target.checked ? '' : 'none';
        buildCommand(); saveSettings();
    });

    // Record enable toggle
    el('opt-record-enable').addEventListener('change', (e) => {
        el('record-fields').style.opacity = e.target.checked ? '1' : '0.4';
        el('record-fields').style.pointerEvents = e.target.checked ? '' : 'none';
        buildCommand(); saveSettings();
    });

    // All checkboxes
    $$('input[type=checkbox]').forEach(cb => {
        cb.addEventListener('change', () => { buildCommand(); saveSettings(); });
    });

    // All selects + text inputs
    $$('select, input[type=text], input[type=number]').forEach(inp => {
        inp.addEventListener('change', () => { buildCommand(); saveSettings(); });
        inp.addEventListener('input', () => { buildCommand(); });
    });
}

// ── File Pick ─────────────────────────────────────────────────────────────────
function initFilePicker() {
    el('btn-pick-file').addEventListener('click', async () => {
        const result = await window.scrcpy.pickFile({});
        if (!result.canceled) {
            el('opt-record-file').value = result.filePath;
            buildCommand(); saveSettings();
        }
    });
}

// ── Command Builder ───────────────────────────────────────────────────────────
function buildCommand() {
    const args = [];

    // Helper to safely get value/checked even if element doesn't exist
    const val = (id) => { const e = el(id); return e ? e.value : ''; };
    const chk = (id) => { const e = el(id); return e ? e.checked : false; };

    // Serial
    const serial = val('opt-serial').trim() || (state.selectedSerial || '');
    if (serial) args.push('--serial', serial);

    // Display ID
    const displayId = val('opt-display-id');
    if (displayId && displayId !== '0') args.push('--display', displayId);

    // Video
    const maxSize = val('opt-max-size');
    if (maxSize && maxSize !== '1080') args.push('--max-size', maxSize);

    const bitRate = val('opt-bit-rate');
    if (bitRate && bitRate !== '8') args.push('--video-bit-rate', bitRate + 'M');

    const maxFps = val('opt-max-fps');
    if (maxFps && maxFps !== '60') args.push('--max-fps', maxFps);

    const dispBuffer = val('opt-display-buffer');
    if (dispBuffer && dispBuffer !== '0') args.push('--display-buffer', dispBuffer);

    const vCodec = val('opt-video-codec');
    if (vCodec) args.push('--video-codec', vCodec);

    const renderDriver = val('opt-render-driver');
    if (renderDriver) args.push('--render-driver', renderDriver);

    const lockOrient = val('opt-lock-orientation');
    if (lockOrient !== '') args.push('--lock-video-orientation=' + lockOrient);

    const codecOpts = val('opt-codec-options').trim();
    if (codecOpts) args.push('--video-codec-options', codecOpts);

    const cropEnable = chk('opt-crop-enable');
    if (cropEnable) {
        const w = val('opt-crop-w');
        const h = val('opt-crop-h');
        const x = val('opt-crop-x') || '0';
        const y = val('opt-crop-y') || '0';
        if (w && h) args.push('--crop', `${w}:${h}:${x}:${y}`);
    }

    if (chk('opt-no-video')) args.push('--no-video');

    // Audio
    if (!chk('opt-audio-enable')) {
        args.push('--no-audio');
    } else {
        const aBitRate = val('opt-audio-bit-rate');
        if (aBitRate && aBitRate !== '128') args.push('--audio-bit-rate', aBitRate + 'K');

        const aBuffer = val('opt-audio-buffer');
        if (aBuffer && aBuffer !== '0') args.push('--audio-buffer', aBuffer);

        const aCodec = val('opt-audio-codec');
        if (aCodec) args.push('--audio-codec', aCodec);

        const aSource = val('opt-audio-source');
        if (aSource) args.push('--audio-source', aSource);
    }

    // Window
    if (chk('opt-fullscreen')) args.push('--fullscreen');
    if (chk('opt-always-on-top')) args.push('--always-on-top');
    if (chk('opt-borderless')) args.push('--window-borderless');

    const winTitle = val('opt-window-title').trim();
    if (winTitle) args.push('--window-title', winTitle);

    const winW = val('opt-window-width');
    if (winW && winW !== '0') args.push('--window-width', winW);

    const winH = val('opt-window-height');
    if (winH && winH !== '0') args.push('--window-height', winH);

    const winX = val('opt-window-x');
    if (winX) args.push('--window-x', winX);

    const winY = val('opt-window-y');
    if (winY) args.push('--window-y', winY);

    // Control
    if (chk('opt-no-control')) args.push('--no-control');
    if (chk('opt-show-touches')) args.push('--show-touches');
    if (chk('opt-stay-awake')) args.push('--stay-awake');
    if (chk('opt-turn-screen-off')) args.push('--turn-screen-off');
    if (chk('opt-forward-all-clicks')) args.push('--forward-all-clicks');
    if (chk('opt-prefer-text')) args.push('--prefer-text');
    if (chk('opt-hid-keyboard')) args.push('--hid-keyboard');
    if (chk('opt-hid-mouse')) args.push('--hid-mouse');

    const shortcutMod = val('opt-shortcut-mod');
    if (shortcutMod) args.push('--shortcut-mod', shortcutMod);

    // Recording
    if (chk('opt-record-enable')) {
        const recFile = val('opt-record-file').trim();
        if (recFile) args.push('--record', recFile);
        const recFmt = val('opt-record-format');
        if (recFmt) args.push('--record-format', recFmt);
    }
    if (chk('opt-no-display')) args.push('--no-display');

    // Advanced
    const tunnelHost = val('opt-tunnel-host').trim();
    if (tunnelHost && tunnelHost !== 'localhost') args.push('--tunnel-host', tunnelHost);

    const tunnelPort = val('opt-tunnel-port');
    if (tunnelPort) args.push('--tunnel-port', tunnelPort);

    if (chk('opt-force-adb-forward')) args.push('--force-adb-forward');

    const logLevel = val('opt-log-level');
    if (logLevel) args.push('--log-level', logLevel);

    const pushTarget = val('opt-push-target').trim();
    if (pushTarget) args.push('--push-target', pushTarget);

    if (chk('opt-disable-screensaver')) args.push('--disable-screensaver');
    if (chk('opt-no-legacy-clipboard')) args.push('--no-legacy-clipboard');

    // Update preview
    const preview = 'scrcpy ' + args.join(' ');
    el('command-preview').textContent = preview;
    el('command-preview').title = preview;

    // Store for launch
    state.currentArgs = args;
    return args;
}

// ── Launch / Stop ─────────────────────────────────────────────────────────────
function initLaunchButton() {
    el('btn-launch').addEventListener('click', launchScrcpy);
    el('btn-stop').addEventListener('click', stopScrcpy);
}

async function launchScrcpy() {
    if (state.scrcpyRunning) return;

    const args = buildCommand();

    // Validate recording
    if (el('opt-record-enable').checked && !el('opt-record-file').value.trim()) {
        Toaster.show('warning', 'No Output File', 'Please select a recording output file.');
        return;
    }

    el('btn-launch').disabled = true;
    el('btn-launch').innerHTML = `<svg viewBox="0 0 24 24" fill="none" style="animation:spin 0.9s linear infinite"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" stroke-dasharray="28 8" stroke-linecap="round"/></svg> Starting…`;

    const result = await window.scrcpy.spawnScrcpy(args);

    if (result.ok) {
        state.scrcpyRunning = true;
        setStatusRunning();
        el('btn-launch').classList.add('hidden');
        el('btn-stop').classList.remove('hidden');
    } else {
        el('btn-launch').disabled = false;
        el('btn-launch').innerHTML = `<svg viewBox="0 0 24 24" fill="none"><polygon points="5,3 19,12 5,21" fill="currentColor"/></svg> Launch scrcpy`;
        Toaster.show('error', 'Launch Failed', result.error || 'Could not start scrcpy.');
    }
}

async function stopScrcpy() {
    await window.scrcpy.killScrcpy();
    state.scrcpyRunning = false;
    el('btn-stop').classList.add('hidden');
    el('btn-launch').classList.remove('hidden');
    el('btn-launch').disabled = false;
    el('btn-launch').innerHTML = `<svg viewBox="0 0 24 24" fill="none"><polygon points="5,3 19,12 5,21" fill="currentColor"/></svg> Launch scrcpy`;
    setStatusConnected(state.selectedSerial || '');
}

// ── scrcpy Status Events ──────────────────────────────────────────────────────
function initScrcpyEvents() {
    window.scrcpy.onScrcpyStatus((status) => {
        if (status === 'running') {
            Toaster.show('success', 'scrcpy Running', 'Mirror window is now active.');
            setStatusRunning();
        } else if (status === 'stopped') {
            state.scrcpyRunning = false;
            el('btn-stop').classList.add('hidden');
            el('btn-launch').classList.remove('hidden');
            el('btn-launch').disabled = false;
            el('btn-launch').innerHTML = `<svg viewBox="0 0 24 24" fill="none"><polygon points="5,3 19,12 5,21" fill="currentColor"/></svg> Launch scrcpy`;
            if (state.selectedSerial) setStatusConnected(state.selectedSerial);
            else setStatusDisconnected();
            Toaster.show('info', 'scrcpy Stopped', '');
        } else if (status === 'error') {
            Toaster.show('error', 'scrcpy Error', 'Check the log panel for details.', 6000);
        }
    });

    window.scrcpy.onScrcpyLog((data) => {
        appendLog(data.type, data.text);
        analyzeLog(data.text);
    });
}

// ── Log Drawer ────────────────────────────────────────────────────────────────
function appendLog(type, text) {
    const body = el('log-body');
    const now = new Date();
    const time = now.toTimeString().slice(0, 8);
    const lines = text.trim().split('\n');

    lines.forEach(line => {
        if (!line.trim()) return;
        const div = document.createElement('div');
        div.className = `log-line ${type}`;
        div.innerHTML = `<span class="log-time">${time}</span><span>${escapeHtml(line)}</span>`;
        body.appendChild(div);
    });

    body.scrollTop = body.scrollHeight;
}

function analyzeLog(text) {
    const lower = text.toLowerCase();

    if (lower.includes('device not found') || lower.includes('no devices')) {
        Toaster.show('error', 'No Device Found', 'Make sure your device is connected and USB debugging is enabled.', 6000);
    } else if (lower.includes('error') && lower.includes('connection')) {
        Toaster.show('error', 'Connection Error', text.slice(0, 120), 6000);
    } else if (lower.includes('encoder') && (lower.includes('not found') || lower.includes('failed'))) {
        Toaster.show('warning', 'Encoder Issue', 'The selected video codec encoder was not found on device.', 6000);
    } else if (lower.includes('timeout')) {
        Toaster.show('warning', 'Connection Timeout', 'Check network or USB connection quality.', 6000);
    } else if (lower.includes('refused')) {
        Toaster.show('error', 'Connection Refused', 'ADB could not reach the device server.', 6000);
    }
}

function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function initLogDrawer() {
    const drawer = el('log-drawer');

    el('btn-toggle-log').addEventListener('click', () => drawer.classList.toggle('open'));
    el('btn-close-log').addEventListener('click', () => drawer.classList.remove('open'));
    el('btn-clear-log').addEventListener('click', () => { el('log-body').innerHTML = ''; });
}

// ── Copy Command ──────────────────────────────────────────────────────────────
function initCopyCmd() {
    el('btn-copy-cmd').addEventListener('click', () => {
        navigator.clipboard.writeText(el('command-preview').textContent).then(() => {
            Toaster.show('success', 'Copied!', 'Command copied to clipboard.');
        });
    });
}

// ── Reset Settings ────────────────────────────────────────────────────────────
function initResetSettings() {
    el('btn-reset-settings').addEventListener('click', () => {
        if (!confirm('Reset all settings to defaults?')) return;
        localStorage.removeItem('scrcpy-settings');
        window.scrcpy.saveSettings({});
        window.location.reload();
    });
}

// ── Settings Persistence ──────────────────────────────────────────────────────
function collectSettings() {
    const data = {};
    $$('input[type=range], input[type=number], input[type=text], select').forEach(inp => {
        if (inp.id) data[inp.id] = inp.value;
    });
    $$('input[type=checkbox]').forEach(cb => {
        if (cb.id) data[cb.id] = cb.checked;
    });
    return data;
}

let _saveTimer;
function saveSettings() {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(async () => {
        const data = collectSettings();
        await window.scrcpy.saveSettings(data);
        localStorage.setItem('scrcpy-settings', JSON.stringify(data));
    }, 800);
}

async function loadSettings() {
    let data = null;

    // Try IPC file first
    const res = await window.scrcpy.loadSettings();
    if (res.ok && res.data) {
        data = res.data;
    } else {
        // Fallback to localStorage
        const raw = localStorage.getItem('scrcpy-settings');
        if (raw) {
            try { data = JSON.parse(raw); } catch { data = null; }
        }
    }

    if (!data) return;

    // Restore inputs
    Object.entries(data).forEach(([id, value]) => {
        const inp = el(id);
        if (!inp) return;
        if (inp.type === 'checkbox') inp.checked = value;
        else inp.value = value;

        // Sync visual labels & preset buttons
        const displayId = 'display-' + id.replace('opt-', '');
        const displayEl = el(displayId);
        if (displayEl) displayEl.textContent = value;

        // Sync preset buttons active state
        const group = document.querySelector(`.preset-group[data-target="${id}"]`);
        if (group) {
            const btns = group.querySelectorAll('.preset-btn');
            let found = false;
            btns.forEach(b => {
                if (b.dataset.value === String(value)) {
                    b.classList.add('active');
                    found = true;
                } else {
                    b.classList.remove('active');
                }
            });
            if (!found) {
                const customBtn = Array.from(btns).find(b => b.dataset.value === 'custom');
                customBtn?.classList.add('active');
                el('custom-' + id.replace('opt-', '') + '-row')?.classList.add('visible');
            }
        }
    });
}

// ── Refresh Button ────────────────────────────────────────────────────────────
function initRefreshBtn() {
    el('btn-refresh-devices').addEventListener('click', refreshDevices);
}

// ── Main Init ─────────────────────────────────────────────────────────────────
async function main() {
    initNavigation();
    initWindowControls();
    initWifi();
    initPresets();
    initSliders();
    initToggles();
    initFilePicker();
    initLaunchButton();
    initScrcpyEvents();
    initLogDrawer();
    initCopyCmd();
    initResetSettings();
    initRefreshBtn();

    // Load saved settings before building command
    await loadSettings();

    // Re-sync sliders after load (to update visual position)
    $$('input[type=range]').forEach(s => s.dispatchEvent(new Event('input')));

    buildCommand();
    startPolling();
}

document.addEventListener('DOMContentLoaded', main);
