"use client";
// What the studio page shows right now (channel, part, opened project), so Ivar knows the context. Pages publish it;
// Ivar reads it. It only proposes a scope: an existing conversation or task never changes destination by itself.
import { useEffect, useSyncExternalStore } from "react";
import type { Scope } from "./types";

let current: Scope = { channelId: null };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function setPageContext(next: Scope) {
  if (JSON.stringify(next) === JSON.stringify(current)) return;
  current = next;
  emit();
}

export function usePageContext(): Scope {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => void listeners.delete(l)),
    () => current,
    () => current,
  );
}

/** A page says what it shows. The latest page to render wins; leaving the page does not clear it (navigation sets a new one). */
export function usePublishPageContext(scope: Scope | null) {
  const key = JSON.stringify(scope);
  useEffect(() => {
    if (scope) setPageContext(scope);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

/** Ivar's "Open in de studio" buttons: the studio page listens and opens that video (no full reload). */
export const IVAR_OPEN_EVENT = "ivar:open-video";
export function openInStudio(videoId: string) {
  window.dispatchEvent(new CustomEvent(IVAR_OPEN_EVENT, { detail: { videoId } }));
}
