import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { proxyArgs } from "./ffmpeg";
import { costCents, createGemini, extractJson } from "./gemini";

function testFile() {
  const file = join(mkdtempSync(join(tmpdir(), "gemini-")), "proxy.mp4");
  writeFileSync(file, "TESTDATA");
  return file;
}

describe("gemini", () => {
  it("rounds costs up to whole cents", () => {
    expect(costCents({ inputTokens: 360_000, outputTokens: 8_000 })).toBe(13);
    expect(costCents({ inputTokens: 10, outputTokens: 0 })).toBe(1);
    expect(costCents({ inputTokens: 0, outputTokens: 0 })).toBe(0);
  });

  it("reads JSON, also inside a code block", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(() => extractJson("nope")).toThrow(/JSON/);
  });

  it("uploads, waits, analyses and always deletes the upload", async () => {
    const calls: string[] = [];
    const fake = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith("/upload/v1beta/files")) return new Response("{}", { headers: { "x-goog-upload-url": "https://upload.test/1" } });
      if (url === "https://upload.test/1") return Response.json({ file: { name: "files/abc", uri: "https://files/abc" } });
      if (url.endsWith("/v1beta/files/abc") && init?.method === "DELETE") return new Response("{}");
      if (url.endsWith("/v1beta/files/abc")) return Response.json({ state: "ACTIVE" });
      if (url.includes(":generateContent")) {
        const body = JSON.parse(String(init?.body));
        expect(url).toContain("models/gemini-3.5-flash-lite:generateContent");
        expect(body.contents[0].parts[0].fileData.fileUri).toBe("https://files/abc");
        expect(body.generationConfig.mediaResolution).toBe("MEDIA_RESOLUTION_LOW");
        return Response.json({ candidates: [{ content: { parts: [{ text: '{"moments":[]}' }] } }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 5, thoughtsTokenCount: 5 } });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;
    const r = await createGemini("test-key", undefined, fake).analyseVideo(testFile(), "prompt");
    expect(r.json).toEqual({ moments: [] });
    expect(r.usage).toEqual({ inputTokens: 100, outputTokens: 10 });
    expect(calls.at(-1)).toBe("DELETE https://generativelanguage.googleapis.com/v1beta/files/abc");
  });

  it("deletes the upload also when the analysis fails", async () => {
    let deleted = false;
    const fake = (async (url: string, init?: RequestInit) => {
      if (url.endsWith("/upload/v1beta/files")) return new Response("{}", { headers: { "x-goog-upload-url": "https://upload.test/1" } });
      if (url === "https://upload.test/1") return Response.json({ file: { name: "files/abc", uri: "u" } });
      if (init?.method === "DELETE") {
        deleted = true;
        return new Response("{}");
      }
      if (url.endsWith("/v1beta/files/abc")) return Response.json({ state: "ACTIVE" });
      return new Response('{"error":{"message":"quota"}}', { status: 429 });
    }) as typeof fetch;
    await expect(createGemini("k", undefined, fake).analyseVideo(testFile(), "p")).rejects.toThrow(/429.*quota/);
    expect(deleted).toBe(true);
  });

  it("the proxy is small: 360p, 1 frame per second, mono audio", () => {
    const args = proxyArgs("in.mp4", "out.mp4").join(" ");
    expect(args).toContain("scale=-2:360,fps=1");
    expect(args).toContain("-ac 1");
  });
});
