import { useEffect, useRef, useState } from "react";
import { SmartSpectraSDK, faceMetrics } from "@smartspectra/node-sdk/renderer";
import { decodeMetrics } from "@smartspectra/node-sdk/messages";
import { PitchPilotRehearsal, type RehearsalSignal } from "./components/PitchPilotRehearsal";
import { startLocalAudioRecorder, type LocalAudioRecorder } from "./media/localAudio";
import type { PerformanceLogRow } from "./types/pitchpilot";
import LocalAnalyticsDashboard from "./analytics/LocalAnalyticsDashboard";

const expressionNames: Record<number, string> = {
  1: "Angry", 2: "Contempt", 3: "Disgust", 4: "Fear",
  5: "Happy", 6: "Neutral", 7: "Sad", 8: "Surprise",
};

function getFaceFraming(
  points: Array<{ x?: number | null; y?: number | null }>,
  frameWidth: number,
  frameHeight: number,
): string | null {
  const usable = points.flatMap((point) =>
    typeof point.x === "number" && Number.isFinite(point.x) &&
    typeof point.y === "number" && Number.isFinite(point.y)
      ? [{ x: point.x, y: point.y }]
      : [],
  );
  if (usable.length < 10) return null;

  // Face landmarks are used for a composition cue only. No body-pose or
  // posture estimate is derived from the face-only coordinates.
  const maxX = Math.max(...usable.map((point) => point.x));
  const maxY = Math.max(...usable.map((point) => point.y));
  const xScale = maxX <= 1.5 ? 1 : Math.max(frameWidth, 1);
  const yScale = maxY <= 1.5 ? 1 : Math.max(frameHeight, 1);
  const xs = usable.map((point) => point.x / xScale);
  const ys = usable.map((point) => point.y / yScale);
  const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
  const faceWidth = Math.max(...xs) - Math.min(...xs);

  if (centerX < 0.34 || centerX > 0.66) return "Move slightly toward the center";
  if (centerY < 0.20 || centerY > 0.80) return "Adjust the camera height";
  if (faceWidth > 0.62) return "Move the camera a little farther away";
  return "Face centered in frame";
}

export default function App() {
  const [view, setView] = useState<"rehearsal" | "analytics">("rehearsal");
  const sdkRef = useRef<SmartSpectraSDK | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRecorderRef = useRef<LocalAudioRecorder | null>(null);
  const sessionStartRef = useRef<number | null>(null);
  const logRowsRef = useRef<PerformanceLogRow[]>([]);
  const signalWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [signal, setSignal] = useState<RehearsalSignal>("waiting");
  const [expression, setExpression] = useState<{ label: string; confidence: number } | null>(null);
  const [faceFraming, setFaceFraming] = useState<string | null>(null);
  const [qualityHint, setQualityHint] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isAudioRecording, setIsAudioRecording] = useState(false);
  const [recording, setRecording] = useState<{ objectUrl: string; durationSeconds: number; lowLevelPercent: number | null } | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const apiKey = import.meta.env.VITE_PRESAGE_API_KEY?.trim();

  useEffect(() => () => {
    if (recording?.objectUrl) URL.revokeObjectURL(recording.objectUrl);
    if (signalWatchdogRef.current) clearTimeout(signalWatchdogRef.current);
  }, [recording?.objectUrl]);

  const appendLog = (event: string, values: Partial<PerformanceLogRow> = {}) => {
    const now = Date.now();
    const startedAt = sessionStartRef.current;
    if (logRowsRef.current.length >= 10000) return;
    logRowsRef.current.push({
      timestamp: new Date(now).toISOString(),
      elapsedSeconds: startedAt === null ? 0 : Math.round((now - startedAt) / 1000),
      event,
      speechActivity: "",
      expressionLabel: "",
      expressionConfidencePercent: null,
      faceFraming: "",
      audioDurationSeconds: null,
      audioLowLevelPercent: null,
      ...values,
    });
  };

  const start = async (recordAudio: boolean) => {
    if (typeof window === "undefined" || !window.pitchPilot || !window.__smartspectraBridge) {
      throw new Error(
        "Live AI rehearsal requires the PitchPilot desktop app to run native camera models. " +
        "Download the Windows executable from GitHub releases, or switch to the Analytics dashboard to inspect rehearsal logs."
      );
    }
    if (!apiKey) throw new Error("Add your SmartSpectra API key to .env.local as VITE_PRESAGE_API_KEY, then restart the app.");
    setSignal("waiting");
    setExpression(null);
    setFaceFraming(null);
    setQualityHint(null);
    setErrorMessage(null);
    setExportNotice(null);
    if (recording?.objectUrl) URL.revokeObjectURL(recording.objectUrl);
    setRecording(null);
    logRowsRef.current = [];
    sessionStartRef.current = Date.now();
    appendLog("session_started", { event: recordAudio ? "session_started_with_audio_opt_in" : "session_started" });

    const sdk = new SmartSpectraSDK({
      apiKey,
      requestedMetrics: [...faceMetrics],
      enableTelemetry: false,
    });
    sdkRef.current = sdk;

    sdk.on("streamAvailable", (stream) => {
      if (sdkRef.current !== sdk) return;
      streamRef.current = stream;
      setCameraStream(stream);
    });

    sdk.on("validationStatus", (code, _timestampUs, hint) => {
      if (sdkRef.current !== sdk) return;
      setQualityHint(hint || null);
      // When tracking is invalid or face is lost, clear live cues immediately
      if (code !== 0) {
        setSignal("waiting");
        setExpression(null);
        setFaceFraming(null);
      }
    });

    sdk.on("metrics", (buffer) => {
      if (sdkRef.current !== sdk) return;
      try {
        const metrics = decodeMetrics(buffer);
        const face = metrics.face;

        // Reset the watchdog timer: if samples stop arriving for > 1500ms, clear stale feedback
        if (signalWatchdogRef.current) clearTimeout(signalWatchdogRef.current);
        signalWatchdogRef.current = setTimeout(() => {
          if (sdkRef.current === sdk) {
            setSignal("waiting");
            setExpression(null);
            setFaceFraming(null);
          }
        }, 1500);

        const latestTalking = face?.talking?.at(-1);
        const isTalkingStable = Boolean(latestTalking?.stable);
        const stableTalking = isTalkingStable ? (latestTalking!.detected ? "speaking" : "pause") : "";
        if (isTalkingStable) {
          setSignal(stableTalking as RehearsalSignal);
        } else {
          // Clear speaking state when samples become unstable
          setSignal("waiting");
        }

        const latestExpression = face?.expression?.at(-1);
        const scores = (latestExpression?.scores ?? []).flatMap((item) =>
          typeof item.type === "number" && typeof item.confidence === "number"
            ? [{ type: item.type, confidence: item.confidence }]
            : [],
        );
        const isExpressionStable = Boolean(latestExpression?.stable && scores.length > 0);
        const top = isExpressionStable
          ? scores.reduce((best, item) => item.confidence > best.confidence ? item : best)
          : null;
        const expressionLabel = top ? expressionNames[top.type] ?? "" : "";
        if (expressionLabel && top) {
          setExpression({ label: expressionLabel, confidence: top.confidence });
        } else {
          // Clear expression label when samples become unstable or confidence is lost
          setExpression(null);
        }

        const latestLandmarks = face?.landmarks?.at(-1);
        let framing = "";
        if (latestLandmarks?.stable && !latestLandmarks.reset && latestLandmarks.value?.length) {
          const settings = streamRef.current?.getVideoTracks()[0]?.getSettings();
          framing = getFaceFraming(latestLandmarks.value, settings?.width ?? 1280, settings?.height ?? 720) ?? "";
          setFaceFraming(framing || null);
        } else {
          // Clear face framing when landmarks become unstable or reset
          setFaceFraming(null);
        }

        if (stableTalking || expressionLabel) {
          appendLog("face_metrics", {
            speechActivity: stableTalking,
            expressionLabel,
            expressionConfidencePercent: expressionLabel && top ? Math.round(top.confidence * 10) / 10 : null,
            faceFraming: framing,
          });
        }
      } catch {
        setErrorMessage("PitchPilot couldn't read a SmartSpectra metrics update. End the session and try again.");
      }
    });

    sdk.on("error", (code, message) => {
      if (sdkRef.current !== sdk) return;
      setSignal("unavailable");
      setErrorMessage(`SmartSpectra error ${code}: ${message}`);
      appendLog("sdk_error", { speechActivity: `${code}: ${message}` });
    });

    try {
      await window.pitchPilot.beginSession({ microphone: recordAudio });
      await sdk.start();
      if (recordAudio) {
        audioRecorderRef.current = await startLocalAudioRecorder();
        setIsAudioRecording(true);
      }
    } catch (error) {
      if (signalWatchdogRef.current) {
        clearTimeout(signalWatchdogRef.current);
        signalWatchdogRef.current = null;
      }
      setSignal("waiting");
      setExpression(null);
      setFaceFraming(null);
      sdkRef.current = null;
      streamRef.current = null;
      setCameraStream(null);
      audioRecorderRef.current?.discard();
      audioRecorderRef.current = null;
      setIsAudioRecording(false);
      try { sdk.destroy(); } catch { /* SDK may already be stopping. */ }
      try { await window.pitchPilot.endSession(); } catch { /* Session may not have started. */ }
      appendLog("session_start_failed");
      sessionStartRef.current = null;
      throw error;
    }
  };

  const stop = async () => {
    if (signalWatchdogRef.current) {
      clearTimeout(signalWatchdogRef.current);
      signalWatchdogRef.current = null;
    }
    const sdk = sdkRef.current;
    sdkRef.current = null;
    streamRef.current = null;
    try {
      if (sdk) {
        try { await sdk.stop(); } finally { sdk.destroy(); }
      }
    } finally {
      const audioRecorder = audioRecorderRef.current;
      audioRecorderRef.current = null;
      if (audioRecorder) {
        try {
          const result = await audioRecorder.stopAndAnalyze();
          setRecording({
            objectUrl: result.objectUrl,
            durationSeconds: result.analysis.durationSeconds,
            lowLevelPercent: result.analysis.lowLevelPercent,
          });
          appendLog("local_audio_analysis", {
            audioDurationSeconds: Math.round(result.analysis.durationSeconds * 10) / 10,
            audioLowLevelPercent: result.analysis.lowLevelPercent,
          });
        } catch (error) {
          setErrorMessage(error instanceof Error ? error.message : "Local audio analysis failed.");
          audioRecorder.discard();
        }
      }
      appendLog("session_ended");
      sessionStartRef.current = null;
      setIsAudioRecording(false);
      setCameraStream(null);
      setSignal("waiting");
      setExpression(null);
      setFaceFraming(null);
      setQualityHint(null);
      if (window.pitchPilot) await window.pitchPilot.endSession();
    }
  };

  const exportCsv = async () => {
    try {
      if (!window.pitchPilot) {
        setExportNotice("Exporting via native save dialog is available in the desktop app.");
        return;
      }
      const result = await window.pitchPilot.exportCsv(logRowsRef.current);
      setExportNotice(result.saved ? `Saved ${result.fileName ?? "CSV file"}.` : "Export cancelled.");
    } catch (error) {
      setExportNotice(error instanceof Error ? error.message : "CSV export failed.");
    }
  };

  const clearRecording = () => {
    if (recording?.objectUrl) URL.revokeObjectURL(recording.objectUrl);
    setRecording(null);
  };

  if (view === "analytics") return <LocalAnalyticsDashboard onBack={() => setView("rehearsal")} />;

  return (
    <PitchPilotRehearsal
      prompt="Tell us what you are building, who it helps, and why it matters."
      signal={signal}
      cameraStream={cameraStream}
      expression={expression}
      faceFraming={faceFraming}
      qualityHint={qualityHint}
      errorMessage={errorMessage}
      isAudioRecording={isAudioRecording}
      recording={recording}
      hasExportData={logRowsRef.current.length > 0}
      exportNotice={exportNotice}
      telemetryDisclosure="SmartSpectra aggregate telemetry is disabled in this build. Local microphone audio is kept in renderer memory for playback and basic level analysis; it is not uploaded or saved to disk by PitchPilot. SDK service requests for authentication and operation may still occur."
      onStart={start}
      onStop={stop}
      onExport={exportCsv}
      onClearRecording={clearRecording}
      onOpenAnalytics={() => setView("analytics")}
    />
  );
}
