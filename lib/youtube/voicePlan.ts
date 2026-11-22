// 23-11-2026 (Milan): an exact voice-over split per channel. Shorts: 1 of every 3 with an English voice-over, 2 without.
// Long videos: 1 of every 5. Every consecutive group of 3 Shorts (or 5 videos) gets exactly one voiced production: the
// one where telling adds the most (a decision the viewer cannot see the reason for, a plan that fails, a find that needs
// context). A chase that is fully readable on screen stays with game sound, footsteps and music. Productions arrive one
// by one, so open places are remembered and the last place of a group is kept for the voice when none came yet.
// The choice is stored per production (video id): a preview, retry, rejection or version 2 never counts twice; a
// production that is dropped for good gives its place back. Pure functions, tested.

export type VoiceFormat = "short" | "long";
export const GROUP_SIZE: Record<VoiceFormat, number> = { short: 3, long: 5 };
/** From this "how much does telling add" value (0-1) a production gets the voice of its group right away. */
export const TELL_THRESHOLD = 0.6;

export type Slot = { videoId: string; voice: boolean; at: string; reason: string; released?: boolean; delivered?: boolean };
export type VoiceLedger = Record<string, Slot[]>;
export const ledgerKey = (channelId: string, format: VoiceFormat) => `${channelId}:${format}`;

/**
 * How much a narrator adds to this moment (0-1), from what the analysis saw. Kinds of moments (yt_moments) and event
 * types (Event Timeline) both count; the description can add a hint (a plan, a choice, a find).
 */
export function narrationValue(input: { kind?: string | null; type?: string | null; description?: string | null }): { value: number; why: string } {
  const byKind: Record<string, [number, string]> = {
    mistake: [0.8, "een plan dat mislukt: de verteller maakt de fout begrijpelijk"],
    discovery: [0.75, "een vondst die context nodig heeft"],
    rare_find: [0.7, "een zeldzame vondst: uitleggen waarom die bijzonder is"],
    build_result: [0.7, "een bouwresultaat: wat je ziet krijgt betekenis met uitleg"],
    rescue: [0.6, "een redding: de keuze achter de actie"],
    escape: [0.35, "een ontsnapping die je op beeld kunt volgen"],
    near_death: [0.3, "spanning die het beeld en geluid zelf dragen"],
    surprise: [0.25, "een verrassing: het geluid vertelt het al"],
  };
  const byType: Record<string, [number, string]> = {
    bouw: [0.7, "een bouwmoment met uitleg"],
    geluk: [0.6, "geluk: context maakt het bijzonder"],
    fail: [0.55, "een mislukking: waarom het misging"],
    grap: [0.4, "een grap die vooral in beeld zit"],
    bijna_dood: [0.3, "spanning die het beeld en geluid zelf dragen"],
    jumpscare: [0.15, "een schrikmoment: de stilte en het geluid moeten blijven"],
  };
  const k = input.kind ? byKind[input.kind] : undefined;
  const t = input.type ? byType[input.type] : undefined;
  let [value, why] = k ?? t ?? [0.4, "onbekend soort moment"];
  if (/\b(plan|decide|decision|choos|why|trade|craft|recipe|build|loot|chest|map|secret)\b/i.test(input.description ?? "")) {
    value = Math.min(1, value + 0.1);
    why += "; de beschrijving noemt een keuze of vondst";
  }
  return { value: Math.round(value * 100) / 100, why };
}

const active = (slots: Slot[]) => slots.filter((s) => !s.released);

/**
 * The voice choice for one production. Already decided before (retry, version 2, preview)? Then that choice, unchanged.
 * Else: in the current group, a voice when none yet and telling adds enough, or when this is the last place of the group
 * and the group still has no voice.
 */
export function decideVoice(ledger: VoiceLedger, key: string, format: VoiceFormat, videoId: string, tell: { value: number; why: string }, now: Date): { ledger: VoiceLedger; slot: Slot; existing: boolean } {
  const slots = ledger[key] ?? [];
  const known = slots.find((s) => s.videoId === videoId && !s.released);
  if (known) return { ledger, slot: known, existing: true };
  const size = GROUP_SIZE[format];
  const list = active(slots);
  const pos = list.length % size;
  const group = list.slice(list.length - pos);
  const hasVoice = group.some((s) => s.voice);
  let voice = false;
  let reason: string;
  if (hasVoice) reason = `groep heeft al een stemversie (plek ${pos + 1} van ${size})`;
  else if (tell.value >= TELL_THRESHOLD) {
    voice = true;
    reason = `stemversie van deze groep: ${tell.why} (plek ${pos + 1} van ${size})`;
  } else if (pos === size - 1) {
    voice = true;
    reason = `laatste plek van de groep was nog vrij voor de stemversie (plek ${size} van ${size}); ${tell.why}`;
  } else reason = `zonder stem: ${tell.why} (plek ${pos + 1} van ${size}; de stem komt later in deze groep)`;
  const slot: Slot = { videoId, voice, at: now.toISOString(), reason };
  return { ledger: { ...ledger, [key]: [...slots.filter((s) => s.videoId !== videoId), slot] }, slot, existing: false };
}

/** A production dropped for good (archived without a new montage): its place is free again. */
export function releaseSlot(ledger: VoiceLedger, key: string, videoId: string): VoiceLedger {
  const slots = ledger[key];
  if (!slots?.some((s) => s.videoId === videoId && !s.released)) return ledger;
  return { ...ledger, [key]: slots.map((s) => (s.videoId === videoId ? { ...s, released: true } : s)) };
}

/** A montage of this production is finished (counts as delivered once, however many versions follow). */
export function markDelivered(ledger: VoiceLedger, key: string, videoId: string): VoiceLedger {
  const slots = ledger[key];
  if (!slots?.some((s) => s.videoId === videoId && !s.delivered)) return ledger;
  return { ...ledger, [key]: slots.map((s) => (s.videoId === videoId ? { ...s, delivered: true } : s)) };
}

/** Planned and delivered split for the studio: "1 van 3 met stem". */
export function voiceSummary(ledger: VoiceLedger, key: string, format: VoiceFormat) {
  const list = active(ledger[key] ?? []);
  const delivered = list.filter((s) => s.delivered);
  const size = GROUP_SIZE[format];
  return {
    planned: { voice: list.filter((s) => s.voice).length, total: list.length },
    delivered: { voice: delivered.filter((s) => s.voice).length, total: delivered.length },
    openInGroup: list.length % size === 0 ? 0 : size - (list.length % size),
    groupHasVoice: list.slice(list.length - (list.length % size)).some((s) => s.voice),
  };
}
