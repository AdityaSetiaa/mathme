import { MongoClient } from "mongodb";

// Server-only. Shared by every feature's server actions so the app holds one connection pool.
const g = globalThis as { mongo?: MongoClient };

export function mongoDb() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");
  g.mongo ??= new MongoClient(uri); // cached on globalThis so dev hot reloads don't leak connections
  return g.mongo.db("mathme");
}
