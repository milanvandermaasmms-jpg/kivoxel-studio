"use client";

import { Gauge, Loader2, RotateCcw, Scissors, Wand2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Dialog } from "@/components/ui/Dialog";
import { formatTimecode } from "@/lib/youtube/analysis";
import { regenerateScript, saveEditedScript, type DbScript } from "@/lib/youtube/analysisData";
import { track } from "@/lib/youtube/learningData";
import { cutPlan, mmss, PART_LABEL, rewriteNote, type Fix, type Part, type PartKey } from "@/lib/youtube/viral";
import { loadViral, requestViral, type ViralCheck, type ViralJob } from "@/lib/youtube/viralData";

const SOURCE: Record<ViralCheck["source"], string> = { ai: "regels + AI-luistercheck", rules: "alleen regels (luistercheck stond uit)", test: "testvideo, vaste beoordeling" };
const tone = (n: number) => (n >= 8 ? "bg-emerald-500" : n >= 6 ? "bg-amber-500" : "bg-red-500");
const nl = (n: number) => n.toLocaleString("nl-NL", { maximumFractionDigits: 1 });
const when = (f: Fix) => (f.fromMs !== null && f.toMs !== null ? `${mmss(f.fromMs)}–${mmss(f.toMs)} ` : "");

/**
 * Viral-score in Review (fase 3.2): three parts with a score 1-10, what goes well and 2-3 fixes with timestamps.
 * "Automatisch verbeteren" always shows before and after first; the result is a new version that waits for Milan.
 */
export function ViralCard({ studioId, videoId, scripts, approved, act }: { studioId: string; videoId: string; scripts: DbScript[]; approved: DbScript | null; act: (a: () => Promise<unknown>) => Promise<void> }) {
  const [state, setState] = useState<{ check: ViralCheck | null; job: ViralJob } | "migration" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"rewrite" | "cut" | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const last = useRef("");
  const load = useCallback(async () => {
    try {
      const s = await loadViral(videoId);
      const key = JSON.stringify(s);
      if (key !== last.current) {
        last.current = key;
        setState(s);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [videoId]);
  useEffect(() => {
    void load();
  }, [load]);
  const pending = !!state && state !== "migration" && (state.job?.status === "queued" || state.job?.status === "running");
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [pending, load]);

  // Same height while loading, so the review list does not jump.
  if (state === null) return <div aria-busy className="mt-3 h-24 animate-pulse rounded-lg bg-slate-50" />;
  if (state === "migration") return <p className="mt-3 rounded-lg bg-slate-50 p-2 text-xs text-slate-600">De Viral-score komt er met migratie 050 (nog niet uitgevoerd).</p>;

  const { check, job } = state;
  const ask = () =>
    void act(async () => {
      await requestViral(studioId, videoId);
      track(studioId, "viral_requested", "review", { video: videoId });
      await load();
    });
  const nextVersion = Math.max(0, ...scripts.map((s) => s.version)) + 1;
  const outdated = check && approved && check.script_id !== approved.id;
  const rewrite = check?.result.parts.script.fixes.some((f) => f.auto === "rewrite");
  const cuts = check?.result.parts.gameplay.fixes.filter((f) => f.auto === "cut" && f.src) ?? [];
  const plan = approved && cuts.length ? cutPlan(approved.edit_plan, approved.lines, cuts.map((f) => f.src!)) : null;

  return (
    <section className="mt-3 space-y-3 rounded-lg border border-slate-200 p-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Gauge className="h-4 w-4 text-violet-600" aria-hidden />
          Viral-score {check ? <span className="tabular-nums">{nl(check.overall)} / 10</span> : null}
        </p>
        {!pending && (
          <Button variant="ghost" onClick={ask}>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden /> {check ? "Opnieuw toetsen" : "Nu toetsen"}
          </Button>
        )}
      </div>
      <p className="text-slate-500">Een voorspelling op basis van wat meestal werkt, geen garantie. {check ? `Gemeten met ${SOURCE[check.source]}, ${new Date(check.created_at).toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam", dateStyle: "short", timeStyle: "short" })}.` : ""}</p>
      {pending && (
        <p role="status" className="flex items-center gap-2 text-violet-800">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {job?.status === "queued" ? "Wacht op de werker…" : "De werker toetst de video (en luistert naar de voice-over)…"}
        </p>
      )}
      {job?.status === "failed" && !pending && (
        <p role="alert" className="flex flex-wrap items-center gap-2 rounded bg-red-50 px-2 py-1 text-red-800">
          Toetsen mislukt: {job.error ?? "onbekende fout"}
          <Button variant="secondary" onClick={ask}>
            Opnieuw proberen
          </Button>
        </p>
      )}
      {!check && !pending && job?.status !== "failed" && <p className="text-slate-600">Nog niet getoetst. Na elke nieuwe montage gebeurt dat vanzelf.</p>}
      {outdated && <p className="rounded bg-amber-50 px-2 py-1 text-amber-900">Deze score hoort bij een eerdere versie. Na de nieuwe montage wordt opnieuw getoetst.</p>}
      {check && (
        <div className="grid gap-2 md:grid-cols-3">
          {(Object.keys(PART_LABEL) as PartKey[]).map((k) => (
            <PartView key={k} label={PART_LABEL[k]} part={check.result.parts[k]} />
          ))}
        </div>
      )}
      {check && (rewrite || plan) && (
        <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-2">
          {rewrite && (
            <Button variant="secondary" onClick={() => setDialog("rewrite")}>
              <Wand2 className="h-4 w-4" aria-hidden /> Script laten herschrijven
            </Button>
          )}
          {plan && plan.removedMs > 0 && (
            <Button variant="secondary" onClick={() => setDialog("cut")}>
              <Scissors className="h-4 w-4" aria-hidden /> Saaie stukken wegknippen
            </Button>
          )}
        </div>
      )}
      {done && <p className="rounded bg-emerald-50 px-2 py-1 text-emerald-800">{done}</p>}
      {error && <p role="alert" className="text-red-800">{error}</p>}

      <Dialog open={dialog === "rewrite"} onClose={() => setDialog(null)} title="Script laten herschrijven" width="max-w-xl">
        {check && (
          <div className="space-y-3 p-4 text-sm">
            <p>De AI schrijft een nieuwe versie die alleen deze punten verbetert (een fractie van een cent; testvideo&apos;s gratis):</p>
            <p className="rounded bg-slate-50 p-2 text-slate-700">{rewriteNote(check.result)}</p>
            <p className="text-slate-600">Voor en na: de nieuwe versie komt in Review te staan, met de verschillen ten opzichte van nu. Er verandert niets tot jij hem goedkeurt.</p>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() =>
                  void act(async () => {
                    await regenerateScript(studioId, videoId, nextVersion, rewriteNote(check.result));
                    track(studioId, "viral_auto_rewrite", "review", { video: videoId });
                    setDialog(null);
                    setDone(`Versie ${nextVersion} wordt geschreven. Hij verschijnt hier om te keuren.`);
                  })
                }
              >
                Ja, nieuwe versie laten schrijven
              </Button>
              <Button variant="ghost" onClick={() => setDialog(null)}>
                Annuleren
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      <Dialog open={dialog === "cut"} onClose={() => setDialog(null)} title="Saaie stukken wegknippen" width="max-w-xl">
        {plan && approved && (
          <div className="space-y-3 p-4 text-sm">
            <ul className="list-disc space-y-0.5 pl-4">
              {cuts.map((f, i) => (
                <li key={i}>
                  {when(f)}
                  {f.text}
                </li>
              ))}
            </ul>
            <table className="w-full text-left text-xs">
              <thead className="text-slate-500">
                <tr>
                  <th className="font-normal" />
                  <th className="font-normal">Voor</th>
                  <th className="font-normal">Na</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="py-1 pr-2 text-slate-500">Lengte</td>
                  <td>{formatTimecode(approved.edit_plan.reduce((n, s) => Math.max(n, s.out_start_ms + Math.round((s.src_end_ms - s.src_start_ms) / s.speed)), 0))}</td>
                  <td className="font-semibold">{formatTimecode(plan.segments.reduce((n, s) => Math.max(n, s.out_start_ms + Math.round((s.src_end_ms - s.src_start_ms) / s.speed)), 0))}</td>
                </tr>
                <tr>
                  <td className="py-1 pr-2 text-slate-500">Delen in beeld</td>
                  <td>{approved.edit_plan.length}</td>
                  <td className="font-semibold">{plan.segments.length}</td>
                </tr>
                <tr>
                  <td className="py-1 pr-2 text-slate-500">Zinnen voice-over</td>
                  <td>{approved.lines.length}</td>
                  <td className="font-semibold">{plan.lines.length}</td>
                </tr>
              </tbody>
            </table>
            <p className="text-slate-600">Er komt een nieuwe versie (gratis, FFmpeg op je pc). Keur hem goed in Review; dan maakt de werker de nieuwe montage en toetst hij opnieuw. De huidige montage blijft bestaan.</p>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() =>
                  void act(async () => {
                    const targetMs = plan.segments.reduce((n, s) => Math.max(n, s.out_start_ms + Math.round((s.src_end_ms - s.src_start_ms) / s.speed)), 0);
                    await saveEditedScript(studioId, approved, nextVersion, { topLine: approved.top_line ?? "", lines: plan.lines, segments: plan.segments, targetMs }, false);
                    track(studioId, "viral_auto_cut", "review", { video: videoId, removed_ms: plan.removedMs });
                    setDialog(null);
                    setDone(`Versie ${nextVersion} staat klaar om te keuren (${Math.round(plan.removedMs / 1000)} s korter).`);
                  })
                }
              >
                Ja, nieuwe versie maken
              </Button>
              <Button variant="ghost" onClick={() => setDialog(null)}>
                Annuleren
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </section>
  );
}

function PartView({ label, part }: { label: string; part: Part }) {
  return (
    <div className="space-y-1.5 rounded-md bg-slate-50 p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{label}</span>
        <span className="font-semibold tabular-nums">{nl(part.score)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded bg-slate-200" aria-hidden>
        <div className={`h-full ${tone(part.score)}`} style={{ width: `${part.score * 10}%` }} />
      </div>
      {part.good.length > 0 && (
        <ul className="space-y-0.5 text-emerald-700">
          {part.good.map((g) => (
            <li key={g}>✓ {g}</li>
          ))}
        </ul>
      )}
      {part.fixes.length > 0 && (
        <ul className="space-y-0.5 text-amber-800">
          {part.fixes.map((f, i) => (
            <li key={i}>
              ⚠ <span className="font-mono">{when(f)}</span>
              {f.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
