// Gemini API (paid tier only; approved by Milan on 11-11-2026 with a cap of €5 per month).
// The key lives in worker/.env.local as GEMINI_API_KEY and never goes into the app or Git.
// Footage goes up as a small proxy (FFmpeg), is analysed once and is deleted from Google straight after.
import { readFile, stat } from "node:fs/promises";

const BASE = "https://generativelanguage.googleapis.com";
export const DEFAULT_MODEL = "gemini-3.5-flash-lite";
/** Files API limit per file. */
const MAX_UPLOAD = 2 * 1024 ** 3;

export type Usage = { inputTokens: number; outputTokens: number };
/** Prices in USD per million tokens (research chapter 9, 11-11-2026) and the rate to euros. 1.0 overestimates a little on purpose. */
export type Rates = { inputPerM: number; outputPerM: number; usdToEur: number };
export const FLASH_LITE_RATES: Rates = { inputPerM: 0.3, outputPerM: 2.5, usdToEur: 1 };

/** Cost of one call in whole euro cents, rounded up (at least 1 cent once anything was used). */
export function costCents(usage: Usage, rates: Rates = FLASH_LITE_RATES): number {
  const usd = (usage.inputTokens * rates.inputPerM + usage.outputTokens * rates.outputPerM) / 1_000_000;
  return usage.inputTokens + usage.outputTokens > 0 ? Math.max(1, Math.ceil(usd * rates.usdToEur * 100)) : 0;
}

/** Gemini sometimes wraps JSON in a ```json block; take the object out. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new Error("De analysedienst gaf geen geldige JSON terug");
  }
}

type GenerateResponse = {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  promptFeedback?: { blockReason?: string };
};

export function createGemini(apiKey: string, model = DEFAULT_MODEL, fetchImpl: typeof fetch = fetch) {
  const headers = { "x-goog-api-key": apiKey };

  async function check(res: Response, what: string) {
    if (res.ok) return;
    const body = await res.text().catch(() => "");
    const message = /"message"\s*:\s*"([^"]+)"/.exec(body)?.[1] ?? body.slice(0, 200);
    throw new Error(`Gemini ${what} mislukt (${res.status}): ${message}`);
  }

  async function upload(file: string, mimeType: string, displayName: string): Promise<{ name: string; uri: string }> {
    const size = (await stat(file)).size;
    if (size > MAX_UPLOAD) throw new Error("De verkleinde opname is groter dan 2 GB; splits de opname");
    const start = await fetchImpl(`${BASE}/upload/v1beta/files`, {
      method: "POST",
      headers: { ...headers, "X-Goog-Upload-Protocol": "resumable", "X-Goog-Upload-Command": "start", "X-Goog-Upload-Header-Content-Length": String(size), "X-Goog-Upload-Header-Content-Type": mimeType, "Content-Type": "application/json" },
      body: JSON.stringify({ file: { display_name: displayName } }),
    });
    await check(start, "upload starten");
    const url = start.headers.get("x-goog-upload-url");
    if (!url) throw new Error("Gemini gaf geen uploadadres terug");
    const done = await fetchImpl(url, { method: "POST", headers: { "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize" }, body: await readFile(file) });
    await check(done, "upload");
    const json = (await done.json()) as { file?: { name?: string; uri?: string } };
    if (!json.file?.name || !json.file.uri) throw new Error("Gemini gaf geen bestandsgegevens terug");
    return { name: json.file.name, uri: json.file.uri };
  }

  async function waitActive(name: string, timeoutMs = 15 * 60_000, pollMs = 5000) {
    const until = Date.now() + timeoutMs;
    for (;;) {
      const res = await fetchImpl(`${BASE}/v1beta/${name}`, { headers });
      await check(res, "status opvragen");
      const state = ((await res.json()) as { state?: string }).state;
      if (state === "ACTIVE") return;
      if (state === "FAILED") throw new Error("Gemini kon de video niet verwerken");
      if (Date.now() > until) throw new Error("Gemini verwerkt de video te traag; later opnieuw proberen");
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }

  async function remove(name: string) {
    await fetchImpl(`${BASE}/v1beta/${name}`, { method: "DELETE", headers }).catch(() => undefined);
  }

  async function generateJson(parts: unknown[], video: boolean): Promise<{ json: unknown; usage: Usage }> {
    const res = await fetchImpl(`${BASE}/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.4, ...(video ? { mediaResolution: "MEDIA_RESOLUTION_LOW" } : {}) },
      }),
    });
    await check(res, "analyse");
    const body = (await res.json()) as GenerateResponse;
    const u = body.usageMetadata ?? {};
    const usage = { inputTokens: u.promptTokenCount ?? 0, outputTokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0) };
    if (body.promptFeedback?.blockReason) throw Object.assign(new Error(`Gemini weigerde de opdracht (${body.promptFeedback.blockReason})`), { usage });
    const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (!text) throw Object.assign(new Error(`Gemini gaf een leeg antwoord (${body.candidates?.[0]?.finishReason ?? "onbekend"})`), { usage });
    return { json: extractJson(text), usage };
  }

  return {
    model,
    /** Uploads the proxy, asks for the moments and always deletes the upload again. */
    async analyseVideo(file: string, prompt: string, onStage?: (stage: "upload" | "processing" | "thinking") => void): Promise<{ json: unknown; usage: Usage }> {
      onStage?.("upload");
      const uploaded = await upload(file, "video/mp4", "familie-mk-analyse");
      try {
        onStage?.("processing");
        await waitActive(uploaded.name);
        onStage?.("thinking");
        return await generateJson([{ fileData: { mimeType: "video/mp4", fileUri: uploaded.uri } }, { text: prompt }], true);
      } finally {
        await remove(uploaded.name);
      }
    },
    generateText: (prompt: string) => generateJson([{ text: prompt }], false),
  };
}

export type Gemini = ReturnType<typeof createGemini>;
