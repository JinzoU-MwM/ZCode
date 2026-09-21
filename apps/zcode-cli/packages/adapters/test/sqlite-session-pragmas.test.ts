// 运行：先 `pnpm --filter @zcode/adapters build`，再 `pnpm test`（node --import tsx --test）。
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  runSqliteSessionMigrations,
  runSqliteSessionMigrationsAsync,
} from "../dist/storage/session-store/migration-runner.js";

const pragma = (db: DatabaseSync, name: string) =>
  (db.prepare(`pragma ${name}`).get() as Record<string, unknown>)[name];

function withTempDb(run: (db: DatabaseSync, path: string) => Promise<void> | void) {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), "zcode-pragma-"));
    const path = join(dir, "db.sqlite");
    const db = new DatabaseSync(path, { timeout: 1000 });
    try {
      await run(db, path);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

test(
  "sync migration prelude leaves the connection in WAL with synchronous=NORMAL",
  withTempDb((db, path) => {
    runSqliteSessionMigrations(db, path, 1000);
    assert.equal(pragma(db, "journal_mode"), "wal");
    // 1 = NORMAL, 2 = FULL。fsync 只在 checkpoint 发生，落库不再阻塞事件循环。
    assert.equal(pragma(db, "synchronous"), 1);
    assert.equal(pragma(db, "foreign_keys"), 1);
  }),
);

test(
  "async migration prelude applies the same pragmas",
  withTempDb(async (db, path) => {
    await runSqliteSessionMigrationsAsync(db, path, { lockWaitTimeoutMs: 1000 });
    assert.equal(pragma(db, "journal_mode"), "wal");
    assert.equal(pragma(db, "synchronous"), 1);
  }),
);

test(
  "reopening an already-migrated database still sets synchronous per connection",
  withTempDb((db, path) => {
    runSqliteSessionMigrations(db, path, 1000);
    const second = new DatabaseSync(path, { timeout: 1000 });
    try {
      // 新连接默认回到 FULL；prelude 必须每次都设。
      assert.equal(pragma(second, "synchronous"), 2);
      runSqliteSessionMigrations(second, path, 1000);
      assert.equal(pragma(second, "synchronous"), 1);
    } finally {
      second.close();
    }
  }),
);
