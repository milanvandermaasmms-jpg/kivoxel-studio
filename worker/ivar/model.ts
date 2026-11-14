// Gemini Flash-Lite with function calling, for Ivar. Same key and model as the analysis (worker/.env.local);
// the key never leaves this pc. Time limit per call, one controlled retry on a busy service, cancellable.
import type { Usage } from "../gemini.ts";

export type Part = Record<string, unknown>;
export type Turn = { role: "user" | "model"; parts: Part[] };
export type Call = { name: string; args: unknown };
export type Reply = { parts: Part[]; text: string; calls: Call[]; usage: Usage };
export type GenerateInput = { system: string; contents: Turn[]; tools: Record<string, unknown>[]; allowTools: boolean; signal: AbortSignal };
export type IvarModel = { model: string; generate: (input: GenerateInput) => Promise<Reply> };

const BASE = "https://generativelanguage.googleapis.com";

type Body = {
  candidates?: { content?: { parts?: Part[] }; finishReason?: string }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  promptFeedback?: { blockReason?: string };
};

/** The model's answer: its text and the functions it wants to call (thought signatures stay in `parts`). */
export function readReply(body: Body): Reply {
  const u = body.usageMetadata ?? {};
  const usage = { inputTokens: u.promptTokenCount ?? 0, outputTokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0) };
  if (body.promptFeedback?.blockReason) throw Object.assign(new Error(`Gemini weigerde dit bericht (${body.promptFeedback.blockReason})`), { usage });
  const parts = body.candidates?.[0]?.content?.parts ?? [];
  const calls = parts.flatMap((p) => {
    const fc = p.functionCall as { name?: string; args?: unknown } | undefined;
    return fc?.name ? [{ name: fc.name, args: fc.args ?? {} }] : [];
  });
  const text = parts
    .filter((p) => typeof p.text === "string" && !p.thought)
    .map((p) => p.text as string)
    .join("")
    .trim();
  if (!calls.length && !text) throw Object.assign(new Error(`Gemini gaf een leeg antwoord (${body.candidates?.[0]?.finishReason ?? "onbekend"})`), { usage });
  return { parts, text, calls, usage };
}

export function createIvarModel(apiKey: string, model: string, fetchImpl: typeof fetch = fetch, timeoutMs = 60_000): IvarModel {
  async function once(input: GenerateInput): Promise<Response> {
    return fetchImpl(`${BASE}/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      signal: AbortSignal.any([input.signal, AbortSignal.timeout(timeoutMs)]),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: input.system }] },
        contents: input.contents,
        tools: [{ functionDeclarations: input.tools }],
        toolConfig: { functionCallingConfig: { mode: input.allowTools ? "AUTO" : "NONE" } },
        generationConfig: { temperature: 0.5, maxOutputTokens: 2048 },
      }),
    });
  }
  return {
    model,
    async generate(input) {
      let res: Response;
      try {
        res = await once(input);
        if (res.status === 429 || res.status >= 500) {
          await new Promise((r) => setTimeout(r, 2000));
          input.signal.throwIfAborted();
          res = await once(input);
        }
      } catch (e) {
        if (input.signal.aborted) throw e;
        throw new Error(e instanceof Error && e.name === "TimeoutError" ? "Gemini reageerde niet binnen een minuut" : "Gemini is niet bereikbaar (internet?)");
      }
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        const message = /"message"\s*:\s*"([^"]+)"/.exec(body)?.[1] ?? body.slice(0, 200);
        throw new Error(res.status === 429 ? "Gemini is even te druk of het tegoed is op; probeer het zo opnieuw" : `Gemini gaf fout ${res.status}: ${message}`);
      }
      return readReply((await res.json()) as Body);
    },
  };
}
