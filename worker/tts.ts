// Google Cloud Text-to-Speech (Chirp 3 HD), only within the free tier: 1 million characters per month
// (approved by Milan on 11-11-2026, cap € 0). The key lives in worker/.env.local as GOOGLE_TTS_API_KEY.
// This pc counts every character it sends and refuses above FREE_CHARS_LIMIT, a margin below the free tier.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const ENDPOINT = "https://texttospeech.googleapis.com/v1/text:synthesize";
export const FREE_CHARS_LIMIT = 900_000;
/** Google refuses longer inputs per request; script lines are far shorter. */
export const MAX_REQUEST_CHARS = 4500;

/** Google counts per calendar month; UTC keeps the counter the same on every pc. */
export const monthKey = (now = new Date()) => now.toISOString().slice(0, 7);

/** "en-US-Chirp3-HD-Charon" -> "en-US". */
export const voiceLanguage = (voiceName: string) => /^([a-z]{2}-[A-Z]{2})-/.exec(voiceName)?.[1] ?? "en-US";

export type UsageFile = { month: string; characters: number };

/** Pure check: the new total, or the reason it is refused. */
export function allow(usage: UsageFile | null, characters: number, now = new Date(), limit = FREE_CHARS_LIMIT): { ok: true; next: UsageFile } | { ok: false; reason: string } {
  const month = monthKey(now);
  const used = usage?.month === month ? usage.characters : 0;
  if (used + characters > limit)
    return { ok: false, reason: `Stem overgeslagen: deze maand zijn al ${used.toLocaleString("nl-NL")} tekens gebruikt; met ${characters.toLocaleString("nl-NL")} erbij gaat het boven de veilige grens van ${limit.toLocaleString("nl-NL")} (het gratis deel is 1 miljoen).` };
  return { ok: true, next: { month, characters: used + characters } };
}

/** Counter on this pc. Characters are counted before the call, so a failed call never lets the total run past the limit. */
export function createUsageCounter(file: string, limit = FREE_CHARS_LIMIT) {
  async function read(): Promise<UsageFile | null> {
    try {
      const parsed = JSON.parse(await readFile(file, "utf8")) as Partial<UsageFile>;
      return typeof parsed.month === "string" && Number.isSafeInteger(parsed.characters) ? { month: parsed.month, characters: parsed.characters! } : null;
    } catch {
      return null;
    }
  }
  let queue: Promise<unknown> = Promise.resolve();
  return {
    read,
    /** Reserves the characters or throws with a Dutch reason. */
    reserve(characters: number): Promise<UsageFile> {
      const run = queue.then(async () => {
        const result = allow(await read(), characters, new Date(), limit);
        if (!result.ok) throw new Error(result.reason);
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, JSON.stringify(result.next), "utf8");
        return result.next;
      });
      queue = run.catch(() => {});
      return run;
    },
  };
}

export type SpeakOptions = { voiceName: string; speakingRate: number };

export function synthesizeBody(text: string, { voiceName, speakingRate }: SpeakOptions) {
  return {
    input: { text },
    voice: { languageCode: voiceLanguage(voiceName), name: voiceName },
    audioConfig: { audioEncoding: "MP3", speakingRate: Math.min(1.5, Math.max(0.75, speakingRate)), sampleRateHertz: 48000 },
  };
}

export function createTts(apiKey: string, fetchImpl: typeof fetch = fetch) {
  return {
    /** One spoken line as MP3. */
    async speak(text: string, options: SpeakOptions): Promise<Buffer> {
      if (!text.trim()) throw new Error("Lege scriptregel");
      if (text.length > MAX_REQUEST_CHARS) throw new Error("Scriptregel te lang voor de stemdienst");
      const res = await fetchImpl(ENDPOINT, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": apiKey }, body: JSON.stringify(synthesizeBody(text, options)) });
      const body = (await res.json().catch(() => ({}))) as { audioContent?: string; error?: { message?: string; status?: string } };
      if (!res.ok || !body.audioContent) {
        const reason = body.error?.message ?? `HTTP ${res.status}`;
        if (res.status === 403) throw new Error(`Stemdienst weigert de sleutel: staat de Cloud Text-to-Speech API aan en geldt de sleutel voor die API? (${reason.slice(0, 160)})`);
        throw new Error(`Stemdienst gaf een fout: ${reason.slice(0, 200)}`);
      }
      return Buffer.from(body.audioContent, "base64");
    },
  };
}
export type Tts = ReturnType<typeof createTts>;
