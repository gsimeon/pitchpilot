'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Install Presage's supported renderer-to-main SDK bridge first. This is a
// private bridge exposed by the SDK package, not raw ipcRenderer.
require('@smartspectra/node-sdk/preload');

const pitchPilotApi = Object.freeze({
  /**
   * Call only from the explicit camera-consent action, before sdk.start().
   * microphone=true is a separate opt-in and is not needed for SmartSpectra's
   * camera-based talking detection.
   */
  beginSession: (options = {}) => ipcRenderer.invoke('pitchpilot:session:begin', {
    microphone: options.microphone === true,
  }),
  /** Revoke media permission for this rehearsal; stop media tracks in renderer too. */
  endSession: () => ipcRenderer.invoke('pitchpilot:session:end'),
  /** Ask the main process to show a native Save dialog and write validated CSV rows. */
  exportCsv: (rows) => ipcRenderer.invoke('pitchpilot:export-csv', rows),
});

contextBridge.exposeInMainWorld('pitchPilot', pitchPilotApi);
