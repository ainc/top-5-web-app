// Read-only week. One row per person so the week can be skimmed.
// A day cell is tasks finished over tasks written. Empty days stay blank
// instead of red, because nothing written is not a missed day.
// Standings and the bar chart use bonus points, not the task count.
// The full task grid stays collapsed, one card per person.
// A shared grid put the next person on the following row, so the names blended together.

import { useMemo, useState } from "react";
import { ScoreGrid, useBoard } from "../board";
import { SeasonBoards } from "./SeasonBoards";
import { shownName } from "../names";
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
    if (!written) continue;
    total += 1;
    if (Boolean(row[done])) completed += 1;
  }
  return { completed, total };
}

function heatClass(score: DayScore): string {
  if (score.total === 0) return "heat-empty";
  if (score.completed === score.total) return "heat-done";
  return "heat-open";
}

function dayLabel(score: DayScore): string {
  if (score.total === 0) return "—";
  return `${score.completed}/${score.total}`;
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
  const { rows, ready, selectedWeek, weekLabel, isCurrentWeek, weeks, rates, scoringMode, season, nicknames } = useBoard();
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();

  const people = useMemo<PersonScore[]>(() => {
    return peopleInOrder(rows)
      .filter((person) => {
        const label = shownName(person.person, nicknames).toLowerCase();
        return person.person.toLowerCase().includes(needle) || label.includes(needle) || (person.team ?? "").toLowerCase().includes(needle);
      })
      .map((person) => {
        const mine = rows.filter((row) => personKey(row) === person.key);
        const byDay = new Map(mine.map((row) => [row.day, row]));
        const days = DAY_NAMES.map((day) => dayScore(byDay.get(day)));
        return {
          key: person.key,
          person: shownName(person.person, nicknames),
          team: person.team,
          days,
          completed: days.reduce((sum, day) => sum + day.completed, 0),
          total: days.reduce((sum, day) => sum + day.total, 0),
          points: mine.reduce((sum, row) => sum + dailyPoints(row, rates), 0),
        };
      });
  }, [needle, nicknames, rates, rows]);

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
          <h1>📊 Dashboard</h1>
          <p>One row per person. Green is a finished day, red still has open tasks, and a dash means nothing was written.</p>
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
          <div className="section-head">
            <h2>📋 {isCurrentWeek ? "This week" : "Selected week"}</h2>
            <p>
              {weekLabel}. {weekCompleted} of {weekTotal} written tasks done ({percentLabel(weekCompleted, weekTotal)}).
            </p>
          </div>
          <table className="scorecard skim">
            <thead>
              <tr>
                <th>Name</th>
                {DAY_NAMES.map((day) => (
                  <th key={day}>{day}</th>
                ))}
                <th>Week</th>
                <th>Points</th>
              </tr>
            </thead>
            <tbody>
              {people.length === 0 ? (
                <tr>
                  <td className="scorecard-empty" colSpan={8}>
                    No one matches that filter.
                  </td>
                </tr>
              ) : (
                people.map((person) => (
                  <tr key={person.key}>
                    <th scope="row">{person.person}</th>
                    {person.days.map((score, index) => (
                      <td key={DAY_NAMES[index]} className={heatClass(score)}>
                        {dayLabel(score)}
                      </td>
                    ))}
                    <td>{percentLabel(person.completed, person.total)}</td>
                    <td>{person.points.toFixed(1)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <aside className="standings-card">
          <h2>🏆 Standings</h2>
          <p className="field-help">Sorted by this week’s bonus points.</p>
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
        <h2>📈 Points this week</h2>
        <p className="field-help">The longest bar is the leader for the week selected above.</p>
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

      <SeasonBoards weeks={weeks} needle={needle} rates={rates} scoringMode={scoringMode} season={season} nicknames={nicknames} />

      <details className="task-details">
        <summary>✅ All tasks</summary>
        <p className="field-help">Each person has their own Monday–Friday. Changes are made on My week.</p>
        {people.length === 0 ? (
          <p className="status">No one matches that filter.</p>
        ) : (
          <div className="task-people">
            {people.map((person) => (
              <article className="person-tasks" key={person.key}>
                <header>
                  <h3>{person.person}</h3>
                  <span>
                    {person.team ? `${person.team} · ` : ""}
                    {person.points.toFixed(1)} pts
                  </span>
                </header>
                <ScoreGrid
                  rows={rows.filter((row) => personKey(row) === person.key)}
                  canEdit={false}
                  showWeek
                  showPerson={false}
                  showGroup={false}
                />
              </article>
            ))}
          </div>
        )}
      </details>
    </section>
  );
}
