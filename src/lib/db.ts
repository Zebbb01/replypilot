// PostgreSQL: embedded locally and in tests, Azure Database for PostgreSQL
// (Flexible Server, free B1ms) in Azure. The schema is applied on first use.
import pg from "pg";

export type Db = Pick<pg.Pool, "query">;

// ponytail: one idempotent schema script instead of a migration tool; add
// numbered migrations once a release needs to change an existing column.
const SCHEMA = `
create table if not exists tickets (
  id uuid primary key,
  workspace text not null,
  source text not null check (source in ('demo', 'email', 'shopify')),
  external_id text,
  customer_email text not null,
  customer_name text,
  subject text not null,
  body text not null,
  thread_id text,
  status text not null default 'queued'
    check (status in ('queued', 'drafting', 'needs_approval', 'approved', 'sent', 'rejected', 'failed')),
  run int not null default 1,
  note text,
  draft jsonb,
  reply text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, external_id)
);
create index if not exists tickets_workspace on tickets (workspace, created_at desc);

-- The audit log. Rows can be added but never changed; whole tickets are purged by age.
create table if not exists events (
  id bigserial primary key,
  ticket_id uuid not null references tickets (id) on delete cascade,
  at timestamptz not null default now(),
  actor text not null,
  type text not null,
  data jsonb not null default '{}'
);
create index if not exists events_ticket on events (ticket_id, id);
create or replace function events_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'the audit log is append-only';
end $$;
create or replace trigger events_no_update before update on events for each row execute function events_append_only();

-- Finished steps of a run (model calls, tool calls, the send), replayed on retry.
create table if not exists steps (
  ticket_id uuid not null references tickets (id) on delete cascade,
  run int not null,
  name text not null,
  output jsonb,
  tokens_in int not null default 0,
  tokens_out int not null default 0,
  cost_usd double precision not null default 0,
  ms int not null default 0,
  finished_at timestamptz not null default now(),
  primary key (ticket_id, run, name)
);

create table if not exists jobs (
  id bigserial primary key,
  ticket_id uuid not null references tickets (id) on delete cascade,
  kind text not null check (kind in ('draft', 'send')),
  run_at timestamptz not null default now(),
  attempts int not null default 0,
  max_attempts int not null default 5,
  locked_until timestamptz,
  last_error text,
  done_at timestamptz
);
create index if not exists jobs_due on jobs (run_at) where done_at is null;

create table if not exists usage (
  key text primary key,
  count int not null,
  expires_at timestamptz not null
);
`;

// An advisory lock keeps the web app and the worker from creating tables at once.
export async function migrate(pool: pg.Pool) {
  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock(80423)");
    await client.query(SCHEMA);
  } finally {
    await client.query("select pg_advisory_unlock(80423)").catch(() => {});
    client.release();
  }
}

const cache = globalThis as { pool?: Promise<pg.Pool> };

export function getDb(): Promise<pg.Pool> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  cache.pool ??= (async () => {
    const pool = new pg.Pool({ connectionString: url, max: 5 });
    await migrate(pool);
    return pool;
  })().catch((e) => {
    cache.pool = undefined;
    throw e;
  });
  return cache.pool;
}

// Adds one to a counter while it stays within the limit. Counters expire after 40
// days; they only matter for their day.
export async function take(db: Db, key: string, limit: number): Promise<boolean> {
  const { rowCount } = await db.query(
    `insert into usage (key, count, expires_at) values ($1, 1, now() + interval '40 days')
     on conflict (key) do update set count = usage.count + 1 where usage.count < $2`,
    [key, limit],
  );
  return rowCount === 1 && limit >= 1;
}

export const dayKey = (kind: string, id: string, now = new Date()) => `${kind}:${id}:${now.toISOString().slice(0, 10)}`;
