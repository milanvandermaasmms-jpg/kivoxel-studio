import { describe, expect, it } from "vitest";
import { buildProjects, reviewQueue, videoStage, type BoardInput, type BoardVideo } from "./board";

const K = "kanaal-kivoxel";
const D = "kanaal-dreamnest";
const rec = (id: string, status = "ready", extra = {}) => ({ id, label: `Opname ${id}`, status, is_test: false, channel_id: K, created_at: `2026-11-13T0${id}:00:00Z`, ...extra });
const vid = (id: string, recording_id: string | null, status: string, format: "A" | "B" | "C" = "A", extra: Partial<BoardVideo> = {}): BoardVideo => ({ id, recording_id, format, status, is_test: false, channel_id: K, created_at: `2026-11-13T10:00:0${id.length}Z`, ...extra });
const empty: BoardInput = { recordings: [], videos: [], scripts: [], jobs: [], costs: [], moments: [] };

describe("stage of one video", () => {
  it("follows the video status once the montage exists", () => {
    expect(videoStage({ id: "v", status: "published" }, [])).toBe("live");
    expect(videoStage({ id: "v", status: "scheduled" }, [])).toBe("scheduled");
    expect(videoStage({ id: "v", status: "approved" }, [])).toBe("scheduled");
    expect(videoStage({ id: "v", status: "review" }, [])).toBe("keur2");
    expect(videoStage({ id: "v", status: "rendering" }, [])).toBe("production");
  });

  it("uses the scripts before the montage", () => {
    expect(videoStage({ id: "v", status: "idea" }, [])).toBe("concept");
    expect(videoStage({ id: "v", status: "scripted" }, [{ id: "s1", video_id: "v", version: 1, status: "draft" }])).toBe("keur1");
    expect(videoStage({ id: "v", status: "scripted" }, [{ id: "s1", video_id: "v", version: 1, status: "approved" }])).toBe("production");
    expect(videoStage({ id: "v", status: "scripted" }, [{ id: "s1", video_id: "v", version: 1, status: "rejected" }])).toBe("concept");
  });

  it("asks Milan again when a newer draft than the approved script exists", () => {
    const scripts = [
      { id: "s1", video_id: "v", version: 1, status: "approved" as const },
      { id: "s2", video_id: "v", version: 2, status: "draft" as const },
    ];
    expect(videoStage({ id: "v", status: "scripted" }, scripts)).toBe("keur1");
  });
});

describe("project cards", () => {
  it("puts a fresh upload in Nieuw and a recording in analysis in Analyse", () => {
    const projects = buildProjects({
      ...empty,
      recordings: [rec("1", "received"), rec("2")],
      jobs: [{ id: "j", recording_id: "2", video_id: null, step: "analyse", status: "running", error: null, created_at: "2026-11-13T10:00:00Z" }],
    });
    expect(projects.find((p) => p.key === "r:1")?.stage).toBe("new");
    expect(projects.find((p) => p.key === "r:2")?.stage).toBe("analyse");
  });

  it("counts long videos and Shorts, cost and what waits for review, and shows the step that is most behind", () => {
    const [p] = buildProjects({
      ...empty,
      recordings: [rec("1")],
      videos: [vid("a", "1", "review", "C"), vid("bb", "1", "scripted"), vid("ccc", "1", "published", "B")],
      scripts: [{ id: "s", video_id: "bb", version: 1, status: "draft" }],
      jobs: [{ id: "j1", recording_id: "1", video_id: null, step: "analyse", status: "done", error: null, created_at: "2026-11-13T09:00:00Z" }],
      costs: [
        { video_id: null, job_id: "j1", amount_cents: 3 },
        { video_id: "a", job_id: null, amount_cents: 2 },
        { video_id: "elders", job_id: null, amount_cents: 50 },
      ],
    });
    expect(p).toMatchObject({ longCount: 1, shortCount: 2, costCents: 5, toReview: 2, stage: "keur1", blocked: [] });
  });

  it("shows a red badge with the reason when a step failed, but not when it was retried", () => {
    const failed = { id: "j1", recording_id: null, video_id: "a", step: "render", status: "failed", error: "FFmpeg stopte", created_at: "2026-11-13T09:00:00Z" };
    const input = { ...empty, recordings: [rec("1")], videos: [vid("a", "1", "rendering")], jobs: [failed] };
    expect(buildProjects(input)[0].blocked).toEqual(["Montage mislukt: FFmpeg stopte"]);
    const retried = { ...failed, id: "j2", status: "running", created_at: "2026-11-13T09:05:00Z" };
    expect(buildProjects({ ...input, jobs: [failed, retried] })[0].blocked).toEqual([]);
  });

  it("blocks a project with a face in view", () => {
    const [p] = buildProjects({ ...empty, recordings: [rec("1")], videos: [vid("a", "1", "review", "A", { yt_video_moments: [{ moment_id: "m" }] })], moments: [{ id: "m", privacy_flags: ["face"] }] });
    expect(p.blocked.join(" ")).toMatch(/gezicht/);
  });

  it("names a finished analysis without usable moments", () => {
    const [p] = buildProjects({ ...empty, recordings: [rec("1")], jobs: [{ id: "j", recording_id: "1", video_id: null, step: "analyse", status: "done", error: null, created_at: "2026-11-13T10:00:00Z" }] });
    expect(p.stage).toBe("analyse");
    expect(p.blocked[0]).toMatch(/geen bruikbaar moment/);
  });

  it("keeps a video without a recording as its own card on its own channel", () => {
    const [p] = buildProjects({ ...empty, videos: [vid("a", null, "idea", "C", { channel_id: D, promise: "Lumi bij het beekje" })] });
    expect(p).toMatchObject({ key: "v:a", title: "Lumi bij het beekje", channelId: D, stage: "concept" });
  });

  it("shows the reason Milan sent something back", () => {
    const [p] = buildProjects({ ...empty, recordings: [rec("1")], videos: [vid("a", "1", "scripted", "A", { review_note: "Hook sneller" })], scripts: [{ id: "s", video_id: "a", version: 1, status: "approved" }] });
    expect(p.sentBack).toBe("Hook sneller");
  });
});

describe("review queue", () => {
  it("lists concepts and final versions, oldest first, per channel", () => {
    const videos = [vid("a", "1", "review"), vid("bb", "1", "scripted"), vid("ccc", "1", "failed"), vid("dddd", null, "review", "C", { channel_id: D })];
    const scripts = [
      { id: "s", video_id: "bb", version: 1, status: "draft" as const },
      { id: "t", video_id: "ccc", version: 1, status: "draft" as const },
    ];
    expect(reviewQueue(videos, scripts)).toEqual([{ kind: "final", videoId: "a" }, { kind: "concept", videoId: "bb", scriptId: "s" }, { kind: "final", videoId: "dddd" }]);
    expect(reviewQueue(videos, scripts, D)).toEqual([{ kind: "final", videoId: "dddd" }]);
  });
});

describe("helper steps", () => {
  it("a failed AI suggestion or Viral-check never blocks a project", async () => {
    const { buildProjects } = await import("./board");
    const p = buildProjects({
      recordings: [{ id: "r", label: "Opname", status: "ready", is_test: false, channel_id: "c", created_at: "2026-11-13T00:00:00Z" }],
      videos: [{ id: "v", recording_id: "r", format: "A", status: "review", is_test: false, channel_id: "c", created_at: "2026-11-13T00:00:00Z" }],
      scripts: [],
      jobs: [
        { id: "j1", recording_id: null, video_id: "v", step: "viral", status: "failed", error: "x", created_at: "2026-11-13T01:00:00Z" },
        { id: "j2", recording_id: null, video_id: "v", step: "suggest", status: "failed", error: "y", created_at: "2026-11-13T01:00:00Z" },
      ],
      costs: [],
      moments: [],
    });
    expect(p[0].blocked).toEqual([]);
  });
});
