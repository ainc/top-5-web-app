// Loads and saves the scorecard through Supabase.
//
// The grid still edits one DayRow per person per weekday. Postgres does not
// store that shape. A save splits one row into:
//   profiles + season_members  who is on the roster
//   day_entries                the notes for that date
//   tasks                      five slots (1 Top through 5 Low)
//   bonus_checks               Top 5, Exercise, Reading, and any added bonus,
//                              with the points copied at check time so a later
//                              bonus edit does not rewrite past days
// A load joins those tables back into DayRows.
//
// This season's scoring_mode is "individual", so team names on a row are
// ignored. The teams tables stay empty until a commissioner turns team
// scoring on.

import type { RealtimeChannel, User } from "@supabase/supabase-js";
import { googleDisplayName } from "./auth";
import { DAY_NAMES, isBuiltinBonus, type BuiltinBonusKey } from "./points";
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

type KnownBonus = {
  id: string;
  key: string;
  name: string;
  points: number;
  retired: boolean;
};

type ScoringMode = "individual" | "teams";

type PersonRecord = {
  id: string;
  person: string;
  team: string | null;
  nickname: string | null;
  createdAt: string;
};

type Catalog = {
  seasonId: string;
  scoringMode: ScoringMode;
  name: string;
  startsOn: string;
  lengthWeeks: number;
  pointsPerTask: number;
  teams: Map<string, string>;
  bonuses: Record<BuiltinBonusKey, { id: string; name: string; points: number }>;
  extras: Array<{ id: string; key: string; name: string; points: number }>;
  knownBonuses: KnownBonus[];
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
  scoringMode: ScoringMode;
  pointsPerTask: number;
  bonusPoints: {
    top5: number;
    exercise: number;
    reading: number;
    top5Name: string;
    exerciseName: string;
    readingName: string;
    extras: Array<{ key: string; name: string; points: number }>;
  };
  season: { name: string; startsOn: string; lengthWeeks: number };
  nicknames: Record<string, string>;
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
    extraChecks: {},
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

// The board reads the one active season. A draft stays off this load until
// a commissioner activates it, which closes the season that was open.
// Bonuses come from the database so a commissioner can change 15/5/5 without a code change.
async function refreshCatalog(): Promise<Catalog> {
  const supabase = getSupabase();
  const { data: season, error: seasonError } = await supabase
    .from("seasons")
    .select("id, name, scoring_mode, starts_on, length_weeks")
    .eq("is_open", true)
    .maybeSingle();
  fail(seasonError, "read season");
  if (!season) throw new Error("No open season in Supabase. Apply the migration in supabase/migrations first.");
  const scoringMode: ScoringMode = season.scoring_mode === "teams" ? "teams" : "individual";
  const { data: rules, error: rulesError } = await supabase
    .from("scoring_rules")
    .select("points_per_task")
    .eq("season_id", season.id)
    .maybeSingle();
  fail(rulesError, "read scoring rules");
  const pointsPerTask = Number(rules?.points_per_task ?? 0);

  const { data: teamRows, error: teamError } = await supabase.from("teams").select("id, name").eq("season_id", season.id);
  fail(teamError, "read teams");
  const teams = new Map<string, string>();
  for (const row of teamRows ?? []) teams.set(String(row.name), String(row.id));

  const { data: bonusRows, error: bonusError } = await supabase
    .from("bonus_definitions")
    .select("id, key, name, points, retired_at")
    .eq("season_id", season.id);
  fail(bonusError, "read bonuses");
  const knownBonuses: KnownBonus[] = (bonusRows ?? []).map((row) => ({
    id: String(row.id),
    key: String(row.key),
    name: String(row.name),
    points: Number(row.points),
    retired: row.retired_at != null,
  }));
  const bonuses = {} as Catalog["bonuses"];
  const builtinNames: Record<BuiltinBonusKey, string> = { top5: "Top 5", exercise: "Exercise", reading: "Reading" };
  for (const bonus of knownBonuses) {
    if (!isBuiltinBonus(bonus.key) || bonus.retired) continue;
    bonuses[bonus.key] = { id: bonus.id, name: bonus.name || builtinNames[bonus.key], points: bonus.points };
  }
  // A missing built-in still leaves the checkbox on screen, worth 0, and is not written.
  for (const field of BONUS_FIELDS) {
    if (!bonuses[field.key]) bonuses[field.key] = { id: "", name: builtinNames[field.key], points: 0 };
  }
  const extras = knownBonuses
    .filter((bonus) => !bonus.retired && !isBuiltinBonus(bonus.key))
    .map((bonus) => ({ id: bonus.id, key: bonus.key, name: bonus.name, points: bonus.points }));

  const { data: members, error: memberError } = await supabase
    .from("season_members")
    .select("profile_id, profiles(display_name, nickname, created_at)")
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
      member.profiles as
        | { display_name: string; nickname: string | null; created_at: string }
        | { display_name: string; nickname: string | null; created_at: string }[]
        | null,
    );
    if (!profile) continue;
    const team = teamByProfile.get(String(member.profile_id)) ?? null;
    people.set(rosterKey(profile.display_name, team), {
      id: String(member.profile_id),
      person: profile.display_name,
      team,
      nickname: profile.nickname,
      createdAt: profile.created_at,
    });
  }

  catalog = {
    seasonId: season.id,
    scoringMode,
    name: String(season.name),
    startsOn: String(season.starts_on),
    lengthWeeks: Number(season.length_weeks),
    pointsPerTask,
    teams,
    bonuses,
    extras,
    knownBonuses,
    people,
  };
  return catalog;
}

async function ensurePerson(person: string, team: string | null, cat: Catalog): Promise<PersonRecord> {
  const key = rosterKey(person, team);
  const cached = cat.people.get(key);
  if (cached) return cached;

  const supabase = getSupabase();
  const { data: existing, error: findError } = await supabase
    .from("season_members")
    .select("profile_id, profiles!inner(display_name, nickname, created_at)")
    .eq("season_id", cat.seasonId)
    .eq("profiles.display_name", person)
    .maybeSingle();
  fail(findError, "find person");

  let profileId: string;
  let createdAt: string;
  let nickname: string | null = null;
  if (existing) {
    const profile = one(
      existing.profiles as
        | { display_name: string; nickname: string | null; created_at: string }
        | { display_name: string; nickname: string | null; created_at: string }[]
        | null,
    );
    profileId = String(existing.profile_id);
    createdAt = profile?.created_at ?? new Date().toISOString();
    nickname = profile?.nickname ?? null;
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

  const record: PersonRecord = { id: profileId, person, team, nickname, createdAt };
  cat.people.set(key, record);
  return record;
}

function rosterFromCatalog(cat: Catalog): Array<{ person: string; team: string | null }> {
  return [...cat.people.values()]
    .sort(comparePeople)
    .map((person) => ({ person: person.person, team: person.team }));
}

function nicknameMap(people: Iterable<PersonRecord>): Record<string, string> {
  const nicknames: Record<string, string> = {};
  for (const person of people) {
    const nick = person.nickname?.trim();
    if (nick) nicknames[person.person] = nick;
  }
  return nicknames;
}

async function fetchWeeks(cat: Catalog): Promise<{ weeks: Record<string, WeekRecord>; nicknames: Record<string, string> }> {
  const [entries, tasks, checks, metas] = await Promise.all([
    selectAll("day_entries", cat.seasonId),
    selectAll("tasks", cat.seasonId),
    selectAll("bonus_checks", cat.seasonId),
    selectAll("week_meta", null),
  ]);

  const profileIds = new Set<string>();
  for (const row of [...entries, ...tasks, ...checks]) {
    if (typeof row.profile_id === "string") profileIds.add(row.profile_id);
  }
  const peopleById = await profilesForWeeks(cat, [...profileIds]);

  const bonusById = new Map(cat.knownBonuses.map((bonus) => [bonus.id, bonus]));

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
    const bonus = bonusById.get(String(check.bonus_id));
    if (!row || !bonus) continue;
    const checked = Boolean(check.checked);
    const awarded = Number(check.points_awarded);
    if (isBuiltinBonus(bonus.key)) {
      row[bonus.key] = checked;
      if (checked) {
        if (bonus.key === "top5") row.top5Awarded = awarded;
        if (bonus.key === "exercise") row.exerciseAwarded = awarded;
        if (bonus.key === "reading") row.readingAwarded = awarded;
      }
      continue;
    }
    row.extraChecks[bonus.key] = checked ? { checked: true, awarded } : { checked: false };
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
  return { weeks, nicknames: nicknameMap(peopleById.values()) };
}

// A past scorecard can name someone who is not on this season's roster.
// Their profile still has to be loaded or that week would render with no rows.
async function profilesForWeeks(cat: Catalog, ids: string[]): Promise<Map<string, PersonRecord>> {
  const peopleById = new Map<string, PersonRecord>();
  for (const person of cat.people.values()) peopleById.set(person.id, person);
  const missing = ids.filter((id) => !peopleById.has(id));
  if (missing.length === 0) return peopleById;

  const supabase = getSupabase();
  for (let start = 0; start < missing.length; start += 100) {
    const chunk = missing.slice(start, start + 100);
    const { data, error } = await supabase.from("profiles").select("id, display_name, nickname, created_at").in("id", chunk);
    fail(error, "read scorecard names");
    for (const profile of data ?? []) {
      peopleById.set(String(profile.id), {
        id: String(profile.id),
        person: profile.display_name,
        team: null,
        nickname: profile.nickname,
        createdAt: profile.created_at,
      });
    }
    if (cat.scoringMode !== "teams") continue;
    const { data: assignments, error: assignmentError } = await supabase
      .from("team_members")
      .select("profile_id, teams(name)")
      .eq("season_id", cat.seasonId)
      .in("profile_id", chunk);
    fail(assignmentError, "read historical teams");
    for (const assignment of assignments ?? []) {
      const person = peopleById.get(String(assignment.profile_id));
      const team = one(assignment.teams as { name: string } | { name: string }[] | null);
      if (person && team?.name) person.team = team.name;
    }
  }
  return peopleById;
}

async function writeJob(weekId: string, job: WeekWrite): Promise<void> {
  const rows = [...job.rows.values()].filter((row) => DAY_NAMES.includes(row.day as (typeof DAY_NAMES)[number]));
  if (rows.length === 0 && !job.replace) return;

  const cat = catalog ?? (await refreshCatalog());
  // getSupabase() is the browser client. Each .from().upsert() below is an
  // HTTPS request to PostgREST (…/rest/v1/<table>), not a SQL string from
  // this app. Postgres applies the row-level policies to that request.
  // The logged-in Google session is sent as the bearer token. Signed out,
  // the request uses the publishable key and the anon role, which cannot write.
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
      if (!cat.bonuses[bonus.key].id) continue;
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
    for (const bonus of cat.extras) {
      const checked = Boolean(row.extraChecks?.[bonus.key]?.checked);
      checkRows.push({
        season_id: cat.seasonId,
        profile_id: person.id,
        entry_date: entryDate,
        bonus_id: bonus.id,
        checked,
        points_awarded: checked ? bonus.points : 0,
      });
    }
  }

  // One grid day becomes three upserts. onConflict names the unique key
  // already declared in the migration, so a second save of Mack's Monday
  // updates that row instead of inserting a duplicate. A database trigger
  // copies the previous values into edit_log before that overwrite.
  //   day_entries   one row: notes, keyed by profile + date
  //   tasks         five rows: slot 1..5, title + done
  //   bonus_checks  Top 5, Exercise, Reading, plus any bonus added in Admin
  // week_meta is only the label under the title ("Imported file.csv").
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

// The grid calls this. It does not talk to Postgres itself.
// Calls are queued on `chain` so two quick checks cannot pass each other
// and write an older day on top of a newer one. flush() then runs writeJob.
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

async function loadOnce(createRosterWeek: boolean): Promise<LoadedBoard> {
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

  const loadedWeeks = await fetchWeeks(cat);
  const weeks = loadedWeeks.weeks;
  const roster = rosterFromCatalog(cat);
  const today = currentMonday();
  // The calendar creates this week, not the New week button. Stop after the
  // season's last Monday so a 12-week season does not grow forever.
  const seasonEnd = addDays(mondayOf(parseISODate(cat.startsOn)), (cat.lengthWeeks - 1) * 7);
  if (createRosterWeek && !weeks[today] && roster.length > 0 && today <= seasonEnd) {
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
    scoringMode: cat.scoringMode,
    pointsPerTask: cat.pointsPerTask,
    bonusPoints: {
      top5: cat.bonuses.top5.points,
      exercise: cat.bonuses.exercise.points,
      reading: cat.bonuses.reading.points,
      top5Name: cat.bonuses.top5.name,
      exerciseName: cat.bonuses.exercise.name,
      readingName: cat.bonuses.reading.name,
      extras: cat.extras.map((bonus) => ({ key: bonus.key, name: bonus.name, points: bonus.points })),
    },
    season: { name: cat.name, startsOn: cat.startsOn, lengthWeeks: cat.lengthWeeks },
    nicknames: loadedWeeks.nicknames,
  };
}

function workspaceDomain(): string {
  return String(import.meta.env.VITE_GOOGLE_WORKSPACE_DOMAIN ?? "")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
}

// A confirmed mailbox wins over the Google display name. Maison Rudd's account
// belongs on the sheet row "Maison" even if Google shows a different label.
// Mack is Mackenzie Hanes. Any mailbox she might use belongs on "Mack",
// not the separate historical row named "Mackenzie".
// Kyle confirmed the rest. kyle@awesomeinc.org is Kyle Raney; the old "Kyle"
// sheet already lives on that profile. nick@awesomeinc.org is "Nick S", not
// the separate row "Nick". Gmail addresses are listed so they can sign in
// past the Workspace domain check. Conner and Nick are absent on purpose.
const ROSTER_BY_EMAIL: Record<string, string> = {
  "maison.rudd@awesomeinc.org": "Maison",
  "mackenzie@awesomeinc.org": "Mack",
  "mackenzie.hanes@awesomeinc.org": "Mack",
  "mackenzie.hanes.awesome@gmail.com": "Mack",
  "kyle@awesomeinc.org": "Kyle Raney",
  "kevin.mansur@awesomeinc.org": "Kevin",
  "awmills25@gmail.com": "Andrew",
  "brianraney18@gmail.com": "Brian",
  "nick@awesomeinc.org": "Nick S",
  "emily@awesomeinc.org": "Emily",
  "cam.sloss@awesomeinc.org": "Cam",
  "hannah.eberts@awesomeinc.org": "Hannah",
  "garrett.fahrbach@awesomeinc.org": "Garrett",
  "ben.strevy@awesomeinc.org": "Ben",
  "jacqueline.benson@awesomeinc.org": "Jacqueline",
  "sarah.reed@awesomeinc.org": "Sarah",
};

async function claimRosterEmail(email: string): Promise<{ id: string; display_name: string } | null> {
  const rosterName = ROSTER_BY_EMAIL[email];
  if (!rosterName) return null;
  const match = await getSupabase()
    .from("profiles")
    .select("id, display_name")
    .is("auth_user_id", null)
    .ilike("display_name", rosterName)
    .limit(2);
  fail(match.error, "match roster email");
  if ((match.data ?? []).length === 1) return match.data?.[0] ?? null;
  return null;
}

// The sheet often stores a first name. Google sends "First Last". Use the full
// name when it matches, otherwise the first name when exactly one unsigned
// roster row has that name. Two people named Logan stay unmatched.
async function claimRosterName(googleName: string): Promise<{ id: string; display_name: string } | null> {
  const supabase = getSupabase();
  const exact = await supabase
    .from("profiles")
    .select("id, display_name")
    .is("auth_user_id", null)
    .ilike("display_name", googleName)
    .limit(2);
  fail(exact.error, "match roster name");
  if ((exact.data ?? []).length === 1) return exact.data?.[0] ?? null;

  const first = googleName.split(/\s+/)[0]?.trim() ?? "";
  if (first.length < 2 || first.toLowerCase() === googleName.trim().toLowerCase()) return null;
  const byFirst = await supabase.from("profiles").select("id, display_name").is("auth_user_id", null).ilike("display_name", first);
  fail(byFirst.error, "match roster name");
  if ((byFirst.data ?? []).length === 1) return byFirst.data?.[0] ?? null;
  return null;
}

// Google tells us who they are. The scorecard still needs a profile, a roster
// row, and five blank days on the current Monday. An unsigned roster row is
// reused when the Google name matches it, so sign-in does not create a second person.
export async function enrollSignedInUser(user: User): Promise<void> {
  const domain = workspaceDomain();
  const email = (user.email ?? "").toLowerCase();
  const knownRosterEmail = Object.prototype.hasOwnProperty.call(ROSTER_BY_EMAIL, email);
  if (domain && !email.endsWith(`@${domain}`) && !knownRosterEmail) {
    await getSupabase().auth.signOut();
    throw new Error(`Use a @${domain} Google Workspace account to join the roster.`);
  }

  const supabase = getSupabase();
  const googleName = googleDisplayName(user);
  const { data: linked, error: linkedError } = await supabase
    .from("profiles")
    .select("id, display_name")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  fail(linkedError, "find signed-in profile");

  let profileId = linked?.id as string | undefined;
  let rosterName = linked?.display_name ?? googleName;
  if (!linked) {
    const claim = (await claimRosterEmail(email)) ?? (await claimRosterName(googleName));
    if (claim) {
      const { error } = await supabase.from("profiles").update({ auth_user_id: user.id }).eq("id", claim.id);
      fail(error, "link roster name");
      profileId = claim.id;
      rosterName = claim.display_name;
    } else {
      const { data: inserted, error } = await supabase
        .from("profiles")
        .insert({ display_name: googleName, auth_user_id: user.id })
        .select("id")
        .single();
      fail(error, "add signed-in profile");
      if (!inserted) throw new Error("add signed-in profile: no profile returned");
      profileId = inserted.id;
    }
  }

  const cat = await refreshCatalog();
  const onRoster = [...cat.people.values()].some((person) => person.id === profileId);
  if (!onRoster && profileId) {
    const { error } = await supabase.from("season_members").upsert(
      { season_id: cat.seasonId, profile_id: profileId },
      { onConflict: "season_id,profile_id" },
    );
    fail(error, "join roster");
  }
  const fresh = onRoster ? cat : await refreshCatalog();
  const person = await ensurePerson(rosterName, null, fresh);
  const monday = currentMonday();
  const friday = addDays(monday, 4);
  const { count, error: countError } = await supabase
    .from("day_entries")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", person.id)
    .gte("entry_date", monday)
    .lte("entry_date", friday);
  fail(countError, "check this week");
  // Leave a week that already has their days alone. A blank insert would wipe tasks.
  if ((count ?? 0) > 0) return;
  await saveDays(monday, blankWeek([{ person: rosterName, team: null }], monday), "Google sign-in");
}

// Loads share the same queue as saves. A refresh that started before a save
// finished would otherwise paint the older rows back over the checkbox.
export function loadBoardState(options: { createRosterWeek?: boolean } = {}): Promise<LoadedBoard> {
  const createRosterWeek = options.createRosterWeek === true;
  const run = chain.then(() => loadOnce(createRosterWeek));
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
