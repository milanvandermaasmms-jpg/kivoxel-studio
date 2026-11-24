// 23-11-2026 (superprompt V5 fase 23): what each production really cost. Every cost line belongs to a step (yt_jobs):
// an analysis belongs to its recording, a script, montage or check to its video, an Ivar answer to nobody's production.
// Measured amounts and estimates (a reservation that was never settled, e.g. after a network error) are shown apart.
// Pure, tested.

export type CostLine = { job_id: string | null; video_id: string | null; amount_cents: number; is_estimate: boolean; category: string; service: string; incurred_on: string };
export type JobRef = { id: string; step: string; video_id: string | null; recording_id: string | null };
export type CostRow = { key: string; kind: "opname" | "video" | "overig"; label: string; measured: number; estimated: number; byStep: Record<string, number>; lines: number };

const STEP: Record<string, string> = { analyse: "analyse", script: "script", render: "montage", viral: "checks", suggest: "suggesties", assistant: "Ivar", insight: "Ivar-weekronde", reference: "referenties", upload: "upload" };

export function costOverview(lines: CostLine[], jobs: JobRef[], names: { recordings: Record<string, string>; videos: Record<string, { title: string; recordingId: string | null }> }, since?: string): { rows: CostRow[]; total: { measured: number; estimated: number } } {
  const byId = new Map(jobs.map((j) => [j.id, j]));
  const rows = new Map<string, CostRow>();
  const total = { measured: 0, estimated: 0 };
  for (const l of lines) {
    if (since && l.incurred_on < since) continue;
    const j = l.job_id ? byId.get(l.job_id) : undefined;
    const videoId = l.video_id ?? j?.video_id ?? null;
    const recId = !videoId ? (j?.recording_id ?? null) : null;
    const step = j ? (STEP[j.step] ?? j.step) : l.category;
    let key: string;
    let row: CostRow | undefined;
    if (videoId) {
      key = `v:${videoId}`;
      row = rows.get(key) ?? { key, kind: "video", label: names.videos[videoId]?.title ?? "Video", measured: 0, estimated: 0, byStep: {}, lines: 0 };
    } else if (recId) {
      key = `r:${recId}`;
      row = rows.get(key) ?? { key, kind: "opname", label: names.recordings[recId] ?? "Opname", measured: 0, estimated: 0, byStep: {}, lines: 0 };
    } else {
      key = `o:${step}`;
      row = rows.get(key) ?? { key, kind: "overig", label: step === "Ivar" ? "Ivar (gesprekken)" : step === "Ivar-weekronde" ? "Ivar (weekinzichten)" : `Overig (${step})`, measured: 0, estimated: 0, byStep: {}, lines: 0 };
    }
    if (l.is_estimate) row.estimated += l.amount_cents;
    else row.measured += l.amount_cents;
    row.byStep[step] = (row.byStep[step] ?? 0) + l.amount_cents;
    row.lines += 1;
    rows.set(key, row);
    if (l.is_estimate) total.estimated += l.amount_cents;
    else total.measured += l.amount_cents;
  }
  return { rows: [...rows.values()].sort((a, b) => b.measured + b.estimated - (a.measured + a.estimated)), total };
}

/**
 * 24-11-2026 (Milan: "wat kost een upload van een uur?"): per recording everything it cost (its analysis plus the
 * scripts, montages and checks of all its videos), per hour of footage, from the real cost lines.
 */
export function perRecordingHour(lines: CostLine[], jobs: JobRef[], videos: Record<string, { recordingId: string | null }>, recordings: Record<string, { label: string; durationMs: number | null }>) {
  const byId = new Map(jobs.map((j) => [j.id, j]));
  const per = new Map<string, { analyse: number; scripts: number; checks: number; overig: number }>();
  for (const l of lines) {
    const j = l.job_id ? byId.get(l.job_id) : undefined;
    const vid = l.video_id ?? j?.video_id ?? null;
    const rec = vid ? (videos[vid]?.recordingId ?? null) : (j?.recording_id ?? null);
    if (!rec) continue;
    const p = per.get(rec) ?? { analyse: 0, scripts: 0, checks: 0, overig: 0 };
    const step = j?.step ?? "";
    if (step === "analyse") p.analyse += l.amount_cents;
    else if (step === "script") p.scripts += l.amount_cents;
    else if (step === "viral") p.checks += l.amount_cents;
    else p.overig += l.amount_cents;
    per.set(rec, p);
  }
  const rows = [...per.entries()]
    .map(([id, p]) => ({ id, label: recordings[id]?.label ?? "Opname", hours: (recordings[id]?.durationMs ?? 0) / 3_600_000, ...p, total: p.analyse + p.scripts + p.checks + p.overig }))
    .filter((r) => r.hours >= 0.25);
  const hours = rows.reduce((a, r) => a + r.hours, 0);
  const sum = (k: "analyse" | "scripts" | "checks" | "overig" | "total") => rows.reduce((a, r) => a + r[k], 0);
  const perHour = (k: "analyse" | "scripts" | "checks" | "overig" | "total") => (hours ? Math.round(sum(k) / hours) : 0);
  return { recordings: rows.length, hours: Math.round(hours * 10) / 10, perHour: { total: perHour("total"), analyse: perHour("analyse"), scripts: perHour("scripts"), checks: perHour("checks"), overig: perHour("overig") }, rows: rows.sort((a, b) => b.total / b.hours - a.total / a.hours) };
}

export const eur = (cents: number) => `€ ${(cents / 100).toFixed(2).replace(".", ",")}`;
