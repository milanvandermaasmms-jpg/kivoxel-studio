import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { foreignFfmpeg, lockFolder } from "./kivoxelFirst.ts";

const worker = { pid: 1, parent: 0, cmd: "node  worker\\index.ts" };
const dnRun = { pid: 2, parent: 1, cmd: '"C:\\Program Files\\nodejs\\node.exe" C:\\x\\worker\\dreamnest\\fase4.ts --minutes 60' };
const dnFfmpeg = { pid: 3, parent: 2, cmd: "C:\\ffmpeg\\bin\\ffmpeg.exe -hide_banner -i a.mp4" };
const kivoxelFfmpeg = { pid: 4, parent: 1, cmd: "C:\\ffmpeg\\bin\\ffmpeg.exe -i C:\\Users\\famdj\\FamilieMK-YouTube\\recordings\\x.webm" };

describe("KIVOXEL goes first, without Dreamnest waiting on itself", () => {
  it("a Dreamnest FFmpeg does not count as KIVOXEL; the worker's own FFmpeg does", () => {
    expect(foreignFfmpeg([worker, dnRun, dnFfmpeg])).toBe(false);
    expect(foreignFfmpeg([worker, dnRun, dnFfmpeg, kivoxelFfmpeg])).toBe(true);
    expect(foreignFfmpeg([{ pid: 9, parent: 777, cmd: "ffmpeg.exe -i x" }])).toBe(true); // unknown parent: assume KIVOXEL
    expect(foreignFfmpeg([worker, dnRun])).toBe(false);
  });
});

let dir = "";
afterEach(() => rm(dir, { recursive: true, force: true }));
describe("one montage per folder", () => {
  it("refuses while another live process holds the lock, takes over a stale one", async () => {
    dir = await mkdtemp(join(tmpdir(), "dn-lock-"));
    await writeFile(join(dir, ".run.lock"), String(process.ppid));
    expect(() => lockFolder(dir, "montage")).toThrow(/Er draait al een montage/);
    await writeFile(join(dir, ".run.lock"), "999999");
    expect(() => lockFolder(dir, "montage")).not.toThrow();
  });
});
