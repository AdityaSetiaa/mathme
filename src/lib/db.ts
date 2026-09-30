"use client";

import { useEffect, useState } from "react";
import type { Attempt, Session } from "@/types/models";
import { loadAll } from "./mongo";

// Practice data lives in MongoDB (MONGODB_URI), reached through the server actions in ./mongo.
export { putAttempt, putSession } from "./mongo";

// crypto.randomUUID only exists in secure contexts; phones hitting the dev server over LAN http don't have it.
export const newId = () => crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export type StoredData ={ sessions: Session[]; attempts: Attempt[] };

// ponytail: loads everything into memory; switch stats to createdAt range queries if this ever gets slow (~100k attempts).
export function useStoredData(): StoredData | null {
  const [data, setData] = useState<StoredData | null>(null);
  useEffect(() => {
    loadAll()
      .then(({ sessions, attempts }) => {
        attempts.sort((a, b) => a.createdAt - b.createdAt);
        sessions.sort((a, b) => b.startedAt - a.startedAt);
        setData({ sessions, attempts });
      })
      .catch((err) => {
        console.error("Could not read practice data", err);
        setData({ sessions: [], attempts: [] });
      });
  }, []);
  return data;
}
