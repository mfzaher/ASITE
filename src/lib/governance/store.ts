import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  COLLECTIONS,
  type Collection,
  type Collections,
  type Scope,
  type WorkspaceData,
} from "./types";

export class WorkspaceStore {
  readonly db: DatabaseSync;
  private depth = 0;
  constructor(path: string) {
    if (path !== ":memory:")
      mkdirSync(dirname(resolve(path)), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS governance_records(collection TEXT NOT NULL,id TEXT NOT NULL,entity_id TEXT NOT NULL,project_id TEXT,data TEXT NOT NULL,PRIMARY KEY(collection,id));
      CREATE INDEX IF NOT EXISTS governance_scope ON governance_records(collection,entity_id,project_id);`);
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS governance_request_limits(key TEXT PRIMARY KEY, window_start INTEGER NOT NULL, hits INTEGER NOT NULL)",
    );
  }
  all<K extends Collection>(collection: K): Collections[K][] {
    return (
      this.db
        .prepare(
          "SELECT data FROM governance_records WHERE collection=? ORDER BY rowid DESC",
        )
        .all(collection) as { data: string }[]
    ).map((r) => JSON.parse(r.data) as Collections[K]);
  }
  get<K extends Collection>(
    collection: K,
    id: string,
  ): Collections[K] | undefined {
    const r = this.db
      .prepare(
        "SELECT data FROM governance_records WHERE collection=? AND id=?",
      )
      .get(collection, id) as { data: string } | undefined;
    return r ? (JSON.parse(r.data) as Collections[K]) : undefined;
  }
  save<K extends Collection>(collection: K, value: Collections[K]): void {
    const previous = this.get(collection, value.id);
    if (
      previous &&
      (previous.entityId !== value.entityId ||
        previous.projectId !== value.projectId)
    )
      throw new Error("A record cannot be moved across projects or entities.");
    this.db
      .prepare(
        "INSERT INTO governance_records(collection,id,entity_id,project_id,data) VALUES(?,?,?,?,?) ON CONFLICT(collection,id) DO UPDATE SET data=excluded.data",
      )
      .run(
        collection,
        value.id,
        value.entityId,
        value.projectId ?? null,
        JSON.stringify(value),
      );
  }
  transaction<T>(callback: () => T): T {
    if (this.depth) return callback();
    this.db.exec("BEGIN IMMEDIATE");
    this.depth++;
    try {
      const value = callback();
      this.db.exec("COMMIT");
      return value;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    } finally {
      this.depth--;
    }
  }
  snapshot(): WorkspaceData {
    return Object.fromEntries(
      COLLECTIONS.map((k) => [k, this.all(k)]),
    ) as WorkspaceData;
  }
  event(
    actor: string,
    action: string,
    scope: Omit<Scope, "id">,
    summary: string,
  ): void {
    this.save("events", {
      id: randomUUID(),
      ...scope,
      actor,
      action,
      summary,
      occurredAt: new Date().toISOString(),
    });
  }
  close() {
    this.db.close();
  }
  consumeBudget(
    key: string,
    maximum: number,
    windowMs = 60_000,
    now = Date.now(),
  ): boolean {
    return this.transaction(() => {
      const row = this.db
        .prepare(
          "SELECT window_start,hits FROM governance_request_limits WHERE key=?",
        )
        .get(key) as { window_start: number; hits: number } | undefined;
      if (!row || now - row.window_start >= windowMs) {
        this.db
          .prepare(
            "INSERT INTO governance_request_limits(key,window_start,hits) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET window_start=excluded.window_start,hits=1",
          )
          .run(key, now);
        return true;
      }
      if (row.hits >= maximum) return false;
      this.db
        .prepare("UPDATE governance_request_limits SET hits=hits+1 WHERE key=?")
        .run(key);
      return true;
    });
  }
}
const globalStore = globalThis as unknown as { eccStore?: WorkspaceStore };
export function getStore(): WorkspaceStore {
  return (globalStore.eccStore ??= new WorkspaceStore(
    process.env.ECC_DATABASE_PATH || resolve(process.cwd(), ".data/ecc.sqlite"),
  ));
}
