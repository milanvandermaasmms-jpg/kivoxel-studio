"use client";

import { THEME_KEY } from "./theme-script";

export type Theme = "light" | "dark";

/** Theme is per device; the class on <html> is already set by THEME_SCRIPT. */
export function getTheme(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function setTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Storage blocked: the theme still applies until the page is closed.
  }
}
