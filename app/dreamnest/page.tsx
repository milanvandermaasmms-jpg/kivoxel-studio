import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { dreamnestEnabled } from "@/lib/dreamnest/core";

export const metadata = { title: "Dreamnest" };

// Dreamnest (second channel). Without FEATURE_DREAMNEST=true this page does not exist, so the Studio stays as it was.
export default async function DreamnestPage() {
  await connection();
  if (!dreamnestEnabled()) notFound();

  const phases = [
    ["0", "Vangnet: eigen wachtrij, rooktest KIVOXEL", "klaar"],
    ["1", "Beeld: Lumi, vriendjes, Huiskamer, keyframes", "volgende"],
    ["2", "Beweging: clips en naadloze loops", ""],
    ["3", "Muziek en sfeergeluid", ""],
    ["4", "Montage van 60+ minuten met kwaliteitscheck", ""],
    ["5", "Thumbnail, titel en publiceren (altijd jouw klik)", ""],
    ["6", "Autopilot en series", ""],
  ];

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-8 text-sm leading-6 text-slate-700">
      <header className="space-y-1">
        <p>
          <Link href="/" className="text-cyan-700 underline underline-offset-2">
            ← Terug naar de Studio
          </Link>
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">🌙 Dreamnest</h1>
        <p>Slaapvideo&apos;s met Lumi van Dreamnest. Dreamnest heeft een eigen wachtrij; KIVOXEL gaat altijd voor.</p>
      </header>
      <ol className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
        {phases.map(([n, label, state]) => (
          <li key={n} className="flex items-center justify-between gap-3 px-4 py-3">
            <span>
              <span className="mr-2 font-semibold text-slate-900">Fase {n}</span>
              {label}
            </span>
            {state && <span className={state === "klaar" ? "rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800" : "rounded-full bg-violet-100 px-2 py-0.5 text-xs text-violet-800"}>{state}</span>}
          </li>
        ))}
      </ol>
    </main>
  );
}
