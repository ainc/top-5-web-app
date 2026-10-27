// Staff view of edit_log. Search is the filters above the list. Restore puts
// that one row back to the values it had before the logged change. The
// database trigger records the restore as a new line, so it can be undone too.

import { useCallback, useEffect, useMemo, useState } from "react";
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
};

type NameOption = { id: string; name: string };

const SLOT_NAMES = ["", "Top", "High", "Medium", "Medium 2", "Low"];
const PAGE = 40;

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

function describe(entry: LogRow): string {
  const source = entry.new_row ?? entry.old_row;
  const slot = Number(source?.slot ?? 0);
  const slotName = SLOT_NAMES[slot] ? `${SLOT_NAMES[slot]} ` : "";
  const day = entry.entry_date ?? "an unknown day";
  return `${TABLE_LABEL[entry.table_name]} ${slotName}on ${day}`;
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
  const [query, setQuery] = useState("");
  const [personId, setPersonId] = useState("");
  const [tableName, setTableName] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const names = useMemo(() => Object.fromEntries(people.map((person) => [person.id, person.name])), [people]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const supabase = getSupabase();
    const [{ data: profiles, error: profileError }, logQuery] = await Promise.all([
      supabase.from("profiles").select("id, display_name, auth_user_id"),
      (async () => {
        let request = supabase.from("edit_log").select("id, changed_at, actor_id, table_name, row_id, action, old_row, new_row, profile_id, entry_date").order("changed_at", { ascending: false }).limit(PAGE + 1);
        if (personId) request = request.eq("profile_id", personId);
        if (tableName) request = request.eq("table_name", tableName);
        const needle = query.trim().replace(/[%_,]/g, "");
        if (needle) {
          request = request.or(
            [`old_row->>title.ilike.%${needle}%`, `new_row->>title.ilike.%${needle}%`, `old_row->>notes.ilike.%${needle}%`, `new_row->>notes.ilike.%${needle}%`].join(","),
          );
        }
        return request;
      })(),
    ]);
    if (profileError || logQuery.error) {
      setError(profileError?.message || logQuery.error?.message || "Could not read the edit log.");
      setLoading(false);
      return;
    }
    const nextActors: Record<string, string> = {};
    for (const profile of profiles ?? []) {
      if (profile.auth_user_id) nextActors[profile.auth_user_id] = profile.display_name;
    }
    const page = (logQuery.data ?? []) as LogRow[];
    setActors(nextActors);
    setHasMore(page.length > PAGE);
    setRows(page.slice(0, PAGE));
    setLoading(false);
  }, [personId, query, tableName]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 200);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function restore(entry: LogRow) {
    const summary = diffs(entry).join(", ") || describe(entry);
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
        Every change to a task, a day's notes, or a score box is recorded with the time, the signed-in account, and the values before and after. Restoring one line puts that row back. Older weeks were saved before this log existed, so they have scores but no edit lines.
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
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
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
                  {entry.action} · {describe(entry)}
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
      {hasMore ? <p className="field-help">Showing the latest {PAGE} matching edits. Narrow the search to see a different set.</p> : null}
    </section>
  );
}
