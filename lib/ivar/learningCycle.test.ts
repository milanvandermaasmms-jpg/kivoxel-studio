import { describe, expect, it } from "vitest";
import { activeFor, audioDefaultFrom, deriveLessons, diffLessons, kindBoostFrom, milanRejected, payoffExtraFrom, type LearnVideo } from "./learningCycle";

const v = (o: Partial<LearnVideo>): LearnVideo => ({ id: Math.random().toString(36).slice(2), channelId: "k", status: "published", note: null, momentKind: "escape", format: "A", ...o });

describe("Ivar: leercyclus", () => {
  it("only Milan's own rejections count (not what the studio archived itself)", () => {
    expect(milanRejected(v({ status: "archived", note: "geen goede game play" }))).toBe(true);
    expect(milanRejected(v({ status: "archived", note: "Studio (inhoud): niets gemeten" }))).toBe(false);
    expect(milanRejected(v({ status: "archived", note: "Niet gebruikt: gamertag in beeld" }))).toBe(false);
    expect(milanRejected(v({ status: "archived", note: null }))).toBe(false);
  });

  it("a kind Milan keeps rejecting becomes 'fewer of these' (active from 3 rejections), applied as a lower weight", () => {
    const videos = [
      v({ momentKind: "rescue", status: "archived", note: "geen content" }),
      v({ momentKind: "rescue", status: "archived", note: "geen goede game play" }),
      v({ momentKind: "rescue", status: "archived", note: "saai" }),
      v({ momentKind: "rescue" }),
    ];
    const lessons = deriveLessons({ videos, feedback: [], audio: [] });
    const l = lessons.find((x) => x.id === "minder:k:rescue")!;
    expect(l.status).toBe("actief");
    expect(kindBoostFrom(activeFor(lessons, "k"), "rescue")).toEqual({ boost: -15, ids: ["minder:k:rescue"] });
    // Two rejections: only a proposal, nothing changes by itself.
    expect(deriveLessons({ videos: videos.slice(1), feedback: [], audio: [] }).find((x) => x.id === "minder:k:rescue")!.status).toBe("voorstel");
  });

  it("the same feedback on three videos is a recurring problem; 'payoff ontbreekt' is fixed by itself (longer outcome)", () => {
    const fb = ["a", "b", "c"].map((id) => ({ videoId: id, channelId: "k", kinds: ["payoff" as const] }));
    const lessons = deriveLessons({ videos: [], feedback: [...fb, ...["a", "b", "c"].map((id) => ({ videoId: id, channelId: "k", kinds: ["music" as const] }))], audio: [] });
    expect(payoffExtraFrom(activeFor(lessons, "k"))?.action).toEqual({ type: "payoff_extra", ms: 1500 });
    expect(lessons.find((x) => x.id === "terug:k:music")!.status).toBe("voorstel");
  });

  it("the audio option Milan keeps choosing becomes the channel default; switched off it is not applied", () => {
    const audio = [{ channelId: "k", music: "energiek", sfx: "subtiel" }, { channelId: "k", music: "energiek", sfx: "gebalanceerd" }, { channelId: "k", music: "energiek", sfx: "subtiel" }];
    const lessons = deriveLessons({ videos: [], feedback: [], audio });
    expect(audioDefaultFrom(activeFor(lessons, "k"))?.action).toEqual({ type: "audio_default", music_pick: "energiek", sfx_level: "subtiel" });
    expect(audioDefaultFrom(activeFor(lessons, "k", ["audio:k"]))).toBeNull();
    expect(audioDefaultFrom(activeFor(lessons, "spawnnado"))).toBeNull(); // another channel learns on its own
  });

  it("keeps a version history of what changed", () => {
    const a = deriveLessons({ videos: [], feedback: [], audio: [{ channelId: "k", music: "rustig" }, { channelId: "k", music: "rustig" }, { channelId: "k", music: "rustig" }] });
    expect(diffLessons([], a)).toEqual(["Nieuw: Standaard audio: muziek rustig (actief)"]);
    expect(diffLessons(a, [])).toEqual(["Vervallen: Standaard audio: muziek rustig"]);
  });
});
