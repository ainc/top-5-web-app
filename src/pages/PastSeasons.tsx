// Closed seasons leave the live week menu. Their days stay in the database
// and can be opened here. The closed-season trigger refuses edits, so this
// list has no save buttons. Shows the final season standings, team totals,
// CSV exports, and week-by-week saved days.

import { Download, Library } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { buildDaysCsv, buildStandingsCsv, downloadCsv } from "../exportCsv";
import { shownName } from "../names";
import { loadSeasonArchive, type LoadedBoard } from "../remoteBoard";
import { ScorecardLoading } from "../ScorecardLoading";
import { seasonBoard, seasonBounds, teamStandings } from "../streaks";
import { getSupabase } from "../supabaseClient";
import { slotName } from "../taskSlots";
import { addDays, formatWeekLabel, mondayOf, parseISODate } from "../weeks";

type ClosedSeason = { id: string; name: string; starts_on: string };

type ArchiveDay = {
  person: string;
  date: string;
  notes: string;
  points: number;
  tasks: string[];
};

function fail(error: { message: string } | null, action: string): void {
  if (error) throw new Error(`${action}: ${error.message}`);
}

export function PastSeasons() {
  const [seasons, setSeasons] = useState<ClosedSeason[]>([]);
  const [seasonId, setSeasonId] = useState("");
  const [archive, setArchive] = useState<LoadedBoard | null>(null);
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
      setArchive(null);
      setWeeks([]);
      setWeekId("");
      return;
    }
    let cancel = false;
    setError("");
    const supabase = getSupabase();
    (async () => {
      const [loadedArchive, mondays] = await Promise.all([
        loadSeasonArchive(seasonId),
        (async () => {
          const found = new Set<string>();
          for (let from = 0; ; from += 1000) {
            const { data, error: dateError } = await supabase
              .from("day_entries")
              .select("entry_date")
              .eq("season_id", seasonId)
              .order("entry_date", { ascending: false })
              .range(from, from + 999);
            if (cancel) return [];
            fail(dateError, "read past days");
            const batch = data ?? [];
            for (const row of batch) {
              if (typeof row.entry_date === "string") found.add(mondayOf(parseISODate(row.entry_date)));
            }
            if (batch.length < 1000) break;
          }
          return [...found].sort().reverse();
        })(),
      ]);
      if (cancel) return;
      setArchive(loadedArchive);
      setWeeks(mondays);
      setWeekId(mondays[0] ?? "");
    })().catch((reason: unknown) => {
      if (!cancel) setError(reason instanceof Error ? reason.message : "Could not load that closed season.");
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
          const slot = slotName(Number(task.slot)) || "Task";
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

  const finalStandings = useMemo(() => {
    if (!archive) return [];
    const bounds = seasonBounds(archive.season);
    const rates = { ...archive.bonusPoints, pointsPerTask: archive.pointsPerTask };
    const ranked = seasonBoard(archive.weeks, bounds.endsOn, rates, archive.season, archive.roster, archive.milestones);
    let place = 1;
    return ranked.map((person, index) => {
      if (index > 0 && person.seasonTotal < ranked[index - 1].seasonTotal) place = index + 1;
      return { ...person, place };
    });
  }, [archive]);

  const finalTeams = useMemo(() => {
    if (!archive || archive.scoringMode !== "teams") return [];
    return teamStandings(finalStandings);
  }, [archive, finalStandings]);

  return (
    <section className="admin-card tone-log">
      <h2>
        <Library aria-hidden="true" />
        Past seasons
      </h2>
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
            {archive ? (
              <div className="admin-row">
                <button
                  type="button"
                  onClick={() => {
                    const bounds = seasonBounds(archive.season);
                    downloadCsv(archive.season.name, "standings", buildStandingsCsv(archive, bounds.endsOn));
                  }}
                >
                  <Download aria-hidden="true" />
                  Export standings CSV
                </button>
                <button
                  type="button"
                  onClick={() => {
                    downloadCsv(archive.season.name, "days", buildDaysCsv(archive));
                  }}
                >
                  <Download aria-hidden="true" />
                  Export days CSV
                </button>
              </div>
            ) : null}
          </div>
          {finalStandings.length > 0 ? (
            <div className="past-summary">
              <h3>Final standings</h3>
              {finalTeams.length > 0 ? (
                <p className="field-help">
                  Teams: {finalTeams.map((team) => `${team.team} (${team.seasonTotal})`).join(" · ")}
                </p>
              ) : null}
              <table className="scorecard board-table">
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Name</th>
                    <th className="num">Weekly</th>
                    <th className="num">Streak bonus</th>
                    <th className="num">Best streak</th>
                    <th className="num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {finalStandings.map((person) => (
                    <tr key={person.key}>
                      <td>{person.place}</td>
                      <td>{shownName(person.person, archive?.nicknames ?? {})}</td>
                      <td className="num">{person.weeklyPoints}</td>
                      <td className="num">{person.streakBonus}</td>
                      <td className="num">{person.longestStreak}</td>
                      <td className="num is-season">{person.seasonTotal}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {loading ? <ScorecardLoading compact label="Loading that week…" /> : null}
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
