export interface CameraSdkSession {
  start(): Promise<void> | void;
  stop(): Promise<void> | void;
  destroy?(): void;
}

export interface StartRehearsalOptions {
  sdk: CameraSdkSession;
  /** Must originate from a separate, explicit microphone opt-in control. */
  microphoneConsent?: boolean;
  /** Optional callback for displaying microphone permission failures. */
  onMicrophoneError?: (error: Error) => void;
}

export interface ActiveRehearsal {
  /** Optional local-only stream; PitchPilot does not record or transmit it. */
  microphoneStream: MediaStream | null;
}

/**
 * Begin a user-authorized rehearsal. SmartSpectra owns the camera capture via
 * its renderer SDK; no MediaStream is copied through Electron IPC. Microphone
 * capture is optional and independent because the camera-based talking signal
 * does not require audio.
 */
export async function startRehearsalSession({
  sdk,
  microphoneConsent = false,
  onMicrophoneError,
}: StartRehearsalOptions): Promise<ActiveRehearsal> {
  let microphoneStream: MediaStream | null = null;
  if (!window.pitchPilot) throw new Error("PitchPilot desktop bridge is required.");
  await window.pitchPilot.beginSession({ microphone: microphoneConsent });

  try {
    await sdk.start();
    if (microphoneConsent) {
      try {
        microphoneStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: false,
        });
      } catch (value) {
        const error = value instanceof Error ? value : new Error("Microphone permission was not granted.");
        onMicrophoneError?.(error);
        // Microphone is optional. Leave the camera rehearsal running and
        // report that the optional mic feature is unavailable.
      }
    }
    return { microphoneStream };
  } catch (error) {
    try { await sdk.stop(); } catch { /* SDK may not have reached Running. */ }
    try { sdk.destroy?.(); } catch { /* best-effort native teardown. */ }
    if (window.pitchPilot) await window.pitchPilot.endSession();
    throw error;
  }
}

/** Stop capture tracks before revoking the main-process consent state. */
export async function stopRehearsalSession(
  sdk: CameraSdkSession,
  active: ActiveRehearsal | null,
): Promise<void> {
  try {
    await sdk.stop();
  } finally {
    active?.microphoneStream?.getTracks().forEach((track) => track.stop());
    try { sdk.destroy?.(); } finally { if (window.pitchPilot) await window.pitchPilot.endSession(); }
  }
}
