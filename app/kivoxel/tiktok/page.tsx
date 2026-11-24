"use client";

// 24-11-2026: TikTok's return address after signing in (TikTok only accepts https). This public page does nothing with
// the code itself: it hands it straight to the worker on the owner's own computer (127.0.0.1), which exchanges it and
// keeps the tokens there, encrypted. Opened on any other computer, there is no worker and nothing happens.
import { useEffect, useState } from "react";

export default function TikTokReturn() {
  const [note, setNote] = useState("Connecting to the studio on this computer…");
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const keep = new URLSearchParams();
    for (const k of ["code", "state", "error", "error_description", "scopes"]) {
      const v = q.get(k);
      if (v) keep.set(k, v.slice(0, 2000));
    }
    if (!keep.get("state")) {
      setNote("This page is only used when connecting TikTok from Kivoxel Studio.");
      return;
    }
    window.location.replace(`http://127.0.0.1:3210/tiktok/callback?${keep.toString()}`);
  }, []);
  return (
    <article className="space-y-2 text-sm text-slate-700">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">TikTok</h1>
      <p>{note}</p>
    </article>
  );
}
