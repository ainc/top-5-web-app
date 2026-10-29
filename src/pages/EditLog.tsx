// Staff view of edit_log. Search is the filters above the list. Restore puts
// that one row back to the values it had before the logged change. The
// database trigger records the restore as a new line, so it can be undone too.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSupabase } from "../supabaseClient";

type LogRow = {
  id: number;
  changed_at: string;
  actor_id: string | null;
  table_name: "tasks" | "day_entries" | "bonus_checks";
  row_id: string;
  action: "insert" | "update" | "delete";
  old_row: Record<string, unknown> | null;
  new_row: Record<string, unknown> | null;
  profile_id: string | null;
  entry_date: string | null;
  season_id: string | null;
};

type SeasonOption = { id: string; name: string; status: string };

type NameOption = { id: string; name: string };

const SLOT_NAMES = ["", "Top", "High", "Medium", "Medium 2", "Low"];
const PAGE = 40;
const LOG_LIMIT = 1000;

const TABLE_LABEL: Record<LogRow["table_name"], string> = {
  tasks: "Task",
  day_entries: "Notes",
  bonus_checks: "Score",
};

function textOf(row: Record<string, unknown> | null, key: string): string {
  const value = row?.[key];
  if (value == null || value === "") return "empty";
  if (typeof value === "boolean") return value ? "checked" : "unchecked";
  return String(value);
}

function describe(entry: LogRow, seasonName: string): string {
  const source = entry.new_row ?? entry.old_row;
  const slot = Number(source?.slot ?? 0);
  const slotName = SLOT_NAMES[slot] ? `${SLOT_NAMES[slot]} ` : "";
  const day = entry.entry_date ?? "an unknown day";
  const season = seasonName ? ` · ${seasonName}` : "";
  return `${TABLE_LABEL[entry.table_name]} ${slotName}on ${day}${season}`;
}

function startOfDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date).toISOString();
}

function startOfNextDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date + 1).toISOString();
}

function diffs(entry: LogRow): string[] {
  const keys = entry.table_name === "tasks" ? ["title", "done"] : entry.table_name === "day_entries" ? ["notes"] : ["checked", "points_awarded"];
  if (entry.action === "insert") {
    return keys.map((key) => `${key}: ${textOf(entry.new_row, key)}`);
  }
  if (entry.action === "delete") {
    return keys.map((key) => `${key}: ${textOf(entry.old_row, key)}`);
  }
  return keys
    .filter((key) => textOf(entry.old_row, key) !== textOf(entry.new_row, key))
    .map((key) => `${key}: ${textOf(entry.old_row, key)} → ${textOf(entry.new_row, key)}`);
}

export function EditLog({ people }: { people: NameOption[] }) {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [actors, setActors] = useState<Record<string, string>>({});
  const [roster, setRoster] = useState<NameOption[]>(people);
  const [seasons, setSeasons] = useState<SeasonOption[]>([]);
  const [query, setQuery] = useState("");
  const [personId, setPersonId] = useState("");
  const [tableName, setTableName] = useState("");
  const [seasonId, setSeasonId] = useState("");
  const [savedFrom, setSavedFrom] = useState("");
  const [savedTo, setSavedTo] = useState("");
  const [dayFrom, setDayFrom] = useState("");
  const [dayTo, setDayTo] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const fallbackPeople = useRef(people);
  fallbackPeople.current = people;
  const names = useMemo(() => Object.fromEntries(roster.map((person) => [person.id, person.name])), [roster]);
  const seasonNames = useMemo(() => Object.fromEntries(seasons.map((season) => [season.id, season.name])), [seasons]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const supabase = getSupabase();
    const [{ data: profiles, error: profileError }, { data: seasonRows, error: seasonError }, logQuery] = await Promise.all([
      supabase.from("profiles").select("id, display_name, auth_user_id").order("display_name"),
      supabase.from("seasons").select("id, name, status, starts_on").order("starts_on", { ascending: false }),
      (async () => {
        let request = supabase
          .from("edit_log")
          .select("id, changed_at, actor_id, table_name, row_id, action, old_row, new_row, profile_id, entry_date, season_id")
          .order("changed_at", { ascending: false })
          .limit(PAGE + 1);
        if (personId) request = request.eq("profile_id", personId);
        if (tableName) request = request.eq("table_name", tableName);
        if (seasonId) request = request.eq("season_id", seasonId);
        if (savedFrom) request = request.gte("changed_at", startOfDay(savedFrom));
        if (savedTo) request = request.lt("changed_at", startOfNextDay(savedTo));
        if (dayFrom) request = request.gte("entry_date", dayFrom);
        if (dayTo) request = request.lte("entry_date", dayTo);
        const needle = query.trim().replace(/[%_,]/g, "");
        if (needle) {
          request = request.or(
            [`old_row->>title.ilike.%${needle}%`, `new_row->>title.ilike.%${needle}%`, `old_row->>notes.ilike.%${needle}%`, `new_row->>notes.ilike.%${needle}%`].join(","),
          );
        }
        return request;
      })(),
    ]);
    if (profileError || seasonError || logQuery.error) {
      setError(profileError?.message || seasonError?.message || logQuery.error?.message || "Could not read the edit log.");
      setLoading(false);
      return;
    }
    const nextActors: Record<string, string> = {};
    const nextRoster: NameOption[] = [];
    for (const profile of profiles ?? []) {
      nextRoster.push({ id: String(profile.id), name: String(profile.display_name) });
      if (profile.auth_user_id) nextActors[String(profile.auth_user_id)] = String(profile.display_name);
    }
    setRoster(nextRoster.length > 0 ? nextRoster : fallbackPeople.current);
    setSeasons(
      (seasonRows ?? []).map((row) => ({
        id: String(row.id),
        name: String(row.name),
        status: String(row.status ?? ""),
      })),
    );
    setActors(nextActors);
    const page = (logQuery.data ?? []) as LogRow[];
    setHasMore(page.length > PAGE);
    setRows(page.slice(0, PAGE));
    setLoading(false);
  }, [dayFrom, dayTo, personId, query, savedFrom, savedTo, seasonId, tableName]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 200);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function restore(entry: LogRow) {
    const summary = diffs(entry).join(", ") || describe(entry, entry.season_id ? seasonNames[entry.season_id] ?? "" : "");
    if (!window.confirm(`Put this back to the earlier values?\n${summary}`)) return;
    setRestoring(entry.id);
    setError("");
    setNotice("");
    const { error: restoreError } = await getSupabase().rpc("restore_edit", { target: entry.id });
    setRestoring(null);
    if (restoreError) {
      setError(restoreError.message);
      return;
    }
    window.dispatchEvent(new Event("top5-reload"));
    setNotice("Restored. That restore is now a line in the log too.");
    await load();
  }

  return (
    <section className="admin-card tone-log">
      <h2>🕘 Edit log</h2>
      <p className="field-help">
        Every change to a task, a day's notes, or a score box is recorded with the time, the signed-in account, and the values before and after. The log keeps the latest {LOG_LIMIT.toLocaleString()} changes. When a new one is saved, the oldest line is dropped. Dropping a line does not delete the day. Days from before this log started were never copied into it.
      </p>
      <div className="admin-row">
        <label className="admin-field">
          Search
          <input value={query} placeholder="Title or notes" aria-label="Search edits" onChange={(event) => setQuery(event.target.value)} />
        </label>
        <label className="admin-field">
          Person
          <select value={personId} aria-label="Filter edits by person" onChange={(event) => setPersonId(event.target.value)}>
            <option value="">Everyone</option>
            {roster.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </label>
        <label className="admin-field">
          Season
          <select value={seasonId} aria-label="Filter edits by season" onChange={(event) => setSeasonId(event.target.value)}>
            <option value="">Every season</option>
            {seasons.map((season) => (
              <option key={season.id} value={season.id}>
                {season.name}
                {season.status === "closed" ? " (closed)" : season.status === "draft" ? " (draft)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="admin-field">
          What changed
          <select value={tableName} aria-label="Filter edits by kind" onChange={(event) => setTableName(event.target.value)}>
            <option value="">Tasks, notes, and scores</option>
            <option value="tasks">Tasks</option>
            <option value="day_entries">Notes</option>
            <option value="bonus_checks">Scores</option>
          </select>
        </label>
      </div>
      <div className="admin-row">
        <label className="admin-field">
          Saved from
          <input type="date" value={savedFrom} aria-label="Edits saved from" onChange={(event) => setSavedFrom(event.target.value)} />
        </label>
        <label className="admin-field">
          Saved through
          <input type="date" value={savedTo} aria-label="Edits saved through" onChange={(event) => setSavedTo(event.target.value)} />
        </label>
        <label className="admin-field">
          Scorecard day from
          <input type="date" value={dayFrom} aria-label="Scorecard day from" onChange={(event) => setDayFrom(event.target.value)} />
        </label>
        <label className="admin-field">
          Scorecard day through
          <input type="date" value={dayTo} aria-label="Scorecard day through" onChange={(event) => setDayTo(event.target.value)} />
        </label>
      </div>
      {error ? <p className="banner error">{error}</p> : null}
      {notice ? <p className="banner ok">{notice}</p> : null}
      {loading && rows.length === 0 ? <p className="status">Loading the edit log…</p> : null}
      {!loading && rows.length === 0 ? <p className="field-help">No matching edits yet.</p> : null}
      <div className="edit-log">
        {rows.map((entry) => {
          const changes = diffs(entry);
          const actor = entry.actor_id ? actors[entry.actor_id] ?? "Signed-in account" : "Database import";
          const person = entry.profile_id ? names[entry.profile_id] ?? "Former roster member" : "Unknown person";
          return (
            <article key={entry.id}>
              <div>
                <strong>
                  {entry.action} · {describe(entry, entry.season_id ? seasonNames[entry.season_id] ?? "" : "")}
                </strong>
                <p className="edit-meta">
                  {new Date(entry.changed_at).toLocaleString()} · {actor} · {person}
                </p>
                {changes.length > 0 ? (
                  <ul>
                    {changes.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="edit-meta">Saved again with the same values.</p>
                )}
              </div>
              <button type="button" disabled={restoring === entry.id} onClick={() => void restore(entry)}>
                {restoring === entry.id ? "Restoring…" : "Restore"}
              </button>
            </article>
          );
        })}
      </div>
      {hasMore ? (
        <p className="field-help">
          Showing the latest {PAGE} matching edits. Narrow the dates, season, person, or words to see a different set. The log holds at most {LOG_LIMIT.toLocaleString()} changes.
        </p>
      ) : null}
    </section>
  );
}
