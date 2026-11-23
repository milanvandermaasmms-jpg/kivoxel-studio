// 23-11-2026 (Milan, superprompt V5, fase 11-13): the production briefing he gives with every upload. One structured
// object, stored with the recording's intake job (yt_jobs.payload.briefing, no migration needed) and read by every step:
// analysis (look for the key event and his time marks), planning (which videos, which moments first), script (his story
// and edit notes, mood), voice and music (his choice beats the automatic split), and afterwards the fidelity check
// (did the montage follow each instruction). His words are direction, never proof: the analysis must SEE the event.
// Pure, tested. App texts Dutch; everything that goes into a video prompt is English (video content is always English).

export const GAMEPLAY_TYPES = ["survival", "hardcore", "speedrun", "horror", "obby", "pvp", "battle_royale", "challenge", "adventure", "funny", "roleplay", "exploration", "other"] as const;
export type GameplayType = (typeof GAMEPLAY_TYPES)[number];
export const GAMEPLAY_LABEL: Record<GameplayType, string> = { survival: "Survival", hardcore: "Hardcore", speedrun: "Speedrun", horror: "Horror", obby: "Obby", pvp: "PvP", battle_royale: "Battle Royale", challenge: "Challenge", adventure: "Avontuur", funny: "Grappige momenten", roleplay: "Roleplay", exploration: "Ontdekking", other: "Anders" };
/** Which types fit which game (the form only shows these). */
export const TYPES_FOR_GAME: Record<string, GameplayType[]> = {
  minecraft: ["survival", "hardcore", "speedrun", "horror", "adventure", "exploration", "challenge", "funny", "pvp", "other"],
  roblox: ["obby", "horror", "roleplay", "funny", "challenge", "adventure", "pvp", "other"],
  fortnite: ["battle_royale", "pvp", "funny", "challenge", "other"],
  gta: ["adventure", "funny", "roleplay", "challenge", "other"],
  cod: ["pvp", "battle_royale", "funny", "challenge", "other"],
};

export const MOODS = ["spannend", "grappig", "mysterieus", "explosief", "avontuurlijk", "rustig", "filmisch", "informatief"] as const;
export type BriefMood = (typeof MOODS)[number];
const MOOD_EN: Record<BriefMood, string> = { spannend: "tense", grappig: "funny", mysterieus: "mysterious", explosief: "high-energy", avontuurlijk: "adventurous", rustig: "calm", filmisch: "cinematic", informatief: "informative" };

export const OUTPUTS = ["auto", "shorts", "long", "both", "many_shorts", "highlights"] as const;
export type Output = (typeof OUTPUTS)[number];
export const OUTPUT_LABEL: Record<Output, string> = { auto: "Automatisch", shorts: "Alleen Shorts", long: "Alleen lange video", both: "Shorts + lange video", many_shorts: "Meerdere Shorts", highlights: "Highlightcompilatie" };

export const VOICE_PREFS = ["auto", "none", "voice", "reactions"] as const;
export type VoicePref = (typeof VOICE_PREFS)[number];
export const VOICE_LABEL: Record<VoicePref, string> = { auto: "Automatisch (1 op 3 Shorts, 1 op 5 lang)", none: "Geen voice-over", voice: "Wel voice-over", reactions: "Alleen korte reacties" };

export const MUSIC_PREFS = ["auto", "tense", "funny", "calm", "mystery", "none"] as const;
export type MusicPref = (typeof MUSIC_PREFS)[number];
export const MUSIC_LABEL: Record<MusicPref, string> = { auto: "Automatisch", tense: "Spannende muziek", funny: "Grappige muziek", calm: "Rustige muziek", mystery: "Mystery", none: "Geen muziek" };
/** Track moods (lib/kivoxel/media.ts) that fit each choice, best first. */
export const MUSIC_MOODS: Record<Exclude<MusicPref, "auto" | "none">, string[]> = { tense: ["tense", "dark", "epic"], funny: ["funny", "happy"], calm: ["chill"], mystery: ["dark", "tense"] };

export type Mark = { atMs: number; note: string };
export type Briefing = {
  v: 1;
  game?: string;
  gameplay?: GameplayType;
  /** "Wat gebeurt er in deze opname?" */
  story?: string;
  /** "Speciale instructies voor de montage" */
  editNotes?: string;
  /** "Welke gebeurtenis is het belangrijkste?" */
  keyEvent?: string;
  marks?: Mark[];
  moods?: BriefMood[];
  output?: Output;
  /** How many Shorts at most (output shorts / many_shorts / both). */
  shorts?: number;
  voice?: VoicePref;
  music?: MusicPref;
  extra?: string;
  /** Instructions Milan let go on purpose after the fidelity check (keys of BriefCheck). */
  waived?: string[];
  at?: string;
};

/** What the analysis found for the key event; never filled in from Milan's words alone. */
export type KeyEventFind = { found: boolean; atMs: number | null; evidence: string };

const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | undefined => (typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : undefined);

/** "2:30", "02:30", "1:02:30" or "150" (seconds) to ms; null when it is no time. */
export function parseTimecode(s: string): number | null {
  const t = s.trim();
  if (/^\d+$/.test(t)) return Number(t) * 1000;
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(t);
  if (!m || Number(m[3]) > 59) return null;
  return ((Number(m[1] ?? 0) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000;
}

export const formatMs = (ms: number) => {
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, "0");
  return `${h ? `${h}:` : ""}${mm}:${String(s % 60).padStart(2, "0")}`;
};

/** Lines like "02:30 grappig moment" (one per line) to marks; lines without a valid time are returned as rejected. */
export function parseMarks(input: string): { marks: Mark[]; rejected: string[] } {
  const marks: Mark[] = [];
  const rejected: string[] = [];
  for (const raw of input.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(\d+(?::\d{1,2}){0,2})\s*(?:[-–—:]\s*)?(.*)$/.exec(line);
    const at = m ? parseTimecode(m[1]) : null;
    if (at === null || !m) rejected.push(line);
    else marks.push({ atMs: at, note: m[2].trim().slice(0, 120) });
  }
  return { marks: marks.sort((a, b) => a.atMs - b.atMs).slice(0, 30), rejected };
}

/** Accepts anything (job payload from the database) and returns a clean briefing, or null when nothing was given. */
export function parseBriefing(input: unknown): Briefing | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  const marks = Array.isArray(o.marks) ? o.marks.filter((m): m is Mark => !!m && typeof (m as Mark).atMs === "number" && (m as Mark).atMs >= 0).map((m) => ({ atMs: Math.round(m.atMs), note: String(m.note ?? "").slice(0, 120) })).slice(0, 30) : [];
  const moods = Array.isArray(o.moods) ? o.moods.filter((m): m is BriefMood => (MOODS as readonly string[]).includes(m as string)) : [];
  const shorts = typeof o.shorts === "number" && o.shorts >= 1 ? Math.min(12, Math.round(o.shorts)) : undefined;
  const b: Briefing = {
    v: 1,
    game: text(o.game, 40),
    gameplay: oneOf(GAMEPLAY_TYPES, o.gameplay),
    story: text(o.story, 2000),
    editNotes: text(o.editNotes, 1500),
    keyEvent: text(o.keyEvent, 300),
    marks: marks.length ? marks : undefined,
    moods: moods.length ? [...new Set(moods)] : undefined,
    output: oneOf(OUTPUTS, o.output),
    shorts,
    voice: oneOf(VOICE_PREFS, o.voice),
    music: oneOf(MUSIC_PREFS, o.music),
    extra: text(o.extra, 1500),
    waived: Array.isArray(o.waived) ? o.waived.filter((w): w is string => typeof w === "string").slice(0, 20) : undefined,
    at: text(o.at, 40),
  };
  const given = b.gameplay || b.story || b.editNotes || b.keyEvent || b.marks || b.moods || (b.output && b.output !== "auto") || (b.voice && b.voice !== "auto") || (b.music && b.music !== "auto") || b.extra;
  return given ? b : null;
}

/** For the analysis (Gemini): Milan's direction, his marks first, and a separate answer about the key event. */
export function briefingAnalysisLines(b: Briefing | null, chunk?: { startMs: number; endMs: number; count: number }): string[] {
  if (!b) return [];
  const out = ["The channel owner gave a briefing (in Dutch). Use it as DIRECTION for where to look, never as proof: report only what you can see or hear yourself."];
  if (b.gameplay) out.push(`Type of gameplay according to the owner: ${b.gameplay}.`);
  if (b.story) out.push(`What happens in this recording according to the owner: "${b.story}"`);
  if (b.editNotes) out.push(`What the edit should focus on: "${b.editNotes}"`);
  const inChunk = (b.marks ?? []).filter((m) => !chunk || chunk.count <= 1 || (m.atMs >= chunk.startMs && m.atMs < chunk.endMs));
  if (inChunk.length) {
    const rel = (ms: number) => formatMs(chunk && chunk.count > 1 ? ms - chunk.startMs : ms);
    out.push(`Check these moments first (times in this clip): ${inChunk.map((m) => `${rel(m.atMs)}${m.note ? ` (${m.note})` : ""}`).join("; ")}. Report each one that really is a usable moment, and keep looking at the rest of the clip for better ones.`);
  }
  if (b.keyEvent)
    out.push(
      `The owner says the most important event is: "${b.keyEvent}". Look for it. On every moment that IS this event, add "matches_key_event": true. Also add to your JSON "key_event": {"found": true|false, "at": "MM:SS" (the instant it is clearly visible, only when found), "evidence": "what you see on screen that proves it"}. Say found=false when you do not clearly see it; never guess.`,
    );
  return out;
}

/** The key event from one analysis answer (times relative to the chunk, like the moments). */
export function parseKeyEvent(json: unknown, chunkStartMs = 0): KeyEventFind | null {
  const k = (json as { key_event?: unknown } | null)?.key_event as { found?: unknown; at?: unknown; evidence?: unknown } | undefined;
  if (!k || typeof k !== "object") return null;
  const at = typeof k.at === "string" ? parseTimecode(k.at) : null;
  const evidence = typeof k.evidence === "string" ? k.evidence.trim().slice(0, 300) : "";
  const found = k.found === true && at !== null && evidence.length > 0;
  return { found, atMs: found ? at! + chunkStartMs : null, evidence };
}

/**
 * 23-11-2026, first real test: Gemini returned four falls as moments but left "key_event" empty, so the studio said
 * "not found". A moment it marked with matches_key_event counts as the key event too (its peak, with its reason as
 * evidence); the explicit answer still wins when it is there and found.
 */
export function keyEventFromMoments(json: unknown, chunkStartMs = 0): KeyEventFind | null {
  const list = (json as { moments?: unknown } | null)?.moments;
  if (!Array.isArray(list)) return null;
  const hit = list.find((m) => (m as { matches_key_event?: unknown })?.matches_key_event === true) as { peak?: unknown; start?: unknown; reason?: unknown } | undefined;
  if (!hit) return null;
  const at = typeof hit.peak === "string" ? parseTimecode(hit.peak) : typeof hit.start === "string" ? parseTimecode(hit.start) : null;
  const evidence = typeof hit.reason === "string" ? hit.reason.trim().slice(0, 300) : "";
  return at !== null && evidence ? { found: true, atMs: at + chunkStartMs, evidence } : null;
}

/** Over all chunks: the first found answer wins; else "not found". */
export function mergeKeyEvents(finds: (KeyEventFind | null)[]): KeyEventFind | null {
  const all = finds.filter((f): f is KeyEventFind => !!f);
  if (!all.length) return null;
  return all.find((f) => f.found) ?? { found: false, atMs: null, evidence: all.map((f) => f.evidence).filter(Boolean)[0] ?? "" };
}

type Span = { startMs: number; endMs: number; peakMs?: number | null };
/** Extra planning points for a moment: the found key event first, then Milan's marks (both near the moment). */
export function briefingBoost(b: Briefing | null, key: KeyEventFind | null, m: Span): number {
  if (!b) return 0;
  let p = 0;
  if (key?.found && key.atMs !== null && key.atMs >= m.startMs - 5000 && key.atMs <= m.endMs + 5000) p += 60;
  if ((b.marks ?? []).some((x) => x.atMs >= m.startMs - 5000 && x.atMs <= m.endMs + 5000)) p += 30;
  return p;
}

/** Which planned videos to make, after Milan's output choice. Plans come best first per format (planVideos). */
export function filterPlans<T extends { format: string }>(plans: T[], b: Briefing | null): { plans: T[]; note: string | null } {
  const out = b?.output ?? "auto";
  if (out === "auto") return { plans, note: null };
  const shorts = plans.filter((p) => p.format !== "C");
  const long = plans.filter((p) => p.format === "C");
  const max = b?.shorts ?? (out === "many_shorts" ? 6 : out === "highlights" ? 1 : 3);
  let keep: T[];
  if (out === "shorts" || out === "many_shorts") keep = shorts.slice(0, max);
  else if (out === "long") keep = long;
  else if (out === "highlights") keep = long.length ? long : shorts.slice(0, 1);
  else keep = [...shorts.slice(0, max), ...long];
  const note = keep.length ? `Briefing: ${OUTPUT_LABEL[out]} (${keep.filter((p) => p.format !== "C").length} Shorts, ${keep.filter((p) => p.format === "C").length} lang)` : `Briefing: ${OUTPUT_LABEL[out]}, maar daarvoor heeft deze opname geen geschikt moment; niets gepland`;
  return { plans: keep, note };
}

/** For the script writer (English): the arc, the edit notes, the mood, and what was or was not found of the key event. */
export function briefingScriptLines(b: Briefing | null, key: KeyEventFind | null): string[] {
  if (!b) return [];
  const out = ["The owner's briefing for this recording (in Dutch; follow it, but only describe what the event list really shows):"];
  if (b.story) out.push(`- What happens: "${b.story}"`);
  if (b.editNotes) out.push(`- Edit instructions: "${b.editNotes}"`);
  if (b.moods?.length) out.push(`- Mood: ${b.moods.map((m) => MOOD_EN[m]).join(", ")}.`);
  if (b.gameplay) out.push(`- Type: ${b.gameplay}.`);
  if (b.keyEvent) {
    if (key?.found && key.atMs !== null) out.push(`- The most important event ("${b.keyEvent}") was seen at ${formatMs(key.atMs)} of the recording (${key.evidence}). Build towards it and make it the clear high point; do not reveal it in the first line.`);
    else out.push(`- The owner named "${b.keyEvent}" as the most important event, but the analysis did NOT see it. Never mention it or claim it happens.`);
  }
  if (b.voice === "reactions") out.push("- Voice: only short reactions (at most 5 words per line), no narration.");
  if (b.extra) out.push(`- Extra: "${b.extra}"`);
  return out;
}

/** The audio mode Milan's voice and music choice ask for, or null (automatic). */
export function briefingAudioMode(b: Briefing | null): "vo_muziek" | "vo_met_muziek" | "muziek_geen_vo" | "alleen_game" | null {
  const v = b?.voice ?? "auto";
  if (v === "voice" || v === "reactions") return b?.music && b.music !== "auto" && b.music !== "none" ? "vo_met_muziek" : "vo_muziek";
  if (v === "none") return b?.music === "none" ? "alleen_game" : "muziek_geen_vo";
  return null;
}

/** The music library narrowed to Milan's choice; the whole library (with a note) when nothing fits. */
export function musicForBriefing<T extends { moods: readonly string[] }>(library: T[], b: Briefing | null): { tracks: T[]; note: string | null } {
  const pref = b?.music ?? "auto";
  if (pref === "auto" || pref === "none") return { tracks: library, note: null };
  const fits = library.filter((t) => t.moods.some((m) => MUSIC_MOODS[pref].includes(m)));
  return fits.length ? { tracks: fits, note: `Briefing: ${MUSIC_LABEL[pref].toLowerCase()} (${fits.length} passende tracks)` } : { tracks: library, note: `Briefing vraagt ${MUSIC_LABEL[pref].toLowerCase()}, maar de bibliotheek heeft geen passende track` };
}

/** What the finished montage really has, measured by the worker. */
export type MontageFacts = {
  format: string;
  hasVoice: boolean;
  /** Track moods of the music in the mix; null = no music. */
  musicMoods: string[] | null;
  /** Source ranges (recording ms) the montage shows. */
  ranges: { startMs: number; endMs: number }[];
  /** Where the main high point lands in the export (ms), if known. */
  peakOutMs: number | null;
  /** Export duration (ms). */
  durationMs: number;
  /** Words of the voice-over lines, for "reactions". */
  lines: string[];
};
export type BriefCheck = { key: string; instruction: string; status: "ok" | "niet" | "onbekend" | "vervallen"; why: string };

const inRanges = (ms: number, ranges: MontageFacts["ranges"], pad = 0) => ranges.some((r) => ms >= r.startMs - pad && ms <= r.endMs + pad);

/**
 * Fase 13, instruction fidelity: per instruction, did the montage follow it? "niet" blocks automatic approval (the
 * eindredacteur shows "Correctie nodig" with the reason); "onbekend" = cannot be measured, Milan judges; "vervallen" =
 * Milan let it go on purpose.
 */
export function briefingCheck(b: Briefing | null, key: KeyEventFind | null, f: MontageFacts): BriefCheck[] {
  if (!b) return [];
  const out: BriefCheck[] = [];
  const add = (c: BriefCheck) => out.push(b.waived?.includes(c.key) ? { ...c, status: "vervallen", why: `Bewust laten vervallen. ${c.why}` } : c);
  if (b.keyEvent) {
    if (!key?.found || key.atMs === null) add({ key: "key_event", instruction: `Belangrijkste gebeurtenis: ${b.keyEvent}`, status: "niet", why: "De analyse heeft deze gebeurtenis niet in beeld gezien; de montage kan er niet om draaien. Geef een tijdcode of kies een ander moment." });
    else if (!inRanges(key.atMs, f.ranges, 1500)) add({ key: "key_event", instruction: `Belangrijkste gebeurtenis: ${b.keyEvent}`, status: "niet", why: `Gezien op ${formatMs(key.atMs)} van de opname, maar dat stuk zit niet in deze montage.` });
    else add({ key: "key_event", instruction: `Belangrijkste gebeurtenis: ${b.keyEvent}`, status: "ok", why: `Het moment van ${formatMs(key.atMs)} (${key.evidence}) zit in de montage.` });
  }
  const marks = b.marks ?? [];
  if (marks.length && f.format !== "C") {
    const hit = marks.filter((m) => inRanges(m.atMs, f.ranges, 3000));
    add({ key: "marks", instruction: `Tijdcodes (${marks.map((m) => formatMs(m.atMs)).join(", ")})`, status: hit.length ? "ok" : "onbekend", why: hit.length ? `${hit.map((m) => formatMs(m.atMs)).join(", ")} zit in deze Short.` : "Deze Short toont een ander moment; de tijdcodes kunnen in een andere Short van deze opname zitten." });
  } else if (marks.length) {
    const miss = marks.filter((m) => !inRanges(m.atMs, f.ranges, 3000));
    add({ key: "marks", instruction: `Tijdcodes (${marks.map((m) => formatMs(m.atMs)).join(", ")})`, status: miss.length ? "niet" : "ok", why: miss.length ? `Niet in de video: ${miss.map((m) => `${formatMs(m.atMs)}${m.note ? ` (${m.note})` : ""}`).join(", ")}.` : "Alle aangewezen momenten zitten in de video." });
  }
  const v = b.voice ?? "auto";
  if (v === "none") add({ key: "voice", instruction: "Geen voice-over", status: f.hasVoice ? "niet" : "ok", why: f.hasVoice ? "Er zit toch een stem in deze versie." : "Geen gegenereerde stem in de mix." });
  if (v === "voice") add({ key: "voice", instruction: "Wel voice-over", status: f.hasVoice ? "ok" : "niet", why: f.hasVoice ? "De Engelse voice-over zit in de mix." : "Deze versie heeft geen stem." });
  if (v === "reactions") {
    const long = f.lines.filter((l) => l.split(/\s+/).filter(Boolean).length > 6);
    add({ key: "voice", instruction: "Alleen korte reacties", status: !f.hasVoice ? "niet" : long.length ? "niet" : "ok", why: !f.hasVoice ? "Deze versie heeft geen stem." : long.length ? `Te lange zinnen: "${long[0]}"` : "Alle stemzinnen zijn korte reacties." });
  }
  const m = b.music ?? "auto";
  if (m === "none") add({ key: "music", instruction: "Geen muziek", status: f.musicMoods ? "niet" : "ok", why: f.musicMoods ? "Er zit toch muziek in de mix." : "Geen muziek in de mix." });
  else if (m !== "auto") {
    const fits = f.musicMoods?.some((x) => MUSIC_MOODS[m].includes(x));
    add({ key: "music", instruction: MUSIC_LABEL[m], status: !f.musicMoods ? "niet" : fits ? "ok" : "niet", why: !f.musicMoods ? "Deze versie heeft geen muziek." : fits ? `De track past (${f.musicMoods.join(", ")}).` : `De track is ${f.musicMoods.join(", ")}; dat is geen ${MUSIC_LABEL[m].toLowerCase()}.` });
  }
  if (b.output === "long" && f.format !== "C") add({ key: "output", instruction: OUTPUT_LABEL.long, status: "niet", why: "Dit is een Short." });
  if ((b.output === "shorts" || b.output === "many_shorts") && f.format === "C") add({ key: "output", instruction: OUTPUT_LABEL[b.output], status: "niet", why: "Dit is een lange video." });
  // Mood, story and free notes cannot be measured by the worker: Milan judges them, listed so nothing is forgotten.
  if (b.moods?.length) add({ key: "moods", instruction: `Sfeer: ${b.moods.join(", ")}`, status: "onbekend", why: "Niet meetbaar; kijk zelf of de sfeer klopt." });
  if (b.editNotes) add({ key: "edit_notes", instruction: `Montage-instructie: ${b.editNotes.slice(0, 120)}`, status: "onbekend", why: "Meegegeven aan analyse en script; beoordeel zelf of de montage het volgt." });
  return out;
}

/** One line for the review screen. */
export function briefingVerdict(checks: BriefCheck[]): { ok: boolean; text: string } {
  const bad = checks.filter((c) => c.status === "niet");
  if (!checks.length) return { ok: true, text: "Geen briefing bij deze opname." };
  return bad.length ? { ok: false, text: `Briefing niet gevolgd: ${bad.map((c) => `${c.instruction} — ${c.why}`).join(" · ")}` } : { ok: true, text: `Briefing gevolgd (${checks.filter((c) => c.status === "ok").length} gemeten, ${checks.filter((c) => c.status === "onbekend").length} zelf beoordelen).` };
}

/** Short Dutch summary for lists. */
export function briefingSummary(b: Briefing | null): string {
  if (!b) return "Geen briefing";
  return [b.gameplay && GAMEPLAY_LABEL[b.gameplay], b.keyEvent && `hoogtepunt: ${b.keyEvent}`, b.marks?.length && `${b.marks.length} tijdcodes`, b.moods?.join("/"), b.output && b.output !== "auto" && OUTPUT_LABEL[b.output], b.voice && b.voice !== "auto" && VOICE_LABEL[b.voice], b.music && b.music !== "auto" && MUSIC_LABEL[b.music]].filter(Boolean).join(" · ");
}
