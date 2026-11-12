import Papa from "papaparse";

export interface ImportedLogRow {
  timestamp: string;
  elapsedSeconds: number;
  event: string;
  speechActivity: string;
  expressionLabel: string;
  expressionConfidencePercent: number | null;
  faceFraming: string;
  audioDurationSeconds: number | null;
  audioLowLevelPercent: number | null;
  sourceId: string;
  sourceFile: string;
}

export interface SessionSummary {
  sourceId: string;
  sourceFile: string;
  startedAt: string;
  durationSeconds: number;
  logRows: number;
  expressionSamples: number;
  averageExpressionConfidence: number | null;
  speakingPercent: number | null;
  expressionCounts: Record<string, number>;
  audioDurationSeconds: number | null;
  audioLowLevelPercent: number | null;
}

const requiredColumns = [
  "timestamp", "elapsedSeconds", "event", "speechActivity",
  "expressionLabel", "expressionConfidencePercent", "faceFraming",
  "audioDurationSeconds", "audioLowLevelPercent",
];

function numericOrNull(value: unknown): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function parsePerformanceCsv(text: string, sourceFile: string, sourceId = sourceFile): ImportedLogRow[] {
  if (!text.trim()) throw new Error("The selected CSV file is empty.");
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^\uFEFF/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    dynamicTyping: false,
  });
  if (parsed.errors.length > 0) {
    throw new Error(`CSV could not be parsed: ${parsed.errors[0].message}`);
  }
  if (parsed.data.length > 10000) throw new Error("CSV contains more than 10,000 rows.");

  const headers = parsed.meta.fields ?? [];
  const missing = requiredColumns.filter((column) => !headers.includes(column));
  if (missing.length) throw new Error(`This does not look like a PitchPilot export. Missing: ${missing.join(", ")}`);

  const rows = parsed.data.flatMap((raw): ImportedLogRow[] => {
    const timestamp = String(raw.timestamp ?? "").trim();
    const event = String(raw.event ?? "").trim();
    const elapsedSeconds = numericOrNull(raw.elapsedSeconds);
    if (!timestamp || Number.isNaN(Date.parse(timestamp)) || !event || elapsedSeconds === null) return [];
    const confidence = numericOrNull(raw.expressionConfidencePercent);
    const audioDuration = numericOrNull(raw.audioDurationSeconds);
    const audioLevel = numericOrNull(raw.audioLowLevelPercent);
    return [{
      timestamp,
      elapsedSeconds: Math.max(0, elapsedSeconds),
      event: event.slice(0, 120),
      speechActivity: String(raw.speechActivity ?? "").trim().slice(0, 40),
      expressionLabel: String(raw.expressionLabel ?? "").trim().replace(/^'/, "").slice(0, 60),
      expressionConfidencePercent: confidence === null ? null : Math.min(100, Math.max(0, confidence)),
      faceFraming: String(raw.faceFraming ?? "").trim().replace(/^'/, "").slice(0, 120),
      audioDurationSeconds: audioDuration === null ? null : Math.max(0, audioDuration),
      audioLowLevelPercent: audioLevel === null ? null : Math.min(100, Math.max(0, audioLevel)),
      sourceId,
      sourceFile: sourceFile.slice(0, 180),
    }];
  });
  if (rows.length === 0) throw new Error("The CSV has no valid rehearsal log rows.");
  return rows;
}

export function summarizeSessions(rows: ImportedLogRow[]): SessionSummary[] {
  const groups = new Map<string, ImportedLogRow[]>();
  for (const row of rows) {
    const group = groups.get(row.sourceId) ?? [];
    group.push(row);
    groups.set(row.sourceId, group);
  }

  return Array.from(groups.entries()).map(([sourceId, sessionRows]) => {
    const expressionRows = sessionRows.filter((row) => row.expressionLabel !== "");
    const expressionCounts: Record<string, number> = {};
    for (const row of expressionRows) expressionCounts[row.expressionLabel] = (expressionCounts[row.expressionLabel] ?? 0) + 1;

    const confidenceRows = expressionRows.flatMap((row) => row.expressionConfidencePercent === null ? [] : [row.expressionConfidencePercent]);
    const speechRows = sessionRows.filter((row) => row.speechActivity === "speaking" || row.speechActivity === "pause");
    const startedAt = sessionRows.map((row) => row.timestamp).sort()[0] ?? "";
    const audioSummary = [...sessionRows].reverse().find((row) => row.event === "local_audio_analysis");

    return {
      sourceId,
      sourceFile: sessionRows[0]?.sourceFile ?? sourceId,
      startedAt,
      durationSeconds: Math.max(0, ...sessionRows.map((row) => row.elapsedSeconds)),
      logRows: sessionRows.length,
      expressionSamples: expressionRows.length,
      averageExpressionConfidence: confidenceRows.length
        ? confidenceRows.reduce((sum, value) => sum + value, 0) / confidenceRows.length
        : null,
      speakingPercent: speechRows.length
        ? (speechRows.filter((row) => row.speechActivity === "speaking").length / speechRows.length) * 100
        : null,
      expressionCounts,
      audioDurationSeconds: audioSummary?.audioDurationSeconds ?? null,
      audioLowLevelPercent: audioSummary?.audioLowLevelPercent ?? null,
    };
  }).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

export function getExpressionTotals(sessions: SessionSummary[]): Array<{ label: string; count: number }> {
  const totals = new Map<string, number>();
  for (const session of sessions) {
    for (const [label, count] of Object.entries(session.expressionCounts)) {
      totals.set(label, (totals.get(label) ?? 0) + count);
    }
  }
  return Array.from(totals, ([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
}
