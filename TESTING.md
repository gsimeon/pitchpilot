# PitchPilot test suite

## Unit tests — Jest

Run `npm run test:unit`. The command first runs `tsc -p tsconfig.test.json`, then Jest in-band.

- `src/analytics/csvAnalytics.test.ts` checks exported-CSV schema validation, invalid-row handling, session aggregation, expression-label totals, speech/pause sample balance, and optional audio summaries.
- `tests/csvExport.test.cjs` checks the main-process serializer's fixed columns, BOM and quoting, formula-injection prefixing, invalid/empty/oversized row limits, and 4 MB output cap.
- `src/components/PitchPilotRehearsal.test.tsx` verifies camera-consent gating, microphone opt-in defaults and propagation, analytics navigation, and CSV-export availability.

## Electron integration — Playwright

Run `npm run test:e2e` when a desktop display is available. On headless Linux, run `npm run test:e2e:headless` (requires `xvfb-run`). Playwright starts a local Vite server, builds the sandboxed preload bundle, launches the real Electron app, and tears it down after each test.

- Confirms the initial renderer state keeps the camera off and microphone recording unchecked.
- Imports a fixture PitchPilot CSV through the React file picker and checks session history, expression samples, and chart rendering.
- Calls the exposed preload CSV API with an invalid empty payload and asserts the real Electron main process rejects it before showing a native dialog.

Run `npm run test:all` for both layers. No SmartSpectra API key or camera/microphone access is needed for the automated suite.

## Desktop acceptance checks

The suite intentionally does not automate OS-native camera/microphone permission prompts or accept a native Save dialog. Before shipping, manually verify: (1) a user can save a valid CSV to a chosen location and reopen it in the dashboard, (2) canceling the dialog leaves no file, (3) camera/microphone permission denial cleans up tracks, and (4) permission requests do not occur before their separate consent controls are selected. Those flows depend on the host OS, devices, and native dialogs.
