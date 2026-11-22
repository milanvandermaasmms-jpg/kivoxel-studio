// 23-11-2026 (Milan, executive producer): before a Short gets a script and a montage, the moment must earn it.
// GROEN LICHT: every check passes. PROEFOPNAME: the moment may work, one thing is unproven; it is made, marked for a
// critical review. AFGEKEURD: a check fails that a montage cannot repair (nothing to see, the outcome is not in the
// footage); no production time is spent, the reason is kept and Milan can still choose "Opnieuw monteren".
// Only what the analysis really measured counts; what it cannot measure is ONBEWEZEN, never GESLAAGD. Pure, tested.
import type { DeadSpan, EventTimeline, GameEvent } from "./events.ts";

export type Verdict = "GESLAAGD" | "ONBEWEZEN" | "GEZAKT";
export type GateCheck = { key: "belofte" | "eerste_indruk" | "voortgang" | "einde" | "originaliteit" | "productie"; label: string; verdict: Verdict; reason: string };
export type GateStatus = "GROEN LICHT" | "PROEFOPNAME" | "AFGEKEURD";
export type GateResult = { status: GateStatus; checks: GateCheck[]; summary: string; directions: string[] };

const clock = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0")}`;
/** Share of [a, b] covered by dead footage of the given kinds. */
export function deadShare(dead: DeadSpan[], a: number, b: number, kinds: DeadSpan["why"][] = ["menu", "black", "still"]): number {
  if (b <= a) return 0;
  let covered = 0;
  for (const d of dead) if (kinds.includes(d.why)) covered += Math.max(0, Math.min(b, d.endMs) - Math.max(a, d.startMs));
  return Math.min(1, covered / (b - a));
}

export function producerGate(input: { event: GameEvent; timeline: EventTimeline; recentHooks?: string[]; hook?: string | null; sourceOnPc: boolean }): GateResult {
  const e = input.event;
  const t = input.timeline;
  const checks: GateCheck[] = [];
  // A. De belofte: a kind of moment and what happens, in one sentence.
  const promise = !!e.type && (e.description ?? "").trim().length >= 12;
  checks.push({ key: "belofte", label: "De belofte", verdict: promise ? "GESLAAGD" : "ONBEWEZEN", reason: promise ? `${e.type}: ${e.description.slice(0, 120)}` : "De analyse geeft geen duidelijk soort moment of beschrijving." });
  // B. De eerste indruk: the opening (teaser of the peak, 0.4 s before to 0.9 s after) must show gameplay, not a menu.
  const openDead = deadShare(t.dead, e.t_peak - 400, e.t_peak + 900);
  const menuNote = /grotendeels menu/.test(e.description ?? "");
  checks.push({
    key: "eerste_indruk",
    label: "De eerste indruk",
    verdict: openDead > 0.5 || menuNote ? "GEZAKT" : "GESLAAGD",
    reason: openDead > 0.5 ? `Het eerste beeld (rond ${clock(e.t_peak)}) is voor ${Math.round(openDead * 100)}% menu, zwart of stilstaand.` : menuNote ? "Rond het moment is vooral een menu of inventaris in beeld." : `Rond ${clock(e.t_peak)} is gameplay in beeld.`,
  });
  // C. De voortgang: something leads up to the peak (another event in the 30 s before), else only the peak itself.
  const lead = t.events.some((x) => x.id !== e.id && x.t_peak < e.t_peak - 2000 && x.t_peak > e.t_peak - 30_000 && x.payoff >= 30);
  checks.push({ key: "voortgang", label: "De voortgang", verdict: lead ? "GESLAAGD" : "ONBEWEZEN", reason: lead ? "Er gebeurt al iets in de aanloop (een eerder moment in de 30 s ervoor)." : "In de aanloop meet de analyse niets; of de opbouw boeit, moet de beoordeling na de export uitwijzen." });
  // D. Het einde: the outcome must be in the footage: 0-3 s after the peak not mostly menu, black or still (a death screen is the outcome).
  const endDead = e.kind === "death" ? 0 : deadShare(t.dead, e.t_peak, Math.min(t.durationMs, e.t_peak + 3000));
  const endRoom = t.durationMs - e.t_peak;
  checks.push({
    key: "einde",
    label: "Het einde",
    verdict: endRoom < 1500 ? "GEZAKT" : endDead > 0.5 ? "GEZAKT" : "GESLAAGD",
    reason: endRoom < 1500 ? "De opname stopt vlak na het hoogtepunt: de uitkomst staat er niet op." : endDead > 0.5 ? `Na het hoogtepunt (${clock(e.t_peak)}) is ${Math.round(endDead * 100)}% menu, zwart of stilstaand: de uitkomst is niet te zien.` : `Na ${clock(e.t_peak)} is de uitkomst in beeld.`,
  });
  // E. Originaliteit: not the same hook as the last Shorts (what the moment adds itself, the analysis cannot judge).
  const repeated = !!input.hook && (input.recentHooks ?? []).includes(input.hook);
  checks.push({ key: "originaliteit", label: "Originaliteit", verdict: repeated ? "ONBEWEZEN" : "ONBEWEZEN", reason: repeated ? "Dezelfde hook als een recente Short." : "Wat dit moment eigen maakt, kan de analyse niet meten; de eindredacteur en Milan beoordelen dat." });
  // F. Productie en bewijs: the source recording is on this pc.
  checks.push({ key: "productie", label: "Productie en bewijs", verdict: input.sourceOnPc ? "GESLAAGD" : "GEZAKT", reason: input.sourceOnPc ? "De bronopname staat op de pc." : "De bronopname staat niet op de pc." });

  const failed = checks.filter((c) => c.verdict === "GEZAKT");
  const critical = failed.filter((c) => c.key === "eerste_indruk" || c.key === "einde" || c.key === "productie");
  const weak = e.payoff < 45;
  const status: GateStatus = critical.length || weak ? "AFGEKEURD" : checks.some((c) => c.verdict === "ONBEWEZEN" && (c.key === "belofte" || c.key === "voortgang")) || e.payoff < 60 ? "PROEFOPNAME" : "GROEN LICHT";
  const directions: string[] = [];
  if (status === "AFGEKEURD") {
    if (critical.some((c) => c.key === "eerste_indruk" || c.key === "einde")) directions.push("Kies een moment uit dezelfde opname waar het hoogtepunt én de uitkomst in gameplay te zien zijn (geen menu).");
    if (weak) directions.push("Combineer dit met een sterker moment in een lange video, of laat het weg.");
  }
  const summary = status === "AFGEKEURD" ? `${[...critical.map((c) => c.reason), ...(weak ? [`Te zwak moment (${e.payoff} punten).`] : [])].join(" ")}` : status === "PROEFOPNAME" ? `Proefmontage: ${checks.filter((c) => c.verdict === "ONBEWEZEN" && c.key !== "originaliteit").map((c) => c.label.toLowerCase()).join(", ") || `zwak moment (${e.payoff} punten)`} nog onbewezen; geslaagd als de eindredacteur de uitkomst en de aanloop in de export ziet.` : "Alle meetbare controles geslaagd.";
  return { status, checks, summary, directions };
}
