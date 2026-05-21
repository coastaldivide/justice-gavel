/**
 * electron/main.js — Justice Gavel Mac Desktop App
 *
 * Wraps the React Native Web build in an Electron shell.
 * Provides: native menu bar, dock icon, system notifications,
 *           file system access, auto-updater.
 *
 * Build: npm run electron:build (outputs to electron-dist/)
 * Dev:   npm run electron:dev
 */

const { app, BrowserWindow, Menu, shell, Notification, nativeTheme } = require('electron');

// ── Main process error logging ──────────────────────────────────────────────
// electron-log writes to platform log files (~/Library/Logs on macOS, etc.)
// and keeps the last 5 log files so crashes are diagnosable after the fact.
let log;
try {
  log = require('electron-log');
  log.transports.file.level = 'warn';
  log.transports.console.level = 'info';
  // Catch unhandled errors in the main process
  process.on('uncaughtException',  (err) => log.error('Uncaught:', err));
  process.on('unhandledRejection', (err) => log.error('Unhandled rejection:', err));
} catch { log = console; }
const path  = require('path');
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// ── Security: enforce content security policy ─────────────────────────────────
// Prevent remote code execution if the app ever loads external content
app.on('web-contents-created', (event, contents) => {
  contents.on('will-navigate', (event, url) => {
    const parsedUrl = new URL(url);
    // Allow localhost (dev) and justicegavel.app (prod)
    const allowed = ['localhost', '127.0.0.1', 'justicegavel.app'];
    if (!allowed.some(h => parsedUrl.hostname.endsWith(h))) {
      event.preventDefault();
      shell.openExternal(url); // open external URLs in default browser
    }
  });
  contents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
});

// ── Single-instance lock ────────────────────────────────────────────────────
// Prevents multiple copies running simultaneously (each would have separate auth).
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}
app.on('second-instance', (_event, _argv, _workingDir) => {
  // Someone tried to open a second instance — focus the existing window
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width:          900,
    height:         700,
    minWidth:       400,
    minHeight:      600,
    // macOS: use hiddenInset for traffic lights overlay
    // Windows/Linux: use default — hiddenInset causes visual issues cross-platform
    titleBarStyle:        process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: process.platform === 'darwin' ? { x: 16, y: 16 } : undefined,
    backgroundColor: '#042C53',
    icon: path.join(__dirname, '../assets/icon.png'),
    webPreferences: {
      nodeIntegration:    false,     // security: no node in renderer
      contextIsolation:   true,      // security: isolate preload
      sandbox:            true,      // security: renderer in sandbox
      webSecurity:        true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // Load the web build or dev server
  const startUrl = isDev
    ? (process.env.EXPO_WEB_PORT ? `http://localhost:\${process.env.EXPO_WEB_PORT}` : 'http://localhost:8081')
    : 'file://' + path.join(__dirname, '../web-build/index.html');

  mainWindow.loadURL(startUrl);

  // Open DevTools in development
  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── macOS App Menu ─────────────────────────────────────────────────────────────
function buildMenu() {
  const template = [
    {
      label: 'Justice Gavel',
      submenu: [
        { label: 'About Justice Gavel', role: 'about' },
        { type: 'separator' },
        { label: 'Preferences…', accelerator: 'CmdOrCtrl+,', click: () => {
            mainWindow?.webContents.executeJavaScript(
              'window.__navigateTo && window.__navigateTo("Settings")'
            );
          }
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' }, { role: 'forceReload' },
        isDev ? { role: 'toggleDevTools' } : null,
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ].filter(Boolean),
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' }, { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
    {
      label: 'Help',
      role: 'help',
      submenu: [
        { label: 'Justice Gavel Support', click: () => shell.openExternal('https://justicegavel.app/support') },
        { label: 'Privacy Policy',        click: () => shell.openExternal('https://justicegavel.app/privacy') },
        { label: 'Terms of Service',      click: () => shell.openExternal('https://justicegavel.app/terms') },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// ── System notifications (maps to expo-notifications on web) ──────────────────
// ── IPC Handlers ──────────────────────────────────────────────────────────────
// These match the ipcRenderer calls in electron/preload.js.
// Without these handlers, preload calls silently fail or hang.
const { ipcMain } = require('electron');

// show-notification: native system notification from renderer
ipcMain.on('show-notification', (_event, { title, body }) => {
  if (Notification.isSupported()) {
    new Notification({ title, body, icon: path.join(__dirname, '../assets/icon.png') }).show();
  }
});

// open-external: open URL in default browser (security: already validated in webPreferences)
ipcMain.on('open-external', (_event, url) => {
  try {
    const parsed = new URL(url);
    const allowed = ['https:', 'http:', 'mailto:'];
    if (allowed.includes(parsed.protocol)) shell.openExternal(url);
  } catch { /* invalid URL — silently ignore */ }
});

// get-version: return app version to renderer
ipcMain.handle('get-version', () => app.getVersion());

app.on('ready', () => {
  createWindow();
  buildMenu();

  // Respect system dark/light mode
  nativeTheme.themeSource = 'system';

  // ── Auto-updater ──────────────────────────────────────────────────────────
  // Checks GitHub releases for new versions on app start.
  // Requires 'publish' config in package.json build block.
  if (!isDev && process.platform !== 'linux') {
    try {
      const { autoUpdater } = require('electron-updater');
      autoUpdater.logger = null; // suppress noisy logging
      autoUpdater.checkForUpdatesAndNotify().catch(() => {}); // non-fatal
    } catch { /* electron-updater not installed — skip silently */ }
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});

// ── Deep link protocol handler ───────────────────────────────────────────────
// Registers justicegavel:// so links in emails/browsers open the desktop app.
// macOS: open-url event. Windows: passed as argv to second-instance.
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('justicegavel', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient('justicegavel');
}

// macOS: open-url fires when a justicegavel:// link is clicked
app.on('open-url', (event, url) => {
  event.preventDefault();
  if (mainWindow) {
    mainWindow.focus();
    // Pass the deep link URL to the renderer for in-app navigation
    mainWindow.webContents.executeJavaScript(
      `window.__handleDeepLink && window.__handleDeepLink(${JSON.stringify(url)})`
    );
  }
});
