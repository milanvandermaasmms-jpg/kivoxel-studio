import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { correctArgs, loudnessCheck, trimArgs } from "../lib/kivoxel/loudness.ts";
import { bestLocalTts, findPiper, sapiRate } from "./localTts.ts";

describe("local voice (no cloud credits)", () => {
  it("maps our speaking rate to Windows' -10..10", () => {
    expect(sapiRate(1)).toBe(0);
    expect(sapiRate(1.1)).toBe(1);
    expect(sapiRate(3)).toBe(10);
  });
  it("finds Piper only with the program and an English voice", () => {
    const dir = mkdtempSync(join(tmpdir(), "kv-"));
    expect(findPiper(dir)).toBeNull();
    mkdirSync(join(dir, "kivoxel-tts", "piper"), { recursive: true });
    writeFileSync(join(dir, "kivoxel-tts", "piper", "piper.exe"), "");
    expect(findPiper(dir)).toBeNull();
    writeFileSync(join(dir, "kivoxel-tts", "piper", "en_US-ryan-high.onnx"), "");
    expect(findPiper(dir)?.model).toMatch(/en_US-ryan-high\.onnx$/);
  });
  it("follows the configured order and always ends at Windows", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kv-"));
    expect((await bestLocalTts(dir, ["piper", "windows"])).name).toMatch(/^Windows/);
    expect((await bestLocalTts(dir, [])).name).toMatch(/^Windows/);
  });
});

describe("exact loudness", () => {
  const t = { lufs: -14, truePeakDb: -1, lra: 11 };
  it("corrects linearly and limits 1.5 dB under the true-peak target (AAC adds peaks)", () => {
    const a = correctArgs("in.mp4", "out.mp4", t, { input_i: "-20", input_tp: "-3", input_lra: "6", input_thresh: "-30", target_offset: "0.1" }).join(" ");
    expect(a).toContain("linear=true");
    expect(a).toContain("alimiter=limit=0.750");
    expect(a).toContain("-c:v copy");
  });
  it("trims the rest with a plain gain, never more than 6 dB", () => {
    expect(trimArgs("a.mp4", "b.mp4", t, -15.5).join(" ")).toContain("volume=1.50dB");
    expect(trimArgs("a.mp4", "b.mp4", t, -30).join(" ")).toContain("volume=6.00dB");
  });
  it("checks -14 ±1 LUFS and true peak <= -1 dB", () => {
    const s = { target_lufs: -14, lufs_tolerance: 1, true_peak_db: -1 };
    expect(loudnessCheck(-14.6, -2.1, s).ok).toBe(true);
    expect(loudnessCheck(-15.5, -2.1, s).ok).toBe(false);
    expect(loudnessCheck(-14, -0.5, s).ok).toBe(false);
  });
});
