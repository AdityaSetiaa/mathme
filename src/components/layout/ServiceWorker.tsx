"use client";

import { useEffect, useSyncExternalStore } from "react";

// Registers public/sw.js in production only: in dev it would cache stale HMR bundles.
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch((err) => console.error("SW registration failed", err));
    }
  }, []);
  return null;
}

// beforeinstallprompt is Chromium-only and needs the production service worker, so the button stays hidden
// in dev, on iOS/Safari/Firefox, and once installed. Captured here because this module loads on every page.
type InstallPrompt = Event & { prompt: () => Promise<void> };
let installPrompt: InstallPrompt | null = null;
const listeners = new Set<() => void>();
const setInstallPrompt = (e: InstallPrompt | null) => {
  installPrompt = e;
  listeners.forEach((l) => l());
};
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // keep Chrome's own mini-infobar away; our button triggers the prompt instead
    setInstallPrompt(e as InstallPrompt);
  });
  window.addEventListener("appinstalled", () => setInstallPrompt(null));
}
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

export function InstallButton({ className = "" }: { className?: string }) {
  const prompt = useSyncExternalStore(subscribe, () => installPrompt, () => null);
  if (!prompt) return null;
  return (
    <button
      onClick={() => {
        setInstallPrompt(null); // a prompt event can only be used once
        prompt.prompt();
      }}
      className={`flex h-10 items-center rounded-full border border-line bg-card px-4 text-sm font-semibold active:bg-line ${className}`}
    >
      ⬇ Install app
    </button>
  );
}
