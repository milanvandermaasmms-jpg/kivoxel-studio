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
