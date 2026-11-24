"use client";

// 24-11-2026: "Kopieer TikTok-tekst": puts the ready English caption with hashtags on the clipboard, so posting a Short
// from the TikTok inbox is paste and tap. The text shows on hover, so Milan sees what he copies.
import { useState } from "react";

export function CopyCaption({ text }: { text: string }) {
  const [done, setDone] = useState<"ok" | "fout" | null>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone("ok");
    } catch {
      setDone("fout");
    }
    setTimeout(() => setDone(null), 2500);
  };
  return (
    <button type="button" onClick={() => void copy()} title={text} className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium hover:bg-slate-50">
      {done === "ok" ? "✓ Gekopieerd" : done === "fout" ? "Kopiëren lukte niet" : "Kopieer TikTok-tekst"}
    </button>
  );
}
