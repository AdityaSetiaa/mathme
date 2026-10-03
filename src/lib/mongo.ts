"use server";

import type { Attempt, Session } from "@/types/models";
import { mongoDb } from "./mongo-db";

// ponytail: no auth — anyone who can reach the server can read and write all data. Add auth before deploying publicly.

function col(name: "sessions" | "attempts") {
  return mongoDb().collection<{ _id: string }>(name);
}

// The app's id doubles as _id: upserts are idempotent (retries are safe) and need no extra index.
async function upsert(name: "sessions" | "attempts", doc: Session | Attempt) {
  if (typeof doc?.id !== "string") throw new Error("Invalid id"); // a non-string _id filter could match other docs
  await col(name).replaceOne({ _id: doc.id }, doc, { upsert: true });
}

export async function putSession(s: Session) {
  await upsert("sessions", s);
}

export async function putAttempt(a: Attempt) {
  await upsert("attempts", a);
}

// One action for both reads: Next runs server actions from a client sequentially, so two calls wouldn't overlap.
export async function loadAll() {
  const [sessions, attempts] = await Promise.all(
    (["sessions", "attempts"] as const).map((n) => col(n).find({}, { projection: { _id: 0 } }).toArray()),
  );
  return { sessions: sessions as unknown as Session[], attempts: attempts as unknown as Attempt[] };
}
