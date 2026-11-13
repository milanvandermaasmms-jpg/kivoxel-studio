// Gemini image plug for Dreamnest (Milan chose Gemini 3.1 Flash Image on 13-11-2026, budget fase 1: 10 euro).
// The key comes from worker/.env.local (GEMINI_API_KEY) and never goes into the app, Git or a log.
import type { ImageProvider, ImageRequest, VisionProvider } from "./types.ts";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";
// List prices (USD ~ EUR), rounded up so the ceiling is never passed by rounding. Checked 13-11-2026; see docs/dreamnest/fase-1-onderzoek.md.
export const IMAGE_CENTS: Record<ImageRequest["size"], number> = { "1K": 7, "2K": 11 };
export const VISION_CENTS = 1;

type Part = { text?: string; inlineData?: { mimeType: string; data: string } };
type Response = { candidates?: { content?: { parts?: Part[] }; finishReason?: string }[]; usageMetadata?: unknown; promptFeedback?: { blockReason?: string }; error?: { message: string } };

async function call(fetchImpl: typeof fetch, key: string, model: string, body: unknown): Promise<Response> {
  const res = await fetchImpl(`${BASE}/${model}:generateContent`, { method: "POST", headers: { "x-goog-api-key": key, "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as Response;
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${json.error?.message ?? "onbekende fout"}`.slice(0, 300));
  return json;
}

const inline = (r: ImageRequest["refs"][number]): Part => ({ inlineData: { mimeType: r.mime, data: r.data.toString("base64") } });

export function createGeminiImage(key: string, model = "gemini-3.1-flash-image", fetchImpl: typeof fetch = fetch): ImageProvider {
  return {
    name: "gemini",
    model,
    estimateCents: (size) => IMAGE_CENTS[size],
    async generate(req) {
      const json = await call(fetchImpl, key, model, {
        contents: [{ role: "user", parts: [{ text: req.prompt }, ...req.refs.map(inline)] }],
        generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: req.aspect, imageSize: req.size } },
      });
      const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
      if (!part?.inlineData) throw new Error(`Geen beeld terug (${json.promptFeedback?.blockReason ?? json.candidates?.[0]?.finishReason ?? "onbekend"})`);
      return { mime: part.inlineData.mimeType, data: Buffer.from(part.inlineData.data, "base64"), model, costCents: IMAGE_CENTS[req.size], usage: json.usageMetadata ?? null };
    },
  };
}

/** Vision judge: how well does the candidate match the character in the reference images (0-100)? */
export function createGeminiVision(key: string, model = "gemini-3.1-flash-lite", fetchImpl: typeof fetch = fetch): VisionProvider {
  return {
    model,
    async consistency(refs, candidate, character) {
      const text =
        `You check character consistency for a children's animation. The first ${refs.length} image(s) are the reference for this character: ${character}\n` +
        `The last image is a new image. Score 0-100 how well the character in the new image matches the reference in body shape, colours, ears, face, markings and outfit ` +
        `(ignore pose, background, lighting and other characters). If the character is missing, score 0. Answer only JSON: {"score": number, "issues": [short strings]}.`;
      const json = await call(fetchImpl, key, model, {
        contents: [{ role: "user", parts: [{ text }, ...refs.map(inline), inline(candidate)] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0 },
      });
      const raw = json.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text ?? "{}";
      const parsed = JSON.parse(raw) as { score?: unknown; issues?: unknown };
      const score = Math.max(0, Math.min(100, Math.round(Number(parsed.score) || 0)));
      const issues = Array.isArray(parsed.issues) ? parsed.issues.map(String).slice(0, 8) : [];
      return { score, issues, costCents: VISION_CENTS };
    },
  };
}
