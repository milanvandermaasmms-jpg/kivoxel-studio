import { describe, expect, it } from "vitest";
import { auditSummary, auditUpload, type AuditInput } from "./uploadAudit";
import { PROFILES } from "./gameProfile";

const base: AuditInput = {
  id: "p1",
  youtubeVideoId: "abc",
  title: "Minecraft Creeper Blast Survival",
  description: "A creeper drops in from above.",
  tags: ["minecraft"],
  madeForKids: false,
  syntheticMedia: false,
  status: "published",
  visibility: "public",
  profile: PROFILES.kivoxel,
  recordingLabel: "22/11 minecraft",
  voiceEngine: "google",
};

describe("uploadcontrole", () => {
  it("passes a clean upload", () => {
    expect(auditUpload(base)).toEqual([]);
  });

  it("flags Dutch text, a cloned voice without AI label and a Fortnite video on KIVOXEL", () => {
    const f = auditUpload({ ...base, title: "Horror Nacht in de Sneeuw", voiceEngine: "chatterbox", recordingLabel: "20-11 fortnite" });
    const keys = f.map((x) => x.key);
    expect(keys).toContain("title-nl");
    expect(keys).toContain("ai-label");
    expect(keys).toContain("channel");
  });

  it("flags another game's name in the title on SpawnNado, and warns when the game name is missing", () => {
    const sp = { ...base, profile: PROFILES.spawnnado };
    expect(auditUpload({ ...sp, title: "Minecraft Duel Win", recordingLabel: "20-11 roblox" }).map((x) => x.key)).toContain("game");
    expect(auditUpload({ ...sp, title: "Epic Duel Win", recordingLabel: "20-11 roblox" })).toMatchObject([{ key: "game-name", severity: "let op" }]);
  });

  it("counts problems, notes and clean uploads", () => {
    const row = (findings: ReturnType<typeof auditUpload>) => ({ id: "x", youtubeVideoId: "y", title: "t", channel: "K", status: "published", findings });
    expect(auditSummary([row([]), row([{ key: "a", severity: "let op", text: "" }]), row([{ key: "b", severity: "probleem", text: "" }])])).toEqual({ total: 3, problems: 1, notes: 1, clean: 1 });
  });
});
