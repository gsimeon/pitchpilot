import { test, expect } from "@playwright/test";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";

let app: ElectronApplication;
let page: Page;

const headers = [
  "timestamp", "elapsedSeconds", "event", "speechActivity", "expressionLabel",
  "expressionConfidencePercent", "faceFraming", "audioDurationSeconds", "audioLowLevelPercent",
];

function csvLine(values: Array<string | number>) {
  return values.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",");
}

function fixtureCsv() {
  const rows: Array<Array<string | number>> = [
    ["2026-11-12T10:00:00.000Z", 0, "session_started", "", "", "", "", "", ""],
    ["2026-11-12T10:00:08.000Z", 8, "face_metrics", "speaking", "Happy", 86, "Face centered in frame", "", ""],
    ["2026-11-12T10:00:18.000Z", 18, "face_metrics", "pause", "Neutral", 78, "Face centered in frame", "", ""],
    ["2026-11-12T10:00:20.000Z", 20, "local_audio_analysis", "", "", "", "", 20, 12],
    ["2026-11-12T10:00:21.000Z", 21, "session_ended", "", "", "", "", "", ""],
  ];
  return [csvLine(headers), ...rows.map(csvLine)].join("\r\n");
}

test.beforeEach(async () => {
  app = await electron.launch({
    args: ["--no-sandbox", "."],
    cwd: process.cwd(),
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "true" },
  });
  page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
});

test.afterEach(async () => {
  if (!app) return;
  const child = app.process();
  const gracefulClose = app.close().catch(() => undefined);
  await Promise.race([gracefulClose, new Promise((resolve) => setTimeout(resolve, 5_000))]);
  if (child.exitCode === null) child.kill("SIGKILL");
});

test("starts with camera off and microphone recording opt-in unchecked", async () => {
  await expect(page.getByRole("heading", { name: "Practice your pitch" })).toBeVisible();
  await expect(page.getByText("Camera off")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /also record my microphone locally/i })).not.toBeChecked();
  await expect(page.getByRole("button", { name: /start rehearsal/i })).toBeDisabled();
});

test("imports exported CSV data and renders historical expression analytics", async () => {
  await page.getByRole("button", { name: "Analytics" }).click();
  await expect(page.getByRole("heading", { name: "No rehearsal history yet" })).toBeVisible();
  await page.getByLabel("Import PitchPilot CSV files").setInputFiles({
    name: "sample-session.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(fixtureCsv()),
  });
  await expect(page.getByRole("heading", { name: "Observed classifications" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "sample-session.csv" })).toBeVisible();
  await expect(page.getByText("1 CSV file processed locally.")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Happy" })).toBeVisible();
  await expect(page.getByText("Neutral", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("img", { name: /line chart of expression classification shares/i })).toBeVisible();
});

test("routes export IPC through the Electron main process and rejects an empty payload", async () => {
  const errorMessage = await page.evaluate(async () => {
    const bridge = (window as unknown as { pitchPilot: { exportCsv: (rows: unknown[]) => Promise<unknown> } }).pitchPilot;
    try {
      await bridge.exportCsv([]);
      return "unexpected-success";
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  });
  expect(errorMessage).toContain("between 1 and 10,000 log rows");
});
