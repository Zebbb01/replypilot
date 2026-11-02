// Starts one throwaway PostgreSQL (real binaries, no Docker) for the unit tests.
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    pgUrl: string;
  }
}

export default async function setup(project: TestProject) {
  const port = 54390;
  const pg = new EmbeddedPostgres({
    databaseDir: await mkdtemp(path.join(tmpdir(), "replypilot-test-")),
    user: "postgres",
    password: "postgres",
    port,
    persistent: false,
    onLog: () => {},
  });
  await pg.initialise();
  await pg.start();
  project.provide("pgUrl", `postgres://postgres:postgres@127.0.0.1:${port}`);
  return () => pg.stop();
}
