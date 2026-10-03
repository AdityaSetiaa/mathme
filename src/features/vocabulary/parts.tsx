"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { CATEGORY_INFO, classLine, type CollectedWord, type Word } from "./catalog";

// ponytail: a read-only copy of the last loaded collection so Your Words opens offline. MongoDB stays the
// source of truth for "seen"; this copy is never consulted for discovery. Move to IndexedDB past a few thousand words.
const CACHE_KEY = "mathme:words";
export function readCache(): CollectedWord[] {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? "[]");
  } catch {
    return [];
  }
}
export function writeCache(words: CollectedWord[] | null) {
  try {
    if (words) localStorage.setItem(CACHE_KEY, JSON.stringify(words));
    else localStorage.removeItem(CACHE_KEY);
  } catch {}
}

export function ChipRow({ children, className = "" }: { children: ReactNode; className?: string }) {
  // Swipeable on phones; wraps on wider screens, where a hidden scroll isn't discoverable with a mouse.
  return <div className={`-mx-4 flex shrink-0 gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0 ${className}`}>{children}</div>;
}

export function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={`h-10 shrink-0 rounded-full px-4 text-sm font-semibold transition-colors ${
        on ? "bg-ink text-bg" : "border border-line bg-card text-muted active:bg-line"
      }`}
    >
      {children}
    </button>
  );
}

export function Heart({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2} strokeLinejoin="round">
      <path d="M12 20.5s-7.5-4.6-9.3-9.2C1.5 8 3.6 4.5 7.2 4.5c2 0 3.6 1.1 4.8 2.8 1.2-1.7 2.8-2.8 4.8-2.8 3.6 0 5.7 3.5 4.5 6.8-1.8 4.6-9.3 9.2-9.3 9.2z" />
    </svg>
  );
}

export function FavoriteButton({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      aria-pressed={on}
      aria-label="Favorite"
      className={`flex h-14 w-14 items-center justify-center rounded-full border border-line bg-card transition-transform active:scale-90 ${on ? "text-bad" : "text-muted"}`}
    >
      <span key={String(on)} className={on ? "animate-beat" : ""}>
        <Heart filled={on} />
      </span>
    </button>
  );
}

// Only rendered when the provider supplied audio: no dead buttons.
function AudioButton({ url }: { url: string }) {
  return (
    <button
      onClick={() => new Audio(url).play().catch(() => {})}
      aria-label="Play pronunciation"
      className="flex h-11 w-11 items-center justify-center rounded-full active:bg-line"
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 5 6 9H3v6h3l5 4V5z" />
        <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
      </svg>
    </button>
  );
}

export function WordHeading({ word: w }: { word: Word }) {
  const meta = [...classLine(w), w.partOfSpeech].filter(Boolean).join(" · "); // "C2+ · Very rare · Poetic · noun"
  return (
    <div className="flex flex-col items-center text-center">
      <p className="rounded-full border border-line px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">
        {w.discoveryCategories.map((c) => CATEGORY_INFO[c].label).join(" · ")}
      </p>
      <h2 className={`mt-5 break-words font-bold tracking-tight ${w.word.length > 11 ? "text-4xl" : "text-5xl"} sm:text-6xl`}>{w.word}</h2>
      {meta && <p className="mt-2 text-sm italic text-muted">{meta}</p>}
      {(w.pronunciation || w.audioUrl) && (
        <div className="flex min-h-11 items-center gap-1 text-muted">
          {w.pronunciation && <span className="font-mono text-sm">{w.pronunciation}</span>}
          {w.audioUrl && <AudioButton url={w.audioUrl} />}
        </div>
      )}
    </div>
  );
}

// Native <dialog>: focus trap, Escape to cancel and the backdrop come from the browser.
export function ConfirmDialog(props: {
  open: boolean;
  title: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (props.open && !d?.open) d?.showModal();
    if (!props.open && d?.open) d.close();
  }, [props.open]);
  return (
    <dialog
      ref={ref}
      onClose={props.onCancel}
      className="m-auto w-[min(24rem,calc(100%-2rem))] rounded-3xl border border-line bg-card p-5 text-ink backdrop:bg-black/50"
    >
      <h2 className="text-lg font-semibold">{props.title}</h2>
      <div className="mt-2 text-sm leading-relaxed text-muted">{props.children}</div>
      <div className="mt-5 grid grid-cols-2 gap-2">
        <button onClick={props.onCancel} className="h-12 rounded-2xl border border-line font-semibold active:bg-line">
          Cancel
        </button>
        <button onClick={props.onConfirm} className="h-12 rounded-2xl bg-bad font-semibold text-white active:opacity-80">
          {props.confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
