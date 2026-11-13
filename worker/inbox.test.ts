import { randomBytes } from "node:crypto";
import { appendFile, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LocalRecording } from "../lib/youtube/protocol";
import { createInbox, ignoredName, labelFromName, settle } from "./inbox";
import { createStore } from "./store";

// TESTDATA: random bytes in a throwaway folder, never real gameplay.
const fakeProbe = async () => ({ durationMs: 1000, width: 1920, height: 1080, fps: 60, videoCodec: "h264", audioCodec: "aac" });
let dir: string;
let inboxDir: string;
let store: ReturnType<typeof createStore>;
let clock: number;
let registered: LocalRecording[];
let failRegister: boolean;
const logs: string[] = [];

function makeInbox() {
  return createInbox({
    dir: inboxDir,
    importFile: (file, label) => store.importFile(file, label),
    register: async (r) => {
      if (failRegister) throw new Error("geen internet");
      registered.push(r);
    },
    log: (m) => logs.push(m),
    now: () => clock,
    settleMs: 20_000,
  });
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "kivoxel-inbox-"));
  inboxDir = join(dir, "KIVOXEL", "inbox");
  store = createStore(join(dir, "data"), fakeProbe);
  await store.init();
  clock = 1_000_000;
  registered = [];
  failRegister = false;
  logs.length = 0;
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe("inbox helpers", () => {
  it("ignores hidden files, own folders and half-finished copies", () => {
    expect(ignoredName("_fout")).toBe(true);
    expect(ignoredName(".DS_Store")).toBe(true);
    expect(ignoredName("opname.mp4.part")).toBe(true);
    expect(ignoredName("opname.crdownload")).toBe(true);
    expect(ignoredName("desktop.ini")).toBe(true);
    expect(ignoredName("13-11 minecraft.mp4")).toBe(false);
  });

  it("makes a readable name from the file name", () => {
    expect(labelFromName("13-11_minecraft__grot.mp4")).toBe("13-11 minecraft grot");
    expect(labelFromName("___.mp4")).toBe("Opname");
  });

  it("only calls a file ready after it stayed the same for the settle time", () => {
    let s = settle(undefined, 100, 1, 0, 20_000);
    expect(s.ready).toBe(false);
    s = settle(s.seen, 100, 1, 10_000, 20_000);
    expect(s.ready).toBe(false);
    s = settle(s.seen, 200, 2, 15_000, 20_000);
    expect(s.ready).toBe(false);
    s = settle(s.seen, 200, 2, 34_000, 20_000);
    expect(s.ready).toBe(false);
    s = settle(s.seen, 200, 2, 35_000, 20_000);
    expect(s.ready).toBe(true);
    expect(settle({ size: 0, mtimeMs: 1, stableSince: 0 }, 0, 1, 99_000, 20_000).ready).toBe(false);
  });
});

describe("inbox folder", () => {
  it("waits while a file is still being copied, then takes it over and registers it once", async () => {
    const inbox = makeInbox();
    await inbox.scan(); // creates the folder
    const file = join(inboxDir, "TESTDATA grot.mp4");
    await writeFile(file, randomBytes(64 * 1024));
    await inbox.scan();
    expect(inbox.status().waiting).toBe(1);
    clock += 10_000;
    await appendFile(file, randomBytes(64 * 1024)); // still copying
    await inbox.scan(); // grew: the 20 seconds start again
    clock += 15_000;
    await inbox.scan();
    expect(registered).toHaveLength(0);
    clock += 6_000;
    await inbox.scan();
    expect(registered.map((r) => r.label)).toEqual(["TESTDATA grot"]);
    expect(registered[0].isTest).toBe(false);
    expect(await readdir(inboxDir)).toEqual([]);
    const list = await store.list();
    expect(list).toHaveLength(1);
    expect((await readFile(join(store.recordingsDir, list[0].file))).length).toBe(128 * 1024);
    expect(inbox.status()).toMatchObject({ imported: 1, waiting: 0, last: { label: "TESTDATA grot", duplicate: false } });
  });

  it("moves a second copy of the same recording to _dubbel instead of taking it twice", async () => {
    const data = randomBytes(32 * 1024);
    const inbox = makeInbox();
    await inbox.scan();
    await writeFile(join(inboxDir, "TESTDATA a.mp4"), data);
    await inbox.scan();
    clock += 21_000;
    await inbox.scan();
    await writeFile(join(inboxDir, "TESTDATA kopie.mp4"), data);
    await inbox.scan();
    clock += 21_000;
    await inbox.scan();
    expect(registered).toHaveLength(1);
    expect(await readdir(join(inboxDir, "_dubbel"))).toEqual(["TESTDATA kopie.mp4"]);
    expect(inbox.status().last?.duplicate).toBe(true);
  });

  it("puts a file that is not a video in _fout with a note", async () => {
    const inbox = makeInbox();
    await inbox.scan();
    await writeFile(join(inboxDir, "notities.txt"), "hallo");
    await inbox.scan();
    expect((await readdir(join(inboxDir, "_fout"))).sort()).toEqual(["notities.txt", "notities.txt.fout.txt"]);
    expect(inbox.status().errors[0].file).toBe("notities.txt");
  });

  it("keeps a recording that could not be registered and registers it in a later round", async () => {
    const inbox = makeInbox();
    await inbox.scan();
    await writeFile(join(inboxDir, "TESTDATA offline.mp4"), randomBytes(16 * 1024));
    await inbox.scan();
    clock += 21_000;
    failRegister = true;
    await inbox.scan();
    expect(registered).toHaveLength(0);
    expect(await store.list()).toHaveLength(1);
    failRegister = false;
    await inbox.scan();
    expect(registered.map((r) => r.label)).toEqual(["TESTDATA offline"]);
  });
});
