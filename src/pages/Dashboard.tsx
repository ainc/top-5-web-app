// Read-only week, arranged as a glance then a comparison then the detail.
// The top cards are the person you picked: points against the week maximum,
// tasks they finished, season total against the leader, and the streak.
// The bar list compares everyone. The tables under it are the breakdown.
// A day cell is tasks finished over tasks written. Empty days stay blank
// instead of red, because nothing written is not a missed day.
// The full task grid stays collapsed, one card per person. It uses AG Grid
// Community only. Sparklines, integrated charts, and master-detail rows are
// paid features, so the summary stays as numbers and a labeled bar list.
// A shared grid put the next person on the following row, so the names blended together.

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { ScoreGrid, useBoard } from "../board";
import { SeasonBoards } from "./SeasonBoards";
import { pickerName, shownName } from "../names";
import { PersonPicker } from "./PersonPicker";
import { DAY_NAMES, dailyPoints, maxWeekPoints, personKey, weekPoints } from "../points";
import { seasonBoard } from "../streaks";
import { taskPlainText } from "../taskMarkup";
import { TaskHtml } from "../taskRich";
import type { DayRow } from "../types";
import { addDays } from "../weeks";

const SLOT_NAMES = ["Top", "High", "Medium", "Medium 2", "Low"];
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

function pointsLabel(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
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
  const { rows, people: weekPeople, ready, selectedWeek, weekLabel, isCurrentWeek, weeks, rates, scoringMode, season, nicknames } = useBoard();
  const { profileName } = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [listKey, setListKey] = useState("");
  const needle = query.trim().toLowerCase();

  const people = useMemo<PersonScore[]>(() => {
    return weekPeople
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
  }, [needle, nicknames, rates, rows, weekPeople]);

  const roster = weekPeople;
  // Nothing chosen yet means the signed-in person, same as My week. The first
  // roster name is only used when this Google account is not on the board.
  const signedInKey = roster.find((person) => person.person === profileName)?.key ?? "";
  const listed =
    roster.find((person) => person.key === listKey) ??
    roster.find((person) => person.key === signedInKey) ??
    roster[0];
  const listedDays = useMemo(() => {
    if (!listed) return [];
    const byDay = new Map(rows.filter((row) => personKey(row) === listed.key).map((row) => [row.day, row]));
    return DAY_NAMES.map((day) => byDay.get(day));
  }, [listed, rows]);
  const listedScores = listedDays.map((row) => dayScore(row));
  const listedCompleted = listedScores.reduce((sum, day) => sum + day.completed, 0);
  const listedTotal = listedScores.reduce((sum, day) => sum + day.total, 0);
  const weekCap = maxWeekPoints(rates);
  const listedPoints = listed ? weekPoints(rows, listed.key, rates) : 0;
  const priorRows = weeks[addDays(selectedWeek, -7)]?.rows ?? [];
  const priorHasListed = listed ? priorRows.some((row) => personKey(row) === listed.key) : false;
  const priorPoints = listed && priorHasListed ? weekPoints(priorRows, listed.key, rates) : 0;
  const pointsDelta = listedPoints - priorPoints;
  const seasonPeople = useMemo(() => seasonBoard(weeks, undefined, rates, season), [rates, season, weeks]);
  const listedSeason = seasonPeople.find((person) => person.key === listed?.key);
  const seasonLeader = seasonPeople[0];

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
  const deltaText = !listed
    ? "No one is on this week yet."
    : !priorHasListed
      ? "No saved score for the week before."
      : pointsDelta > 0
        ? `Up ${pointsLabel(pointsDelta)} from last week.`
        : pointsDelta < 0
          ? `Down ${pointsLabel(Math.abs(pointsDelta))} from last week.`
          : "Same as last week.";
  const seasonText = !listedSeason
    ? "No season score yet."
    : seasonLeader && seasonLeader.key === listedSeason.key
      ? "Leads the season."
      : seasonLeader
        ? `${shownName(seasonLeader.person, nicknames)} leads at ${pointsLabel(seasonLeader.seasonTotal)}.`
        : "No season scores yet.";
  const streakText = !listedSeason
    ? "No streak yet."
    : listedSeason.nextMilestone === "—"
      ? "Past the last milestone."
      : `Next milestone: ${listedSeason.nextMilestone}.`;

  if (!ready) return <p className="status">Loading the scorecard…</p>;

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <h1>📊 Dashboard</h1>
          <p>The numbers are for the person you pick. The chart and tables compare everyone in the filter.</p>
        </div>
        <input
          className="filter"
          value={query}
          placeholder="Filter people"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {listed ? (
        <div className="whose-week">
          <div className="whose-week-field">
            <span>Look at someone's tasks</span>
            <PersonPicker
              people={roster}
              value={listed.key}
              nicknames={nicknames}
              signedInName={profileName}
              onChange={setListKey}
              onReturn={profileName ? () => navigate("/") : undefined}
            />
          </div>
          <p>These four numbers follow the person above. Change tasks on My week.</p>
        </div>
      ) : null}

      <div className="kpi-row">
        <article className="kpi-card">
          <span>{listed && listed.person === profileName ? "Your points" : "Points"}</span>
          <strong>{listed ? pointsLabel(listedPoints) : "—"}</strong>
          <p>
            {listed && listed.person !== profileName ? `${pickerName(listed.person, nicknames, false)}. ` : ""}
            Of {weekCap} possible. {deltaText}
          </p>
        </article>
        <article className="kpi-card">
          <span>Tasks finished</span>
          <strong>{listed ? percentLabel(listedCompleted, listedTotal) : "—"}</strong>
          <p>{listed ? `${listedCompleted} of ${listedTotal} written tasks are done.` : "No tasks yet."}</p>
        </article>
        <article className="kpi-card">
          <span>Season total</span>
          <strong>{listedSeason ? pointsLabel(listedSeason.seasonTotal) : "—"}</strong>
          <p>{seasonText}</p>
        </article>
        <article className="kpi-card">
          <span>Current streak</span>
          <strong>{listedSeason ? listedSeason.currentStreak : "—"}</strong>
          <p>{streakText}</p>
        </article>
      </div>

      <div className="chart-card tone-chart">
        <div className="section-head">
          <h2>📈 Points this week</h2>
          <p>Longest bar is the highest score. Place is on the name, so the bar does not have to be hovered.</p>
        </div>
        {ranked.length === 0 ? (
          <p className="status">No scores for this filter yet.</p>
        ) : (
          <div className="bars">
            {ranked.map((person) => {
              const width = topPoints === 0 ? 0 : (person.points / topPoints) * 100;
              return (
                <div className="bar-row" key={person.key}>
                  <span className="bar-name">
                    {placeLabel(person.place)} {person.person}
                  </span>
                  <div className="bar-track" role="img" aria-label={`${placeLabel(person.place)} ${person.person}, ${person.points} points`}>
                    <div className="bar-fill" style={{ width: `${width}%` }} />
                  </div>
                  <span className="bar-value">{person.points.toFixed(1)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="scorecard-wrap tone-week">
        <div className="section-head">
          <h2>📋 {isCurrentWeek ? "This week" : "Selected week"}</h2>
          <p>
            {weekLabel}. {weekCompleted} of {weekTotal} written tasks done ({percentLabel(weekCompleted, weekTotal)}). A name opens that list below.
          </p>
        </div>
        <p className="skim-legend">
          <span className="heat-done">Done</span>
          <span className="heat-open">Still open</span>
          <span className="heat-empty">Nothing written</span>
        </p>
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
                  <th scope="row">
                    <button
                      type="button"
                      className={person.key === listed?.key ? "name-link is-open" : "name-link"}
                      onClick={() => setListKey(person.key)}
                    >
                      {person.person}
                    </button>
                  </th>
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

      {listed ? (
        <article className="shared-list tone-list">
          <header className="section-head">
            <h2>👀 {pickerName(listed.person, nicknames, listed.person === profileName)}</h2>
            <p>{listed.team || "No team"}</p>
          </header>
          <div className="shared-days">
            {DAY_NAMES.map((day, dayIndex) => {
              const row = listedDays[dayIndex];
              return (
                <section key={day}>
                  <h3>{day}</h3>
                  <ol>
                    {TASKS.map(([label, done], slot) => {
                      const stored = String(row?.[label] ?? "");
                      const title = taskPlainText(stored);
                      const finished = title.length > 0 && Boolean(row?.[done]);
                      return (
                        <li key={label} className={finished ? "is-done" : undefined}>
                          <span>{SLOT_NAMES[slot]}</span>
                          {title ? <TaskHtml value={stored} /> : "—"}
                        </li>
                      );
                    })}
                  </ol>
                </section>
              );
            })}
          </div>
        </article>
      ) : null}

      <SeasonBoards weeks={weeks} needle={needle} rates={rates} scoringMode={scoringMode} season={season} nicknames={nicknames} />

      {/* All tasks is the parent section. Its summary is sized in CSS above the
          person headers inside, so opening the list does not make every name
          look like another page title. */}
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
