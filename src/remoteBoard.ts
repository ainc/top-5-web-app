// Loads and saves the scorecard through Supabase.
//
// The grid still edits one DayRow per person per weekday. Postgres does not
// store that shape. A save splits one row into:
//   profiles + season_members  who is on the roster
//   day_entries                the notes for that date
//   tasks                      five slots (1 Top through 5 Low)
//   bonus_checks               Top 5, Exercise, and Reading, with the points
//                              copied at check time so a later bonus edit
//                              does not rewrite past days
// A load joins those tables back into DayRows.
//
// This season's scoring_mode is "individual", so team names on a row are
// ignored. The teams tables stay empty until a commissioner turns team
// scoring on.

import type { RealtimeChannel } from "@supabase/supabase-js";
import { DAY_NAMES } from "./points";
import { getSupabase } from "./supabaseClient";
import type { DayRow } from "./types";
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

type ScoringMode = "individual" | "teams";

type PersonRecord = {
  id: string;
  person: string;
  team: string | null;
  createdAt: string;
};

type Catalog = {
  seasonId: string;
  scoringMode: ScoringMode;
  teams: Map<string, string>;
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
  roster: Array<{ person: string; team: string | null }>;
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

function rosterKey(person: string, team: string | null): string {
  return team ? `${team}|${person}` : person;
}

// Sheet banners such as ACES used to arrive as a team name. Drop them unless
// this season is actually scoring teams, so an import cannot recreate those groups.
function assignedTeam(cat: Catalog, team: string | null): string | null {
  return cat.scoringMode === "teams" ? team : null;
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

function identitySlug(person: string, team: string | null): string {
  return team ? `${slug(team)}-${slug(person)}` : slug(person);
}

function emptyRow(person: PersonRecord, monday: string, offset: number): DayRow {
  return {
    id: `${monday}-${identitySlug(person.person, person.team)}-${offset + 1}`,
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

// The first version of this app stored weeks in localStorage. Copy that up only
// when Supabase has no day_entries. Once the database has rows, it wins, so a
// second browser cannot overwrite the shared board with its own empty cache.
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

function comparePeople(a: PersonRecord, b: PersonRecord): number {
  if (a.team !== b.team) {
    if (!a.team) return 1;
    if (!b.team) return -1;
    return a.team.localeCompare(b.team);
  }
  return a.createdAt.localeCompare(b.createdAt) || a.person.localeCompare(b.person);
}

// Everything else hangs off the one open season. Bonuses come from the
// database so a commissioner can change 15/5/5 without a code change. The
// grid still labels those boxes 15, 5, and 5 until that UI exists.
async function refreshCatalog(): Promise<Catalog> {
  const supabase = getSupabase();
  const { data: season, error: seasonError } = await supabase
    .from("seasons")
    .select("id, scoring_mode")
    .eq("is_open", true)
    .maybeSingle();
  fail(seasonError, "read season");
  if (!season) throw new Error("No open season in Supabase. Apply the migration in supabase/migrations first.");
  const scoringMode: ScoringMode = season.scoring_mode === "teams" ? "teams" : "individual";

  const { data: teamRows, error: teamError } = await supabase.from("teams").select("id, name").eq("season_id", season.id);
  fail(teamError, "read teams");
  const teams = new Map<string, string>();
  for (const row of teamRows ?? []) teams.set(String(row.name), String(row.id));

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
    .from("season_members")
    .select("profile_id, profiles(display_name, created_at)")
    .eq("season_id", season.id);
  fail(memberError, "read roster");

  const teamByProfile = new Map<string, string>();
  if (scoringMode === "teams") {
    const { data: assignments, error: assignmentError } = await supabase
      .from("team_members")
      .select("profile_id, teams(name)")
      .eq("season_id", season.id);
    fail(assignmentError, "read team assignments");
    for (const assignment of assignments ?? []) {
      const team = one(assignment.teams as { name: string } | { name: string }[] | null);
      if (team?.name) teamByProfile.set(String(assignment.profile_id), team.name);
    }
  }

  const people = new Map<string, PersonRecord>();
  for (const member of members ?? []) {
    const profile = one(
      member.profiles as { display_name: string; created_at: string } | { display_name: string; created_at: string }[] | null,
    );
    if (!profile) continue;
    const team = teamByProfile.get(String(member.profile_id)) ?? null;
    people.set(rosterKey(profile.display_name, team), {
      id: String(member.profile_id),
      person: profile.display_name,
      team,
      createdAt: profile.created_at,
    });
  }

  catalog = { seasonId: season.id, scoringMode, teams, bonuses, people };
  return catalog;
}

async function ensurePerson(person: string, team: string | null, cat: Catalog): Promise<PersonRecord> {
  const key = rosterKey(person, team);
  const cached = cat.people.get(key);
  if (cached) return cached;

  const supabase = getSupabase();
  const { data: existing, error: findError } = await supabase
    .from("season_members")
    .select("profile_id, profiles!inner(display_name, created_at)")
    .eq("season_id", cat.seasonId)
    .eq("profiles.display_name", person)
    .maybeSingle();
  fail(findError, "find person");

  let profileId: string;
  let createdAt: string;
  if (existing) {
    const profile = one(
      existing.profiles as { display_name: string; created_at: string } | { display_name: string; created_at: string }[] | null,
    );
    profileId = String(existing.profile_id);
    createdAt = profile?.created_at ?? new Date().toISOString();
  } else {
    const { data: inserted, error: insertError } = await supabase
      .from("profiles")
      .insert({ display_name: person })
      .select("id, created_at")
      .single();
    fail(insertError, "add person");
    if (!inserted) throw new Error("add person: no profile returned");
    const { error: memberError } = await supabase.from("season_members").insert({
      season_id: cat.seasonId,
      profile_id: inserted.id,
    });
    if (memberError) {
      await supabase.from("profiles").delete().eq("id", inserted.id);
      throw new Error(`add roster: ${memberError.message}`);
    }
    profileId = inserted.id;
    createdAt = inserted.created_at;
  }

  if (team) {
    const teamId = cat.teams.get(team);
    if (teamId) {
      const { error: teamError } = await supabase.from("team_members").upsert(
        { season_id: cat.seasonId, team_id: teamId, profile_id: profileId },
        { onConflict: "season_id,profile_id" },
      );
      fail(teamError, "assign team");
    }
  }

  const record: PersonRecord = { id: profileId, person, team, createdAt };
  cat.people.set(key, record);
  return record;
}

function rosterFromCatalog(cat: Catalog): Array<{ person: string; team: string | null }> {
  return [...cat.people.values()]
    .sort(comparePeople)
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
      const left = cat.people.get(rosterKey(a.person, a.team));
      const right = cat.people.get(rosterKey(b.person, b.team));
      const peopleDelta = left && right ? comparePeople(left, right) : a.person.localeCompare(b.person);
      if (peopleDelta !== 0) return peopleDelta;
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
    const team = assignedTeam(cat, row.team);
    const key = rosterKey(row.person, team);
    if (!people.has(key)) people.set(key, await ensurePerson(row.person, team, cat));
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
    const person = people.get(rosterKey(row.person, assignedTeam(cat, row.team)));
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
        // Store the point value from this moment. Unchecking clears it so the
        // next check picks up whatever the bonus is worth then.
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

// Writes run one at a time. A second edit to the same week updates the queued
// rows instead of starting a second request, so a burst of checks cannot
// finish out of order and put an older day back. replace=true is an import:
// it deletes that Monday–Friday first, then inserts the file.
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

// Loads share the same queue as saves. A refresh that started before a save
// finished would otherwise paint the older rows back over the checkbox.
export function loadBoardState(): Promise<LoadedBoard> {
  const run = chain.then(() => loadOnce());
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

// Other browsers hear inserts and updates on the three tables a checkbox
// writes. Profiles and the roster are not in this channel; a new person
// shows up the next time the board reloads.
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
