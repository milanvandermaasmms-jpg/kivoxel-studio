// KIVOXEL fase 1, section 9: the mini report in the review. Per check ✅/⚠️/❌, plus the chosen hook, length bucket,
// audio mode and whether the free engine (no AI) wrote the script. Reads what the worker stored with the montage.
import type { QcItem } from "@/lib/youtube/qc";

/** The checks of section 9, in this order; anything else in the QC list is shown by the general list already. */
const ORDER = ["vo_sync", "hook_words", "hook_type", "hook_fresh", "hook_safe", "thumbnail_header", "length_bucket", "length_varies", "dead_air", "first_frame", "interrupts", "loudness_target", "audio_mode", "chapters"];

type Qc = { items?: QcItem[]; audio?: { label?: string; music?: string | null; voiceEngine?: string | null }; fx?: { zoom?: string; captions?: string }; chapters?: string[] } | null | undefined;

export function MiniReport({ qc, topLine, model, short }: { qc: Qc; topLine: string | null; model?: string | null; short: boolean }) {
  // Only for montages made with the fase-1 chain (older ones have loudness lines too, but none of the new checks).
  if (!qc?.audio && !(qc?.items ?? []).some((i) => ["vo_sync", "hook_words", "audio_mode", "dead_air"].includes(i.key))) return null;
  const items = (qc?.items ?? []).filter((i) => ORDER.includes(i.key)).sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));
  // The thumbnail check only adds a line when a header was refused; no line means every thumbnail passed.
  if (items.length && !items.some((i) => i.key === "thumbnail_header")) items.splice(Math.max(0, items.findIndex((i) => i.key === "length_bucket")), 0, { key: "thumbnail_header", label: "Thumbnail-header geel", level: "green", value: "goed", note: "" });
  if (!items.length) return null;
  const bucket = items.find((i) => i.key === "length_bucket")?.value;
  const icon = (l: QcItem["level"]) => (l === "green" ? "✅" : l === "orange" ? "⚠️" : "❌");
  return (
    <section className="space-y-2 rounded-md border border-slate-200 p-3 text-xs">
      <p className="font-medium text-slate-800">Mini-rapport</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-slate-700">
        {short && topLine && (
          <>
            <dt className="text-slate-500">Hook</dt>
            <dd className="font-medium">{topLine}</dd>
          </>
        )}
        {bucket && (
          <>
            <dt className="text-slate-500">Lengte</dt>
            <dd>{bucket}</dd>
          </>
        )}
        <dt className="text-slate-500">Geluid</dt>
        <dd>
          {qc?.audio?.label ?? "oude mix"}
          {qc?.audio?.music ? ` · ${qc.audio.music}` : ""}
          {qc?.audio?.voiceEngine ? ` · stem: ${qc.audio.voiceEngine}` : ""}
        </dd>
        <dt className="text-slate-500">Script</dt>
        <dd>{model === "gratis-engine" ? "gratis engine (zonder AI)" : model ? `AI (${model})` : "onbekend"}</dd>
        {qc?.fx && (
          <>
            <dt className="text-slate-500">Stijl</dt>
            <dd>
              zoom {qc.fx.zoom}, captions {qc.fx.captions}
            </dd>
          </>
        )}
      </dl>
      <ul className="space-y-0.5">
        {items.map((i) => (
          <li key={i.key} className={i.level === "red" ? "text-red-800" : i.level === "orange" ? "text-amber-800" : "text-slate-700"}>
            {icon(i.level)} {i.label}: {i.value}
            {i.level !== "green" && i.note ? <span className="text-slate-500"> ({i.note})</span> : null}
          </li>
        ))}
      </ul>
      {qc?.chapters?.length ? <p className="whitespace-pre-line text-slate-600">Hoofdstukken voor de beschrijving:{"\n"}{qc.chapters.join("\n")}</p> : null}
    </section>
  );
}
