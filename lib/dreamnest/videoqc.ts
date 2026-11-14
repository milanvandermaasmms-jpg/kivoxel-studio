// Dreamnest fase 4: QC of the finished long video, per minute with timestamps (fase-4-eisen.md). Pure, tested.

export type VideoProbe = { durationS: number; width: number; height: number; fps: number };
export type MinuteRow = { minute: number; lumaMax: number; lumaMean: number; maxJump: number; minStep: number; calmP10: number; problems: string[] };

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/**
 * luma: average brightness per frame (0-255); steps: SSIM between each frame and the next.
 * Rules per minute: no flash (jump > 25), nothing brighter than 200, no hard cut (step < 0.6),
 * calm (the 10% biggest steps still >= calmMin alike: 0.98 in the story, where gentle movement belongs, 0.99 later), and the light never changes faster than 3/255 per second.
 */
export function perMinute(luma: number[], steps: number[], fps: number, calmMin: (minute: number) => number = () => 0.99): MinuteRow[] {
  const per = Math.round(60 * fps);
  const rows: MinuteRow[] = [];
  for (let m = 0; m * per < luma.length; m++) {
    const L = luma.slice(m * per, (m + 1) * per);
    const S = steps.slice(m * per, (m + 1) * per);
    const problems: string[] = [];
    let maxJump = 0, jumpAt = 0;
    for (let i = 1; i < L.length; i++) {
      const j = Math.abs(L[i] - L[i - 1]);
      if (j > maxJump) [maxJump, jumpAt] = [j, i];
    }
    const sorted = [...S].sort((a, b) => a - b);
    const minStep = sorted[0] ?? 1;
    const calmP10 = sorted[Math.floor(sorted.length * 0.1)] ?? 1;
    const lumaMax = Math.max(...L);
    if (maxJump > 25) problems.push(`flits bij ${fmt(m * 60 + jumpAt / fps)}`);
    if (lumaMax > 200) problems.push("te fel");
    if (minStep < 0.6) problems.push(`harde knip bij ${fmt(m * 60 + S.indexOf(minStep) / fps)}`);
    if (calmP10 < calmMin(m)) problems.push(`onrustig (${(calmP10 * 100).toFixed(1)}%)`);
    // Light drift: compare averages one second apart.
    for (let i = Math.round(fps); i < L.length; i += Math.round(fps)) {
      const a = avg(L.slice(i - Math.round(fps), i)), b = avg(L.slice(i, i + Math.round(fps)));
      if (Math.abs(b - a) > 3) {
        problems.push(`licht verspringt bij ${fmt(m * 60 + i / fps)}`);
        break;
      }
    }
    rows.push({ minute: m, lumaMax, lumaMean: avg(L), maxJump, minStep, calmP10, problems });
  }
  return rows;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

export function judgeVideo(probe: VideoProbe, minutes: MinuteRow[], targetS: number, blackRanges: { start: number; end: number }[]) {
  const problems: string[] = [];
  if (probe.durationS < targetS - 1) problems.push(`te kort: ${fmt(probe.durationS)} (doel ${fmt(targetS)})`);
  if (probe.width < 1920 || probe.height < 1080) problems.push(`resolutie ${probe.width}×${probe.height}, minimaal 1920×1080`);
  if (Math.abs(probe.fps - 24) > 0.01 && Math.abs(probe.fps - 30) > 0.01) problems.push(`${probe.fps} fps, moet 24 of 30`);
  for (const b of blackRanges) if (b.start < probe.durationS - 90) problems.push(`zwart beeld ${fmt(b.start)}-${fmt(b.end)} (alleen aan het eind toegestaan)`);
  for (const m of minutes) for (const p of m.problems) problems.push(`minuut ${m.minute}: ${p}`);
  return { ok: problems.length === 0, problems };
}

export function parseBlack(text: string): { start: number; end: number }[] {
  return [...text.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map((m) => ({ start: Number(m[1]), end: Number(m[2]) }));
}
