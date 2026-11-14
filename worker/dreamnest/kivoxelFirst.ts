// KIVOXEL goes first (fase 6 fix, 14-11-2026): Dreamnest waits only for FFmpeg that is NOT started by a Dreamnest
// script. Before, every ffmpeg.exe counted, so two Dreamnest runs waited on each other ("KIVOXEL gebruikt FFmpeg")
// while KIVOXEL was not busy at all. Plus a run lock, so two montages never write into the same folder.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Proc = { pid: number; parent: number; cmd: string };

/** True when an FFmpeg runs whose parent is not a worker/dreamnest script (so: KIVOXEL's). Pure, tested. */
export function foreignFfmpeg(procs: Proc[]): boolean {
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  return procs.some((p) => /(^|[\\/"])ffmpeg(\.exe)?("|\s|$)/i.test(p.cmd) && !/worker[\\/]dreamnest[\\/]/i.test(byPid.get(p.parent)?.cmd ?? ""));
}

export function listProcs(): Proc[] {
  const ps = "Get-CimInstance Win32_Process -Filter \"Name='ffmpeg.exe' OR Name='node.exe'\" | ForEach-Object { \"$($_.ProcessId)`t$($_.ParentProcessId)`t$($_.CommandLine)\" }";
  const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { windowsHide: true, timeout: 20_000 }).toString();
  return out.split(/\r?\n/).filter(Boolean).map((l) => {
    const [pid, parent, ...cmd] = l.split("\t");
    return { pid: Number(pid), parent: Number(parent), cmd: cmd.join("\t") };
  });
}

/** Waits while KIVOXEL uses FFmpeg (checked every 30 s). If the check itself fails, it does not block. */
export async function waitForKivoxel(log: (m: string) => void) {
  for (let waited = 0; ; waited++) {
    let busy = false;
    try {
      busy = foreignFfmpeg(listProcs());
    } catch {}
    if (!busy) return;
    if (waited % 10 === 0) log("KIVOXEL gebruikt FFmpeg: Dreamnest wacht even...");
    await new Promise((r) => setTimeout(r, 30_000));
  }
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** One montage per folder: refuses to start while another live process holds the lock; frees it on exit. */
export function lockFolder(dir: string, what: string) {
  const f = join(dir, ".run.lock");
  if (existsSync(f)) {
    const pid = Number(readFileSync(f, "utf8").trim());
    if (pid && pid !== process.pid && alive(pid)) throw new Error(`Er draait al een ${what} in deze map (proces ${pid}). Wacht tot die klaar is.`);
  }
  writeFileSync(f, String(process.pid));
  process.on("exit", () => {
    try {
      if (readFileSync(f, "utf8").trim() === String(process.pid)) rmSync(f, { force: true });
    } catch {}
  });
}
