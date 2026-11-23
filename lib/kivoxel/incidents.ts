// 23-11-2026 (Milan, superprompt V6, fase 28): Ivar as first aid. Every two minutes the worker takes a snapshot of the
// studio (running and failed steps, heartbeats, progress, disk, budget, YouTube sign-in, the upload line) and this
// module turns it into incidents: what is wrong, technical or quality, how bad, the likely cause, and which safe action
// (level 1: reversible, allowed in advance) the worker may take itself. Level 2/3 actions (paid re-productions,
// deleting, publishing, restarting the worker while FFmpeg runs) are never taken here: they become a question to Milan.
// An incident stays open until a later snapshot shows it is gone; then it is closed with what solved it. Pure, tested.

export type Severity = "info" | "waarschuwing" | "storing";
export type IncidentKind = "stap_vast" | "voortgang_stil" | "stap_mislukt" | "schijf" | "budget" | "youtube" | "uploadrij" | "kwaliteit";
export type Action = { level: 1 | 2 | 3; what: string; auto: boolean };
export type Incident = {
  id: string;
  kind: IncidentKind;
  severity: Severity;
  /** "techniek" = a fault in the machinery; "kwaliteit" = a creative problem in a production. */
  domain: "techniek" | "kwaliteit";
  title: string;
  cause: string;
  action: Action | null;
  firstSeen: string;
  lastSeen: string;
  /** What the worker did itself, and whether a later round saw it work. */
  done?: { what: string; at: string; verified: boolean | null };
  resolvedAt?: string;
  resolution?: string;
  /** For Ivar and the studio: the production or step it is about. */
  ref?: { jobId?: string; videoId?: string; step?: string; title?: string };
};

export type JobSnap = { id: string; step: string; status: string; error: string | null; /** A later step of the same video and kind is done, running or waiting: this failure no longer matters. */ superseded?: boolean; /** When this worker session claimed it; older than the session start = an orphan of a previous run. */ locked_at?: string | null; attempts: number; max_attempts: number; heartbeat_at: string | null; progress: number | null; phase: string | null; started_at: string | null; finished_at: string | null; video_id: string | null; title?: string | null };
export type Snapshot = {
  now: string;
  jobs: JobSnap[];
  /** Progress seen per running job in earlier rounds (jobId -> {progress, since}). */
  progressSeen: Record<string, { progress: number | null; since: string }>;
  diskFreeBytes: number | null;
  budget: { spentCents: number; capCents: number } | null;
  youtube: { connected: boolean; scopes: string[] } | null;
  /** Publications waiting in "Wachtrij YouTube": oldest wait start. */
  uploadLineOldest: string | null;
  uploadLineCount: number;
  /** Productions in review with a viral score below 8.0 or blocked (quality, not technique). */
  belowNorm: { videoId: string; title: string; summary: string }[];
};

const MIN = 60_000;
/** Heartbeat older than this while running: the step is stuck (the database frees it after its own stale time). */
export const HEARTBEAT_STALE_MS = 10 * MIN;
/** Same progress for this long while the heartbeat is alive: stalled (the "93%" case). */
export const PROGRESS_STALL_MS = 20 * MIN;
/** Errors worth one automatic retry: the network, a 5xx, a timeout, a busy service. Never quota, never a bad file. */
export const TRANSIENT = /ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|fetch failed|timed? ?out|\b50[0234]\b|UNAVAILABLE|overloaded|try again/i;

const ago = (from: string | null, now: string) => (from ? Date.parse(now) - Date.parse(from) : Infinity);
const mins = (ms: number) => `${Math.round(ms / MIN)} min`;
const STEP: Record<string, string> = { intake: "intake", analyse: "analyse", script: "script", render: "montage", upload: "upload", viral: "viral-check", assistant: "Ivar-antwoord", insight: "weekinzicht", suggest: "suggesties", reference: "referentievideo's" };
const stepName = (s: string) => STEP[s] ?? s;

/** Everything wrong right now, with the safe action for each. */
export function detect(s: Snapshot): Omit<Incident, "firstSeen" | "lastSeen">[] {
  const out: Omit<Incident, "firstSeen" | "lastSeen">[] = [];
  for (const j of s.jobs.filter((x) => x.status === "running")) {
    const beat = ago(j.heartbeat_at ?? j.started_at, s.now);
    const name = `${stepName(j.step)}${j.title ? ` van "${j.title}"` : ""}`;
    if (beat > HEARTBEAT_STALE_MS) {
      out.push({ id: `stap_vast:${j.id}`, kind: "stap_vast", severity: "storing", domain: "techniek", title: `De ${name} geeft al ${mins(beat)} geen teken van leven`, cause: "Waarschijnlijk is de werker gestopt of herstart tijdens deze stap (pc uit, venster gesloten).", action: j.attempts < j.max_attempts ? { level: 1, what: "De stap wordt vrijgegeven en opnieuw opgepakt (geen dubbele kosten: dezelfde stap)", auto: true } : { level: 2, what: "Te vaak geprobeerd: kijk naar de fout en kies 'opnieuw proberen' of afkeuren", auto: false }, ref: { jobId: j.id, videoId: j.video_id ?? undefined, step: j.step, title: j.title ?? undefined } });
      continue;
    }
    const seen = s.progressSeen[j.id];
    if (seen && j.progress !== null && seen.progress === j.progress && ago(seen.since, s.now) > PROGRESS_STALL_MS)
      out.push({ id: `voortgang_stil:${j.id}`, kind: "voortgang_stil", severity: "waarschuwing", domain: "techniek", title: `De ${name} staat al ${mins(ago(seen.since, s.now))} op ${Math.round(j.progress * 100)}%`, cause: `De werker leeft nog (laatste teken ${mins(beat)} geleden) maar de voortgang verandert niet${j.phase ? ` (fase: ${j.phase})` : ""}. Lange stappen (gekloonde stem, lange video) kunnen zo lang stilstaan.`, action: { level: 2, what: "Nog niet ingrijpen: een lopende FFmpeg wordt nooit zonder jouw akkoord gestopt. Blijft het zo, dan vraagt Ivar of de stap opnieuw mag.", auto: false }, ref: { jobId: j.id, videoId: j.video_id ?? undefined, step: j.step, title: j.title ?? undefined } });
  }
  const day = 24 * 60 * MIN;
  for (const j of s.jobs.filter((x) => x.status === "failed" && !x.superseded && ago(x.finished_at, s.now) < day)) {
    const transient = !!j.error && TRANSIENT.test(j.error);
    out.push({
      id: `stap_mislukt:${j.id}`,
      kind: "stap_mislukt",
      severity: transient ? "waarschuwing" : "storing",
      domain: "techniek",
      title: `De ${stepName(j.step)}${j.title ? ` van "${j.title}"` : ""} is mislukt`,
      cause: (j.error ?? "Geen foutmelding opgeslagen").slice(0, 240),
      action: transient && j.attempts < j.max_attempts ? { level: 1, what: "Tijdelijke fout (netwerk of dienst): één keer automatisch opnieuw", auto: true } : { level: 2, what: "Geen tijdelijke fout: bekijk de oorzaak; opnieuw proberen kan in de wachtrij", auto: false },
      ref: { jobId: j.id, videoId: j.video_id ?? undefined, step: j.step, title: j.title ?? undefined },
    });
  }
  if (s.diskFreeBytes !== null && s.diskFreeBytes < 15e9)
    out.push({ id: "schijf", kind: "schijf", severity: s.diskFreeBytes < 5e9 ? "storing" : "waarschuwing", domain: "techniek", title: `Nog ${(s.diskFreeBytes / 1e9).toFixed(1)} GB vrij op de schijf`, cause: "Een montage of opname kan mislukken met 'No space left on device'.", action: { level: 3, what: "Opruimen (bijv. tijdelijke mappen, oude exports van live video's) alleen met jouw akkoord", auto: false } });
  if (s.budget && s.budget.capCents > 0 && s.budget.spentCents >= 0.8 * s.budget.capCents)
    out.push({ id: "budget", kind: "budget", severity: s.budget.spentCents >= s.budget.capCents ? "storing" : "waarschuwing", domain: "techniek", title: `Maandbudget AI: € ${(s.budget.spentCents / 100).toFixed(2)} van € ${(s.budget.capCents / 100).toFixed(2)}`, cause: "Boven het plafond stopt de werker vóór betaalde stappen (analyse, script, Ivar).", action: { level: 3, what: "Het plafond verhogen kan alleen jij (Instellingen)", auto: false } });
  if (s.youtube && (!s.youtube.connected || !s.youtube.scopes.some((x) => x.includes("youtube.upload"))))
    out.push({ id: "youtube", kind: "youtube", severity: "storing", domain: "techniek", title: "De YouTube-koppeling werkt niet", cause: s.youtube.connected ? "Toestemming voor uploaden ontbreekt." : "De werker is niet (meer) aangemeld bij YouTube.", action: { level: 3, what: "Opnieuw koppelen in Instellingen (jouw Google-aanmelding)", auto: false } });
  if (s.uploadLineCount && s.uploadLineOldest && ago(s.uploadLineOldest, s.now) > 48 * 60 * MIN)
    out.push({ id: "uploadrij", kind: "uploadrij", severity: "info", domain: "techniek", title: `${s.uploadLineCount} video('s) wachten al meer dan 2 dagen in Wachtrij YouTube`, cause: "YouTube weigert uploads (limiet of quotum); de werker probeert het vanzelf opnieuw zodra het mag.", action: null });
  for (const b of s.belowNorm) out.push({ id: `kwaliteit:${b.videoId}`, kind: "kwaliteit", severity: "info", domain: "kwaliteit", title: `"${b.title}" haalt de 8,0 niet`, cause: b.summary, action: { level: 2, what: "Gericht verbeteren of afkeuren in het keurscherm", auto: false }, ref: { videoId: b.videoId, title: b.title } });
  return out;
}

/** Keeps the log: new incidents open, still-present ones update, gone ones close (with the action that was taken). */
export function merge(prev: Incident[], current: Omit<Incident, "firstSeen" | "lastSeen">[], now: string, keepClosedMs = 7 * 24 * 60 * MIN): Incident[] {
  const open = new Map(prev.filter((p) => !p.resolvedAt).map((p) => [p.id, p]));
  const out: Incident[] = [];
  for (const c of current) {
    const p = open.get(c.id);
    out.push(p ? { ...p, ...c, firstSeen: p.firstSeen, lastSeen: now, done: p.done } : { ...c, firstSeen: now, lastSeen: now });
    open.delete(c.id);
  }
  for (const p of open.values()) out.push({ ...p, resolvedAt: now, resolution: p.done ? `Opgelost na: ${p.done.what}` : "Niet meer gezien (vanzelf opgelost of door jou)", done: p.done ? { ...p.done, verified: true } : undefined });
  for (const p of prev.filter((x) => x.resolvedAt && Date.parse(now) - Date.parse(x.resolvedAt) < keepClosedMs)) if (!out.some((o) => o.id === p.id)) out.push(p);
  return out.sort((a, b) => Number(!!a.resolvedAt) - Number(!!b.resolvedAt) || b.lastSeen.localeCompare(a.lastSeen)).slice(0, 200);
}

/** One line for Ivar's button and the health panel. */
export function healthLine(list: Incident[]): { status: "operationeel" | "aandacht" | "storing"; text: string } {
  const open = list.filter((i) => !i.resolvedAt);
  const storing = open.filter((i) => i.severity === "storing");
  const warn = open.filter((i) => i.severity === "waarschuwing");
  if (storing.length) return { status: "storing", text: `${storing.length} storing${storing.length > 1 ? "en" : ""}: ${storing[0].title}` };
  if (warn.length) return { status: "aandacht", text: `${warn.length} waarschuwing${warn.length > 1 ? "en" : ""}: ${warn[0].title}` };
  return { status: "operationeel", text: open.length ? `Operationeel; ${open.length} melding${open.length > 1 ? "en" : ""} ter info` : "Operationeel: niets aan de hand" };
}
