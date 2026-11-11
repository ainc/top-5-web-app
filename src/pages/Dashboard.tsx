// Read-only week. The page is a glance, then a comparison, then the detail.
//
// The cards at the top are the week, not one person. Tasks done is how many
// written tasks are checked. Active this week is how many people wrote
// anything. Week leader is the highest score on this week. Season leader
// is the link to the Leaderboard. The person switcher still highlights a
// row and opens that person's list. It does not change these four numbers.
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

import { ChartColumn, ClipboardList, LayoutDashboard, SquareCheck } from "lucide-react";
import { useLayoutEffect, useMemo, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { useAuth } from "../auth";
import { ScoreGrid, useBoard } from "../board";
import { shownName } from "../names";
import { ScorecardLoading } from "../ScorecardLoading";
import { StepMenu } from "../StepMenu";
import { PersonPicker } from "./PersonPicker";
import { DAY_NAMES, dailyPoints, personKey } from "../points";
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
  const [listKey, setListKey] = useState("");
  const [teamFilter, setTeamFilter] = useState("");
  const [toolbar, setToolbar] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setToolbar(document.getElementById("dashboard-toolbar"));
  }, []);
  const teamNames = useMemo(() => {
    const names = new Set<string>();
    let unassigned = false;
    for (const person of weekPeople) {
      if (person.team) names.add(person.team);
      else unassigned = true;
    }
    const list = [...names].sort((a, b) => a.localeCompare(b));
    if (unassigned) list.push("Unassigned");
    return list;
  }, [weekPeople]);
  const roster = useMemo(
    () =>
      weekPeople.filter((person) => {
        if (!teamFilter) return true;
        if (teamFilter === "Unassigned") return !person.team;
        return person.team === teamFilter;
      }),
    [teamFilter, weekPeople],
  );

  const people = useMemo<PersonScore[]>(() => {
    return weekPeople
      .filter((person) => {
        if (teamFilter === "Unassigned") return !person.team;
        if (teamFilter) return person.team === teamFilter;
        return true;
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
  }, [nicknames, rates, rows, teamFilter, weekPeople]);

  // Nothing chosen yet means the signed-in person, same as My week. A team
  // filter that does not include that person falls through to the first
  // person still on screen.
  const signedInKey = roster.find((person) => person.person === profileName)?.key ?? "";
  const listed =
    roster.find((person) => person.key === listKey) ??
    roster.find((person) => person.key === signedInKey) ??
    roster[0];
  const seasonPeople = useMemo(() => seasonBoard(weeks, undefined, rates, season), [rates, season, weeks]);
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
  const weekLeaders = withPoints.length > 0 ? withPoints.filter((person) => person.points === withPoints[0].points) : [];
  // Monday is index 0. A Saturday or a past week matches no column, so the
  // mark does not stick to Friday after the week has ended.
  const todayIso = formatISODate(new Date());
  const todayIndex = DAY_NAMES.findIndex((_, index) => addDays(selectedWeek, index) === todayIso);

  if (!ready) return <ScorecardLoading />;

  return (
    <section className="page">
      {toolbar
        ? createPortal(
            <>
              <PersonPicker
                compact
                people={roster}
                value={listed?.key ?? ""}
                nicknames={nicknames}
                signedInName={profileName}
                onChange={setListKey}
              />
              <TeamMenu teams={teamNames} value={teamFilter} onChange={setTeamFilter} />
            </>,
            toolbar,
          )
        : null}
      <div className="page-head">
        <div>
          <h1>
            <LayoutDashboard aria-hidden="true" />
            Dashboard
          </h1>
        </div>
      </div>

      <div className="kpi-row">
        <article className="kpi-card">
          <span>Tasks done</span>
          <strong>{percentLabel(weekCompleted, weekTotal)}</strong>
          <p>{weekTotal === 0 ? "Nothing written yet." : `${weekCompleted} of ${weekTotal} written`}</p>
        </article>
        <article className="kpi-card">
          <span>Active this week</span>
          <strong>
            {writtenRows.length}
            <span className="kpi-of"> of {people.length}</span>
          </strong>
          <p>
            {unwritten.length === 0
              ? "Everyone has written tasks."
              : unwritten.length === 1
                ? "1 hasn't written tasks."
                : `${unwritten.length} haven't written tasks.`}
          </p>
        </article>
        <article className="kpi-card">
          <span>Week leader</span>
          <strong className="kpi-name">
            {weekLeaders.length > 0 ? (
              weekLeaders.map((person, index) => (
                <span key={person.key}>
                  {index > 0 ? ", " : null}
                  <Link className="name-link" to={personWeekPath(person.key)}>
                    {person.person}
                  </Link>
                </span>
              ))
            ) : (
              "—"
            )}
          </strong>
          <p>{weekLeaders.length > 0 ? `${pointsLabel(weekLeaders[0].points)} points` : "No points yet."}</p>
        </article>
        <Link className="kpi-card" to="/leaderboard">
          <span>Season leader</span>
          <strong className="kpi-name">{seasonLeaders.length > 0 ? seasonLeaders.map((person) => shownName(person.person, nicknames)).join(", ") : "—"}</strong>
          <p>
            {seasonLeaders.length > 0 ? `${pointsLabel(seasonLeaders[0].seasonTotal)} points` : "No season scores yet."}
            <span className="kpi-more"> · Full leaderboard</span>
          </p>
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
          <p>{weekLabel}.</p>
        </div>
        <table className="scorecard skim">
          <thead>
            <tr>
              <th>Name</th>
              {DAY_NAMES.map((day, index) => (
                <th key={day} className={index === todayIndex ? "is-today" : undefined} aria-current={index === todayIndex ? "date" : undefined}>
                  {index === todayIndex ? `${day} · Today` : day}
                </th>
              ))}
              <th>Done</th>
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
        <div className="week-foot">
          {unwritten.length > 0 ? (
            <p className="bar-zeros">
              Nothing written this week: <PersonNames people={unwritten} />
            </p>
          ) : (
            <span />
          )}
          <p className="skim-legend">
            <span>Fewer</span>
            <span className="heat-ramp" aria-hidden="true" />
            <span>More done</span>
          </p>
        </div>
      </div>

      {/* All tasks is the parent section. Its summary is sized in CSS above the
          person headers inside, so opening the list does not make every name
          look like another page title. */}
      <details className="task-details">
        <summary>
          <SquareCheck aria-hidden="true" />
          All tasks
        </summary>
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

// Everyone is the first stop, then each team name. The arrows, the open list,
// and the wrap come from StepMenu, the same control as the person picker.
// Everyone means no filter.
function TeamMenu({ teams, value, onChange }: { teams: string[]; value: string; onChange: (team: string) => void }) {
  return (
    <StepMenu
      compact
      options={[{ value: "", label: "Everyone" }, ...teams.map((team) => ({ value: team, label: team }))]}
      value={value}
      onChange={onChange}
      closedLabel={value ? `Team: ${value}` : "Team: Everyone"}
      previousLabel="Previous team"
      nextLabel="Next team"
      menuLabel="Team"
      listLabel="Team"
    />
  );
}
