// 24-11-2026 (superprompt: "controle per zin op 7 punten"): every voice line checked against Milan's tone rules of
// 23-11-2026 (sounds like someone who knows the game; every sentence one job, specific for this recording, never giving
// the reveal away, natural spoken English, silence allowed, no generic shouting, kid-friendly) plus its timing.
// Before speaking, a line that breaks a hard rule takes a shorter version that passes, or is left out (silence is
// allowed); only shouting in capitals is softened in place. Pure, tested.

import { looksDutch } from "./config.ts";

export type LinePoint = { key: "english" | "one_job" | "specific" | "no_spoiler" | "natural" | "kid_safe" | "timing"; label: string; ok: boolean; why: string | null };
export type LineCheck = { text: string; points: LinePoint[]; score: number };
type Line = { text: string; kind?: string; alts?: string[] };

/** Hard rules: a line that breaks one of these is never spoken. */
const HARD: LinePoint["key"][] = ["english", "no_spoiler", "natural", "kid_safe"];

const words = (t: string) => t.trim().split(/\s+/).filter(Boolean);
/** A line made only of generic exclamations fits any clip: it says nothing about this recording. */
const GENERIC = /^(oh( my (god|gosh))?|no+|no way|wow+|what+|let'?s go+|yes+|insane|crazy|epic|bro|omg|whoa+|huh|nice|what is (this|that)|this is (insane|crazy|epic))[\s!?.…,]*$/i;
/** Outcome words: said before the moment, they give the reveal away. */
const OUTCOME = /\b(dies|died|dead|death|survives?|survived|made it|makes it|wins?|won|victory|explodes|exploded|blows? up|blew up|fell|falls to|gets? eliminated|got eliminated|game over|respawn(s|ed)?)\b/i;
/** Never in a kids' channel voice (2026-11 KID_SAFE: eliminated/knocked/took out instead). */
const UNSAFE = /\b(kill(s|ed|ing|er)?|blood(y)?|murder(s|ed)?|guns?|shoot(s|ing)?|shot (him|her|them)|stab(s|bed)?|gore|damn|hell|stupid|idiot|shut up|dumb)\b/i;
/** Short words that are written in capitals anyway (TNT, PVP, MLG, PS5, OP). */
const CAPS_OK = /^(TNT|PVP|MLG|PS5|XP|HP|OP|GG|AFK|NPC|TP|OK|I|A)$/;

export function checkLine(line: Line, timing?: { ok: boolean; reason: string | null } | null): LineCheck {
  const t = line.text.trim();
  const w = words(t);
  const before = line.kind === "anticipation" || line.kind === "hook";
  const shouting = w.filter((x) => /[A-Z]{3,}/.test(x) && x.replace(/[^A-Za-z0-9]/g, "") === x.replace(/[^A-Za-z0-9]/g, "").toUpperCase() && !CAPS_OK.test(x.replace(/[^A-Za-z0-9]/g, "")));
  const spoiler = before ? OUTCOME.exec(t) : null;
  const unsafe = UNSAFE.exec(t);
  // Short separate sentences ("Yep. There it goes.") are natural speech; a long chain ("... and then ... and then") is not.
  const chained = w.length > 8 && (/\band then\b/i.test(t) || (t.match(/[.;]\s+\S/g) ?? []).length >= 2);
  const points: LinePoint[] = [
    { key: "english", label: "Engels", ok: !looksDutch(t), why: looksDutch(t) ? "lijkt Nederlands" : null },
    { key: "one_job", label: "Eén taak", ok: w.length <= 14 && !chained, why: w.length > 14 ? `${w.length} woorden (max 14)` : chained ? "meerdere zinnen aan elkaar geregen" : null },
    { key: "specific", label: "Specifiek", ok: !GENERIC.test(t), why: GENERIC.test(t) ? "algemene kreet die bij elke clip past" : null },
    { key: "no_spoiler", label: "Verklapt niets", ok: !spoiler, why: spoiler ? `"${spoiler[0]}" vóór het moment verklapt de afloop` : null },
    { key: "natural", label: "Natuurlijk gesproken", ok: !shouting.length && !/[!?]{2,}/.test(t) && !/#\w|\p{Extended_Pictographic}/u.test(t), why: shouting.length ? `geschreeuw in hoofdletters (${shouting.slice(0, 2).join(", ")})` : /[!?]{2,}/.test(t) ? "meerdere uitroeptekens" : /#\w|\p{Extended_Pictographic}/u.test(t) ? "hashtag of emoji in gesproken tekst" : null },
    { key: "kid_safe", label: "Kindvriendelijk", ok: !unsafe, why: unsafe ? `"${unsafe[0]}" past niet bij een kinderkanaal` : null },
    { key: "timing", label: "Past in de tijd", ok: timing ? timing.ok : true, why: timing && !timing.ok ? timing.reason : null },
  ];
  return { text: t, points, score: points.filter((p) => p.ok).length };
}

/** Softens shouting in capitals and stacked marks in place ("NO WAY!!!" -> "No way!"); the words stay the same. */
export function soften(text: string): string {
  const lowered = text.replace(/\b[A-Z][A-Z']+\b/g, (x) => (CAPS_OK.test(x) ? x : x.toLowerCase())).replace(/([!?])[!?]+/g, "$1");
  // The sentence starts with a capital again ("no way" -> "No way"); "I" stays a capital.
  return lowered.replace(/^(\W*)([a-z])/, (_m, pre: string, c: string) => pre + c.toUpperCase()).replace(/\bi\b/g, "I");
}

const hardOk = (c: LineCheck) => c.points.every((p) => !HARD.includes(p.key) || p.ok);

/**
 * Before speaking: every line that breaks a hard rule is fixed. Shouting is softened in place; otherwise its first
 * shorter version that passes takes its place; with none, the line is left out (silence is allowed).
 */
export function repairLines<T extends Line>(lines: T[]): { lines: T[]; changes: string[] } {
  const out: T[] = [];
  const changes: string[] = [];
  for (const l of lines) {
    let line: T = l;
    let c = checkLine(line);
    if (!hardOk(c) && !c.points.find((p) => p.key === "natural")!.ok) {
      const soft = { ...line, text: soften(line.text) };
      if (soft.text !== line.text) {
        changes.push(`"${line.text}" zachter gemaakt`);
        line = soft;
        c = checkLine(line);
      }
    }
    // Its shorter versions (the sync gate takes them when time is short) must pass the hard rules too.
    const passing = (line.alts ?? []).filter((a) => hardOk(checkLine({ ...line, text: a })));
    if (hardOk(c)) {
      out.push(line.alts && passing.length !== line.alts.length ? { ...line, alts: passing } : line);
      continue;
    }
    const why = c.points.filter((p) => HARD.includes(p.key) && !p.ok).map((p) => p.why).join(", ");
    if (passing.length) {
      changes.push(`"${line.text}" vervangen door "${passing[0]}" (${why})`);
      out.push({ ...line, text: passing[0], alts: passing.slice(1) });
    } else changes.push(`"${line.text}" weggelaten (${why})`);
  }
  return { lines: out, changes };
}

/** One line for the QC list: green when every line passes all 7 points, orange with soft notes, red when a hard rule is broken. */
export function lineCheckQc(checks: LineCheck[]): { level: "green" | "orange" | "red"; value: string; note: string } {
  const full = checks.filter((c) => c.score === 7).length;
  const hard = checks.filter((c) => !hardOk(c));
  const notes = checks
    .filter((c) => c.score < 7)
    .slice(0, 4)
    .map((c) => `"${c.text.slice(0, 40)}": ${c.points.filter((p) => !p.ok).map((p) => p.why ?? p.label).join(", ")}`);
  return { level: hard.length ? "red" : full === checks.length ? "green" : "orange", value: `${full} van ${checks.length} zinnen 7/7`, note: notes.join("; ").slice(0, 400) };
}
