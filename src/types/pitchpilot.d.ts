export {};

export interface PerformanceLogRow {
  timestamp: string;
  elapsedSeconds: number;
  event: string;
  speechActivity: string;
  expressionLabel: string;
  expressionConfidencePercent: number | null;
  faceFraming: string;
  audioDurationSeconds: number | null;
  audioLowLevelPercent: number | null;
}

declare global {
  interface Window {
    /** Narrow app bridge from electron/preload.cjs; never expose ipcRenderer itself. */
    pitchPilot: {
      beginSession(options?: { microphone?: boolean }): Promise<{
        ok: true;
        camera: true;
        microphone: boolean;
      }>;
      endSession(): Promise<{ ok: true }>;
      exportCsv(rows: PerformanceLogRow[]): Promise<{ saved: boolean; fileName?: string }>;
    };
  }
}
