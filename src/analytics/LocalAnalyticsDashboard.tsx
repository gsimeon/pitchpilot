import { useMemo, useRef, useState } from "react";
import { getExpressionTotals, parsePerformanceCsv, summarizeSessions, type ImportedLogRow } from "./csvAnalytics";

interface Props { onBack: () => void; }

const trendColors = ["#28745c", "#d58a3c", "#6381bb", "#b65d58"];

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return minutes ? `${minutes}m ${String(remainder).padStart(2, "0")}s` : `${remainder}s`;
}

export default function LocalAnalyticsDashboard({ onBack }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ImportedLogRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sessions = useMemo(() => summarizeSessions(rows), [rows]);
  const expressionTotals = useMemo(() => getExpressionTotals(sessions), [sessions]);
  const totalDuration = sessions.reduce((sum, item) => sum + item.durationSeconds, 0);
  const speechSamples = rows.filter((row) => row.speechActivity === "speaking" || row.speechActivity === "pause");
  const speakingShare = speechSamples.length
    ? Math.round((speechSamples.filter((row) => row.speechActivity === "speaking").length / speechSamples.length) * 100)
    : null;
  const allExpressionSamples = expressionTotals.reduce((sum, item) => sum + item.count, 0);
  const audioSessions = sessions.filter((session) => session.audioLowLevelPercent !== null);
  const averageLowLevel = audioSessions.length
    ? Math.round(audioSessions.reduce((sum, session) => sum + (session.audioLowLevelPercent ?? 0), 0) / audioSessions.length)
    : null;
  const trendLabels = expressionTotals.slice(0, 4).map((item) => item.label);

  const importFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    if (files.length > 20) {
      setError("Import up to 20 CSV files at a time.");
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    const added: ImportedLogRow[] = [];
    const failures: string[] = [];
    for (const file of Array.from(files)) {
      try {
        if (file.size > 4 * 1024 * 1024) throw new Error("CSV file exceeds the 4 MB import limit.");
        const text = await file.text();
        const id = `${file.name}:${file.lastModified}:${file.size}`;
        added.push(...parsePerformanceCsv(text, file.name, id));
      } catch (cause) {
        failures.push(`${file.name}: ${cause instanceof Error ? cause.message : "Could not read file."}`);
      }
    }
    const known = new Set(rows.map((row) => row.sourceId));
    const newSourceIds = new Set(added.map((row) => row.sourceId).filter((sourceId) => !known.has(sourceId)));
    const newRows = added.filter((row) => newSourceIds.has(row.sourceId));
    if (newRows.length) setRows((current) => [...current, ...newRows]);
    if (failures.length) setError(failures.join(" "));
    if (newRows.length && !failures.length) setNotice(`${new Set(newRows.map((row) => row.sourceId)).size} CSV file${new Set(newRows.map((row) => row.sourceId)).size === 1 ? "" : "s"} processed locally.`);
    else if (added.length > newRows.length) setNotice("One or more files were already imported and were skipped.");
    else if (!added.length && !failures.length) setNotice("No new rows to import.");
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  const clearHistory = () => {
    setRows([]);
    setError(null);
    setNotice("Imported history cleared from memory.");
  };

  const width = 720;
  const height = 250;
  const left = 48;
  const right = 18;
  const top = 20;
  const bottom = 34;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const trendSeries = trendLabels.map((label, index) => ({
    label,
    color: trendColors[index % trendColors.length],
    points: sessions.map((session, sessionIndex) => {
      const total = session.expressionSamples || 1;
      const value = ((session.expressionCounts[label] ?? 0) / total) * 100;
      const x = sessions.length === 1 ? left + chartWidth / 2 : left + (sessionIndex / (sessions.length - 1)) * chartWidth;
      const y = top + chartHeight - (value / 100) * chartHeight;
      return { x, y, value };
    }),
  }));

  return (
    <main className="min-h-screen bg-[#f4f7f3] text-slate-900">
      <header className="flex min-h-[76px] items-center justify-between border-b border-emerald-950/10 bg-[#fbfcf9] px-5 sm:px-10">
        <div>
          <p className="text-[10px] font-extrabold tracking-[.15em] text-emerald-900/55">PITCHPILOT · PRIVATE BY DEFAULT</p>
          <h1 className="text-2xl font-bold tracking-tight">Rehearsal analytics</h1>
        </div>
        <button className="rounded-xl border border-emerald-950/15 bg-white px-4 py-2 text-sm font-semibold text-emerald-950 hover:bg-emerald-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700" onClick={onBack}>Back to rehearsal</button>
      </header>

      <section className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-10">
        <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="mb-2 text-xs font-bold tracking-widest text-emerald-800/65">LOCAL CSV HISTORY</p>
            <h2 className="text-3xl font-bold tracking-tight">Your practice, over time</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Import PitchPilot CSV exports to compare rehearsal signals and the SDK's expression classifications across sessions. Files are read locally and are not uploaded.</p>
          </div>
          <div className="flex gap-2">
            <input ref={inputRef} className="sr-only" type="file" accept=".csv,text/csv" multiple aria-label="Import PitchPilot CSV files" onChange={(event) => void importFiles(event.target.files)} />
            <button type="button" className="rounded-xl bg-[#215f50] px-4 py-3 text-sm font-bold text-white hover:bg-[#194c40] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700" onClick={() => inputRef.current?.click()} disabled={busy}>{busy ? "Reading locally…" : "Import CSV files"}</button>
            {rows.length > 0 && <button type="button" className="rounded-xl border border-emerald-950/15 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50" onClick={clearHistory}>Clear history</button>}
          </div>
        </div>

        {error && <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">{error}</p>}
        {notice && <p className="mb-4 text-xs text-slate-500" role="status">{notice}</p>}

        {sessions.length === 0 ? (
          <section className="rounded-3xl border border-dashed border-emerald-900/25 bg-white/75 px-6 py-16 text-center">
            <div aria-hidden="true" className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-emerald-100 text-2xl text-emerald-800">↗</div>
            <h3 className="text-xl font-bold">No rehearsal history yet</h3>
            <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-600">Choose one or more CSV exports. PitchPilot groups each file as one rehearsal and builds the dashboard in memory.</p>
            <button className="mt-6 rounded-xl bg-[#215f50] px-4 py-3 text-sm font-bold text-white hover:bg-[#194c40]" onClick={() => inputRef.current?.click()}>Choose CSV files</button>
          </section>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard label="Imported rehearsals" value={String(sessions.length)} detail="One CSV file per session" />
              <MetricCard label="Total rehearsal time" value={formatDuration(totalDuration)} detail="Sum of elapsed session time" />
              <MetricCard label="Speaking samples" value={speakingShare === null ? "—" : `${speakingShare}%`} detail="Share of stable speaking/pause detections" />
              <MetricCard label="Low-level audio" value={averageLowLevel === null ? "—" : `${averageLowLevel}%`} detail={averageLowLevel === null ? "No local audio summary imported" : `Mean of ${audioSessions.length} local summaries`} />
            </div>

            <div className="mt-5 grid gap-5 xl:grid-cols-2">
              <section className="rounded-2xl border border-emerald-950/10 bg-white p-5 sm:p-6">
                <div className="flex items-start justify-between gap-4">
                  <div><p className="text-[10px] font-extrabold tracking-[.15em] text-emerald-800/60">EXPRESSION LABELS</p><h3 className="mt-1 text-lg font-bold">Observed classifications</h3></div>
                  <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-900">{allExpressionSamples} samples</span>
                </div>
                {expressionTotals.length ? <div className="mt-5 space-y-4">
                  {expressionTotals.map((item) => <div key={item.label}>
                    <div className="mb-1 flex justify-between text-xs"><span className="font-semibold text-slate-700">{item.label}</span><span className="tabular-nums text-slate-500">{item.count} · {Math.round(item.count / allExpressionSamples * 100)}%</span></div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-700" style={{ width: `${item.count / Math.max(1, expressionTotals[0]?.count ?? 1) * 100}%` }} /></div>
                  </div>)}
                </div> : <EmptyChart>No expression samples are present in these files.</EmptyChart>}
                <p className="mt-5 text-[10px] leading-5 text-slate-500">These are SmartSpectra model labels and confidence scores. They are not conclusions about mood, personality, confidence, or audience reaction.</p>
              </section>

              <section className="rounded-2xl border border-emerald-950/10 bg-white p-5 sm:p-6">
                <p className="text-[10px] font-extrabold tracking-[.15em] text-emerald-800/60">HISTORY TREND</p>
                <h3 className="mt-1 text-lg font-bold">Expression-label share by rehearsal</h3>
                {trendSeries.length ? <>
                  <div className="mt-5 overflow-x-auto">
                    <svg viewBox={`0 0 ${width} ${height}`} className="min-w-[560px] w-full" role="img" aria-label="Line chart of expression classification shares across imported rehearsal sessions">
                      {[0, 25, 50, 75, 100].map((tick) => {
                        const y = top + chartHeight - (tick / 100) * chartHeight;
                        return <g key={tick}><line x1={left} x2={width - right} y1={y} y2={y} stroke="#e7eeea" strokeWidth="1" /><text x={left - 8} y={y + 4} textAnchor="end" fill="#72817a" fontSize="10">{tick}%</text></g>;
                      })}
                      {trendSeries.map((series) => <g key={series.label}>
                        {series.points.length > 1 && <polyline fill="none" stroke={series.color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" points={series.points.map((point) => `${point.x},${point.y}`).join(" ")} />}
                        {series.points.map((point, index) => <circle key={`${series.label}-${index}`} cx={point.x} cy={point.y} r="4" fill={series.color}><title>{`${series.label}: ${Math.round(point.value)}% in rehearsal ${index + 1}`}</title></circle>)}
                      </g>)}
                      {sessions.map((session, index) => {
                        const x = sessions.length === 1 ? left + chartWidth / 2 : left + (index / (sessions.length - 1)) * chartWidth;
                        return <text key={session.sourceId} x={x} y={height - 8} textAnchor="middle" fill="#72817a" fontSize="10">#{index + 1}</text>;
                      })}
                    </svg>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">{trendSeries.map((series) => <span key={series.label} className="inline-flex items-center gap-2 text-[11px] text-slate-600"><i className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: series.color }} />{series.label}</span>)}</div>
                  <p className="mt-4 text-[10px] leading-5 text-slate-500">Each point is that label's share of stable expression samples in one imported CSV. X-axis follows session date; hover points for sample values.</p>
                </> : <EmptyChart>Import exports containing expression samples to see a trend.</EmptyChart>}
              </section>
            </div>

            <section className="mt-5 rounded-2xl border border-emerald-950/10 bg-white p-5 sm:p-6">
              <p className="text-[10px] font-extrabold tracking-[.15em] text-emerald-800/60">SESSION HISTORY</p>
              <h3 className="mt-1 text-lg font-bold">Imported rehearsal files</h3>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[700px] border-collapse text-left text-xs">
                  <thead><tr className="border-b border-slate-200 text-slate-500"><th className="py-3 pr-4 font-semibold">Date</th><th className="py-3 pr-4 font-semibold">CSV source</th><th className="py-3 pr-4 font-semibold">Duration</th><th className="py-3 pr-4 font-semibold">Expression samples</th><th className="py-3 pr-4 font-semibold">Most common label</th><th className="py-3 font-semibold">Mean confidence</th></tr></thead>
                  <tbody>{sessions.map((session) => {
                    const top = Object.entries(session.expressionCounts).sort((a, b) => b[1] - a[1])[0];
                    return <tr key={session.sourceId} className="border-b border-slate-100 last:border-0"><td className="py-3 pr-4 text-slate-600">{new Date(session.startedAt).toLocaleDateString()}</td><td className="max-w-[220px] truncate py-3 pr-4 font-medium text-slate-800" title={session.sourceFile}>{session.sourceFile}</td><td className="py-3 pr-4 tabular-nums">{formatDuration(session.durationSeconds)}</td><td className="py-3 pr-4 tabular-nums">{session.expressionSamples}</td><td className="py-3 pr-4">{top?.[0] ?? "—"}</td><td className="py-3 tabular-nums">{session.averageExpressionConfidence === null ? "—" : `${Math.round(session.averageExpressionConfidence)}%`}</td></tr>;
                  })}</tbody>
                </table>
              </div>
              <p className="mt-4 text-[10px] text-slate-500">Imported CSV contents are held in memory only. Clear history or close the app to remove them.</p>
            </section>
          </>
        )}
      </section>
    </main>
  );
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <section className="rounded-2xl border border-emerald-950/10 bg-white p-5"><p className="text-[10px] font-extrabold tracking-[.14em] text-slate-500">{label.toUpperCase()}</p><p className="mt-3 text-3xl font-bold tracking-tight text-emerald-950">{value}</p><p className="mt-1 text-[10px] leading-4 text-slate-500">{detail}</p></section>;
}

function EmptyChart({ children }: { children: string }) {
  return <div className="mt-5 grid min-h-40 place-items-center rounded-xl bg-slate-50 px-5 text-center text-sm text-slate-500">{children}</div>;
}
