"use client";

import { useEffect, useState } from "react";
import { Section } from "@/components/settings/Section";
import { Button } from "@/components/ui/Dialog";
import { byDay, calendarMoment, loadPublications, PUBLICATION_STATUS, type PublicationItem, type PublicationStatus } from "@/lib/youtube/publicationData";

const time = (iso: string) => new Date(iso).toLocaleTimeString("nl-NL", { timeZone: "Europe/Amsterdam", hour: "2-digit", minute: "2-digit" });
const dayLabel = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" });
const VIS: Record<string, string> = { private: "privé", unlisted: "verborgen", public: "openbaar" };

function usePublications(studioId: string) {
  const [items, setItems] = useState<PublicationItem[] | "migration" | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    loadPublications(studioId)
      .then((p) => live && setItems(p))
      .catch((e) => live && setError(e instanceof Error ? e.message : "Laden lukte niet."));
    return () => {
      live = false;
    };
  }, [studioId]);
  return { items, error };
}

function Links({ p }: { p: PublicationItem }) {
  if (!p.youtube_video_id) return null;
  return (
    <span className="flex gap-3">
      <a href={`https://youtu.be/${p.youtube_video_id}`} target="_blank" rel="noreferrer" className="text-cyan-700 underline underline-offset-2">
        YouTube
      </a>
      <a href={`https://studio.youtube.com/video/${p.youtube_video_id}/edit`} target="_blank" rel="noreferrer" className="text-cyan-700 underline underline-offset-2">
        Studio
      </a>
    </span>
  );
}

/** Contentkalender: what goes online when, and what was published (2.2, 24.9 "ritme boven pieken"). */
export function ContentCalendar({ studioId, onOpen }: { studioId: string; onOpen: () => void }) {
  const { items, error } = usePublications(studioId);
  if (error) return <Section title="Contentkalender"><p className="text-sm text-red-800">{error}</p></Section>;
  if (items === null) return <p className="text-sm text-slate-500">Laden…</p>;
  if (items === "migration") return <Section title="Contentkalender"><p className="text-sm text-slate-600">De kalender komt er met migratie 037.</p></Section>;
  const real = items.filter((p) => !p.is_test);
  const days = byDay(real, calendarMoment);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
  const upcoming = days.filter((d) => d.day >= today);
  const past = days.filter((d) => d.day < today).slice(-14).reverse();
  const unplanned = real.filter((p) => !calendarMoment(p) && p.status !== "failed");
  return (
    <div className="space-y-4">
      <Section title="Komt online" intro="Ingeplande video's zet YouTube zelf openbaar; de pc hoeft dan niet aan te staan. Testvideo's staan hier niet in.">
        {upcoming.length === 0 ? (
          <p className="text-sm text-slate-500">Er staat niets ingepland. Plannen doe je in het publicatiescherm van een goedgekeurde video (met een voorstel voor het moment).</p>
        ) : (
          <ol className="space-y-3">
            {upcoming.map((d) => (
              <li key={d.day}>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{d.day === today ? "Vandaag" : dayLabel(d.day)}</p>
                <ul className="mt-1 space-y-1">
                  {d.items.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm">
                      <span className="min-w-0">
                        <span className="tabular-nums text-slate-500">{time(calendarMoment(p)!)}</span> {p.title || "zonder titel"}
                      </span>
                      <span className="flex items-center gap-3 text-xs text-slate-600">
                        {PUBLICATION_STATUS[p.status]}
                        <Links p={p} />
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </Section>
      <Section title="Nog zonder moment">
        {unplanned.length === 0 ? (
          <p className="text-sm text-slate-500">Geen concepten of privé-video's zonder moment.</p>
        ) : (
          <ul className="space-y-1">
            {unplanned.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>{p.title || "zonder titel"}</span>
                <span className="text-xs text-slate-600">{PUBLICATION_STATUS[p.status]}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2">
          <Button variant="secondary" onClick={onOpen}>
            Naar productiestudio
          </Button>
        </div>
      </Section>
      <Section title="Gepubliceerd (laatste 14 dagen met een video)">
        {past.length === 0 ? (
          <p className="text-sm text-slate-500">Nog niets gepubliceerd.</p>
        ) : (
          <ul className="space-y-1">
            {past.flatMap((d) =>
              d.items.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span>
                    <span className="text-slate-500">{dayLabel(d.day)}</span> · {p.title}
                  </span>
                  <Links p={p} />
                </li>
              )),
            )}
          </ul>
        )}
      </Section>
    </div>
  );
}

const ORDER: PublicationStatus[] = ["failed", "queued", "uploading", "processing", "draft", "uploaded", "scheduled", "published"];

/** YouTube: every publication by status, with links to YouTube and YouTube Studio. Publishing itself stays in the video. */
export function PublicationsOverview({ studioId, onOpen }: { studioId: string; onOpen: () => void }) {
  const { items, error } = usePublications(studioId);
  if (error) return <Section title="Publicaties"><p className="text-sm text-red-800">{error}</p></Section>;
  if (items === null) return <p className="text-sm text-slate-500">Laden…</p>;
  if (items === "migration") return <Section title="Publicaties"><p className="text-sm text-slate-600">Het overzicht komt er met migratie 037.</p></Section>;
  return (
    <Section title="Publicaties" intro="Alle video's die naar YouTube gaan of gingen, per status. Uploaden, inplannen en publiceren doe je in het publicatiescherm van de video zelf (Productiestudio). De koppeling met het kanaal staat bij Instellingen.">
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">Nog geen publicaties.</p>
      ) : (
        <div className="space-y-3">
          {ORDER.map((status) => {
            const list = items.filter((p) => p.status === status);
            if (!list.length) return null;
            return (
              <div key={status}>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  {PUBLICATION_STATUS[status]} ({list.length})
                </p>
                <ul className="mt-1 divide-y divide-slate-100">
                  {list.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-sm">
                      <span className="min-w-0">
                        {p.title || "zonder titel"}
                        {p.is_test && <span className="ml-1 rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-800">testvideo</span>}
                        <span className="text-xs text-slate-500">
                          {" "}
                          · {VIS[p.visibility] ?? p.visibility}
                          {p.publish_at ? ` · ${new Date(p.publish_at).toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam", dateStyle: "medium", timeStyle: "short" })}` : ""}
                        </span>
                        {p.error && <span className="block text-xs text-red-700">{p.error}</span>}
                      </span>
                      <Links p={p} />
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          <Button variant="secondary" onClick={onOpen}>
            Naar productiestudio
          </Button>
        </div>
      )}
    </Section>
  );
}
