import { getExpressionTotals, parsePerformanceCsv, summarizeSessions } from "./csvAnalytics";

const headers = [
  "timestamp", "elapsedSeconds", "event", "speechActivity", "expressionLabel",
  "expressionConfidencePercent", "faceFraming", "audioDurationSeconds", "audioLowLevelPercent",
];

function exportCsv(rows: Array<Record<string, string | number | undefined>>) {
  return [headers, ...rows.map((row) => headers.map((header) => {
    const value = String(row[header] ?? "");
    return `"${value.replace(/"/g, '""')}"`;
  }))].map((row) => row.join(",")).join("\r\n");
}

const sampleRows = [
  { timestamp: "2026-11-12T10:00:00.000Z", elapsedSeconds: 0, event: "session_started" },
  { timestamp: "2026-11-12T10:00:08.000Z", elapsedSeconds: 8, event: "face_metrics", speechActivity: "speaking", expressionLabel: "Happy", expressionConfidencePercent: 86.4 },
  { timestamp: "2026-11-12T10:00:18.000Z", elapsedSeconds: 18, event: "face_metrics", speechActivity: "pause", expressionLabel: "Neutral", expressionConfidencePercent: 79 },
  { timestamp: "2026-11-12T10:00:20.000Z", elapsedSeconds: 20, event: "local_audio_analysis", audioDurationSeconds: 20, audioLowLevelPercent: 12 },
  { timestamp: "2026-11-12T10:00:21.000Z", elapsedSeconds: 21, event: "session_ended" },
];

describe("local PitchPilot CSV analytics", () => {
  test("parses the exported schema and skips invalid data rows", () => {
    const csv = `\uFEFF${exportCsv([
      ...sampleRows,
      { timestamp: "not-a-date", elapsedSeconds: 22, event: "invalid" },
    ])}`;
    const rows = parsePerformanceCsv(csv, "practice.csv", "file-1");
    expect(rows).toHaveLength(sampleRows.length);
    expect(rows[1]).toMatchObject({ expressionLabel: "Happy", sourceFile: "practice.csv", sourceId: "file-1" });
  });

  test("rejects files that do not use the PitchPilot export schema", () => {
    expect(() => parsePerformanceCsv("date,score\n2026-11-12,4", "other.csv")).toThrow("does not look like a PitchPilot export");
  });

  test("summarizes imported rehearsal, speech, expression, and audio metrics", () => {
    const rows = parsePerformanceCsv(exportCsv(sampleRows), "practice.csv", "session-1");
    const [summary] = summarizeSessions(rows);
    expect(summary).toMatchObject({
      sourceFile: "practice.csv",
      durationSeconds: 21,
      logRows: 5,
      expressionSamples: 2,
      speakingPercent: 50,
      audioDurationSeconds: 20,
      audioLowLevelPercent: 12,
    });
    expect(summary.averageExpressionConfidence).toBeCloseTo(82.7);
    expect(summary.expressionCounts).toEqual({ Happy: 1, Neutral: 1 });
    expect(getExpressionTotals([summary])).toEqual([
      { label: "Happy", count: 1 },
      { label: "Neutral", count: 1 },
    ]);
  });

  test("keeps separate CSV files as distinct historical sessions", () => {
    const first = parsePerformanceCsv(exportCsv(sampleRows), "one.csv", "one");
    const second = parsePerformanceCsv(exportCsv(sampleRows), "two.csv", "two");
    expect(summarizeSessions([...first, ...second])).toHaveLength(2);
  });
});
