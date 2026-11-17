"use client";
// Zelf uploaden (17-11-2026): the montage, a thumbnail and the texts to put a video on YouTube by hand in YouTube Studio,
// for days when the YouTube API quota is used up. Uploading by hand does not count for the API quota.
import { useEffect, useRef, useState } from "react";
import { downloadName } from "@/lib/youtube/downloadName";
import { WORKER_URL } from "@/lib/youtube/protocol";
import { linkManualUpload } from "@/lib/youtube/workerClient";

type SaveHandle = { createWritable: () => Promise<WritableStream<Uint8Array>> };
type SavePicker = (o: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<SaveHandle>;

/**
 * Saves a file from the worker. The worker only serves files to the Studio (Origin required), so a plain link does not
 * work: fetch it. Chrome asks where to save first (the click must open the dialog) and then streams straight to disk,
 * so a long video does not have to fit in memory; other browsers get an ordinary download.
 */
async function saveFromWorker(file: string, name: string): Promise<boolean> {
  const mp4 = name.endsWith(".mp4");
  const picker = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
  let handle: SaveHandle | null = null;
  if (picker) {
    try {
      handle = await picker({ suggestedName: name, types: [mp4 ? { description: "Video", accept: { "video/mp4": [".mp4"] } } : { description: "Afbeelding", accept: { "image/jpeg": [".jpg"] } }] });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return false;
      handle = null;
    }
  }
  const res = await fetch(`${WORKER_URL}/renders/${encodeURIComponent(file)}`);
  if (!res.ok || !res.body) throw new Error(`De werker gaf het bestand niet (${res.status}).`);
  if (handle) {
    await res.body.pipeTo(await handle.createWritable());
    return true;
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}

const WHEN = new Intl.DateTimeFormat("nl-NL", { timeZone: "Europe/Amsterdam", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function SelfUpload({ videoId, renderFile, thumbs, title, description, tags, workerOnline, onLinked, startOpen = false, onRemember }: { videoId: string; renderFile: string | null; thumbs: { file: string; label: string }[]; title: string; description: string; tags: string[]; workerOnline: boolean; onLinked?: () => void; /** Opened with the "Zelf uploaden" button on the card. */ startOpen?: boolean; /** Stores the chosen title, so the worker can recognise the upload by it. */ onRemember?: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [link, setLink] = useState("");
  const box = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (startOpen) box.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [startOpen]);
  if (!renderFile) return null;

  async function connect() {
    setBusy("link");
    setNote(null);
    try {
      const r = await linkManualUpload(videoId, link);
      setNote(r.status === "scheduled" && r.publishAt ? `Gekoppeld: "${r.title}" staat bij Ingepland (openbaar op ${WHEN.format(new Date(r.publishAt))}).` : `Gekoppeld: "${r.title}" staat bij Live op YouTube.`);
      setLink("");
      onLinked?.();
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Koppelen lukte niet.");
    } finally {
      setBusy(null);
    }
  }

  async function save(file: string, name: string, what: string) {
    setBusy(file);
    setNote(null);
    void onRemember?.();
    try {
      if (await saveFromWorker(file, name)) setNote(`${what} opgeslagen als "${name}".`);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Downloaden lukte niet.");
    } finally {
      setBusy(null);
    }
  }
  async function copy(text: string, what: string) {
    if (what === "Titel") void onRemember?.();
    try {
      await navigator.clipboard.writeText(text);
      setNote(`${what} gekopieerd.`);
    } catch {
      setNote("Kopiëren lukte niet; selecteer de tekst hierboven en kopieer hem zelf.");
    }
  }

  const button = "rounded-md border border-slate-300 px-2 py-1 hover:bg-slate-50 disabled:opacity-50";
  return (
    <details ref={box} open={startOpen || undefined} className="scroll-mt-4 rounded-md border border-cyan-200 bg-cyan-50/60 p-2">
      <summary className="cursor-pointer font-medium">⬇ Zelf uploaden in YouTube Studio</summary>
      <div className="mt-2 space-y-2">
        <ol className="list-decimal space-y-0.5 pl-5 text-slate-600">
          <li>Kies hierboven de titel en download de video en een thumbnail.</li>
          <li>Upload hem op studio.youtube.com met <b>precies die titel</b> (hashtags erachter mag).</li>
          <li>Klaar: de Studio vindt hem binnen 10 minuten vanzelf en zet hem bij Ingepland of Live.</li>
        </ol>
        {!workerOnline && <p className="text-amber-700">Start de werker om te kunnen downloaden.</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={button} disabled={!workerOnline || !!busy} onClick={() => void save(renderFile, downloadName(title, "mp4"), "Video")}>
            {busy === renderFile ? "Bezig met downloaden…" : "⬇ Video downloaden"}
          </button>
          {thumbs.map((t, i) => (
            <button key={t.file} type="button" className={button} disabled={!workerOnline || !!busy} onClick={() => void save(t.file, downloadName(`${title} thumbnail ${i + 1}`, "jpg", `kivoxel-thumbnail-${i + 1}`), "Thumbnail")}>
              {busy === t.file ? "Bezig…" : `⬇ Thumbnail ${t.label}`}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={button} disabled={!title} onClick={() => void copy(title, "Titel")}>Titel kopiëren</button>
          <button type="button" className={button} disabled={!description} onClick={() => void copy(description, "Beschrijving")}>Beschrijving kopiëren</button>
          <button type="button" className={button} disabled={!tags.length} onClick={() => void copy(tags.join(", "), "Tags")}>Tags kopiëren</button>
        </div>
        {note && <p className="text-slate-600" role="status">{note}</p>}
        <p className="text-slate-500">Let op: zet bij het uploaden zelf &quot;Gemaakt voor kinderen&quot;, de zichtbaarheid en, als er een gekloonde stem in zit, de AI-melding goed.</p>
        <details className="rounded-md border border-slate-200 p-2">
          <summary className="cursor-pointer text-slate-600">Lukt het niet automatisch? Plak de link</summary>
          <p className="mt-1 text-slate-500">Bijvoorbeeld als je een andere titel hebt gebruikt. De Studio zet hem dan bij Ingepland of Live, en verstuurt hem nooit nog een keer.</p>
          <div className="mt-1 flex flex-wrap gap-2">
            <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://youtube.com/shorts/…" className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1" aria-label="YouTube-link" />
            <button type="button" className={button} disabled={!workerOnline || !link.trim() || !!busy} onClick={() => void connect()}>
              {busy === "link" ? "Bezig…" : "Koppelen"}
            </button>
          </div>
        </details>
      </div>
    </details>
  );
}
