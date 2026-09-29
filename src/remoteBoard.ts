// Loads and saves the scorecard through Supabase.
// The grid still thinks in person-day rows. This file splits those rows into
// roster, tasks, notes, and bonus checks.

import type { RealtimeChannel } from "@supabase/supabase-js";
import { DAY_NAMES } from "./points";
import { getSupabase } from "./supabaseClient";
import type { DayRow, Team } from "./types";
import {
  addDays,
  blankWeek,
  currentMonday,
  mondayOf,
  parseISODate,
  type BoardState,
  type WeekRecord,
} from "./weeks";

const STORAGE_KEY = "top5-board-v2";
const LEGACY_KEY = "top5-board-v1";

const TEAMS: Team[] = ["ACES", "Alpha", "Awesomes"];
const TEAM_RANK: Record<Team, number> = { ACES: 0, Alpha: 1, Awesomes: 2 };

const TASK_SLOTS = [
  { slot: 1, label: "topLabel", done: "topDone" },
  { slot: 2, label: "highLabel", done: "highDone" },
  { slot: 3, label: "med1Label", done: "med1Done" },
  { slot: 4, label: "med2Label", done: "med2Done" },
  { slot: 5, label: "lowLabel", done: "lowDone" },
] as const;

const BONUS_FIELDS = [
  { key: "top5", field: "top5" },
  { key: "exercise", field: "exercise" },
  { key: "reading", field: "reading" },
] as const;

type BonusKey = (typeof BONUS_FIELDS)[number]["key"];

type PersonRecord = {
  id: string;
  person: string;
  team: Team;
  createdAt: string;
};

type Catalog = {
  seasonId: string;
  teams: Record<Team, string>;
  bonuses: Record<BonusKey, { id: string; points: number }>;
  people: Map<string, PersonRecord>;
};

type WeekWrite = {
  source: string;
  replace: boolean;
  rows: Map<string, DayRow>;
};

export type LoadedBoard = {
  weeks: Record<string, WeekRecord>;
  roster: Array<{ person: string; team: Team }>;
  migratedFromBrowser: boolean;
  empty: boolean;
};

let catalog: Catalog | null = null;
const pendingWrites = new Map<string, WeekWrite>();
let chain: Promise<void> = Promise.resolve();
let queuedFlushes = 0;

export function writesInFlight(): boolean {
  return queuedFlushes > 0 || pendingWrites.size > 0;
}

function fail(error: { message: string } | null, action: string): void {
  if (error) throw new Error(`${action}: ${error.message}`);
}

function personKey(person: string, team: Team): string {
  return `${team}|${person}`;
}

function isTeam(value: string): value is Team {
  return TEAMS.includes(value as Team);
}

function isBonusKey(value: string): value is BonusKey {
  return value === "top5" || value === "exercise" || value === "reading";
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function dayOffset(monday: string, date: string): number {
  const start = parseISODate(monday).getTime();
  const current = parseISODate(date).getTime();
  return Math.round((current - start) / 86_400_000);
}

function emptyRow(person: PersonRecord, monday: string, offset: number): DayRow {
  return {
    id: `${monday}-${slug(person.team)}-${slug(person.person)}-${offset + 1}`,
    person: person.person,
    team: person.team,
    day: DAY_NAMES[offset],
    topLabel: "",
    topDone: false,
    highLabel: "",
    highDone: false,
    med1Label: "",
    med1Done: false,
    med2Label: "",
    med2Done: false,
    lowLabel: "",
    lowDone: false,
    notes: "",
    top5: false,
    exercise: false,
    reading: false,
  };
}

function isDayRowArray(value: unknown): value is DayRow[] {
  return Array.isArray(value) && value.length > 0 && typeof value[0]?.person === "string";
}

// One-time copy of the old browser save, used only when Supabase has no days yet.
function readLocalBoard(): BoardState | null {
  const today = currentMonday();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as BoardState;
      if (parsed?.weeks && typeof parsed.selectedWeek === "string" && Object.keys(parsed.weeks).length > 0) {
        return {
          selectedWeek: parsed.selectedWeek > today ? today : parsed.selectedWeek,
          weeks: parsed.weeks,
        };
      }
    }
  } catch {
    // Fall through to the older single-week save.
  }

  try {
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (!legacy) return null;
    const rows = JSON.parse(legacy) as unknown;
    if (!isDayRowArray(rows)) return null;
    return {
      selectedWeek: today,
      weeks: { [today]: { rows, source: "Saved on this computer" } },
    };
  } catch {
    return null;
  }
}

async function selectAll(
  table: "day_entries" | "tasks" | "bonus_checks" | "week_meta",
  seasonId: string | null,
): Promise<Record<string, unknown>[]> {
  const pageSize = 1000;
  const rows: Record<string, unknown>[] = [];
  const supabase = getSupabase();
  for (let from = 0; ; from += pageSize) {
    let request = supabase.from(table).select("*");
    if (seasonId) request = request.eq("season_id", seasonId);
    const { data, error } = await request.range(from, from + pageSize - 1);
    fail(error, `read ${table}`);
    const batch = data ?? [];
    rows.push(...(batch as Record<string, unknown>[]));
    if (batch.length < pageSize) break;
  }
  return rows;
}

async function refreshCatalog(): Promise<Catalog> {
  const supabase = getSupabase();
  const { data: season, error: seasonError } = await supabase
    .from("seasons")
    .select("id")
    .eq("is_open", true)
    .maybeSingle();
  fail(seasonError, "read season");
  if (!season) throw new Error("No open season in Supabase. Apply the migration in supabase/migrations first.");

  const { data: teamRows, error: teamError } = await supabase.from("teams").select("id, name").eq("season_id", season.id);
  fail(teamError, "read teams");
  const teams = {} as Record<Team, string>;
  for (const row of teamRows ?? []) {
    if (isTeam(row.name)) teams[row.name] = row.id;
  }
  for (const name of TEAMS) {
    if (!teams[name]) throw new Error(`Team ${name} is missing from the open season.`);
  }

  const { data: bonusRows, error: bonusError } = await supabase
    .from("bonus_definitions")
    .select("id, key, points")
    .eq("season_id", season.id)
    .is("retired_at", null);
  fail(bonusError, "read bonuses");
  const bonuses = {} as Catalog["bonuses"];
  for (const row of bonusRows ?? []) {
    const key = String(row.key);
    if (isBonusKey(key)) bonuses[key] = { id: String(row.id), points: Number(row.points) };
  }
  for (const field of BONUS_FIELDS) {
    if (!bonuses[field.key]) throw new Error(`Bonus ${field.key} is missing from the open season.`);
  }

  const { data: members, error: memberError } = await supabase
    .from("team_members")
    .select("profile_id, profiles(display_name, created_at), teams(name)")
    .eq("season_id", season.id);
  fail(memberError, "read roster");

  const people = new Map<string, PersonRecord>();
  for (const member of members ?? []) {
    const profile = one(member.profiles as { display_name: string; created_at: string } | { display_name: string; created_at: string }[] | null);
    const team = one(member.teams as { name: string } | { name: string }[] | null);
    if (!profile || !team || !isTeam(team.name)) continue;
    people.set(personKey(profile.display_name, team.name), {
      id: member.profile_id,
      person: profile.display_name,
      team: team.name,
      createdAt: profile.created_at,
    });
  }

  catalog = { seasonId: season.id, teams, bonuses, people };
  return catalog;
}

async function ensurePerson(person: string, team: Team, cat: Catalog): Promise<PersonRecord> {
  const key = personKey(person, team);
  const cached = cat.people.get(key);
  if (cached) return cached;

  const supabase = getSupabase();
  const { data: existing, error: findError } = await supabase
    .from("team_members")
    .select("profile_id, profiles!inner(display_name, created_at), teams!inner(name)")
    .eq("season_id", cat.seasonId)
    .eq("profiles.display_name", person)
    .eq("teams.name", team)
    .maybeSingle();
  fail(findError, "find person");
  if (existing) {
    const profile = one(existing.profiles as { display_name: string; created_at: string } | { display_name: string; created_at: string }[] | null);
    const record: PersonRecord = {
      id: existing.profile_id,
      person,
      team,
      createdAt: profile?.created_at ?? new Date().toISOString(),
    };
    cat.people.set(key, record);
    return record;
  }

  const { data: inserted, error: insertError } = await supabase
    .from("profiles")
    .insert({ display_name: person })
    .select("id, created_at")
    .single();
  fail(insertError, "add person");
  if (!inserted) throw new Error("add person: no profile returned");
  const { error: memberError } = await supabase.from("team_members").insert({
    season_id: cat.seasonId,
    team_id: cat.teams[team],
    profile_id: inserted.id,
  });
  if (memberError) {
    await supabase.from("profiles").delete().eq("id", inserted.id);
    throw new Error(`add roster: ${memberError.message}`);
  }
  const record: PersonRecord = {
    id: inserted.id,
    person,
    team,
    createdAt: inserted.created_at,
  };
  cat.people.set(key, record);
  return record;
}

function rosterFromCatalog(cat: Catalog): Array<{ person: string; team: Team }> {
  return [...cat.people.values()]
    .sort(
      (a, b) =>
        TEAM_RANK[a.team] - TEAM_RANK[b.team] || a.createdAt.localeCompare(b.createdAt) || a.person.localeCompare(b.person),
    )
    .map((person) => ({ person: person.person, team: person.team }));
}

async function fetchWeeks(cat: Catalog): Promise<Record<string, WeekRecord>> {
  const [entries, tasks, checks, metas] = await Promise.all([
    selectAll("day_entries", cat.seasonId),
    selectAll("tasks", cat.seasonId),
    selectAll("bonus_checks", cat.seasonId),
    selectAll("week_meta", null),
  ]);

  const peopleById = new Map<string, PersonRecord>();
  for (const person of cat.people.values()) peopleById.set(person.id, person);

  const bonusField = new Map<string, BonusKey>();
  for (const field of BONUS_FIELDS) bonusField.set(cat.bonuses[field.key].id, field.key);

  const drafts = new Map<string, DayRow>();
  const draftFor = (profileId: string, entryDate: string): DayRow | null => {
    const person = peopleById.get(profileId);
    if (!person || typeof entryDate !== "string") return null;
    const monday = mondayOf(parseISODate(entryDate));
    const offset = dayOffset(monday, entryDate);
    if (offset < 0 || offset > 4) return null;
    const key = `${profileId}|${entryDate}`;
    const existing = drafts.get(key);
    if (existing) return existing;
    const row = emptyRow(person, monday, offset);
    drafts.set(key, row);
    return row;
  };

  for (const entry of entries) {
    const row = draftFor(String(entry.profile_id), String(entry.entry_date));
    if (row) row.notes = typeof entry.notes === "string" ? entry.notes : "";
  }
  for (const task of tasks) {
    const row = draftFor(String(task.profile_id), String(task.entry_date));
    const slot = TASK_SLOTS.find((item) => item.slot === Number(task.slot));
    if (!row || !slot) continue;
    row[slot.label] = typeof task.title === "string" ? task.title : "";
    row[slot.done] = Boolean(task.done);
  }
  for (const check of checks) {
    const row = draftFor(String(check.profile_id), String(check.entry_date));
    const field = bonusField.get(String(check.bonus_id));
    if (!row || !field) continue;
    row[field] = Boolean(check.checked);
  }

  const sources = new Map<string, string>();
  for (const meta of metas) {
    if (typeof meta.week_monday === "string" && typeof meta.source === "string") {
      sources.set(meta.week_monday, meta.source);
    }
  }

  const grouped = new Map<string, DayRow[]>();
  for (const row of drafts.values()) {
    // emptyRow prefixes the id with Monday, YYYY-MM-DD.
    const weekId = row.id.slice(0, 10);
    const list = grouped.get(weekId) ?? [];
    list.push(row);
    grouped.set(weekId, list);
  }

  const weeks: Record<string, WeekRecord> = {};
  for (const [weekId, rows] of grouped) {
    rows.sort((a, b) => {
      const teamDelta = TEAM_RANK[a.team] - TEAM_RANK[b.team];
      if (teamDelta !== 0) return teamDelta;
      const created =
        (cat.people.get(personKey(a.person, a.team))?.createdAt ?? "").localeCompare(
          cat.people.get(personKey(b.person, b.team))?.createdAt ?? "",
        ) || a.person.localeCompare(b.person);
      if (created !== 0) return created;
      return DAY_NAMES.indexOf(a.day as (typeof DAY_NAMES)[number]) - DAY_NAMES.indexOf(b.day as (typeof DAY_NAMES)[number]);
    });
    weeks[weekId] = { rows, source: sources.get(weekId) ?? "Supabase" };
  }
  return weeks;
}

async function writeJob(weekId: string, job: WeekWrite): Promise<void> {
  const rows = [...job.rows.values()].filter((row) => DAY_NAMES.includes(row.day as (typeof DAY_NAMES)[number]));
  if (rows.length === 0 && !job.replace) return;

  const cat = catalog ?? (await refreshCatalog());
  const supabase = getSupabase();
  const friday = addDays(weekId, 4);

  if (job.replace) {
    const tables = ["tasks", "bonus_checks", "day_entries"] as const;
    await Promise.all(
      tables.map(async (table) => {
        const { error } = await supabase
          .from(table)
          .delete()
          .eq("season_id", cat.seasonId)
          .gte("entry_date", weekId)
          .lte("entry_date", friday);
        fail(error, `clear ${table}`);
      }),
    );
  }

  if (rows.length === 0) {
    const { error } = await supabase.from("week_meta").upsert({ week_monday: weekId, source: job.source });
    fail(error, "save week label");
    return;
  }

  const people = new Map<string, PersonRecord>();
  for (const row of rows) {
    const key = personKey(row.person, row.team);
    if (!people.has(key)) people.set(key, await ensurePerson(row.person, row.team, cat));
  }

  const dayEntries: Array<{ season_id: string; profile_id: string; entry_date: string; notes: string }> = [];
  const taskRows: Array<{
    season_id: string;
    profile_id: string;
    entry_date: string;
    slot: number;
    title: string;
    done: boolean;
  }> = [];
  const checkRows: Array<{
    season_id: string;
    profile_id: string;
    entry_date: string;
    bonus_id: string;
    checked: boolean;
    points_awarded: number;
  }> = [];

  for (const row of rows) {
    const offset = DAY_NAMES.indexOf(row.day as (typeof DAY_NAMES)[number]);
    if (offset < 0) continue;
    const person = people.get(personKey(row.person, row.team));
    if (!person) continue;
    const entryDate = addDays(weekId, offset);
    dayEntries.push({
      season_id: cat.seasonId,
      profile_id: person.id,
      entry_date: entryDate,
      notes: row.notes,
    });
    for (const slot of TASK_SLOTS) {
      taskRows.push({
        season_id: cat.seasonId,
        profile_id: person.id,
        entry_date: entryDate,
        slot: slot.slot,
        title: row[slot.label],
        done: row[slot.done],
      });
    }
    for (const bonus of BONUS_FIELDS) {
      const checked = row[bonus.field];
      checkRows.push({
        season_id: cat.seasonId,
        profile_id: person.id,
        entry_date: entryDate,
        bonus_id: cat.bonuses[bonus.key].id,
        checked,
        points_awarded: checked ? cat.bonuses[bonus.key].points : 0,
      });
    }
  }

  const { error: entryError } = await supabase.from("day_entries").upsert(dayEntries, { onConflict: "profile_id,entry_date" });
  fail(entryError, "save notes");
  const { error: taskError } = await supabase.from("tasks").upsert(taskRows, { onConflict: "profile_id,entry_date,slot" });
  fail(taskError, "save tasks");
  const { error: checkError } = await supabase
    .from("bonus_checks")
    .upsert(checkRows, { onConflict: "profile_id,entry_date,bonus_id" });
  fail(checkError, "save bonuses");
  const { error: metaError } = await supabase.from("week_meta").upsert({ week_monday: weekId, source: job.source });
  fail(metaError, "save week label");
}

async function flush(weekId: string): Promise<void> {
  const job = pendingWrites.get(weekId);
  if (!job) return;
  pendingWrites.delete(weekId);
  await writeJob(weekId, job);
}

// Later edits to the same week replace the queued rows, so a burst of checks is one write.
export function saveDays(weekId: string, rows: DayRow[], source: string, replace = false): Promise<void> {
  const current = pendingWrites.get(weekId) ?? { source, replace: false, rows: new Map<string, DayRow>() };
  current.source = source;
  if (replace) {
    current.replace = true;
    current.rows = new Map(rows.map((row) => [row.id, { ...row }]));
  } else {
    for (const row of rows) current.rows.set(row.id, { ...row });
  }
  pendingWrites.set(weekId, current);

  queuedFlushes += 1;
  const run = chain.then(async () => {
    try {
      await flush(weekId);
    } finally {
      queuedFlushes -= 1;
    }
  });
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function loadOnce(): Promise<LoadedBoard> {
  const cat = await refreshCatalog();
  const supabase = getSupabase();
  const { count, error } = await supabase
    .from("day_entries")
    .select("id", { count: "exact", head: true })
    .eq("season_id", cat.seasonId);
  fail(error, "count days");

  let migratedFromBrowser = false;
  if ((count ?? 0) === 0) {
    const local = readLocalBoard();
    const savedWeeks = Object.entries(local?.weeks ?? {}).filter(([, week]) => week.rows.length > 0);
    for (const [weekId, week] of savedWeeks) {
      await writeJob(weekId, {
        replace: true,
        source: week.source,
        rows: new Map(week.rows.map((row) => [row.id, { ...row }])),
      });
      migratedFromBrowser = true;
    }
  }

  const weeks = await fetchWeeks(cat);
  const roster = rosterFromCatalog(cat);
  const today = currentMonday();
  if (!weeks[today] && roster.length > 0) {
    const rows = blankWeek(roster, today);
    await writeJob(today, {
      replace: false,
      source: "Blank week",
      rows: new Map(rows.map((row) => [row.id, row])),
    });
    weeks[today] = { rows, source: "Blank week" };
  }

  return {
    weeks,
    roster,
    migratedFromBrowser,
    empty: Object.keys(weeks).length === 0,
  };
}

export function loadBoardState(): Promise<LoadedBoard> {
  const run = chain.then(() => loadOnce());
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function subscribeToBoard(onChange: () => void): () => void {
  const supabase = getSupabase();
  let channel: RealtimeChannel | null = supabase
    .channel("scorecard")
    .on("postgres_changes", { event: "*", schema: "public", table: "day_entries" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "bonus_checks" }, onChange)
    .subscribe();

  return () => {
    if (!channel) return;
    void supabase.removeChannel(channel);
    channel = null;
  };
}
