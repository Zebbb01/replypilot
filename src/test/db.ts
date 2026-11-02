// Test helper: a fresh, migrated database per test file.
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, inject } from "vitest";
import { migrate } from "../lib/db.ts";

export function setupDb(): () => pg.Pool {
  let pool: pg.Pool;
  beforeAll(async () => {
    const base = inject("pgUrl");
    const name = `t_${randomUUID().replaceAll("-", "")}`;
    const admin = new pg.Client({ connectionString: `${base}/postgres` });
    await admin.connect();
    await admin.query(`create database ${name}`);
    await admin.end();
    pool = new pg.Pool({ connectionString: `${base}/${name}`, max: 4 });
    await migrate(pool);
  });
  afterAll(() => pool?.end());
  return () => pool;
}
