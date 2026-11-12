import { useEffect, useRef, useState } from "react";
import "./PitchPilotRehearsal.css";

export type RehearsalSignal = "waiting" | "speaking" | "pause" | "unavailable";
export type RehearsalPhase = "ready" | "starting" | "live" | "error";

export interface PitchPilotRehearsalProps {
  /** Prompt shown during the rehearsal. */
  prompt: string;
  /** Normalized state derived from SmartSpectra talking-detection events. */
  signal: RehearsalSignal;
  /** Optional camera stream emitted by the Electron/SDK adapter. */
  cameraStream?: MediaStream | null;
  /** SDK validation hint, e.g. lighting, framing, or motion guidance. */
  qualityHint?: string | null;
  /** Highest-confidence SDK facial-expression class; not a mood or pitch-quality score. */
  expression?: { label: string; confidence: number } | null;
  /** Derived from face landmarks for camera framing only; not body posture. */
  faceFraming?: string | null;
  /** Set for a recoverable/non-recoverable startup or SDK error. */
  errorMessage?: string | null;
  /** Explain actual application behavior; keep accurate to SDK configuration. */
  telemetryDisclosure?: string;
  isAudioRecording?: boolean;
  recording?: { objectUrl: string; durationSeconds: number; lowLevelPercent: number | null } | null;
  hasExportData?: boolean;
  exportNotice?: string | null;
  onOpenAnalytics?: () => void;
  /** Called only after the user checks the consent box and presses Start. */
  onStart: (recordAudio: boolean) => Promise<void> | void;
  /** Stop SDK processing and release the camera. */
  onStop: () => Promise<void> | void;
  onExport?: () => Promise<void> | void;
  onClearRecording?: () => void;
}

const signalCopy: Record<RehearsalSignal, { title: string; detail: string }> = {
  waiting: { title: "Getting a reading", detail: "Stay in frame while PitchPilot connects to the live signal." },
  speaking: { title: "You're speaking", detail: "Keep going. PitchPilot is detecting speech activity." },
  pause: { title: "A pause", detail: "A natural moment to breathe or move to your next point." },
  unavailable: { title: "Signal unavailable", detail: "Check your camera and framing, then try again." },
};

export function PitchPilotRehearsal({
  prompt,
  signal,
  cameraStream,
  qualityHint,
  expression,
  faceFraming,
  errorMessage,
  telemetryDisclosure = "No video or rehearsal signal history is saved by PitchPilot by default. SmartSpectra diagnostic telemetry follows the SDK setting disclosed by this app.",
  isAudioRecording = false,
  recording,
  hasExportData = false,
  exportNotice,
  onOpenAnalytics,
  onStart,
  onStop,
  onExport,
  onClearRecording,
}: PitchPilotRehearsalProps) {
  const [phase, setPhase] = useState<RehearsalPhase>("ready");
  const [consent, setConsent] = useState(false);
  const [recordAudio, setRecordAudio] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const startAt = useRef<number | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = cameraStream ?? null;
    if (cameraStream) void video.play().catch(() => {});
  }, [cameraStream]);

  useEffect(() => {
    if (phase !== "live") return;
    const timer = window.setInterval(() => {
      if (startAt.current !== null) setElapsed(Math.floor((Date.now() - startAt.current) / 1000));
    }, 250);
    return () => window.clearInterval(timer);
  }, [phase]);

  const start = async () => {
    if (!consent || phase === "starting" || phase === "live") return;
    setLocalError(null);
    setPhase("starting");
    try {
      await onStart(recordAudio);
      startAt.current = Date.now();
      setElapsed(0);
      setPhase("live");
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Camera could not be started. Check permissions and try again.");
      setPhase("error");
    }
  };

  const stop = async () => {
    try {
      await onStop();
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "The session did not shut down cleanly.");
    } finally {
      startAt.current = null;
      setPhase("ready");
      setConsent(false);
      setRecordAudio(false);
    }
  };

  const liveSignal = signalCopy[signal];
  const totalSeconds = elapsed;
  const timeLabel = `${String(Math.floor(totalSeconds / 60)).padStart(2, "0")}:${String(totalSeconds % 60).padStart(2, "0")}`;
  const visibleError = localError ?? errorMessage;

  return (
    <main className="pp-shell" aria-label="PitchPilot rehearsal">
      <header className="pp-header">
        <div className="pp-brand"><span className="pp-brand-mark" aria-hidden="true">P</span><span>PitchPilot</span></div>
        <div className="pp-header-actions">
          {onOpenAnalytics && <button className="pp-nav-button" type="button" disabled={phase !== "ready"} onClick={onOpenAnalytics}>Analytics</button>}
          <span className={`pp-camera-state ${phase === "live" ? "is-live" : ""}`}>
            <span className="pp-dot" aria-hidden="true" />
            {phase === "live" ? "Camera on" : phase === "starting" ? "Starting camera…" : "Camera off"}
          </span>
        </div>
      </header>

      <section className="pp-main">
        <div className="pp-title-row">
          <div>
            <p className="pp-eyebrow">REHEARSAL STUDIO</p>
            <h1>{phase === "live" ? "Your rehearsal" : "Practice your pitch"}</h1>
            <p className="pp-subtitle">A private practice space with live, camera-based speech activity feedback.</p>
          </div>
          {phase === "live" && <div className="pp-timer" aria-label={`Elapsed time ${timeLabel}`}><span>TIME</span><strong>{timeLabel}</strong></div>}
        </div>

        {phase !== "live" ? (
          <section className="pp-consent-card" aria-labelledby="pp-consent-title">
            <div className="pp-icon" aria-hidden="true">◎</div>
            <p className="pp-eyebrow">BEFORE YOU BEGIN</p>
            <h2 id="pp-consent-title">Your camera stays off until you start.</h2>
            <p className="pp-body">When you start, SmartSpectra processes camera frames for speech activity, facial-expression classification, and face framing. Body posture is not analyzed. Microphone recording is off unless you separately opt in below.</p>
            <ul className="pp-privacy-list">
              <li><span aria-hidden="true">✓</span> Camera frames are processed live, not saved</li>
              <li><span aria-hidden="true">✓</span> Performance and expression logs stay in memory for this app session</li>
              <li><span aria-hidden="true">✓</span> CSV is saved only on request and contains no raw audio/video</li>
              <li><span aria-hidden="true">✓</span> End rehearsal to stop the camera and microphone</li>
            </ul>
            <label className="pp-consent-check">
              <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} disabled={phase === "starting"} />
              <span>I understand and agree to turn on my camera for this rehearsal.</span>
            </label>
            <label className="pp-audio-consent">
              <input type="checkbox" checked={recordAudio} onChange={(event) => setRecordAudio(event.target.checked)} disabled={phase === "starting"} />
              <span><strong>Also record my microphone locally</strong><small>Optional. Kept in memory for playback and a basic quiet-level summary. Not uploaded or written to disk. You can discard it after the session.</small></span>
            </label>
            {telemetryDisclosure && <details className="pp-details"><summary>SDK telemetry and data details</summary><p>{telemetryDisclosure}</p></details>}
            {visibleError && <p className="pp-error" role="alert">{visibleError}</p>}
            <button className="pp-button pp-button-primary" type="button" onClick={start} disabled={!consent || phase === "starting"}>
              {phase === "starting" ? "Starting…" : phase === "error" ? "Try again" : "Start rehearsal"}
              {phase !== "starting" && <span aria-hidden="true">→</span>}
            </button>
            <p className="pp-footnote">Camera permission may be requested by your operating system{recordAudio ? ", as may microphone permission." : ". Microphone permission is not requested unless you opt in above."}</p>
            {recording && <section className="pp-recording-card" aria-label="Local audio recording playback">
              <div className="pp-recording-heading"><div><p className="pp-eyebrow">LOCAL PLAYBACK</p><h3>Your rehearsal audio</h3></div><button className="pp-text-button" type="button" onClick={onClearRecording}>Discard audio</button></div>
              <audio controls preload="metadata" src={recording.objectUrl} />
              <p className="pp-recording-analysis">{Math.round(recording.durationSeconds)} sec · {recording.lowLevelPercent === null ? "Audio level analysis unavailable" : `${recording.lowLevelPercent}% low-level audio`}</p>
              <small>Level summary only—not transcription, speech recognition, or a speaking-quality score.</small>
            </section>}
            <div className="pp-export-actions">
              <button className="pp-button pp-button-export" type="button" disabled={!hasExportData} onClick={() => void onExport?.()}>Export performance CSV</button>
              {exportNotice && <p className="pp-export-notice" role="status">{exportNotice}</p>}
            </div>
          </section>
        ) : (
          <div className="pp-session-grid">
            <section className="pp-preview-card" aria-label="Camera preview">
              <div className="pp-preview-top"><span className="pp-live-tag"><span className="pp-dot" aria-hidden="true" /> LIVE</span><span className="pp-muted">{isAudioRecording ? "MIC RECORDING · local" : "Preview stays on this device"}</span></div>
              {cameraStream ? <video ref={videoRef} className="pp-video" autoPlay muted playsInline aria-label="Your live camera preview" /> : <div className="pp-camera-placeholder"><span aria-hidden="true">◉</span><p>Waiting for camera preview…</p></div>}
              {qualityHint && <p className="pp-quality" role="status"><span aria-hidden="true">ⓘ</span>{qualityHint}</p>}
            </section>
            <section className={`pp-signal-card signal-${signal}`} aria-live="polite" aria-atomic="true">
              <p className="pp-eyebrow">LIVE SPEECH ACTIVITY</p>
              <div className="pp-signal-orb" aria-hidden="true"><span /></div>
              <h2>{liveSignal.title}</h2>
              <p className="pp-body">{liveSignal.detail}</p>
              <div className="pp-signal-note">This reflects speech activity only—not confidence, emotion, or speaking quality.</div>
              <div className="pp-face-readouts" aria-label="Additional face signals">
                <div><span>SDK expression label</span><strong>{expression ? `${expression.label} · ${Math.round(expression.confidence)}%` : "Waiting for stable sample"}</strong></div>
                <div><span>Face framing</span><strong>{faceFraming ?? "Waiting for face landmarks"}</strong></div>
              </div>
              <p className="pp-signal-note pp-readout-disclaimer">Expression output is a model classification, not a mood inference. Face framing is not body-posture analysis.</p>
              {visibleError && <p className="pp-error" role="alert">{visibleError}</p>}
              <button className="pp-button pp-button-stop" type="button" onClick={stop}>End rehearsal <span aria-hidden="true">■</span></button>
            </section>
            <section className="pp-prompt-card"><p className="pp-eyebrow">YOUR PROMPT</p><p className="pp-prompt">{prompt}</p></section>
          </div>
        )}
      </section>
      <footer className="pp-footer"><span>PitchPilot is a rehearsal aid, not a medical or performance assessment.</span><span>No video, audio, or logs are saved to disk automatically.</span></footer>
    </main>
  );
}
