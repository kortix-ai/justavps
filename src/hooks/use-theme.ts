"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

type Theme = "light" | "dark";

// Module-level store — shared across all hook instances, no stale closures
let currentTheme: Theme = "dark";
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot(): Theme {
  return currentTheme;
}

function getServerSnapshot(): Theme {
  return "dark";
}

function applyTheme(t: Theme) {
  currentTheme = t;
  if (typeof document !== "undefined") {
    document.documentElement.classList.toggle("dark", t === "dark");
    document.documentElement.classList.toggle("light", t === "light");
  }
  notify();
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const initialized = useRef(false);

  // On mount: read localStorage once and apply
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    const stored = localStorage.getItem("theme") as Theme | null;
    const initial =
      stored ||
      (window.matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark");
    applyTheme(initial);
  }, []);

  const setTheme = useCallback((t: Theme) => {
    localStorage.setItem("theme", t);
    applyTheme(t);
  }, []);

  // Reads currentTheme directly — never stale
  const toggleTheme = useCallback(() => {
    setTheme(currentTheme === "dark" ? "light" : "dark");
  }, [setTheme]);

  return { theme, setTheme, toggleTheme };
}
