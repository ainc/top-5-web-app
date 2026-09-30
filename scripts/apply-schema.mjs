// Applies pending files in supabase/migrations using SUPABASE_DB_URL from .env.local.
import { readdirSync, readFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.trim().startsWith("#") && line.includes("="))
    .map((line) => {
      const index = line.indexOf("=");
      const key = line.slice(0, index).trim();
      let value = line.slice(index + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      return [key, value];
    }),
);

if (!env.SUPABASE_DB_URL) {
  console.error("SUPABASE_DB_URL is missing from .env.local");
  process.exit(1);
}

const client = new pg.Client({
  connectionString: env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
const migrationsDir = new URL("../supabase/migrations/", import.meta.url);
const files = readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .sort();

await client.connect();
try {
  await client.query(`
    create table if not exists public.schema_migrations (
      filename text primary key,
      applied_at timestamptz not null default now()
    )
  `);
  await client.query("alter table public.schema_migrations enable row level security");
  await client.query("revoke all on public.schema_migrations from anon, authenticated");
  const applied = await client.query("select filename from public.schema_migrations");
  const done = new Set(applied.rows.map((row) => row.filename));

  for (const filename of files) {
    if (done.has(filename)) {
      console.log(`skip ${filename}`);
      continue;
    }
    console.log(`apply ${filename}`);
    const sql = readFileSync(new URL(filename, migrationsDir), "utf8");
    await client.query(sql);
    await client.query("insert into public.schema_migrations (filename) values ($1)", [filename]);
  }

  const check = await client.query(
    `select s.name as season, s.scoring_mode,
            count(distinct sm.profile_id)::int as people,
            count(distinct t.id)::int as teams
     from seasons s
     left join season_members sm on sm.season_id = s.id
     left join teams t on t.season_id = s.id
     where s.is_open
     group by s.name, s.scoring_mode`,
  );
  console.log(JSON.stringify(check.rows, null, 2));
} finally {
  await client.end();
}
