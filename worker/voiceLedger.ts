// 23-11-2026: the voice-over split per channel and format (lib/youtube/voicePlan.ts), kept in one file on this pc
// (<data>/voice-plan.json). One worker runs at a time; the lock below keeps two montages of this worker from writing
// at the same moment.
import { readFile, rename, writeFile } from "node:fs/promises";
import { decideVoice, ledgerKey, markDelivered, releaseSlot, voiceSummary, type Slot, type VoiceFormat, type VoiceLedger } from "../lib/youtube/voicePlan.ts";

export function createVoiceLedger(file: string) {
  let lock: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = lock.then(fn, fn);
    lock = next.catch(() => undefined);
    return next;
  };
  const load = async (): Promise<VoiceLedger> => JSON.parse(await readFile(file, "utf8").catch(() => "{}")) as VoiceLedger;
  const save = async (l: VoiceLedger) => {
    await writeFile(`${file}.tmp`, JSON.stringify(l, null, 2), "utf8");
    await rename(`${file}.tmp`, file);
  };
  return {
    /** The choice for this production; `dropped`: videos of this channel that are archived for good (their places come free). */
    decide: (channelId: string, format: VoiceFormat, videoId: string, tell: { value: number; why: string }, dropped: string[] = []) =>
      serial(async (): Promise<Slot & { existing: boolean }> => {
        const key = ledgerKey(channelId, format);
        let l = await load();
        for (const id of dropped) if (id !== videoId) l = releaseSlot(l, key, id);
        const r = decideVoice(l, key, format, videoId, tell, new Date());
        await save(r.ledger);
        return { ...r.slot, existing: r.existing };
      }),
    delivered: (channelId: string, format: VoiceFormat, videoId: string) => serial(async () => save(markDelivered(await load(), ledgerKey(channelId, format), videoId))),
    /** All slots of a channel and format (to find the ones whose video was archived). */
    slots: async (channelId: string, format: VoiceFormat) => (await load())[ledgerKey(channelId, format)] ?? [],
    summary: async () => {
      const l = await load();
      return Object.keys(l).map((key) => {
        const [channelId, format] = key.split(":") as [string, VoiceFormat];
        return { channelId, format, ...voiceSummary(l, key, format) };
      });
    },
  };
}
export type VoiceLedgerStore = ReturnType<typeof createVoiceLedger>;
