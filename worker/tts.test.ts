import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { allow, createTts, createUsageCounter, monthKey, synthesizeBody, voiceLanguage } from "./tts";

describe("free tier of the voice service", () => {
  const nov = new Date("2026-11-11T20:00:00Z");

  it("counts per month and starts again in a new month", () => {
    expect(monthKey(nov)).toBe("2026-11");
    expect(allow({ month: "2026-11", characters: 100 }, 50, nov)).toEqual({ ok: true, next: { month: "2026-11", characters: 150 } });
    expect(allow({ month: "2026-10", characters: 899_999 }, 50, nov)).toEqual({ ok: true, next: { month: "2026-11", characters: 50 } });
  });

  it("refuses above the safe limit", () => {
    const r = allow({ month: "2026-11", characters: 899_990 }, 20, nov);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/veilige grens/);
    expect(allow(null, 900_000, nov).ok).toBe(true);
  });

  it("keeps the counter on disk and never passes the limit, also with calls at the same time", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fmk-tts-"));
    try {
      const counter = createUsageCounter(join(dir, "tts-usage.json"), 100);
      const results = await Promise.allSettled([counter.reserve(40), counter.reserve(40), counter.reserve(40)]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
      expect((await createUsageCounter(join(dir, "tts-usage.json"), 100).read())?.characters).toBe(80);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("Google TTS request", () => {
  it("takes the language from the voice name and keeps the tempo in range", () => {
    expect(voiceLanguage("en-GB-Chirp3-HD-Charon")).toBe("en-GB");
    const body = synthesizeBody("Run!", { voiceName: "en-US-Chirp3-HD-Charon", speakingRate: 3 });
    expect(body.voice).toEqual({ languageCode: "en-US", name: "en-US-Chirp3-HD-Charon" });
    expect(body.audioConfig).toMatchObject({ audioEncoding: "MP3", speakingRate: 1.5 });
  });

  it("sends the key in a header, never in the address", async () => {
    let url = "";
    let headers: Record<string, string> = {};
    const fake = (async (u: string, init: RequestInit) => {
      url = u;
      headers = init.headers as Record<string, string>;
      return new Response(JSON.stringify({ audioContent: Buffer.from("mp3").toString("base64") }), { status: 200 });
    }) as unknown as typeof fetch;
    const audio = await createTts("SECRET", fake).speak("Hello", { voiceName: "en-US-Chirp3-HD-Charon", speakingRate: 1.1 });
    expect(audio.toString()).toBe("mp3");
    expect(url).not.toContain("SECRET");
    expect(headers["x-goog-api-key"]).toBe("SECRET");
  });

  it("explains a refused key in Dutch", async () => {
    const fake = (async () => new Response(JSON.stringify({ error: { message: "API not enabled" } }), { status: 403 })) as unknown as typeof fetch;
    await expect(createTts("x", fake).speak("Hi", { voiceName: "en-US-Chirp3-HD-Charon", speakingRate: 1 })).rejects.toThrow(/Cloud Text-to-Speech API aan/);
  });
});
