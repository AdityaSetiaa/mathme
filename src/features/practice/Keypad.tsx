"use client";

import type { PointerEvent, MouseEvent } from "react";

export type Key = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "sign" | "back";

const KEYS: Key[] = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "sign", "0", "back"];
const LABEL: Partial<Record<Key, string>> = { sign: "±", back: "←" };
const ARIA: Partial<Record<Key, string>> = { sign: "Toggle minus sign", back: "Delete" };

// Fire on pointerdown, not click: click waits for the finger to lift, which adds latency to every key.
// Keyboard activation (Enter/Space on a focused button) only produces a click with detail 0, so handle that too.
let ghostClickArmed = false;

export const fastPress = (fn: () => void) => ({
  onPointerDown: (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault(); // no focus ring, no text selection
    ghostClickArmed = true;
    fn();
  },
  onClick: (e: MouseEvent) => {
    if (e.detail === 0) fn();
  },
});

// After a fast press swaps the UI, the browser still delivers that same tap's click to whatever now sits
// under the finger (e.g. last NEXT → the summary's Home button). Put these on a wrapper around any screen
// using fastPress: the click belonging to a fast-press gesture is swallowed, and any new press disarms it.
export const ghostClickGuard = {
  onPointerDownCapture: () => {
    ghostClickArmed = false;
  },
  onClickCapture: (e: MouseEvent) => {
    if (ghostClickArmed && e.detail > 0) {
      ghostClickArmed = false;
      e.preventDefault();
      e.stopPropagation();
    }
  },
};

export function Keypad({ onKey, onSubmit, canSubmit }: { onKey: (k: Key) => void; onSubmit: () => void; canSubmit: boolean }) {
  return (
    <div className="grid select-none grid-cols-3 gap-2">
      {KEYS.map((k) => (
        <button
          key={k}
          aria-label={ARIA[k] ?? k}
          {...fastPress(() => onKey(k))}
          className="h-16 rounded-2xl border border-line bg-card font-mono text-2xl font-semibold active:scale-95 active:bg-line"
        >
          {LABEL[k] ?? k}
        </button>
      ))}
      <button
        {...fastPress(onSubmit)}
        disabled={!canSubmit}
        className="col-span-3 h-16 rounded-2xl bg-accent text-lg font-bold tracking-wide text-accent-ink active:scale-[0.98] disabled:opacity-40"
      >
        SUBMIT
      </button>
    </div>
  );
}
