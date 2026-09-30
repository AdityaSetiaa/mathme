"use server";

import { MongoClient } from "mongodb";
import type { Attempt, Session } from "@/types/models";

// ponytail: no auth — anyone who can reach the server can read and write all data. Add auth before deploying publicly.

const g = globalThis as { mongo?: MongoClient };

function col(name: "sessions" | "attempts") {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");
  g.mongo ??= new MongoClient(uri); // cached on globalThis so dev hot reloads don't leak connections
  return g.mongo.db("mathme").collection<{ _id: string }>(name);
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
