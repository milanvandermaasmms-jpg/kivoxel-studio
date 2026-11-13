import { describe, expect, it } from "vitest";
import { judgeAudio, parseEbur128, parseSilences } from "./audioqc";

const ok = { integrated: -22.3, truePeak: -5, silences: [], shortTerm: Array.from({ length: 600 }, () => -22 + Math.random() * 0.5) };

describe("audio QC", () => {
  it("passes a calm part at its target", () => {
    expect(judgeAudio(ok, -22)).toEqual({ ok: true, problems: [] });
  });
  it("flags wrong loudness, peaks, long silences and volume jumps", () => {
    expect(judgeAudio({ ...ok, integrated: -18 }, -22).problems.join()).toMatch(/luidheid/);
    expect(judgeAudio({ ...ok, truePeak: -1 }, -22).problems.join()).toMatch(/piek/);
    expect(judgeAudio({ ...ok, silences: [{ start: 65, dur: 2.5 }] }, -22).problems.join()).toMatch(/stilte van 2.5 s bij 1:05/);
    const st = [...ok.shortTerm];
    for (let i = 300; i < 600; i++) st[i] = -17;
    expect(judgeAudio({ ...ok, shortTerm: st }, -22).problems.join()).toMatch(/volumesprong/);
  });
  it("reads FFmpeg's loudness and silence output", () => {
    const text = "t: 0.1 M: -30 S: -25.0 I: -24 LUFS\nt: 0.2 M: -30 S: -24.5\n[Parsed_ebur128_0] Summary:\n  Integrated loudness:\n    I:         -21.8 LUFS\n  True peak:\n    Peak:       -4.2 dBFS\n";
    expect(parseEbur128(text)).toEqual({ integrated: -21.8, truePeak: -4.2, shortTerm: [-25, -24.5] });
    expect(parseSilences("silence_start: 12.5\nsilence_end: 15 | silence_duration: 2.5")).toEqual([{ start: 12.5, dur: 2.5 }]);
  });
});
