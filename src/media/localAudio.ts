export interface AudioPlaybackAnalysis {
  durationSeconds: number;
  lowLevelPercent: number | null;
}

export interface LocalAudioRecording {
  objectUrl: string;
  analysis: AudioPlaybackAnalysis;
}

export interface LocalAudioRecorder {
  stopAndAnalyze(): Promise<LocalAudioRecording>;
  discard(): void;
}

async function analyzeLocally(blob: Blob): Promise<AudioPlaybackAnalysis> {
  const context = new AudioContext();
  try {
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    const windowFrames = Math.max(1, Math.floor(buffer.sampleRate * 0.1));
    let peakRms = 0;
    const rmsWindows: number[] = [];
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));

    for (let start = 0; start < buffer.length; start += windowFrames) {
      const end = Math.min(buffer.length, start + windowFrames);
      let sumSquares = 0;
      let samples = 0;
      for (const channel of channels) {
        for (let index = start; index < end; index += 1) {
          const sample = channel[index];
          sumSquares += sample * sample;
          samples += 1;
        }
      }
      const rms = samples > 0 ? Math.sqrt(sumSquares / samples) : 0;
      rmsWindows.push(rms);
      peakRms = Math.max(peakRms, rms);
    }

    // This is a relative amplitude summary for reviewing a recording, not a
    // speech detector. It does not transcribe speech or judge delivery.
    const threshold = Math.max(0.008, peakRms * 0.06);
    const lowLevelPercent = rmsWindows.length
      ? Math.round((rmsWindows.filter((rms) => rms < threshold).length / rmsWindows.length) * 100)
      : null;

    return { durationSeconds: buffer.duration, lowLevelPercent };
  } finally {
    await context.close();
  }
}

/** Acquire microphone only after the caller has separately obtained consent. */
export async function startLocalAudioRecorder(): Promise<LocalAudioRecorder> {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    throw new Error("This Electron runtime does not support local microphone recording.");
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: false,
  });

  const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"]
    .find((candidate) => MediaRecorder.isTypeSupported(candidate));
  let recorder: MediaRecorder;
  try {
    recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    const chunks: BlobPart[] = [];
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    });
    recorder.start(500);

    let stopped = false;
    let recordingUrl: string | null = null;
    return {
      async stopAndAnalyze() {
        if (stopped) throw new Error("This audio recording has already been stopped.");
        stopped = true;
        if (recorder.state !== "inactive") {
          const stopEvent = new Promise<void>((resolve, reject) => {
            recorder.addEventListener("stop", () => resolve(), { once: true });
            recorder.addEventListener("error", () => reject(new Error("The local audio recording could not be finalized.")), { once: true });
          });
          recorder.stop();
          await stopEvent;
        }
        stream.getTracks().forEach((track) => track.stop());

        const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" });
        if (blob.size === 0) throw new Error("The recording was empty. Check microphone permission and try again.");
        const analysis = await analyzeLocally(blob);
        recordingUrl = URL.createObjectURL(blob);
        return { objectUrl: recordingUrl, analysis };
      },
      discard() {
        if (recorder.state !== "inactive") recorder.stop();
        stream.getTracks().forEach((track) => track.stop());
        if (recordingUrl) URL.revokeObjectURL(recordingUrl);
      },
    };
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    throw error;
  }
}
