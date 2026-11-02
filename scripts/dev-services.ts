// Local stand-ins for ReplyPilot's Azure dependencies: an embedded PostgreSQL (real
// binaries, no Docker), the rule-based mock model, and the job worker in watch mode.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import EmbeddedPostgres from "embedded-postgres";
import { createMockLlm } from "./mock-llm.ts";

const env = {
  DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:54330/postgres",
  LLM_ENDPOINT: "http://127.0.0.1:4021",
  LLM_API_KEY: "local",
  LLM_MODEL: "mock",
  ...process.env,
};

const dir = ".data/pg";
const logs: string[] = [];
const pg = new EmbeddedPostgres({ databaseDir: dir, user: "postgres", password: "postgres", port: 54330, persistent: true, onLog: (m) => logs.push(String(m)) });
if (!existsSync(`${dir}/PG_VERSION`)) await pg.initialise();
await pg.start().catch(() => {
  // Usually an earlier run's server still holding the port or its shared memory.
  console.error(`PostgreSQL did not start:\n${logs.join("").trim()}`);
  process.exit(1);
});

const { server } = createMockLlm();
server.listen(4021, "127.0.0.1");

const worker = spawn(
  process.execPath,
  ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", "src/worker/run.ts", "--watch"],
  { env, stdio: "inherit" },
);

console.log("PostgreSQL on 54330, mock model on 4021, worker watching the job queue.");

const stop = async () => {
  worker.kill();
  server.close();
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
worker.on("exit", (code) => {
  console.error(`Worker exited with code ${code}`);
  void stop();
});
