import { Platform } from "react-native";
import { open, type DB } from "@op-engineering/op-sqlite";

const REPLICA_NAME = "ciciro.sqlite";

let replica: DB | null = null;

/** Local manuscript replica. Tokens stay in SecureStore; this is the op log + snapshots. */
export function getReplica(): DB {
  if (Platform.OS === "web") {
    throw new Error("The manuscript replica is native-only.");
  }
  if (!replica) {
    replica = open({ name: REPLICA_NAME });
  }
  return replica;
}

export async function ensureReplica(): Promise<DB> {
  const db = getReplica();
  await db.execute("PRAGMA journal_mode = WAL");
  await db.execute("PRAGMA foreign_keys = ON");
  return db;
}
