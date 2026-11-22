import { describe, expect, it } from "vitest";
import { byLine, nextInLine, oldRefusal, parseWait, retryAfter, waitNote, waitReason, type WaitingPub } from "./uploadWait";

const iso = (s: string) => new Date(s).toISOString();
const now = Date.parse("2026-11-22T12:00:00Z");

describe("Wachtrij YouTube", () => {
  it("writes and reads the wait note", () => {
    const w = { since: iso("2026-11-22T10:00:00Z"), retryAt: iso("2026-11-23T10:00:00Z"), reason: "uploadLimitExceeded: The user has exceeded the number of videos they may upload." };
    expect(parseWait(waitNote(w))).toEqual(w);
    expect(waitNote({ ...w, reason: "x".repeat(800) }).length).toBeLessThanOrEqual(500);
    expect(parseWait("YouTube-quotum van vandaag is op")).toBeNull();
    expect(parseWait(null)).toBeNull();
  });

  it("recognises the old refusals, so those videos join the line", () => {
    expect(oldRefusal("YouTube-quotum van vandaag is op: terug naar Klaar voor YouTube. Verstuur hem morgen na 09:00 opnieuw, of upload hem zelf.")).toBe(true);
    expect(oldRefusal("YouTube laat dit kanaal nu niet via de studio uploaden (uploadlimiet via de API).")).toBe(true);
    expect(oldRefusal("Titel of montage ontbreekt")).toBe(false);
    expect(oldRefusal(waitNote({ since: iso("2026-11-22T10:00:00Z"), retryAt: iso("2026-11-22T10:00:00Z"), reason: "uploadlimiet" }))).toBe(false);
  });

  it("tries again after 24 hours for the channel limit, after midnight Pacific for the quota", () => {
    expect(retryAfter("uploadLimitExceeded", now)).toBe(now + 24 * 3_600_000);
    const q = retryAfter("YouTube-quotum voor vandaag is op (100 van 100 uploads)", now);
    // 12:00 UTC = 04:00 in Los Angeles: the next Pacific midnight is 08:00 UTC the next day.
    expect(q).toBeGreaterThan(Date.parse("2026-11-23T08:00:00Z"));
    expect(q).toBeLessThan(Date.parse("2026-11-23T08:30:00Z"));
  });

  it("only the first in line of each channel goes, when its time has come and nothing runs for that channel", () => {
    const w = (id: string, ch: string, since: string, retry: string): WaitingPub => ({ id, channelId: ch, wait: { since: iso(since), retryAt: iso(retry), reason: "" } });
    const list = [
      w("b", "spawn", "2026-11-21T10:00:00Z", "2026-11-22T11:00:00Z"),
      w("a", "spawn", "2026-11-21T09:00:00Z", "2026-11-22T13:00:00Z"),
      w("c", "kivoxel", "2026-11-22T09:00:00Z", "2026-11-22T09:00:00Z"),
    ];
    // SpawnNado: "a" came first and must wait until 13:00, so "b" waits behind it. KIVOXEL: "c" goes.
    expect(nextInLine(list, new Set(), now).map((x) => x.id)).toEqual(["c"]);
    expect(nextInLine(list, new Set(["kivoxel"]), now)).toEqual([]);
    expect(nextInLine(list, new Set(), Date.parse("2026-11-22T13:00:00Z")).map((x) => x.id).sort()).toEqual(["a", "c"]);
    expect([...list].sort(byLine).map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("says the reason in plain Dutch", () => {
    expect(waitReason("YouTube-uploadlimiet van dit kanaal via de API is bereikt (YouTube: uploadLimitExceeded: …)")).toBe("YouTube-daglimiet van dit kanaal bereikt");
    expect(waitReason("YouTube-quotum voor vandaag is op (100 van 100 uploads)")).toBe("Dagquotum van de studio op");
  });
});
