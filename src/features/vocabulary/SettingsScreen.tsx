"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Screen } from "@/components/layout/Screen";
import { clearVocabularyData, getSettings, updateSettings } from "./actions";
import {
  CATEGORY_INFO,
  DIFFICULTIES,
  DEFAULT_SETTINGS,
  DIFFICULTY_INFO,
  DISCOVERY_CATEGORIES,
  STYLE_INFO,
  STYLES,
  type VocabSettings,
} from "./catalog";
import { ConfirmDialog, writeCache } from "./parts";

export function SettingsScreen() {
  const [settings, setSettings] = useState<VocabSettings | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    getSettings()
      .then(setSettings)
      .catch(() => setNote("Settings need a connection. Try again when you’re online."));
  }, []);

  // Sends only the list that changed, so a level toggle never overwrites a category toggle in flight.
  function save(change: Partial<VocabSettings>) {
    if (!settings) return;
    const before = settings;
    setSettings({ ...settings, ...change });
    setNote(null);
    updateSettings(change).catch(() => {
      setSettings(before);
      setNote("Couldn’t save. Check your connection.");
    });
  }

  async function clear() {
    setConfirming(false);
    try {
      await clearVocabularyData();
      writeCache(null);
      setSettings(DEFAULT_SETTINGS);
      setNote("Vocabulary data cleared.");
    } catch {
      setNote("Couldn’t clear data. Check your connection.");
    }
  }

  return (
    <Screen title="Vocabulary settings" back="/words">
      {note && (
        <p role="status" className="mb-4 rounded-2xl border border-line bg-card p-3 text-sm">
          {note}
        </p>
      )}
      {settings && (
        <>
          <h2 className="mb-2 text-sm font-semibold text-muted">Word levels</h2>
          <Rows>
            {DIFFICULTIES.map((d) => (
              <Toggle key={d} on={settings.difficulties.includes(d)} onChange={() => save({ difficulties: flip(settings.difficulties, d) })}>
                <span className="font-medium">{DIFFICULTY_INFO[d].label}</span>
                <span className="block text-sm text-muted">
                  {DIFFICULTY_INFO[d].detail} · {DIFFICULTY_INFO[d].blurb}
                </span>
              </Toggle>
            ))}
          </Rows>
          <p className="mt-2 text-xs text-muted">
            Easy to Advanced follow the CEFR word lists (CEFR-J and Octanove), which end at C2. C2+, Rare and Very rare are this
            app’s tiers for words beyond those lists, by how often they occur; C2+ is not an official CEFR level.
          </p>

          <h2 className="mb-2 mt-7 text-sm font-semibold text-muted">Word styles</h2>
          <Rows>
            {STYLES.map((st) => (
              <Toggle key={st} on={settings.styles.includes(st)} onChange={() => save({ styles: flip(settings.styles, st) })}>
                <span className="font-medium">{STYLE_INFO[st].label}</span>
                <span className="block text-sm text-muted">{STYLE_INFO[st].blurb}</span>
              </Toggle>
            ))}
          </Rows>
          <p className="mt-2 text-xs text-muted">
            A word appears when any of its styles is on; words without a label count as Everyday. Style is separate from level: a
            poetic word can be easy or very rare.
          </p>

          <h2 className="mb-2 mt-7 text-sm font-semibold text-muted">Allowed word categories</h2>
          <Rows>
            {DISCOVERY_CATEGORIES.filter((c) => !CATEGORY_INFO[c].sensitive).map((c) => (
              <Toggle key={c} on={settings.enabled.includes(c)} onChange={() => save({ enabled: flip(settings.enabled, c) })}>
                <span className="font-medium">{CATEGORY_INFO[c].label}</span>
              </Toggle>
            ))}
          </Rows>

          <h2 className="mb-1 mt-7 text-sm font-semibold text-muted">Sensitive categories</h2>
          <p className="mb-2 text-sm text-muted">Explicit or offensive language. Off unless you turn them on.</p>
          <Rows>
            {DISCOVERY_CATEGORIES.filter((c) => CATEGORY_INFO[c].sensitive).map((c) => (
              <Toggle key={c} on={settings.enabled.includes(c)} onChange={() => save({ enabled: flip(settings.enabled, c) })}>
                <span className="font-medium">{CATEGORY_INFO[c].label}</span>
              </Toggle>
            ))}
          </Rows>
          <p className="mt-2 text-xs text-muted">A level, style or category that’s off never appears, not even in Random.</p>

          <h2 className="mb-2 mt-10 text-sm font-semibold text-muted">Data</h2>
          <button onClick={() => setConfirming(true)} className="h-12 w-full rounded-2xl border border-line bg-card font-semibold text-bad active:bg-line">
            Clear vocabulary data
          </button>
          <p className="mt-2 text-xs text-muted">Your math practice history is not affected.</p>
        </>
      )}

      <ConfirmDialog open={confirming} title="Clear vocabulary data?" confirmLabel="Clear Data" onConfirm={clear} onCancel={() => setConfirming(false)}>
        <p>This will permanently remove:</p>
        <ul className="my-2 list-disc pl-5">
          <li>discovered-word history</li>
          <li>favorites</li>
          <li>learned states</li>
          <li>vocabulary settings</li>
        </ul>
        <p>After clearing your data, previously seen words may appear again.</p>
      </ConfirmDialog>
    </Screen>
  );
}

function Rows({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-line rounded-2xl border border-line bg-card">{children}</div>;
}

function Toggle({ on, onChange, children }: { on: boolean; onChange: () => void; children: ReactNode }) {
  return (
    <label className="flex min-h-14 cursor-pointer items-center justify-between gap-4 px-4 py-2">
      <span>{children}</span>
      <input type="checkbox" checked={on} onChange={onChange} className="h-5 w-5 shrink-0 accent-accent" />
    </label>
  );
}

const flip = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);
