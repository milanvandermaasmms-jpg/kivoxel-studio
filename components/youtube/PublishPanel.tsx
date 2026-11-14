"use client";

import { CheckCircle2, Rocket } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useEffect, useRef, useState } from "react";
import { StatusBadge } from "@/components/shell/StatusBadge";
import { Button, Dialog } from "@/components/ui/Dialog";
import { SuggestBox, TagChips } from "@/components/youtube/SuggestBox";
import { PRIVACY } from "@/lib/youtube/flow";
import { PrivacyBadge } from "@/components/youtube/FlowBadges";
import { amsterdamHhmm, defaultSlot, defaultTags, nextSlot } from "@/lib/youtube/learning";
import { loadLearning, track } from "@/lib/youtube/learningData";
import type { Hook } from "@/lib/youtube/hooks";
import {
  amsterdamToIso,
  descriptionSuggestion,
  draftAdvice,
  draftProblems,
  EMPTY_DRAFT,
  hashtags,
  isoToAmsterdam,
  tagsLength,
  titleSuggestions,
  uploadProblems,
  utf8Bytes,
  DESCRIPTION_MAX_BYTES,
  TAGS_MAX,
  TITLE_MAX,
  type PublicationDraft,
  type Visibility,
} from "@/lib/youtube/publication";
import { CaptionsChoice, ExtrasAfterUpload, SlotSuggestion, ThumbnailPicker } from "@/components/youtube/PublishExtras";
import { GateList } from "@/components/youtube/GateList";
import { hasRed, publicationGate, videoGate } from "@/lib/youtube/gatekeeper";
import { loadGateContext, loadThumbs, type GateContext } from "@/lib/youtube/gatekeeperData";
import { WORKER_URL } from "@/lib/youtube/protocol";
import type { StoredThumb } from "@/lib/youtube/thumbnails";
import { loadPublication, loadUploadProgress, PUBLICATION_STATUS, requestPublish, savePublication, type DbPublication, type Extras, type PublishAction, type UploadProgress } from "@/lib/youtube/publicationData";

const IN_TRANSIT = ["queued", "uploading", "processing"];

type Confirm = { action: PublishAction; at: string | null; visibility: "public" | "unlisted" | null };
const when = (iso: string) => new Date(iso).toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam", dateStyle: "full", timeStyle: "short" });

/** What exactly happens, in plain Dutch, before Milan confirms. */
function confirmText(c: Confirm, onYouTube: boolean): string {
  if (c.action === "private")
    return onYouTube
      ? "De video wordt weer privé op YouTube; een ingepland moment vervalt. Alleen jij kunt hem dan nog zien."
      : "De werker zet deze montage privé op het gekoppelde YouTube-kanaal. Alleen jij kunt hem daar zien; er wordt niets openbaar gemaakt. Dit telt als 1 van de 100 uploads van vandaag.";
  if (c.action === "schedule")
    return `${onYouTube ? "De video blijft" : "De video komt"} privé op YouTube, en YouTube zet hem zelf openbaar op ${c.at ? when(c.at) : "het gekozen moment"}. De pc hoeft dan niet aan te staan. Tot dat moment kun je hem nog terugzetten naar privé.`;
  return c.visibility === "unlisted"
    ? `De video wordt ${onYouTube ? "" : "geüpload en "}meteen verborgen gepubliceerd: alleen wie de link heeft, kan hem zien.`
    : `De video wordt ${onYouTube ? "" : "geüpload en "}meteen OPENBAAR voor iedereen. Terugzetten naar privé kan daarna wel, maar wie hem al zag, heeft hem gezien.`;
}

function stateText(p: DbPublication): string {
  if (p.status === "uploaded") return "Deze video staat privé op YouTube.";
  if (p.status === "scheduled") return p.publish_at ? `Ingepland: YouTube zet hem openbaar op ${when(p.publish_at)}.` : "Ingepland.";
  if (p.status === "published") return p.visibility === "public" ? "Deze video is openbaar op YouTube." : "Deze video is verborgen gepubliceerd (alleen met link).";
  return "De werker is bezig met YouTube; dit concept kan nu niet worden gewijzigd.";
}

/** After the upload: schedule, publish now or back to private, each with its own confirmation. Test videos stay private. */
function AfterUpload({ current, busy, onAsk, studioId }: { current: DbPublication; busy: boolean; onAsk: (c: Confirm) => void; studioId: string }) {
  const [at, setAt] = useState(isoToAmsterdam(current.publish_at));
  const [vis, setVis] = useState<"public" | "unlisted">("public");
  const iso = amsterdamToIso(at);
  const soon = !iso || Date.parse(iso) < Date.now() + 15 * 60_000;
  const field = "min-w-0 rounded-md border border-slate-300 bg-transparent px-2 py-1";
  if (current.is_test) return <p className="text-slate-600">Testvideo: die blijft privé op YouTube. Verwijderen kan in YouTube Studio.</p>;
  return (
    <div className="space-y-2 rounded-md border border-slate-200 p-2">
      <p className="font-medium">Zichtbaarheid op YouTube wijzigen</p>
      {current.status !== "published" && (
        <div className="flex flex-wrap items-center gap-2">
          <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} className={field} aria-label="Moment van publiceren (Nederlandse tijd)" />
          <Button variant="secondary" disabled={busy || soon} onClick={() => onAsk({ action: "schedule", at: iso, visibility: null })}>
            {current.status === "scheduled" ? "Ander moment" : "Inplannen"}
          </Button>
          <SlotSuggestion studioId={studioId} onUse={(s) => setAt(isoToAmsterdam(s))} disabled={busy} />
          {soon && at && <span className="text-amber-800">Minstens een kwartier vooruit.</span>}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <select value={vis} onChange={(e) => setVis(e.target.value as "public" | "unlisted")} className={field} aria-label="Openbaar of verborgen">
          <option value="public">Openbaar</option>
          <option value="unlisted">Niet vermeld (alleen met link)</option>
        </select>
        <Button variant="secondary" disabled={busy || (current.status === "published" && current.visibility === vis)} onClick={() => onAsk({ action: "publish", at: null, visibility: vis })}>
          Nu publiceren
        </Button>
        {(current.status === "scheduled" || current.status === "published") && (
          <Button variant="ghost" disabled={busy} onClick={() => onAsk({ action: "private", at: null, visibility: null })}>
            Terug naar privé
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Fase 1.5: 🔒 Privé | 🔗 Niet vermeld | 🌍 Openbaar as one clear control, Privé by default. Openbaar asks first.
 * Inplannen (Europe/Amsterdam) keeps the video private on YouTube until that moment; YouTube then makes it public.
 */
function PrivacyControl({ draft, set, disabled, isTest, studioId, log }: { draft: PublicationDraft; set: (patch: Partial<PublicationDraft>) => void; disabled: boolean; isTest: boolean; studioId: string; log: (action: string, metadata: Record<string, unknown>) => void }) {
  const [askPublic, setAskPublic] = useState(false);
  const [planning, setPlanning] = useState(!!draft.publish_at);
  // A time can also arrive later (a saved draft, or a default from a Studio-tip): then show it as planned.
  useEffect(() => {
    if (draft.publish_at) setPlanning(true);
  }, [draft.publish_at]);
  const field = "min-w-0 rounded-md border border-slate-300 bg-transparent px-2 py-1";
  const options: { key: Visibility; active: string }[] = [
    { key: "private", active: "border-[#475569] bg-[#475569] text-white" },
    { key: "unlisted", active: "border-orange-500 bg-orange-500 text-white" },
    { key: "public", active: "border-[#059669] bg-[#059669] text-white" },
  ];
  const choose = (v: Visibility) => {
    if (v === "public" && draft.visibility !== "public") return setAskPublic(true);
    log("privacy_chosen", { visibility: v });
    setPlanning(false);
    set({ visibility: v, publish_at: null });
  };
  return (
    <div className="space-y-2">
      <span className="font-medium">Wie mag de video zien?</span>
      <div role="radiogroup" aria-label="Zichtbaarheid op YouTube" className="grid grid-cols-3 overflow-hidden rounded-lg border border-slate-300 text-sm">
        {options.map((o) => {
          const on = draft.visibility === o.key && !(o.key === "private" && planning);
          const p = PRIVACY[o.key];
          const off = disabled || (isTest && o.key !== "private");
          return (
            <button key={o.key} type="button" role="radio" aria-checked={on} disabled={off} onClick={() => choose(o.key)} className={`flex min-h-11 items-center justify-center gap-1.5 border-r border-slate-300 px-2 py-2 font-medium last:border-r-0 disabled:opacity-40 ${on ? o.active : "hover:bg-slate-50"}`}>
              <span aria-hidden>{p.icon}</span> {p.label}
            </button>
          );
        })}
      </div>
      <p className="text-slate-500">
        {isTest ? "Testvideo: gaat alleen privé naar YouTube." : draft.visibility === "private" ? (planning ? "Blijft privé tot het ingeplande moment; dan zet YouTube hem zelf openbaar (de pc hoeft niet aan)." : "Alleen jij kunt hem zien.") : draft.visibility === "unlisted" ? "Alleen wie de link heeft, kan hem zien." : "Iedereen kan hem vinden en zien."}
      </p>
      {!isTest && (
        <div className="space-y-2 rounded-md bg-slate-50 p-2">
          <label className="flex items-center gap-2 font-medium">
            <input
              type="checkbox"
              checked={planning}
              disabled={disabled}
              onChange={(e) => {
                setPlanning(e.target.checked);
                set(e.target.checked ? { visibility: "private" } : { publish_at: null });
                log("schedule_toggled", { on: e.target.checked });
              }}
            />
            🗓️ Publicatie inplannen
          </label>
          {planning && (
            <div className="flex flex-wrap items-center gap-2">
              <input type="datetime-local" value={isoToAmsterdam(draft.publish_at)} disabled={disabled} onChange={(e) => set({ visibility: "private", publish_at: amsterdamToIso(e.target.value) })} className={field} aria-label="Moment van publiceren (Nederlandse tijd)" />
              <span className="text-slate-500">Nederlandse tijd (Europe/Amsterdam)</span>
              <SlotSuggestion studioId={studioId} onUse={(iso) => set({ visibility: "private", publish_at: iso })} />
            </div>
          )}
        </div>
      )}
      <Dialog open={askPublic} onClose={() => setAskPublic(false)} title="Openbaar maken?">
        <div className="space-y-3 p-4 text-sm">
          <p className="font-medium">🌍 Deze video wordt voor iedereen zichtbaar.</p>
          <p className="text-slate-600">Er gaat nog niets naar YouTube: je kiest nu alleen de zichtbaarheid. Bij &quot;Naar YouTube sturen&quot; vragen we het nog één keer.</p>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => {
                setPlanning(false);
                set({ visibility: "public", publish_at: null });
                log("privacy_chosen", { visibility: "public" });
                setAskPublic(false);
              }}
            >
              Ja, openbaar
            </Button>
            <Button variant="ghost" onClick={() => setAskPublic(false)}>
              Nee, laat staan
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

/** Progress of the worker talking to YouTube, from the newest upload step. */
function UploadBar({ progress }: { progress: UploadProgress | null }) {
  const share = progress?.progress ?? null;
  return (
    <div className="space-y-1" role="status">
      <div className="h-2 w-full overflow-hidden rounded bg-cyan-50">{share !== null ? <div className="h-full bg-cyan-500 transition-[width] duration-700" style={{ width: `${Math.round(share * 100)}%` }} /> : <div className="h-full w-1/3 animate-pulse bg-cyan-300" />}</div>
      <p className="tabular-nums text-cyan-900">
        {progress?.status === "queued" ? "Wacht op de werker op de pc…" : (progress?.phase ?? "Bezig met YouTube…")}
        {share !== null ? ` · ${Math.round(share * 100)}%` : ""}
        {progress?.totalBytes ? ` · ${((progress.sentBytes ?? 0) / 1048576).toFixed(1)} van ${(progress.totalBytes / 1048576).toFixed(1)} MB` : ""}
      </p>
    </div>
  );
}

/** Test videos are never planned: they only go to YouTube as private. */
const isTestVideo = (c: GateContext) => !!(c.script as { is_test?: boolean } | null)?.is_test;

const toDraft = (p: DbPublication): PublicationDraft => ({
  title: p.title,
  description: p.description,
  tags: p.tags,
  category_id: p.category_id,
  language: p.language,
  made_for_kids: p.made_for_kids,
  contains_synthetic_media: p.contains_synthetic_media,
  visibility: p.visibility,
  publish_at: p.publish_at,
});

function Counter({ used, max, unit }: { used: number; max: number; unit: string }) {
  return <span className={`text-[11px] tabular-nums ${used > max ? "font-medium text-red-700" : used > max * 0.9 ? "text-amber-700" : "text-slate-500"}`}>{used} / {max} {unit}</span>;
}

function YesNo({ name, value, onChange, yes, no }: { name: string; value: boolean | null; onChange: (v: boolean) => void; yes: string; no: string }) {
  return (
    <div className="flex flex-wrap gap-3">
      {[
        [false, no],
        [true, yes],
      ].map(([v, label]) => (
        <label key={String(v)} className="flex items-center gap-1.5">
          <input type="radio" name={name} checked={value === v} onChange={() => onChange(v as boolean)} />
          {label as string}
        </label>
      ))}
      {value === null && <span className="text-amber-800">nog niet gekozen</span>}
    </div>
  );
}

/**
 * Publication screen for an approved video (fase D2, 2.2 chapter 6 and 24.9). Saves a draft in the database only.
 * Uploading, scheduling and publishing (D3-D4) are always an explicit click of Milan; they are shown as "later" here.
 */
const extrasOf = (p: DbPublication): Extras => ({ captions_enabled: p.captions_enabled ?? true, thumbnail_ms: p.thumbnail_ms ?? null });

export function PublishPanel({ studioId, videoId, kind, language, hook, renderId, renderLabel, renderFile = null, renderMs = null, workerOnline = false, onWatch }: { studioId: string; videoId: string; kind: "short" | "long"; language: "en" | "nl"; hook: Hook | null; renderId: string | null; renderLabel: string | null; renderFile?: string | null; renderMs?: number | null; workerOnline?: boolean; onWatch?: () => void }) {
  const [row, setRow] = useState<DbPublication | null | "migration" | undefined>(undefined);
  const [draft, setDraft] = useState<PublicationDraft>(EMPTY_DRAFT(language));
  const [busy, setBusy] = useState(false);
  const [upload, setUpload] = useState<UploadProgress | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [fromTip, setFromTip] = useState<string | null>(null);
  const wasTransit = useRef(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirming, setConfirming] = useState<Confirm | null>(null);
  const [extras, setExtras] = useState<Extras>({ captions_enabled: true, thumbnail_ms: null });
  const [gateCtx, setGateCtx] = useState<GateContext | null>(null);
  const [thumbs, setThumbs] = useState<StoredThumb[]>([]);
  const channelId = gateCtx?.channel?.id ?? null;
  const log = (action: string, metadata: Record<string, unknown> = {}) => track(studioId, action, "klaar", { video: videoId, kind, ...metadata }, channelId);

  useEffect(() => {
    let live = true;
    if (renderId) void loadThumbs(renderId).then((t) => live && setThumbs(t));
    return () => {
      live = false;
    };
  }, [renderId]);

  // What the Poortwachter needs: channel profile, private words, approved script and privacy flags.
  useEffect(() => {
    let live = true;
    loadGateContext(studioId, videoId)
      .then((c) => live && setGateCtx(c))
      .catch(() => live && setGateCtx(null));
    return () => {
      live = false;
    };
  }, [studioId, videoId]);

  useEffect(() => {
    let live = true;
    loadPublication(videoId)
      .then((p) => {
        if (!live) return;
        setRow(p);
        if (p && p !== "migration") {
          setDraft(toDraft(p));
          setExtras(extrasOf(p));
        } else if (p === null) {
          // A new draft starts with the working title of the video, if there is one (also one applied from Ivar).
          void supabase.from("yt_videos").select("title").eq("id", videoId).maybeSingle<{ title: string | null }>().then(({ data }) => {
            if (live && data?.title) setDraft((d) => (d.title ? d : { ...d, title: data.title!.slice(0, 100) }));
          });
        }
      })
      .catch((e) => live && setMessage({ ok: false, text: e instanceof Error ? e.message : "Laden lukte niet." }));
    return () => {
      live = false;
    };
  }, [videoId]);

  // Fase 2.2: a new draft starts with what Milan made standard via a Studio-tip (tags and a publish time). Privé stays
  // the default: a time only plans the video, sending it to YouTube is still his click.
  const defaultsDone = useRef(false);
  useEffect(() => {
    if (row !== null || !gateCtx || defaultsDone.current) return;
    defaultsDone.current = true;
    let live = true;
    void loadLearning(studioId)
      .then((l) => {
        if (!live || !l.ready) return;
        const tags = defaultTags(l.prefs, channelId);
        const slot = isTestVideo(gateCtx) ? null : defaultSlot(l.prefs, channelId, kind);
        const at = slot ? nextSlot(slot) : null;
        if (!tags.length && !at) return;
        setDraft((d) => ({ ...d, tags: d.tags.length ? d.tags : tags, ...(at && !d.publish_at && d.visibility === "private" ? { publish_at: at } : {}) }));
        setFromTip([tags.length ? `standaardtags (${tags.join(", ")})` : "", at ? `inplannen om ${slot}` : ""].filter(Boolean).join(" en "));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [row, gateCtx, studioId, channelId, kind]);

  // While the worker uploads, look every 3 seconds how far it is; when it is done, show where it went.
  const transit = !!row && row !== "migration" && IN_TRANSIT.includes(row.status);
  useEffect(() => {
    if (!row || row === "migration") return;
    if (wasTransit.current && !transit && row.youtube_video_id && row.status !== "failed")
      setSuccess(row.status === "published" ? (row.visibility === "public" ? "De video staat openbaar op YouTube." : "De video staat op YouTube (niet vermeld).") : row.status === "scheduled" ? "De video staat ingepland op YouTube." : "De video staat privé op YouTube.");
    wasTransit.current = transit;
  }, [row, transit]);
  useEffect(() => {
    if (!transit) return;
    const tick = () => {
      void loadUploadProgress(videoId).then(setUpload);
      void loadPublication(videoId)
        .then((p) => p && p !== "migration" && setRow(p))
        .catch(() => undefined);
    };
    tick();
    const timer = window.setInterval(tick, 3000);
    return () => window.clearInterval(timer);
  }, [transit, videoId]);

  // Same height as the form while loading, so the page does not jump when it appears.
  if (row === undefined) return <div aria-busy className="mt-2 h-64 animate-pulse rounded-md border border-slate-200 bg-slate-50" />;
  if (row === "migration")
    return (
      <div className="mt-2 rounded-md border border-slate-200 px-3 py-2 text-xs text-slate-600">
        Publiceren <StatusBadge status="later" />: het publicatiescherm komt er met migratie 037 (nog niet uitgevoerd).
      </div>
    );

  const current: DbPublication | null = row;
  const locked = !!current && current.status !== "draft" && current.status !== "failed";
  const set = (patch: Partial<PublicationDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setMessage(null);
  };
  // Before migration 040 an existing draft has no caption/thumbnail columns; a new draft simply tries them.
  const extrasReady = !row || row.captions_enabled !== undefined;
  const saved = row ? JSON.stringify(toDraft(row)) === JSON.stringify(draft) && row.render_id === renderId && (!extrasReady || JSON.stringify(extrasOf(row)) === JSON.stringify(extras)) : false;
  const problems = draftProblems(draft);
  const before = uploadProblems(draft);
  const advice = draftAdvice(draft, kind);
  const gate = gateCtx ? [...videoGate(gateCtx), ...publicationGate({ draft, channel: gateCtx.channel, privateTerms: gateCtx.privateTerms })] : [];
  const titles = titleSuggestions(hook);
  const aiTitles = gateCtx?.script?.titles ?? [];
  const field = "w-full min-w-0 rounded-md border border-slate-300 bg-transparent px-2 py-1";

  // What may be sent: Milan's complete, saved choices. The database checks all of this again.
  // A test video is known from its script before there is a draft: it only ever goes to YouTube as private.
  const isTest = current ? !!current.is_test : !!gateCtx && isTestVideo(gateCtx);
  const onYouTube = !!current?.youtube_video_id;
  const base = uploadProblems({ ...draft, publish_at: null });
  const scheduleOk = draft.visibility === "private" && !!draft.publish_at && before.length === 0;
  const publishOk = draft.visibility !== "private" && !draft.publish_at;
  const canAfter = onYouTube && !!current && ["uploaded", "scheduled", "published", "failed"].includes(current.status);
  // The one big button: what it does follows from the privacy choice. Saving happens first when needed.
  const sendable = !locked && !onYouTube && base.length === 0 && !!renderId && !hasRed(gate) && problems.length === 0;
  const primary: Confirm | null = !sendable ? null : draft.publish_at ? (isTest || !scheduleOk ? null : { action: "schedule", at: draft.publish_at, visibility: null }) : draft.visibility === "private" ? { action: "private", at: null, visibility: null } : isTest || !publishOk ? null : { action: "publish", at: null, visibility: draft.visibility as "public" | "unlisted" };
  const whyNot = !renderId ? "Er is nog geen montage." : base[0] ?? problems[0] ?? (hasRed(gate) ? "De Poortwachter blokkeert deze video (zie de rode punten)." : before[0] ?? null);

  async function send(c: Confirm) {
    setBusy(true);
    try {
      let target = current;
      // One click: save the draft first when it changed, then hand it to the worker.
      if (!onYouTube && (!target || !saved)) {
        target = await savePublication(studioId, videoId, renderId, draft, current ? current.id : null, extrasReady ? extras : undefined);
        setRow(target);
      }
      if (!target) throw new Error("Er is nog geen concept.");
      await requestPublish(target.id, c.action, c.at, c.visibility);
      log("publish_sent", { action: c.action, visibility: c.visibility ?? (c.action === "private" ? "private" : null), publish_at: c.at, hhmm: c.at ? amsterdamHhmm(c.at) : null, tags: draft.tags.slice(0, 20) });
      setConfirming(null);
      const fresh = await loadPublication(videoId);
      if (fresh && fresh !== "migration") setRow(fresh);
      setMessage({ ok: true, text: "De werker regelt het nu met YouTube. De voortgang staat hierboven." });
      setSuccess(null);
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "Starten lukte niet." });
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    try {
      const stored = await savePublication(studioId, videoId, renderId, draft, current ? current.id : null, extrasReady ? extras : undefined);
      setRow(stored);
      setDraft(toDraft(stored));
      setExtras(extrasOf(stored));
      setMessage({ ok: true, text: "Concept opgeslagen. Er is niets naar YouTube gestuurd." });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "Opslaan lukte niet." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 space-y-3 rounded-md border border-slate-200 p-3 text-xs text-slate-700">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium">Publiceren op YouTube</p>
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">{row ? PUBLICATION_STATUS[row.status] : "Nog geen concept"}</span>
        <PrivacyBadge publication={current ?? { status: "draft", visibility: draft.visibility, publish_at: draft.publish_at }} />
        {row?.is_test && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">testvideo</span>}
      </div>

      {/* Fase 1.2: the primary action sits at the top of the card, never between the other buttons. */}
      {!locked && !onYouTube && (
        <div className="space-y-1.5 rounded-lg border-2 border-violet-200 bg-violet-50 p-3">
          <button type="button" disabled={!primary || busy} onClick={() => primary && setConfirming(primary)} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-[#7c3aed] px-6 text-base font-semibold text-white shadow-sm hover:bg-[#6d28d9] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 sm:w-auto">
            <Rocket className="h-5 w-5" aria-hidden /> Naar YouTube sturen
          </button>
          <p className="text-violet-900">
            {primary
              ? primary.action === "private"
                ? "Gaat privé naar YouTube: alleen jij kunt hem zien."
                : primary.action === "schedule"
                  ? `Gaat privé naar YouTube en wordt openbaar op ${primary.at ? when(primary.at) : "het gekozen moment"}.`
                  : primary.visibility === "public"
                    ? "Gaat meteen openbaar op YouTube (je krijgt eerst nog een vraag)."
                    : "Gaat niet vermeld op YouTube: alleen met de link te zien."
              : `Nog niet klaar: ${whyNot ?? "kies eerst de zichtbaarheid."}`}
          </p>
        </div>
      )}
      {transit && <UploadBar progress={upload} />}
      {success && current?.youtube_video_id && (
        <div role="status" className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden />
          <span className="font-medium">{success}</span>
          <a href={`https://youtu.be/${current.youtube_video_id}`} target="_blank" rel="noreferrer" className="font-semibold underline underline-offset-2">
            Bekijk op YouTube
          </a>
        </div>
      )}

      {fromTip && !row && <p className="rounded bg-amber-50 px-2 py-1 text-amber-900">💡 Vooraf ingevuld uit je Studio-tips: {fromTip}. Pas gerust aan.</p>}
      <p className="text-slate-500">Montage: {renderLabel ?? "nog geen montage"}. Dit is de versie die geüpload wordt.</p>
      {row?.error && <p className="text-red-800">Laatste fout: {row.error}</p>}
      {locked && <p className="text-amber-800">{stateText(current!)}</p>}
      {current?.youtube_video_id && (
        <p className="flex flex-wrap gap-3">
          <a href={`https://youtu.be/${current.youtube_video_id}`} target="_blank" rel="noreferrer" className="font-medium text-cyan-700 underline underline-offset-2">
            Bekijk op YouTube ({current.status === "published" ? (current.visibility === "public" ? "openbaar" : "niet vermeld") : current.status === "scheduled" ? "ingepland" : "privé"})
          </a>
          <a href={`https://studio.youtube.com/video/${current.youtube_video_id}/edit`} target="_blank" rel="noreferrer" className="text-cyan-700 underline underline-offset-2">
            Openen in YouTube Studio
          </a>
        </p>
      )}
      {transit && onWatch && (
        <button type="button" onClick={onWatch} className="text-cyan-800 underline underline-offset-2">
          Alle stappen bekijken in In productie
        </button>
      )}

      <details open={!locked} className="group">
        <summary className={locked ? "cursor-pointer font-medium text-slate-600" : "hidden"}>Titel, beschrijving en tags zoals ze naar YouTube gingen</summary>
      <fieldset disabled={locked || busy} className="mt-2 space-y-3">
        <label className="grid gap-1">
          <span className="flex items-center justify-between gap-2">
            <span className="font-medium">Titel</span>
            <Counter used={draft.title.length} max={TITLE_MAX} unit="tekens" />
          </span>
          <input value={draft.title} onChange={(e) => set({ title: e.target.value })} placeholder="Minecraft: wat er gebeurt + context" className={field} />
        </label>
        {titles.length > 0 && aiTitles.length === 0 && (
          <div className="space-y-1">
            <p className="text-slate-500">Voorstellen uit de gekozen hook (geen AI, pas ze gerust aan):</p>
            <div className="flex flex-wrap gap-1.5">
              {titles.map((t) => (
                <button key={t} type="button" onClick={() => set({ title: t })} className="rounded-full border border-slate-300 px-2 py-0.5 text-left hover:bg-slate-50">
                  {t}
                </button>
              ))}
            </div>
          </div>
        )}
        {aiTitles.length > 0 && (
          <div className="space-y-1">
            <p className="text-slate-500">3 titelvarianten van de AI (zoekwoord, nieuwsgierigheid, uitdaging). Kies er een; de andere kun je in YouTube Studio bij Test &amp; Compare zetten:</p>
            <div className="flex flex-wrap gap-1.5">
              {aiTitles.map((t) => (
                <button key={t} type="button" onClick={() => set({ title: t.slice(0, TITLE_MAX) })} className={`rounded-full border px-2 py-0.5 text-left hover:bg-slate-50 ${draft.title === t ? "border-cyan-500" : "border-slate-300"}`}>
                  {t}
                </button>
              ))}
            </div>
          </div>
        )}

        <label className="grid gap-1">
          <span className="flex items-center justify-between gap-2">
            <span className="font-medium">Beschrijving</span>
            <span className="flex items-center gap-2">
              <span className="text-[11px] text-slate-500">{hashtags(draft.description)} hashtags</span>
              <Counter used={utf8Bytes(draft.description)} max={DESCRIPTION_MAX_BYTES} unit="bytes" />
            </span>
          </span>
          <textarea value={draft.description} rows={4} onChange={(e) => set({ description: e.target.value })} className={field} />
        </label>
        {!draft.description && (
          <button type="button" onClick={() => set({ description: descriptionSuggestion(hook, kind) })} className="text-slate-600 underline underline-offset-2">
            Begin met een voorstel (eerste zin van de hook en 3 hashtags)
          </button>
        )}

        <div className="grid gap-1">
          <span className="flex items-center justify-between gap-2">
            <span className="font-medium">Tags</span>
            <Counter used={tagsLength(draft.tags)} max={TAGS_MAX} unit="tekens" />
          </span>
          <TagChips tags={draft.tags} onChange={(tags) => set({ tags })} disabled={locked || busy} log={log} />
        </div>
        <SuggestBox studioId={studioId} videoId={videoId} channelId={channelId} title={draft.title} description={draft.description} tags={draft.tags} disabled={locked || busy} onTags={(tags) => set({ tags })} onTitle={(t) => set({ title: t.slice(0, TITLE_MAX) })} onDescription={(d) => set({ description: d })} />

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1">
            <span className="font-medium">Taal van de video</span>
            <select value={draft.language} onChange={(e) => set({ language: e.target.value as "en" | "nl" })} className={field}>
              <option value="en">Engels</option>
              <option value="nl">Nederlands</option>
            </select>
          </label>
          <div className="grid gap-1">
            <span className="font-medium">Categorie</span>
            <span className="py-1">Gaming</span>
          </div>
        </div>

        <div className="space-y-1 rounded-md bg-slate-50 p-2">
          <p className="font-medium">Doelgroep (verplicht, kies zelf)</p>
          <p className="text-slate-500">Is deze video gemaakt voor kinderen? Dat bepaalt onder meer reacties en advertenties. Er staat bewust niets voor ingevuld.</p>
          <YesNo name={`kids-${videoId}`} value={draft.made_for_kids} onChange={(v) => set({ made_for_kids: v })} no="Nee, niet voor kinderen gemaakt" yes="Ja, gemaakt voor kinderen" />
        </div>
        <div className="space-y-1 rounded-md bg-slate-50 p-2">
          <p className="font-medium">AI-melding (verplicht, kies zelf)</p>
          <p className="text-slate-500">Bevat de video realistische inhoud die gewijzigd of door AI gemaakt is (bijvoorbeeld een echt lijkende stem of persoon)? Een AI-verteller over gameplay kan hieronder vallen; twijfel je, kies dan Ja.</p>
          <YesNo name={`ai-${videoId}`} value={draft.contains_synthetic_media} onChange={(v) => set({ contains_synthetic_media: v })} no="Nee" yes="Ja, melden bij YouTube" />
        </div>

        <PrivacyControl draft={draft} set={set} disabled={locked || busy} isTest={isTest} studioId={studioId} log={log} />
        {extrasReady && !onYouTube && (
          <div className="space-y-2 rounded-md bg-slate-50 p-2">
            <CaptionsChoice value={extras.captions_enabled} onChange={(v) => setExtras({ ...extras, captions_enabled: v })} />
            {thumbs.length > 0 && (
              <div className="space-y-1">
                <p className="font-medium">Thumbnails van de werker</p>
                <p className="text-slate-500">Kies er een voor de upload. Ze staan ook als JPG in de map renders van de werker op je pc, voor Test &amp; Compare in YouTube Studio.</p>
                <ul className="grid grid-cols-3 gap-2">
                  {thumbs.map((t) => {
                    const chosen = extras.thumbnail_ms === t.at_ms;
                    return (
                      <li key={t.file}>
                        <button type="button" onClick={() => setExtras({ ...extras, thumbnail_ms: chosen ? null : t.at_ms })} aria-pressed={chosen} className={`block w-full overflow-hidden rounded-md border-2 text-left ${chosen ? "border-cyan-500" : "border-transparent"}`}>
                          {workerOnline ? <img src={`${WORKER_URL}/renders/${encodeURIComponent(t.file)}`} crossOrigin="anonymous" alt={`Thumbnail ${t.label}`} className="aspect-video w-full bg-black object-contain" /> : <span className="block bg-slate-100 p-2 text-slate-500">Start de werker om hem te zien</span>}
                          <span className="block px-1 py-0.5">
                            {t.label}
                            {chosen ? " · gekozen" : ""}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            <ThumbnailPicker file={renderFile} durationMs={renderMs} valueMs={extras.thumbnail_ms} onChange={(ms) => setExtras({ ...extras, thumbnail_ms: ms })} workerOnline={workerOnline} />
          </div>
        )}
        <p className="flex flex-wrap items-center gap-1.5 text-slate-500">
          {!extrasReady && <>Ondertitels en thumbnail: met migratie 040 · </>}Playlist <StatusBadge status="later" />
        </p>
      </fieldset>
      </details>

      {problems.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-4 text-red-800">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {advice.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-4 text-amber-800">
          {advice.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}

      {gate.length > 0 && !onYouTube && <GateList items={gate} />}
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={locked || busy || problems.length > 0 || saved} onClick={() => void save()}>
          {saved ? "Concept opgeslagen" : "Concept opslaan"}
        </Button>
      </div>
      {isTest && !locked && !onYouTube && <p className="text-slate-600">Dit is een testvideo: die gaat alleen privé naar YouTube, nooit openbaar of ingepland.</p>}
      {canAfter && current && (
        <>
          <AfterUpload current={current} busy={busy} onAsk={setConfirming} studioId={studioId} />
          <ExtrasAfterUpload
            key={`${current.updated_at}`}
            current={current}
            file={renderFile}
            durationMs={renderMs}
            workerOnline={workerOnline}
            busy={busy}
            onSent={(text, ok) => {
              setMessage({ ok, text });
              if (ok) {
                void loadPublication(videoId).then((p) => p && p !== "migration" && setRow(p));
                onWatch?.();
              }
            }}
          />
        </>
      )}
      <Dialog open={!!confirming} onClose={() => !busy && setConfirming(null)} title={confirming?.action === "publish" && confirming.visibility === "public" ? "🌍 Openbaar publiceren?" : "Naar YouTube sturen?"} closeOnOutside={false}>
        {confirming && (
          <div className="space-y-3 p-4 text-sm">
            {confirming.action === "publish" && confirming.visibility === "public" && <p className="font-semibold text-emerald-800">Deze video wordt voor iedereen zichtbaar.</p>}
            <p>{confirmText(confirming, onYouTube)}</p>
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy} onClick={() => void send(confirming)}>
                {confirming.action === "private" ? (onYouTube ? "Ja, privé zetten" : "Ja, privé uploaden") : confirming.action === "schedule" ? "Ja, inplannen" : "Ja, nu publiceren"}
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => setConfirming(null)}>
                Annuleren
              </Button>
            </div>
          </div>
        )}
      </Dialog>
      {before.length > 0 && !problems.length && (
        <div className="text-slate-600">
          <p>Nog nodig voor de upload:</p>
          <ul className="list-disc pl-4">
            {before.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}
      {message && <p className={message.ok ? "text-emerald-800" : "text-red-800"}>{message.text}</p>}
    </div>
  );
}
