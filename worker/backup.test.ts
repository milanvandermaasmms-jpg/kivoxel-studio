import { describe, expect, it } from "vitest";
import { backupDir, backupDue, toPrune } from "./backup.ts";

describe("wekelijkse back-up", () => {
  it("keeps the last 8 weeks and ignores other folders", () => {
    const weeks = Array.from({ length: 10 }, (_, i) => `2026-${String(9 + Math.floor(i / 4)).padStart(2, "0")}-${String(1 + (i % 4) * 7).padStart(2, "0")}`);
    expect(toPrune([...weeks, "notes"])).toEqual(weeks.slice(0, 2));
    expect(toPrune(weeks.slice(0, 3))).toEqual([]);
  });

  it("is due once a week (or when there is none yet)", () => {
    expect(backupDue(null)).toBe(true);
    expect(backupDue("2026-11-20", new Date("2026-11-24T12:00:00Z"))).toBe(false);
    expect(backupDue("2026-11-17", new Date("2026-11-24T12:00:00Z"))).toBe(true);
  });

  it("goes where Milan says, else to the backup drive or the data folder", () => {
    expect(backupDir("C:/data", { KIVOXEL_BACKUP_DIR: "E:/bk" })).toBe("E:/bk");
    expect(backupDir("C:/data", {})).toMatch(/backups$/);
  });
});
