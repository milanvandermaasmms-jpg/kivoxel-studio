// Gemini Omni 1.2 Flash video plug (successor of Veo 3.1, which Google shut down on 22-10-2026).
// Interactions API, first + last frame in the input (3-10 s). The key comes from worker/.env.local and is never logged.
import { clipCents } from "../../../lib/dreamnest/motion.ts";

export type VideoRequest = { first: { mime: string; data: Buffer }; last: { mime: string; data: Buffer } | null; prompt: string; durationS: number; resolution: "720p" | "1080p" };
export type VideoResult = { data: Buffer; mime: string; model: string; costCents: number; id: string | null };
export type VideoProvider = { name: string; model: string; estimateCents: (durationS: number, res: VideoRequest["resolution"]) => number; generate: (req: VideoRequest) => Promise<VideoResult> };

type Content = { type: string; mime_type?: string; data?: string };
type Interaction = { id?: string; status?: string; steps?: { type: string; content?: Content[] }[]; error?: { message?: string } };

export function createOmniVideo(key: string, model = "gemini-omni-1.2-flash", fetchImpl: typeof fetch = fetch): VideoProvider {
  return {
    name: "gemini",
    model,
    estimateCents: clipCents,
    async generate(req) {
      const image = (i: { mime: string; data: Buffer }) => ({ type: "image", mime_type: i.mime, data: i.data.toString("base64") });
      const body = {
        model,
        input: [image(req.first), ...(req.last ? [image(req.last)] : []), { type: "text", text: req.prompt }],
        response_format: { type: "video", duration: `${req.durationS}s`, resolution: req.resolution, aspect_ratio: "16:9" },
      };
      const res = await fetchImpl("https://generativelanguage.googleapis.com/v1beta/interactions", {
        method: "POST",
        headers: { "x-goog-api-key": key, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15 * 60_000),
      });
      const json = (await res.json().catch(() => ({}))) as Interaction;
      if (!res.ok) throw new Error(`Omni ${res.status}: ${json.error?.message ?? "onbekende fout"}`.slice(0, 300));
      const video = json.steps?.flatMap((s) => s.content ?? []).find((c) => c.type === "video" && c.data);
      if (!video?.data) throw new Error(`Geen video terug (status ${json.status ?? "onbekend"})`);
      return { data: Buffer.from(video.data, "base64"), mime: video.mime_type ?? "video/mp4", model, costCents: clipCents(req.durationS, req.resolution), id: json.id ?? null };
    },
  };
}
