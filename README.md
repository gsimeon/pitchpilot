# PitchPilot

A consent-first Electron rehearsal prototype built with React, Vite, Tailwind CSS v4, and the Presage SmartSpectra Node.js SDK.

## Run locally

1. Use Node.js 20 or later.
2. Copy `.env.example` to `.env.local` and set `VITE_PRESAGE_API_KEY` to a SmartSpectra developer key.
3. Run `npm install` and then `npm start`.

`npm start` launches Vite at `http://localhost:5173` and opens Electron. The app asks for camera consent before `sdk.start()`; the operating system may also show a camera permission prompt.

The SDK and PitchPilot preload bridge are bundled to `dist/preload.cjs` before Electron launches. The renderer keeps `contextIsolation: true`, `sandbox: true`, and `nodeIntegration: false`.

The Vite-prefixed API key is available to renderer code and will be included in a client build. Use an SDK-specific development key, keep `.env.local` out of source control, and review Presage key restrictions before distributing a packaged app.

## SmartSpectra integration

The renderer requests the official `faceMetrics` bundle. It decodes the SDK's `metrics` events to display:

- Talking detection, presented as speaking / pause feedback.
- The highest-confidence stable facial-expression class and its model confidence.
- A simple face-centering / camera-framing cue derived from the face landmarks.

The SDK reports face landmarks and expressions, but does not provide a general body-posture measurement. PitchPilot therefore labels its derived cue **Face framing**, not posture analysis. Expression labels are shown as the SDK's classification only; PitchPilot does not treat them as measurements of mood, confidence, or pitch quality.

SmartSpectra SDK aggregate telemetry is disabled with `enableTelemetry: false`. SDK service requests for authentication and operation may still occur. Camera frames are not written to disk by PitchPilot. The camera is released through `stop()`/`destroy()` when the user ends the rehearsal.

## Optional local audio and CSV export

Microphone access is a separate unchecked opt-in. After consent, the renderer records through Chromium's `getUserMedia` and `MediaRecorder` APIs. The recording remains in memory for playback. After the session, Web Audio decodes it locally and computes a simple share of 100 ms windows below an amplitude threshold. This is a level summary only, not speech recognition, transcription, or a delivery score. Audio is not uploaded or saved to disk; the user can discard it, and it is cleared when the app session ends.

Performance and expression event rows are also held in memory for the app session. **Export performance CSV** invokes Electron's native Save dialog through a narrow preload API. The CSV includes timestamps, elapsed time, speech-activity state, expression label/confidence, face-framing cue, and optional audio duration/low-level percentage. It excludes raw audio, video, and landmark coordinates. The main process caps rows and file size, limits accepted columns, quotes values, and prefixes formula-like text cells.

## Local analytics dashboard

Choose **Analytics** from the rehearsal screen and import one or more previously exported PitchPilot CSV files. Each CSV is grouped as a rehearsal and parsed in the renderer. The dashboard shows total practice time, speaking/pause sample balance, expression-label distribution and per-session label-share trends, plus optional local audio summaries. Imported contents are kept in memory only; **Clear history** or closing the app removes them. The charts describe stable SDK classifications and do not interpret mood or posture.

## Project checks

- `npm run build` — strict TypeScript check, Vite production build, and sandboxed preload bundle.
- `node --check electron/main.cjs && node --check electron/preload.cjs` — Electron entrypoint syntax checks.
- `npm run test:unit` — Jest tests for CSV parsing/aggregation, the main-process CSV serializer, and React consent/export controls.
- `npm run test:e2e` — Playwright desktop integration tests (requires a display on Linux).
- `npm run test:e2e:headless` — Playwright Electron tests under Xvfb on Linux; starts a local Vite server automatically.
- `npm run test:all` — Jest unit tests followed by the headless Electron suite.

See [`TESTING.md`](./TESTING.md) for exact coverage and manual desktop acceptance checks.

Official references: [SmartSpectra Node.js/Electron guide](https://smartspectra.presagetech.com/docs/nodejs), [metrics guide](https://smartspectra.presagetech.com/docs/nodejs/metrics), [metric data types](https://smartspectra.presagetech.com/docs/data-types), and [Tailwind CSS Vite setup](https://tailwindcss.com/docs/installation/using-vite).
