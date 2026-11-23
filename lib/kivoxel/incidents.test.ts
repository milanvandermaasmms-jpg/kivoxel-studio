import { describe, expect, it } from "vitest";
import { detect, healthLine, merge, type JobSnap, type Snapshot } from "./incidents";

const now = "2026-11-23T14:00:00.000Z";
const job = (over: Partial<JobSnap>): JobSnap => ({ id: "j1", step: "render", status: "running", error: null, attempts: 1, max_attempts: 3, heartbeat_at: "2026-11-23T13:59:30.000Z", progress: 0.93, phase: "Exporteren", started_at: "2026-11-23T13:00:00.000Z", finished_at: null, video_id: "v1", title: "Creeper Ambush", ...over });
const snap = (over: Partial<Snapshot> = {}): Snapshot => ({ now, jobs: [], progressSeen: {}, diskFreeBytes: 60e9, budget: { spentCents: 2330, capCents: 10000 }, youtube: { connected: true, scopes: ["https://www.googleapis.com/auth/youtube.upload"] }, uploadLineOldest: null, uploadLineCount: 0, belowNorm: [], ...over });

describe("Ivar-incidentmonitor", () => {
  it("a healthy studio has no incidents", () => {
    expect(detect(snap({ jobs: [job({})] }))).toEqual([]);
    expect(healthLine([]).status).toBe("operationeel");
  });

  it("a step without heartbeat is stuck, and the safe action is to free it once (level 1)", () => {
    const [i] = detect(snap({ jobs: [job({ heartbeat_at: "2026-11-23T13:40:00.000Z" })] }));
    expect(i).toMatchObject({ kind: "stap_vast", severity: "storing", domain: "techniek", action: { level: 1, auto: true } });
    expect(i.title).toMatch(/montage van "Creeper Ambush" geeft al 20 min geen teken van leven/);
  });

  it("the 93% case: progress unchanged for 20+ minutes while alive is a warning, never an automatic stop", () => {
    const [i] = detect(snap({ jobs: [job({})], progressSeen: { j1: { progress: 0.93, since: "2026-11-23T13:30:00.000Z" } } }));
    expect(i).toMatchObject({ kind: "voortgang_stil", severity: "waarschuwing", action: { level: 2, auto: false } });
    expect(i.title).toMatch(/op 93%/);
  });

  it("only a transient failure is retried automatically", () => {
    const failed = (error: string) => job({ status: "failed", error, finished_at: "2026-11-23T13:50:00.000Z" });
    expect(detect(snap({ jobs: [failed("fetch failed (ECONNRESET)")] }))[0].action).toMatchObject({ level: 1, auto: true });
    expect(detect(snap({ jobs: [failed("Maandplafond bereikt")] }))[0].action).toMatchObject({ level: 2, auto: false });
  });

  it("disk, budget and YouTube are level 3: Ivar tells, Milan decides", () => {
    const list = detect(snap({ diskFreeBytes: 4e9, budget: { spentCents: 9000, capCents: 10000 }, youtube: { connected: false, scopes: [] } }));
    expect(list.map((i) => i.kind)).toEqual(["schijf", "budget", "youtube"]);
    expect(list.every((i) => i.action?.level === 3 && !i.action.auto)).toBe(true);
  });

  it("keeps a log: open, still open, then closed with what solved it", () => {
    const a = merge([], detect(snap({ jobs: [job({ heartbeat_at: "2026-11-23T13:40:00.000Z" })] })), now);
    a[0].done = { what: "Stap vrijgegeven", at: now, verified: null };
    const b = merge(a, [], "2026-11-23T14:04:00.000Z");
    expect(b[0]).toMatchObject({ resolvedAt: "2026-11-23T14:04:00.000Z", resolution: "Opgelost na: Stap vrijgegeven", done: { verified: true } });
    expect(healthLine(b).status).toBe("operationeel");
  });

  it("quality below 8.0 is reported as quality, not as a fault", () => {
    const [i] = detect(snap({ belowNorm: [{ videoId: "v2", title: "Night Walk", summary: "7,4 — onder 8,0" }] }));
    expect(i).toMatchObject({ domain: "kwaliteit", severity: "info" });
  });
});
