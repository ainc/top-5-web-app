// Closed seasons leave the live week menu. Their days stay in the database
// and can be opened here. The closed-season trigger refuses edits, so this
// list has no save buttons. Weeks from before the edit log are included:
// the log never copied them, and dropping an old log line does not drop a day.

import { useEffect, useState } from "react";
import { getSupabase } from "../supabaseClient";
import { addDays, formatWeekLabel, mondayOf, parseISODate } from "../weeks";

type ClosedSeason = { id: string; name: string; starts_on: string };

type ArchiveDay = {
  person: string;
  date: string;
  notes: string;
  points: number;
  tasks: string[];
};

const SLOT_NAMES = ["", "Top", "High", "Medium", "Medium 2", "Low"];

function fail(error: { message: string } | null, action: string): void {
  if (error) throw new Error(`${action}: ${error.message}`);
}

export function PastSeasons() {
  const [seasons, setSeasons] = useState<ClosedSeason[]>([]);
  const [seasonId, setSeasonId] = useState("");
  const [weeks, setWeeks] = useState<string[]>([]);
  const [weekId, setWeekId] = useState("");
  const [days, setDays] = useState<ArchiveDay[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const supabase = getSupabase();
    supabase
      .from("seasons")
      .select("id, name, starts_on")
      .eq("status", "closed")
      .order("starts_on", { ascending: false })
      .then(({ data, error: seasonError }) => {
        if (seasonError) {
          setError(seasonError.message);
          return;
        }
        const closed = (data ?? []).map((row) => ({
          id: String(row.id),
          name: String(row.name),
          starts_on: String(row.starts_on),
        }));
        setSeasons(closed);
        setSeasonId(closed[0]?.id ?? "");
      });
  }, []);

  useEffect(() => {
    if (!seasonId) {
      setWeeks([]);
      setWeekId("");
      return;
    }
    let cancel = false;
    const supabase = getSupabase();
    (async () => {
      const found = new Set<string>();
      for (let from = 0; ; from += 1000) {
        const { data, error: dateError } = await supabase
          .from("day_entries")
          .select("entry_date")
          .eq("season_id", seasonId)
          .order("entry_date", { ascending: false })
          .range(from, from + 999);
        if (cancel) return;
        fail(dateError, "read past days");
        const batch = data ?? [];
        for (const row of batch) {
          if (typeof row.entry_date === "string") found.add(mondayOf(parseISODate(row.entry_date)));
        }
        if (batch.length < 1000) break;
      }
      if (cancel) return;
      const mondays = [...found].sort().reverse();
      setWeeks(mondays);
      setWeekId(mondays[0] ?? "");
    })().catch((reason: unknown) => {
      if (!cancel) setError(reason instanceof Error ? reason.message : "Could not list weeks.");
    });
    return () => {
      cancel = true;
    };
  }, [seasonId]);

  useEffect(() => {
    if (!seasonId || !weekId) {
      setDays([]);
      return;
    }
    let cancel = false;
    setLoading(true);
    const friday = addDays(weekId, 4);
    const supabase = getSupabase();
    Promise.all([
      supabase.from("day_scores").select("profile_id, entry_date, notes, daily_points").eq("season_id", seasonId).gte("entry_date", weekId).lte("entry_date", friday),
      supabase.from("tasks").select("profile_id, entry_date, slot, title, done").eq("season_id", seasonId).gte("entry_date", weekId).lte("entry_date", friday),
      supabase.from("profiles").select("id, display_name"),
    ])
      .then(([scoreResult, taskResult, profileResult]) => {
        if (cancel) return;
        fail(scoreResult.error, "read past scores");
        fail(taskResult.error, "read past tasks");
        fail(profileResult.error, "read names");
        const names = new Map((profileResult.data ?? []).map((row) => [String(row.id), String(row.display_name)]));
        const tasks = new Map<string, string[]>();
        for (const task of taskResult.data ?? []) {
          const key = `${task.profile_id}|${task.entry_date}`;
          const lines = tasks.get(key) ?? [];
          const slot = SLOT_NAMES[Number(task.slot)] ?? "Task";
          const title = String(task.title ?? "").trim();
          if (title) lines.push(`${slot}: ${title}${task.done ? " (done)" : ""}`);
          tasks.set(key, lines);
        }
        const next = (scoreResult.data ?? [])
          .map((row) => ({
            person: names.get(String(row.profile_id)) ?? "Former roster member",
            date: String(row.entry_date),
            notes: String(row.notes ?? ""),
            points: Number(row.daily_points ?? 0),
            tasks: tasks.get(`${row.profile_id}|${row.entry_date}`) ?? [],
          }))
          .sort((a, b) => a.person.localeCompare(b.person) || a.date.localeCompare(b.date));
        setDays(next);
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (cancel) return;
        setLoading(false);
        setError(reason instanceof Error ? reason.message : "Could not open that week.");
      });
    return () => {
      cancel = true;
    };
  }, [seasonId, weekId]);

  return (
    <section className="admin-card tone-log">
      <h2>📚 Past seasons</h2>
      <p className="field-help">
        The edit log is not a copy of the scorecard. Days saved before the log started are still stored on their season, and closing a season does not delete them. A closed season opens here and cannot be changed. Older weeks of the season that is live stay on the week menu, where people can still edit their own days.
      </p>
      {error ? <p className="banner error">{error}</p> : null}
      {seasons.length === 0 ? (
        <p className="field-help">No season has been closed yet. Nothing has been taken off the live week menu.</p>
      ) : (
        <>
          <div className="admin-row">
            <label className="admin-field">
              Closed season
              <select value={seasonId} aria-label="Closed season" onChange={(event) => setSeasonId(event.target.value)}>
                {seasons.map((season) => (
                  <option key={season.id} value={season.id}>
                    {season.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="admin-field">
              Week
              <select value={weekId} aria-label="Closed season week" onChange={(event) => setWeekId(event.target.value)} disabled={weeks.length === 0}>
                {weeks.length === 0 ? <option value="">No saved weeks</option> : null}
                {weeks.map((monday) => (
                  <option key={monday} value={monday}>
                    {formatWeekLabel(monday)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {loading ? <p className="status">Loading that week…</p> : null}
          {!loading && weekId && days.length === 0 ? <p className="field-help">That week has no saved days.</p> : null}
          <div className="edit-log">
            {days.map((day) => (
              <article key={`${day.person}-${day.date}`}>
                <div>
                  <strong>
                    {day.person} · {day.date} · {day.points} points
                  </strong>
                  {day.tasks.length > 0 ? (
                    <ul>
                      {day.tasks.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="edit-meta">No task text.</p>
                  )}
                  {day.notes ? <p className="edit-meta">Notes: {day.notes}</p> : null}
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
