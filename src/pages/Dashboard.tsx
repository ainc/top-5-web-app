// Read-only week, laid out like the Google Sheet scorecard.
// Each person has five day rows: tasks finished, tasks written, and a color.
// Standings and the bar chart use bonus points, not the task count.

import { useMemo, useState } from "react";
import { ScoreGrid, useBoard } from "../board";
import { DAY_NAMES, dailyPoints, peopleInOrder, personKey } from "../points";
import type { DayRow } from "../types";

const TASKS: Array<[label: keyof DayRow, done: keyof DayRow]> = [
  ["topLabel", "topDone"],
  ["highLabel", "highDone"],
  ["med1Label", "med1Done"],
  ["med2Label", "med2Done"],
  ["lowLabel", "lowDone"],
];

type DayScore = { completed: number; total: number };
type PersonScore = {
  key: string;
  person: string;
  team: string | null;
  days: DayScore[];
  completed: number;
  total: number;
  points: number;
};

function dayScore(row: DayRow | undefined): DayScore {
  if (!row) return { completed: 0, total: 0 };
  let completed = 0;
  let total = 0;
  for (const [label, done] of TASKS) {
    const written = String(row[label] ?? "").trim().length > 0;
    const checked = Boolean(row[done]);
    if (!written && !checked) continue;
    total += 1;
    if (checked) completed += 1;
  }
  return { completed, total };
}

function heatClass(score: DayScore): string {
  if (score.total > 0 && score.completed === score.total) return "heat-done";
  return "heat-open";
}

function percentLabel(completed: number, total: number): string {
  if (total === 0) return "—";
  return `${((completed / total) * 100).toFixed(2)}%`;
}

function placeLabel(place: number): string {
  const mod100 = place % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${place}th`;
  switch (place % 10) {
    case 1:
      return `${place}st`;
    case 2:
      return `${place}nd`;
    case 3:
      return `${place}rd`;
    default:
      return `${place}th`;
  }
}

export function Dashboard() {
  const { rows, ready, selectedWeek } = useBoard();
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();

  const people = useMemo<PersonScore[]>(() => {
    return peopleInOrder(rows)
      .filter((person) => person.person.toLowerCase().includes(needle) || (person.team ?? "").toLowerCase().includes(needle))
      .map((person) => {
        const mine = rows.filter((row) => personKey(row) === person.key);
        const byDay = new Map(mine.map((row) => [row.day, row]));
        const days = DAY_NAMES.map((day) => dayScore(byDay.get(day)));
        return {
          key: person.key,
          person: person.person,
          team: person.team,
          days,
          completed: days.reduce((sum, day) => sum + day.completed, 0),
          total: days.reduce((sum, day) => sum + day.total, 0),
          points: mine.reduce((sum, row) => sum + dailyPoints(row), 0),
        };
      });
  }, [needle, rows]);

  const weekCompleted = people.reduce((sum, person) => sum + person.completed, 0);
  const weekTotal = people.reduce((sum, person) => sum + person.total, 0);
  const ranked = useMemo(() => {
    const sorted = [...people].sort((a, b) => b.points - a.points || a.person.localeCompare(b.person));
    let place = 1;
    return sorted.map((person, index) => {
      if (index > 0 && person.points < sorted[index - 1].points) place = index + 1;
      return { ...person, place };
    });
  }, [people]);
  const topPoints = ranked.reduce((max, person) => Math.max(max, person.points), 0);

  if (!ready) return <p className="status">Loading the scorecard…</p>;

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p>Finished tasks are green. An open day is red. Standings use Top 5, Exercise, and Reading points.</p>
        </div>
        <input
          className="filter"
          value={query}
          placeholder="Filter people"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <div className="dashboard-top" key={selectedWeek}>
        <div className="scorecard-wrap">
          <table className="scorecard">
            <thead>
              <tr>
                <th>Names</th>
                <th>Day</th>
                <th>Completed</th>
                <th>Total</th>
                <th>Percentage</th>
              </tr>
              <tr className="scorecard-summary">
                <th colSpan={2}>This week</th>
                <th>{weekCompleted}</th>
                <th>{weekTotal}</th>
                <th>{percentLabel(weekCompleted, weekTotal)}</th>
              </tr>
            </thead>
            <tbody>
              {people.length === 0 ? (
                <tr>
                  <td className="scorecard-empty" colSpan={5}>
                    No one matches that filter.
                  </td>
                </tr>
              ) : (
                people.flatMap((person) =>
                  DAY_NAMES.map((day, index) => {
                    const score = person.days[index];
                    const tone = heatClass(score);
                    return (
                      <tr key={`${person.key}-${day}`} className={index === 0 ? "person-start" : undefined}>
                        <th scope="row">{person.person}</th>
                        <td>{day}</td>
                        <td className={tone}>{score.completed}</td>
                        <td className={tone}>{score.total}</td>
                        <td />
                      </tr>
                    );
                  }),
                )
              )}
            </tbody>
          </table>
        </div>

        <aside className="standings-card">
          <h2>Standings</h2>
          {ranked.length === 0 ? (
            <p className="status">No scores for this week yet.</p>
          ) : (
            <ol className="rank-list">
              {ranked.map((person) => (
                <li key={person.key}>
                  <span className="place">{placeLabel(person.place)}</span>
                  <span className="rank-name">
                    {person.person}
                    {person.team ? <small>{person.team}</small> : null}
                  </span>
                  <span className="rank-points">{person.points.toFixed(1)}</span>
                </li>
              ))}
            </ol>
          )}
        </aside>
      </div>

      <div className="chart-card">
        <h2>Points this week</h2>
        {ranked.length === 0 ? (
          <p className="status">No scores to chart yet.</p>
        ) : (
          <div className="bars">
            {ranked.map((person) => {
              const width = topPoints === 0 ? 0 : (person.points / topPoints) * 100;
              return (
                <div className="bar-row" key={person.key}>
                  <span className="bar-name">{person.person}</span>
                  <div
                    className="bar-track"
                    role="img"
                    aria-label={`${person.person}, ${person.points} points`}
                  >
                    <div className="bar-fill" style={{ width: `${width}%` }} />
                  </div>
                  <span className="bar-value">{person.points.toFixed(1)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <h2>Tasks</h2>
      <ScoreGrid rows={rows} canEdit={false} showWeek quickFilter={query} height={560} />
    </section>
  );
}
