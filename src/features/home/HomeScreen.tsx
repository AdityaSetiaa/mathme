"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { Screen } from "@/components/layout/Screen";
import { InstallButton } from "@/components/layout/ServiceWorker";
import { Card } from "@/components/ui";
import { dayKey, dayStreak } from "@/features/stats/aggregate";
import { useStoredData } from "@/lib/db";

// The user's name is the only profile data, so it lives in one localStorage key.
const NAME_KEY = "mathme:name";
const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};
const readName = () => {
  try {
    return localStorage.getItem(NAME_KEY);
  } catch {
    return null;
  }
};
const saveName = (name: string) => {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {}
  listeners.forEach((l) => l());
};

export function HomeScreen() {
  // undefined = not read yet (server render), null = never set.
  const name = useSyncExternalStore(subscribe, readName, () => undefined);
  const [editing, setEditing] = useState(false);
  const data = useStoredData();
  const [now] = useState(() => Date.now());

  const today = dayKey(now);
  const todayCount = data?.attempts.filter((a) => dayKey(a.createdAt) === today).length ?? 0;
  const streak = data ? dayStreak(data.attempts, now) : 0;

  return (
    <Screen>
      <InstallButton className="self-end" />
      <div className="flex flex-1 flex-col justify-center gap-8 py-8">
        <div className="min-h-20">
          {name === undefined ? null : name === null || editing ? (
            <NameForm
              initial={name ?? ""}
              onSave={(n) => {
                saveName(n);
                setEditing(false);
              }}
            />
          ) : (
            <button onClick={() => setEditing(true)} className="text-left" aria-label="Change name">
              <p className="text-muted">Hello,</p>
              <p className="text-4xl font-bold tracking-tight">{name}</p>
            </button>
          )}
        </div>

        {data && data.attempts.length > 0 && (
          <Card className="flex justify-between text-sm">
            <span>
              🔥 <b>{streak}</b> day streak
            </span>
            <span className="text-muted">
              Today: <b className="text-ink">{todayCount}</b> problems
            </span>
          </Card>
        )}

        <Link
          href="/start"
          className="flex h-20 items-center justify-center rounded-3xl bg-accent text-2xl font-bold tracking-wide text-accent-ink active:scale-[0.98]"
        >
          START
        </Link>

        <div className="grid grid-cols-2 gap-3">
          <Link href="/stats" className="flex h-16 items-center justify-center rounded-2xl border border-line bg-card font-semibold active:bg-line">
            📊 STATS
          </Link>
          <Link href="/history" className="flex h-16 items-center justify-center rounded-2xl border border-line bg-card font-semibold active:bg-line">
            🕘 HISTORY
          </Link>
        </div>
      </div>
    </Screen>
  );
}

function NameForm({ initial, onSave }: { initial: string; onSave: (name: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) onSave(value.trim());
      }}
      className="flex flex-col gap-2"
    >
      <label htmlFor="name" className="text-muted">
        What should we call you?
      </label>
      <div className="flex gap-2">
        <input
          id="name"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={30}
          autoComplete="given-name"
          className="min-w-0 flex-1 rounded-xl border border-line bg-card px-3 py-2 text-lg outline-none focus:border-accent"
        />
        <button className="rounded-xl bg-accent px-4 font-semibold text-accent-ink">Save</button>
      </div>
    </form>
  );
}
