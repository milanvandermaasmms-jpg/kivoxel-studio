// Image providers are swappable plugs (megaprompt §6). Only Gemini is connected; another one = a new file here,
// plus Milan's approval and budget.
export type ImageRequest = { prompt: string; refs: { mime: string; data: Buffer }[]; aspect: "1:1" | "16:9" | "9:16"; size: "1K" | "2K" };
export type ImageResult = { mime: string; data: Buffer; model: string; costCents: number; usage: unknown };
export type ImageProvider = { name: string; model: string; estimateCents: (size: ImageRequest["size"]) => number; generate: (req: ImageRequest) => Promise<ImageResult> };

export type VisionCheck = { score: number; issues: string[]; costCents: number };
export type VisionProvider = { model: string; consistency: (refs: ImageRequest["refs"], candidate: ImageRequest["refs"][number], character: string) => Promise<VisionCheck> };
