// Applies supabase/migrations using SUPABASE_DB_URL from .env.local.
import { readFileSync } from "node:fs";
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
const sql = readFileSync(new URL("../supabase/migrations/20260929160000_initial_schema.sql", import.meta.url), "utf8");

await client.connect();
try {
  await client.query(sql);
  const check = await client.query(
    `select s.name as season, s.starts_on, s.length_weeks, t.name as team, b.key, b.points
     from seasons s
     left join teams t on t.season_id = s.id
     left join bonus_definitions b on b.season_id = s.id
     where s.is_open
     order by t.name, b.key`,
  );
  console.log(JSON.stringify(check.rows, null, 2));
} finally {
  await client.end();
}
