// One-time load of previous scorecard tabs.
// Google Sheets downloads every tab together only as an Excel workbook.
// Run: npm run import:workbook -- path\to\workbook.xlsx --dry-run
// Drop --dry-run to write. The database URL comes from .env.local, the same
// connection npm run db:apply uses, so this writes the shared Supabase project.
// A week that already has a task title or a checked box is left alone.
// People who are not already on the roster get a profile, not a roster row,
// so the current week's dashboard does not grow a blank line for them.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import pg from "pg";
import XLSX from "xlsx";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const MONTHS = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function pad(value) {
  return String(value).padStart(2, "0");
}

function isoDate(year, month, day) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

function mondayOf(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const weekday = date.getDay();
  const daysFromMonday = weekday === 0 ? -6 : 1 - weekday;
  date.setDate(date.getDate() + daysFromMonday);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function addDays(iso, days) {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function weekday(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day).getDay();
}

function daysBetween(earlier, later) {
  const [y1, m1, d1] = earlier.split("-").map(Number);
  const [y2, m2, d2] = later.split("-").map(Number);
  return Math.round((new Date(y2, m2 - 1, d2) - new Date(y1, m1 - 1, d1)) / 86_400_000);
}

// Excel deletes / \ ? * [ ] : from a sheet name, so 9/28/2026 arrives as 9282026.
// A name can be read more than one way (1192026 is Jan 19 or Nov 9). The caller
// picks among these Mondays using the neighboring tabs.
export function mondayChoices(name) {
  const text = String(name);
  const separated = separatedDate(text);
  if (separated) return [mondayOf(separated)];

  const cleaned = text.replace(/\s*(scoreboard|scoring|stats)\b.*$/i, "").trim();
  if (!/^\d+$/.test(cleaned)) return [];
  const dates = compactDates(cleaned);
  const exactMondays = dates.filter((iso) => weekday(iso) === 1);
  const pool = exactMondays.length > 0 ? exactMondays : dates.map((iso) => mondayOf(iso));
  return [...new Set(pool)].sort();
}

function separatedDate(text) {
  const patterns = [
    /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/,
    /\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/,
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i,
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{4})\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    let year;
    let month;
    let day;
    if (pattern === patterns[0]) {
      year = Number(match[1]);
      month = Number(match[2]);
      day = Number(match[3]);
    } else if (pattern === patterns[1]) {
      month = Number(match[1]);
      day = Number(match[2]);
      year = Number(match[3]);
    } else if (pattern === patterns[2]) {
      month = MONTHS[match[1].toLowerCase()];
      day = Number(match[2]);
      year = Number(match[3]);
    } else {
      day = Number(match[1]);
      month = MONTHS[match[2].toLowerCase()];
      year = Number(match[3]);
    }
    const iso = isoDate(year, month, day);
    if (iso) return iso;
  }
  return null;
}

function compactDates(digits) {
  const found = [];
  const push = (year, prefix) => {
    if (!prefix || year < 2018 || year > 2030) return;
    for (let monthLength = 1; monthLength <= 2 && monthLength < prefix.length; monthLength += 1) {
      const month = Number(prefix.slice(0, monthLength));
      const dayText = prefix.slice(monthLength);
      if (dayText.length > 2) continue;
      const iso = isoDate(year, month, Number(dayText));
      if (iso) found.push(iso);
    }
  };
  if (digits.length >= 5) push(Number(digits.slice(-4)), digits.slice(0, -4));
  if (digits.length >= 3) {
    const shortYear = Number(digits.slice(-2));
    if (shortYear >= 18 && shortYear <= 30) push(2000 + shortYear, digits.slice(0, -2));
  }
  return [...new Set(found)];
}

// Tabs are newest first. 1192026 can be Jan 19 or Nov 9, so a name with two
// Mondays takes the one a week before the newer tab. A date that is not itself
// a Monday uses that week's Monday. If that week is already another tab, and
// this tab is the newer one, it moves to the following Monday.
export function assignMondays(tabs) {
  const assigned = new Map();
  let newer = null;
  const pending = [];
  for (const tab of tabs) {
    const choices = mondayChoices(tab.name);
    const exact = exactMondays(tab.name).filter((iso) => choices.includes(iso));
    if (exact.length === 1) {
      assigned.set(tab.name, exact[0]);
      newer = exact[0];
      continue;
    }
    if (exact.length > 1) {
      const picked = pickMonday(exact, newer);
      assigned.set(tab.name, picked);
      newer = picked;
      continue;
    }
    pending.push(tab);
  }

  for (const tab of pending) {
    const index = tabs.indexOf(tab);
    const newerMonday = assignedMondayBefore(tabs, assigned, index);
    const olderMonday = assignedMondayAfter(tabs, assigned, index);
    const choices = mondayChoices(tab.name);
    const between = choices.filter((monday) => (!newerMonday || monday < newerMonday) && (!olderMonday || monday > olderMonday));
    let picked = pickMonday(between.length ? between : choices, newerMonday);
    if (picked && olderMonday && picked === olderMonday) picked = addDays(olderMonday, 7);
    if (picked && [...assigned.values()].includes(picked)) {
      const bumped = addDays(picked, 7);
      if (![...assigned.values()].includes(bumped)) picked = bumped;
    }
    if (picked) assigned.set(tab.name, picked);
  }
  return assigned;
}

function exactMondays(name) {
  const cleaned = String(name).replace(/\s*(scoreboard|scoring|stats)\b.*$/i, "").trim();
  if (!/^\d+$/.test(cleaned)) {
    const separated = separatedDate(String(name));
    return separated && weekday(separated) === 1 ? [separated] : [];
  }
  return compactDates(cleaned).filter((iso) => weekday(iso) === 1);
}

function assignedMondayBefore(tabs, assigned, index) {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const monday = assigned.get(tabs[cursor].name);
    if (monday) return monday;
  }
  return null;
}

function assignedMondayAfter(tabs, assigned, index) {
  for (let cursor = index + 1; cursor < tabs.length; cursor += 1) {
    const monday = assigned.get(tabs[cursor].name);
    if (monday) return monday;
  }
  return null;
}

function pickMonday(choices, newer) {
  if (choices.length === 0) return null;
  if (!newer) return choices[choices.length - 1];
  const earlier = choices.filter((monday) => monday < newer);
  const ranked = (earlier.length ? earlier : choices).slice().sort((a, b) => {
    const gapA = Math.abs(daysBetween(a, newer) - 7);
    const gapB = Math.abs(daysBetween(b, newer) - 7);
    return gapA - gapB || daysBetween(a, newer) - daysBetween(b, newer);
  });
  return ranked[0] ?? null;
}

function cellText(value) {
  if (value == null) return "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) return isoDate(value.getFullYear(), value.getMonth() + 1, value.getDate()) ?? "";
  return String(value).trim();
}

function isChecked(value) {
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "yes" || normalized === "y" || normalized === "1";
}

function isPriorityHeader(value) {
  return /priority|high|medium|low/i.test(value) && !/top\s*5/i.test(value);
}

function isBannerRow(cells) {
  return cells.map((cell) => cell.trim()).filter(Boolean).length === 1;
}

function findPriorityPairs(headers, start, end) {
  const pairs = [];
  let index = start;
  while (index < end && pairs.length < 5) {
    const header = headers[index] ?? "";
    const next = headers[index + 1] ?? "";
    if (header && !next && index + 1 < end) {
      pairs.push({ check: index, label: index + 1 });
      index += 2;
      continue;
    }
    if (!header && next && isPriorityHeader(next)) {
      pairs.push({ check: index, label: index + 1 });
      index += 2;
      continue;
    }
    if (header && isPriorityHeader(header)) {
      pairs.push({ check: -1, label: index });
      index += 1;
      continue;
    }
    index += 1;
  }
  return pairs;
}

function combineHeader(table, headerIndex) {
  const headers = table[headerIndex].map((cell) => cell.trim());
  const next = table[headerIndex + 1];
  if (!next) return { headers, dataStart: headerIndex + 1 };
  const nextHasScore = next.some((cell) => /exercise|reading|top\s*5/i.test(cell));
  const nextIsData = next.some((cell) => /^(true|false)$/i.test(cell.trim()));
  if (!nextHasScore || nextIsData) return { headers, dataStart: headerIndex + 1 };
  next.forEach((cell, index) => {
    if (!headers[index] && cell.trim()) headers[index] = cell.trim();
  });
  return { headers, dataStart: headerIndex + 2 };
}

function at(row, index) {
  if (index < 0) return "";
  return (row[index] ?? "").trim();
}

// Same reading rules as src/parseSheetCsv.ts. The first five rows for a person
// are Monday through Friday. Later rows are counted and dropped.
export function parseScorecard(matrix) {
  const table = matrix
    .map((row) => (Array.isArray(row) ? row : []).map(cellText))
    .filter((row) => row.some((value) => value.trim() !== ""));
  const headerIndex = table.findIndex((row) => row.some((cell) => /top priority/i.test(cell)));
  if (headerIndex === -1) return null;

  const { headers, dataStart } = combineHeader(table, headerIndex);
  const notesCol = headers.findIndex((header) => /notes/i.test(header));
  const top5Col = headers.findIndex((header) => /top\s*5/i.test(header));
  const exerciseCol = headers.findIndex((header) => /exercise/i.test(header));
  const readingCol = headers.findIndex((header) => /reading/i.test(header));
  const priorityEnd = [notesCol, top5Col, headers.length].find((index) => index > 0) ?? headers.length;
  const pairs = findPriorityPairs(headers, 1, priorityEnd);
  if (pairs.length === 0 || top5Col === -1) {
    return { error: "The tab is missing the priority columns or the Top 5 checkbox column." };
  }

  const days = [];
  const dayCount = new Map();
  let extra = 0;
  let person = "";

  for (const source of table.slice(dataStart)) {
    if (isBannerRow(source)) {
      person = "";
      continue;
    }
    const name = at(source, 0);
    if (name && name.length > 1) person = name;
    if (!person || person.length < 2) continue;

    const labels = pairs.map((pair) => at(source, pair.label));
    const dones = pairs.map((pair) => isChecked(at(source, pair.check)));
    const top5 = isChecked(at(source, top5Col));
    const exercise = isChecked(at(source, exerciseCol));
    const reading = isChecked(at(source, readingCol));
    const notes = at(source, notesCol);
    const hasTask = labels.some(Boolean) || dones.some(Boolean) || top5 || exercise || reading || notes.length > 0;
    if (!hasTask) continue;

    const dayNumber = (dayCount.get(person) ?? 0) + 1;
    dayCount.set(person, dayNumber);
    if (dayNumber > DAY_NAMES.length) {
      extra += 1;
      continue;
    }

    days.push({
      person,
      offset: dayNumber - 1,
      labels: [0, 1, 2, 3, 4].map((index) => labels[index] ?? ""),
      dones: [0, 1, 2, 3, 4].map((index) => dones[index] ?? false),
      notes,
      top5,
      exercise,
      reading,
    });
  }

  if (days.length === 0) return { error: "The tab did not include any scorecard rows." };
  return { days, extra, people: new Set(days.map((day) => day.person)).size };
}

function readEnv() {
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
  return env;
}

function sheetMatrix(workbook, name) {
  const sheet = workbook.Sheets[name];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "", blankrows: false });
}

async function upsertChunks(client, sqlPrefix, columns, rows, updateSet) {
  const width = columns.length;
  const chunkSize = 200;
  for (let start = 0; start < rows.length; start += chunkSize) {
    const chunk = rows.slice(start, start + chunkSize);
    const params = [];
    const tuples = chunk.map((row) => {
      const marks = row.map((value) => {
        params.push(value);
        return `$${params.length}`;
      });
      return `(${marks.join(", ")})`;
    });
    if (tuples.some((tuple) => tuple.split(",").length !== width)) {
      throw new Error(`Column count drifted for ${sqlPrefix}`);
    }
    await client.query(`${sqlPrefix} values ${tuples.join(", ")} ${updateSet}`, params);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const file = args.find((arg) => !arg.startsWith("--"));
  if (!file) {
    console.error("Usage: npm run import:workbook -- path\\to\\workbook.xlsx [--dry-run]");
    process.exit(1);
  }

  const workbook = XLSX.readFile(file, { cellDates: true });
  const scorecards = [];
  let skippedLayout = 0;

  for (const name of workbook.SheetNames) {
    const parsed = parseScorecard(sheetMatrix(workbook, name));
    if (!parsed) {
      skippedLayout += 1;
      continue;
    }
    if (parsed.error) {
      console.log(`skip ${name}: ${parsed.error}`);
      continue;
    }
    scorecards.push({ name, ...parsed });
  }
  console.log(`Skipped ${skippedLayout} tabs that are not scorecards.`);

  const mondays = assignMondays(scorecards);
  const planned = [];
  const claimed = new Map();
  for (const tab of scorecards) {
    const monday = mondays.get(tab.name) ?? null;
    if (!monday) {
      console.log(`skip ${tab.name}: no date in the tab name`);
      continue;
    }
    if (claimed.has(monday)) {
      console.log(`skip ${tab.name}: ${monday} is already ${claimed.get(monday)}`);
      continue;
    }
    claimed.set(monday, tab.name);
    planned.push({ ...tab, monday });
  }

  const env = readEnv();
  const client = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const season = await client.query(
      "select id, starts_on::text as starts_on from public.seasons where is_open",
    );
    if (season.rows.length !== 1) throw new Error("Expected one open season.");
    const seasonId = season.rows[0].id;
    const bonuses = await client.query(
      `select id, key, points
       from public.bonus_definitions
       where season_id = $1 and retired_at is null and key in ('top5', 'exercise', 'reading')`,
      [seasonId],
    );
    const bonusByKey = new Map(bonuses.rows.map((row) => [row.key, row]));
    const taken = await client.query(
      `select distinct to_char(entry_date - (extract(isodow from entry_date)::int - 1), 'YYYY-MM-DD') as week_monday
       from public.tasks
       where season_id = $1 and (done or length(btrim(title)) > 0)`,
      [seasonId],
    );
    const takenWeeks = new Set(taken.rows.map((row) => row.week_monday));
    const profiles = await client.query(
      `select p.id, p.display_name, p.created_at,
              exists (
                select 1 from public.season_members sm
                where sm.season_id = $1 and sm.profile_id = p.id
              ) as on_roster
       from public.profiles p`,
      [seasonId],
    );
    const byName = new Map();
    for (const profile of profiles.rows) {
      const key = profile.display_name.trim().toLowerCase();
      const current = byName.get(key);
      const better =
        !current ||
        (profile.on_roster && !current.on_roster) ||
        (profile.on_roster === current.on_roster && profile.created_at < current.created_at);
      if (better) byName.set(key, profile);
    }

    const ready = [];
    for (const tab of planned) {
      if (takenWeeks.has(tab.monday)) {
        console.log(`skip ${tab.name}: ${tab.monday} already has tasks`);
        continue;
      }
      const extra = tab.extra > 0 ? `, ${tab.extra} row${tab.extra === 1 ? "" : "s"} past Friday left out` : "";
      console.log(`${dryRun ? "would write" : "write"} ${tab.name}: ${tab.monday}, ${tab.people} people${extra}`);
      ready.push(tab);
    }

    if (dryRun || ready.length === 0) {
      console.log(`${dryRun ? "Dry run." : "Nothing to write."} ${ready.length} week${ready.length === 1 ? "" : "s"}.`);
      return;
    }

    await client.query("begin");
    try {
      const dayEntries = [];
      const taskRows = [];
      const checkRows = [];
      for (const tab of ready) {
        const friday = addDays(tab.monday, 4);
        const names = [...new Set(tab.days.map((day) => day.person))];
        const ids = new Map();
        for (const person of names) {
          const key = person.trim().toLowerCase();
          const existing = byName.get(key);
          if (existing) {
            ids.set(person, existing.id);
            continue;
          }
          const inserted = await client.query(
            "insert into public.profiles (display_name) values ($1) returning id, created_at",
            [person.trim()],
          );
          const created = { ...inserted.rows[0], display_name: person.trim(), on_roster: false };
          byName.set(key, created);
          ids.set(person, created.id);
        }

        for (const day of tab.days) {
          const profileId = ids.get(day.person);
          const entryDate = addDays(tab.monday, day.offset);
          if (entryDate < tab.monday || entryDate > friday) continue;
          dayEntries.push([seasonId, profileId, entryDate, day.notes]);
          day.labels.forEach((title, index) => {
            taskRows.push([seasonId, profileId, entryDate, index + 1, title, day.dones[index]]);
          });
          for (const key of ["top5", "exercise", "reading"]) {
            const bonus = bonusByKey.get(key);
            if (!bonus) continue;
            const checked = day[key];
            checkRows.push([seasonId, profileId, entryDate, bonus.id, checked, checked ? bonus.points : 0]);
          }
        }
        await client.query(
          `insert into public.week_meta (week_monday, source) values ($1, $2)
           on conflict (week_monday) do update set source = excluded.source`,
          [tab.monday, tab.name],
        );
      }

      await upsertChunks(
        client,
        "insert into public.day_entries (season_id, profile_id, entry_date, notes)",
        ["season_id", "profile_id", "entry_date", "notes"],
        dayEntries,
        `on conflict (profile_id, entry_date) do update set notes = excluded.notes`,
      );
      await upsertChunks(
        client,
        "insert into public.tasks (season_id, profile_id, entry_date, slot, title, done)",
        ["season_id", "profile_id", "entry_date", "slot", "title", "done"],
        taskRows,
        `on conflict (profile_id, entry_date, slot) do update set title = excluded.title, done = excluded.done`,
      );
      if (checkRows.length > 0) {
        await upsertChunks(
          client,
          "insert into public.bonus_checks (season_id, profile_id, entry_date, bonus_id, checked, points_awarded)",
          ["season_id", "profile_id", "entry_date", "bonus_id", "checked", "points_awarded"],
          checkRows,
          `on conflict (profile_id, entry_date, bonus_id) do update
             set checked = excluded.checked, points_awarded = excluded.points_awarded`,
        );
      }
      await client.query("commit");
      console.log(`Wrote ${ready.length} week${ready.length === 1 ? "" : "s"}.`);
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  } finally {
    await client.end();
  }
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
