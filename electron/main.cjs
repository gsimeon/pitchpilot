'use strict';

const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const { fileURLToPath } = require('node:url');
const { app, BrowserWindow, dialog, ipcMain, session } = require('electron');

// Ensure SMARTSPECTRA_CAPI_PATH is set before requiring the SDK in packaged builds.
// When packaged into ASAR, native dlopen/LoadLibrary calls cannot load shared libraries
// directly from inside app.asar. They must be loaded from app.asar.unpacked.
const LIB_BASENAME = {
  darwin: 'libsmartspectra_capi.dylib',
  linux:  'libsmartspectra_capi.so',
  win32:  'smartspectra_capi.dll',
};

function setupSmartSpectraCapiPath() {
  if (process.env.SMARTSPECTRA_CAPI_PATH) return;

  const libName = LIB_BASENAME[process.platform];
  if (!libName) return;

  const platformPkg = `@smartspectra/node-sdk-${process.platform}-${process.arch}`;
  const candidates = [];

  if (process.resourcesPath) {
    candidates.push(
      path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', platformPkg, libName),
      path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', '@smartspectra', `node-sdk-${process.platform}-${process.arch}`, libName)
    );
  }

  try {
    const appPath = typeof app.getAppPath === 'function' ? app.getAppPath() : '';
    if (appPath && appPath.includes('.asar')) {
      const unpackedApp = appPath.replace(/\.asar$/, '.asar.unpacked');
      candidates.push(
        path.join(unpackedApp, 'node_modules', platformPkg, libName),
        path.join(unpackedApp, 'node_modules', '@smartspectra', `node-sdk-${process.platform}-${process.arch}`, libName),
        path.join(path.dirname(unpackedApp), 'app.asar.unpacked', 'node_modules', platformPkg, libName),
        path.join(path.dirname(unpackedApp), 'app.asar.unpacked', 'node_modules', '@smartspectra', `node-sdk-${process.platform}-${process.arch}`, libName)
      );
    }
  } catch {}

  for (const candidate of candidates) {
    if (fsSync.existsSync(candidate)) {
      process.env.SMARTSPECTRA_CAPI_PATH = candidate;
      break;
    }
  }
}

setupSmartSpectraCapiPath();

const { bindSmartSpectraIpc } = require('@smartspectra/node-sdk/main');
const { buildPerformanceCsv } = require('./csvExport.cjs');

const isDev = !app.isPackaged;
const rendererFile = path.resolve(__dirname, '../dist/index.html');
const activeConsents = new Map();
let mainWindow = null;

function isTrustedWindow(webContents) {
  return Boolean(mainWindow && webContents === mainWindow.webContents && !webContents.isDestroyed());
}

function isTrustedLocalPage(requestingUrl, webContents) {
  if (!isTrustedWindow(webContents)) return false;
  try {
    const url = new URL(requestingUrl || webContents.getURL());
    if (isDev) {
      return url.protocol === 'http:' && url.hostname === 'localhost' && url.port === '5173';
    }
    return url.protocol === 'file:' && path.resolve(fileURLToPath(url)).toLowerCase() === rendererFile.toLowerCase();
  } catch {
    return false;
  }
}

function installPermissionPolicy() {
  const appSession = session.defaultSession;

  // Electron's `media` permission groups camera and microphone. Only honor a
  // request after the app UI has explicitly begun a session; microphone use
  // requires a separate opt-in flag. No permissions are granted to popups or
  // pages other than PitchPilot's trusted local renderer.
  appSession.setPermissionRequestHandler((webContents, permission, callback, details = {}) => {
    if (permission !== 'media' || !isTrustedLocalPage(details.requestingUrl, webContents)) {
      callback(false);
      return;
    }

    const consent = activeConsents.get(webContents.id);
    const requested = Array.isArray(details.mediaTypes) ? details.mediaTypes : [];
    const asksForVideo = requested.includes('video');
    const asksForAudio = requested.includes('audio');
    const onlyKnownMedia = requested.length > 0 && requested.every((type) => type === 'video' || type === 'audio');

    callback(Boolean(
      onlyKnownMedia &&
      (asksForVideo || asksForAudio) &&
      (!asksForVideo || consent?.camera === true) &&
      (!asksForAudio || consent.microphone === true)
    ));
  });

}

function installSessionIpc() {
  ipcMain.handle('pitchpilot:session:begin', (event, options = {}) => {
    if (!isTrustedWindow(event.sender) || !isTrustedLocalPage(event.senderFrame?.url, event.sender)) {
      throw new Error('Untrusted renderer cannot start a rehearsal.');
    }
    if (event.senderFrame && event.senderFrame !== event.sender.mainFrame) {
      throw new Error('Only the main application frame can start a rehearsal.');
    }

    // Camera consent is always required. Audio is optional and separate; the
    // SmartSpectra speech-activity feature does not require microphone input.
    const microphone = options.microphone === true;
    activeConsents.set(event.sender.id, { camera: true, microphone });
    return { ok: true, camera: true, microphone };
  });

  ipcMain.handle('pitchpilot:session:end', (event) => {
    if (!isTrustedWindow(event.sender)) throw new Error('Untrusted renderer cannot end a rehearsal.');
    activeConsents.delete(event.sender.id);
    return { ok: true };
  });

  ipcMain.handle('pitchpilot:export-csv', async (event, rows) => {
    if (!isTrustedWindow(event.sender) || !isTrustedLocalPage(event.senderFrame?.url, event.sender)) {
      throw new Error('Untrusted renderer cannot export rehearsal data.');
    }
    if (event.senderFrame && event.senderFrame !== event.sender.mainFrame) {
      throw new Error('Only the main application frame can export rehearsal data.');
    }
    const csv = buildPerformanceCsv(rows);
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export PitchPilot rehearsal logs',
      defaultPath: 'pitchpilot-rehearsal.csv',
      filters: [{ name: 'CSV file', extensions: ['csv'] }],
    });
    if (result.canceled || !result.filePath) return { saved: false };
    await fs.writeFile(result.filePath, csv, { encoding: 'utf8', flag: 'w' });
    return { saved: true, fileName: path.basename(result.filePath) };
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1160,
    height: 820,
    minWidth: 360,
    minHeight: 560,
    backgroundColor: '#f4f7f3',
    webPreferences: {
      preload: path.resolve(__dirname, '../dist/preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  // Presage's supported Electron bridge owns the private SDK IPC channel.
  // The app preload exposes only its own two consent/session operations.
  bindSmartSpectraIpc(mainWindow);

  const webContentsId = mainWindow.webContents.id;

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (!isTrustedLocalPage(targetUrl, mainWindow.webContents)) event.preventDefault();
  });
  mainWindow.webContents.on('will-redirect', (event, targetUrl) => {
    if (!isTrustedLocalPage(targetUrl, mainWindow.webContents)) event.preventDefault();
  });
  mainWindow.webContents.on('render-process-gone', () => {
    activeConsents.delete(webContentsId);
  });
  mainWindow.on('closed', () => {
    activeConsents.delete(webContentsId);
    mainWindow = null;
  });

  if (isDev) mainWindow.loadURL('http://localhost:5173');
  else mainWindow.loadFile(rendererFile);
}

function ensureSmartSpectraPreconfigured() {
  try {
    const ffiPath = path.join(path.dirname(require.resolve('@smartspectra/node-sdk')), 'ffi.js');
    const { preconfigure } = require(ffiPath);
    const sdkDirectory = path.join(app.getPath('cache'), app.getName(), 'SmartSpectraSDK');
    fsSync.mkdirSync(sdkDirectory, { recursive: true, mode: 0o700 });
    const deviceId = crypto.createHash('sha256').update(os.hostname() || 'pitchpilot-client').digest('hex').slice(0, 32);
    preconfigure(sdkDirectory, deviceId);
  } catch (err) {
    console.warn('[PitchPilot] SmartSpectra preconfigure warning:', err.message || err);
  }
}

app.whenReady().then(() => {
  ensureSmartSpectraPreconfigured();
  installPermissionPolicy();
  installSessionIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  activeConsents.clear();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => activeConsents.clear());
