"use client";

import { useStudioContext } from "@/components/youtube/StudioContext";

export function Section({ title, intro, children }: { title: string; intro?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-surface p-4 shadow-[var(--shadow-card)]">
      <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
      {intro && <p className="mt-1 text-sm text-slate-500">{intro}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function Notice({ tone, children }: { tone: "error" | "ok"; children: React.ReactNode }) {
  return (
    <p role={tone === "error" ? "alert" : "status"} className={`mt-2 rounded px-2 py-1 text-sm ${tone === "error" ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-800"}`}>
      {children}
    </p>
  );
}

/**
 * A section that opens on a click (fase 1.3): details only when you ask for them. With an id, opening it is remembered
 * (fase 2) and Milan can hide it after a Studio-tip; a hidden part stays one click away.
 */
export function Fold({ id, title, intro, children, defaultOpen = false }: { id?: string; title: string; intro?: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const { hiddenFolds, onFoldOpen, onShowFold } = useStudioContext();
  if (id && hiddenFolds.includes(id))
    return (
      <button type="button" onClick={() => onShowFold(id)} className="text-xs text-slate-500 underline underline-offset-2">
        Verborgen: {title} (tonen)
      </button>
    );
  return (
    <details open={defaultOpen} onToggle={(e) => id && (e.currentTarget as HTMLDetailsElement).open && onFoldOpen(id)} className="group rounded-xl border border-slate-200 bg-surface shadow-[var(--shadow-card)]">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span>
          <span className="block text-sm font-semibold tracking-tight">{title}</span>
          {intro && <span className="block text-xs text-slate-500">{intro}</span>}
        </span>
        <span aria-hidden className="text-slate-400 transition-transform group-open:rotate-180">▾</span>
      </summary>
      <div className="space-y-4 border-t border-slate-100 p-4">{children}</div>
    </details>
  );
}
