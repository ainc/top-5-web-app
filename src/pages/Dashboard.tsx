// Read-only week. The page is a glance, then a comparison, then the detail.
//
// The cards at the top follow the person picked in "Look at someone's tasks":
// their points against the week maximum, tasks finished, season total, and
// streak. The streak card is the length and the longest run. It does not
// say how many days are left until the next bonus. That countdown is private
// to the signed-in person, on My week. A fifth card, Season leader, is the
// only season summary kept here.
// The season board, week winners, team standings, and streak tracker used to
// be copied onto this page and onto their own routes. They now live once, on
// the Leaderboard, and this card is the link to that page.
//
// The bar list is this week's points. People at zero are named on one line
// under the bars, because a chart that is half empty bars hides the people
// who actually scored. Percents and points are whole numbers (75%, 80). A
// trailing .00 or .0 made a finished day look more precise than the scoring is.
//
// The week table is one red scale: a light tint is little done, solid brand
// red is every written task done. An empty day is a gray dot, not a red cell,
// because nothing written is not a missed day. Rows are highest points first.
// Today's column is marked only while this week is the one on screen. People
// with nothing written all week leave the table and sit on one line under it.
//
// A name is a link to My week for that person. The old embedded week under
// this table squeezed five days into one row and the task text was too small
// to read. My week is the readable view, and it already knows how to lock
// edits. The collapsed All tasks list is still here for a scan of every card.
//
// That list uses AG Grid Community only. Sparklines, integrated charts, and
// master-detail rows are paid features, so the summary stays as numbers and
// a labeled bar list. A shared grid put the next person on the following row,
// so the names blended together.

import { ChartColumn, ClipboardList, LayoutDashboard } from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { ScoreGrid, useBoard } from "../board";
import { pickerName, shownName } from "../names";
import { PersonPicker } from "./PersonPicker";
import { DAY_NAMES, dailyPoints, maxWeekPoints, personKey, weekPoints } from "../points";
import { seasonBoard } from "../streaks";
import type { DayRow } from "../types";
import { addDays, formatISODate } from "../weeks";

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

// --heat is how much brand red to mix into the cell. 16% is the light end
// (tasks written, none finished). 100% is solid red. White text starts at
// 80% done, where the red is dark enough that charcoal numbers disappear.
function heatStyle(score: DayScore): { className: string; style?: CSSProperties } {
  if (score.total === 0) return { className: "heat-empty" };
  const ratio = score.completed / score.total;
  const heat = Math.round(16 + ratio * 84);
  return {
    className: ratio >= 0.8 ? "heat-scale is-solid" : "heat-scale",
    style: { "--heat": `${heat}%` } as CSSProperties,
  };
}

function dayLabel(score: DayScore): string {
  if (score.total === 0) return "";
  return `${score.completed}/${score.total}`;
}

function percentLabel(completed: number, total: number): string {
  if (total === 0) return "—";
  return `${Math.round((completed / total) * 100)}%`;
}

function pointsLabel(value: number): string {
  return String(Math.round(value));
}

// A person key is "Team|Name", so the pipe has to be encoded or the query
// string cuts the name off. My week reads this same parameter.
function personWeekPath(key: string): string {
  return `/?person=${encodeURIComponent(key)}`;
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
  const { rows, people: weekPeople, ready, selectedWeek, weekLabel, isCurrentWeek, weeks, rates, season, nicknames } = useBoard();
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
  // A tie for the top season total lists every name on the card. A season
  // where the best total is still 0 has no leader yet.
  const seasonLeaders = seasonLeader && seasonLeader.seasonTotal > 0 ? seasonPeople.filter((person) => person.seasonTotal === seasonLeader.seasonTotal) : [];

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
  // Chart membership uses the rounded points the bars print, so a value that
  // displays as 0 does not still draw a bar. The table split is different:
  // someone who wrote tasks but scored 0 stays in the grid; someone with no
  // task text at all is only a name under it.
  const withPoints = ranked.filter((person) => Math.round(person.points) > 0);
  const withoutPoints = ranked.filter((person) => Math.round(person.points) <= 0);
  const writtenRows = ranked.filter((person) => person.total > 0);
  const unwritten = ranked.filter((person) => person.total === 0);
  const topPoints = withPoints.reduce((max, person) => Math.max(max, person.points), 0);
  // Monday is index 0. A Saturday or a past week matches no column, so the
  // mark does not stick to Friday after the week has ended.
  const todayIso = formatISODate(new Date());
  const todayIndex = DAY_NAMES.findIndex((_, index) => addDays(selectedWeek, index) === todayIso);
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
  const streakText = !listedSeason || listedSeason.longestStreak === 0
    ? "No streak yet."
    : `Longest is ${listedSeason.longestStreak}.`;

  if (!ready) return <p className="status">Loading the scorecard…</p>;

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <h1>
            <LayoutDashboard aria-hidden="true" />
            Dashboard
          </h1>
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
        <Link className="kpi-card" to="/leaderboard">
          <span>Season leader</span>
          <strong className="kpi-name">{seasonLeaders.length > 0 ? seasonLeaders.map((person) => shownName(person.person, nicknames)).join(", ") : "—"}</strong>
          <p>{seasonLeaders.length > 0 ? `${pointsLabel(seasonLeaders[0].seasonTotal)} this season` : "No season scores yet."}</p>
        </Link>
      </div>

      <div className="chart-card tone-chart">
        <div className="section-head">
          <h2>
            <ChartColumn aria-hidden="true" />
            Points this week
          </h2>
        </div>
        {ranked.length === 0 ? (
          <p className="status">No scores for this filter yet.</p>
        ) : (
          <>
            {withPoints.length > 0 ? (
              <div className="bars">
                {withPoints.map((person) => {
                  const width = topPoints === 0 ? 0 : (person.points / topPoints) * 100;
                  return (
                    <div className="bar-row" key={person.key}>
                      <span className="bar-name">
                        <Link className="name-link" to={personWeekPath(person.key)}>
                          {placeLabel(person.place)} {person.person}
                        </Link>
                      </span>
                      <div className="bar-track" role="img" aria-label={`${placeLabel(person.place)} ${person.person}, ${pointsLabel(person.points)} points`}>
                        <div className="bar-fill" style={{ width: `${width}%` }} />
                      </div>
                      <span className="bar-value">{pointsLabel(person.points)}</span>
                    </div>
                  );
                })}
              </div>
            ) : null}
            {withoutPoints.length > 0 ? (
              <p className="bar-zeros">
                No points yet: <PersonNames people={withoutPoints} />
              </p>
            ) : null}
          </>
        )}
      </div>

      <div className="scorecard-wrap tone-week">
        <div className="section-head">
          <h2>
            <ClipboardList aria-hidden="true" />
            {isCurrentWeek ? "This week" : "Selected week"}
          </h2>
          <p>
            {weekLabel}. {weekCompleted} of {weekTotal} written tasks done ({percentLabel(weekCompleted, weekTotal)}).
          </p>
        </div>
        <p className="skim-legend">
          <span className="heat-dot" />
          <span className="heat-ramp" />
        </p>
        <table className="scorecard skim">
          <thead>
            <tr>
              <th>Name</th>
              {DAY_NAMES.map((day, index) => (
                <th key={day} className={index === todayIndex ? "is-today" : undefined} aria-current={index === todayIndex ? "date" : undefined}>
                  {day}
                </th>
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
              writtenRows.map((person) => (
                <tr key={person.key}>
                  <th scope="row">
                    <Link className={person.key === listed?.key ? "name-link is-open" : "name-link"} to={personWeekPath(person.key)}>
                      {person.person}
                    </Link>
                  </th>
                  {person.days.map((score, index) => {
                    const paint = heatStyle(score);
                    return (
                      <td
                        key={DAY_NAMES[index]}
                        className={`${paint.className}${index === todayIndex ? " is-today" : ""}`}
                        style={paint.style}
                        aria-label={score.total === 0 ? "Nothing written" : undefined}
                      >
                        {score.total === 0 ? <span className="heat-dot" aria-hidden="true" /> : dayLabel(score)}
                      </td>
                    );
                  })}
                  <td>{percentLabel(person.completed, person.total)}</td>
                  <td>{pointsLabel(person.points)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        {unwritten.length > 0 ? (
          <p className="bar-zeros">
            Nothing written: <PersonNames people={unwritten} />
          </p>
        ) : null}
      </div>

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
                  <h3>
                    <Link className="name-link" to={personWeekPath(person.key)}>
                      {person.person}
                    </Link>
                  </h3>
                  <span>
                    {person.team ? `${person.team} · ` : ""}
                    {pointsLabel(person.points)} pts
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

function PersonNames({ people }: { people: Array<{ key: string; person: string }> }) {
  return people.map((person, index) => (
    <span key={person.key}>
      {index > 0 ? ", " : null}
      <Link className="name-link" to={personWeekPath(person.key)}>
        {person.person}
      </Link>
    </span>
  ));
}
