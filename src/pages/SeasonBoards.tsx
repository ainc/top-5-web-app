// Season leaderboard, week winners, team standings, and the streak tracker.
// These used to be rendered again at the bottom of the dashboard. The dashboard
// now links here with one Season leader card, so this page is the only copy.
// The tracker sits under the season tables because a streak is part of the
// season total (the bonus column), not a separate product.
//
// The page is one panel style. Colored header bands (the solid red season
// title, the grey winner band, the pink streak band) made each block look
// like a different product. Titles are charcoal on the card instead.
//
// The top three stand on a podium, ordered 2nd, 1st, 3rd, so first place sits
// in the middle. The signed-in person is the dark card when they are up there,
// or a marked row when they are further down. Everyone else with a season
// total of zero is one line under the table. A six-way tie at zero used to
// fill the rank list with identical rows.
//
// Season / This week changes what the podium and the ranks sort by. The
// columns stay put, so a switch does not reshuffle the table shape.
//
// The streak tracker under this board is the shared scan: name, current,
// longest, bonus, last active. Next milestone is not here. It is a countdown
// on My week, and only for the signed-in person ("1 more day for +5").
// The milestone log is not a cell either. A name opens that person's detail
// on this page, and the awards are a list there. Last active is the latest
// weekday with points, so a blank row for today does not mark the roster active.
//
// A streak cell is the number. At 7 days, and again at 21, one red badge
// sits beside it. There is no blue/green/gold scale and no legend of colors.
// Week winners and teams sit in a narrow column on the right. Side by side
// with the main table, the winner list left a wide empty score column.
// Numbers come from saved weeks. People who only exist on the old sheet are
// absent until those weeks are imported.

import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth";
import { useBoard } from "../board";
import { DEFAULT_RATES, type ScoreRates } from "../points";
import { shownName } from "../names";
import { seasonBoard, streakBadge, teamStandings, weekWinners, type PersonSeason, type SeasonSpan } from "../streaks";
import { addDays, parseISODate, type WeekRecord } from "../weeks";

type BoardView = "season" | "week";

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

// "Oct 26 – 30" in the sidebar. The week menu still uses the longer
// "Mon, Oct 26 – Fri, Oct 30", which is too wide for this column.
function shortWeek(weekId: string): string {
  const start = parseISODate(weekId);
  const end = parseISODate(addDays(weekId, 4));
  const startMonth = start.toLocaleDateString("en-US", { month: "short" });
  const endMonth = end.toLocaleDateString("en-US", { month: "short" });
  if (start.getMonth() === end.getMonth()) return `${startMonth} ${start.getDate()} – ${end.getDate()}`;
  return `${startMonth} ${start.getDate()} – ${endMonth} ${end.getDate()}`;
}

function streakPhrase(person: PersonSeason): string {
  if (person.currentStreak > 0) return `${person.currentStreak}-day streak`;
  if (person.longestStreak > 0) return `best streak ${person.longestStreak}`;
  return "no streak yet";
}

function prettyDate(iso: string): string {
  if (!iso) return "—";
  return parseISODate(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// A person key is "Team|Name". The pipe has to be encoded or the query
// string cuts the name off. This page reads the same parameter back.
function personDetailPath(key: string): string {
  return `/leaderboard?person=${encodeURIComponent(key)}`;
}

// The number is the streak. The badge is the milestone already reached,
// 7 or 21, in one style. A shorter run has no badge.
function StreakCount({ length }: { length: number }) {
  const badge = streakBadge(length);
  return (
    <span className="streak-count">
      {length}
      {badge ? (
        <span className="streak-badge" aria-label={`${badge}-day milestone`}>
          {badge}
        </span>
      ) : null}
    </span>
  );
}

function scoreOf(person: PersonSeason, view: BoardView): number {
  return view === "season" ? person.seasonTotal : person.thisWeek;
}

export function SeasonBoards({
  weeks,
  needle,
  rates = DEFAULT_RATES,
  scoringMode = "individual",
  season,
  nicknames = {},
  you = "",
  detailKey = "",
}: {
  weeks: Record<string, WeekRecord>;
  needle: string;
  rates?: ScoreRates;
  scoringMode?: "individual" | "teams";
  season?: SeasonSpan;
  nicknames?: Record<string, string>;
  you?: string;
  // Set from /leaderboard?person=. Empty means the shared table only.
  detailKey?: string;
}) {
  const [view, setView] = useState<BoardView>("season");
  const roster = useMemo(() => seasonBoard(weeks, undefined, rates, season), [rates, season, weeks]);
  const people = useMemo(
    () =>
      roster.filter((person) => {
        const label = shownName(person.person, nicknames).toLowerCase();
        return person.person.toLowerCase().includes(needle) || label.includes(needle) || (person.team ?? "").toLowerCase().includes(needle);
      }),
    [needle, nicknames, roster],
  );
  const detail = roster.find((person) => person.key === detailKey) ?? null;
  useEffect(() => {
    if (!detail) return;
    document.getElementById("streak-detail")?.scrollIntoView({ block: "nearest" });
  }, [detail]);
  const winners = useMemo(() => weekWinners(weeks, undefined, rates, season, nicknames), [nicknames, rates, season, weeks]);
  const teams = useMemo(() => (scoringMode === "teams" ? teamStandings(people) : []), [people, scoringMode]);

  // Zeros stay out of the rank math. Sorting them in would hand 4th place to
  // the first name in a tie of nothing. The line under the table lists them.
  const scoring = useMemo(() => people.filter((person) => person.seasonTotal > 0), [people]);
  const quiet = useMemo(() => people.filter((person) => person.seasonTotal === 0), [people]);
  const ranked = useMemo(() => {
    const sorted = [...scoring].sort((a, b) => {
      const primary = scoreOf(b, view) - scoreOf(a, view);
      if (primary !== 0) return primary;
      const secondary = view === "season" ? b.thisWeek - a.thisWeek : b.seasonTotal - a.seasonTotal;
      if (secondary !== 0) return secondary;
      return a.person.localeCompare(b.person);
    });
    let place = 1;
    return sorted.map((person, index) => {
      if (index > 0 && scoreOf(person, view) < scoreOf(sorted[index - 1], view)) place = index + 1;
      return { ...person, place };
    });
  }, [scoring, view]);

  // The podium is the first three people who actually have a score in the
  // view that is open. A person with a season total but nothing this week
  // stays in the table while This week is selected.
  const podium = ranked.filter((person, index) => index < 3 && scoreOf(person, view) > 0);
  const podiumKeys = new Set(podium.map((person) => person.key));
  const table = ranked.filter((person) => !podiumKeys.has(person.key));
  const lead = teams[0]?.seasonTotal ?? 0;
  const isYou = (person: string) => you !== "" && person === you;

  return (
    <>
      <div className="board-toolbar">
        <div className="board-toggle" role="group" aria-label="Rank the leaderboard by">
          <button type="button" aria-pressed={view === "season"} onClick={() => setView("season")}>
            Season
          </button>
          <button type="button" aria-pressed={view === "week"} onClick={() => setView("week")}>
            This week
          </button>
        </div>
      </div>

      <div className="season-layout">
        <div className="board-panel">
          <h2 className="board-title">{view === "season" ? "Season leaderboard" : "This week"}</h2>
          {podium.length > 0 ? (
            <div className="podium">
              {podium.map((person) => (
                <article key={person.key} className={isYou(person.person) ? "podium-card is-you" : "podium-card"} data-place={person.place}>
                  <p>{isYou(person.person) ? `${placeLabel(person.place)} · You` : placeLabel(person.place)}</p>
                  <h3>
                    <Link className={detailKey === person.key ? "name-link is-open" : "name-link"} to={personDetailPath(person.key)}>
                      {shownName(person.person, nicknames)}
                    </Link>
                  </h3>
                  <strong>{scoreOf(person, view)}</strong>
                  <span>
                    {view === "season" ? `${person.thisWeek} this week` : `${person.seasonTotal} this season`}
                    {" · "}
                    {streakPhrase(person)}
                  </span>
                </article>
              ))}
            </div>
          ) : null}
          <table className="scorecard board-table">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Name</th>
                <th className="num">This week</th>
                <th className="num">Streak</th>
                <th className="num">Bonus</th>
                <th className="num">Season</th>
              </tr>
            </thead>
            <tbody>
              {table.length === 0 ? (
                <tr>
                  <td className="scorecard-empty" colSpan={6}>
                    {ranked.length === 0 ? "No season scores yet." : "Everyone with points is on the podium."}
                  </td>
                </tr>
              ) : (
                table.map((person) => (
                  <tr key={person.key} className={isYou(person.person) ? "is-you" : undefined}>
                    <td>{placeLabel(person.place)}</td>
                    <td>
                      <Link className={detailKey === person.key ? "name-link is-open" : "name-link"} to={personDetailPath(person.key)}>
                        {shownName(person.person, nicknames)}
                      </Link>
                    </td>
                    <td className="num">{person.thisWeek}</td>
                    <td className="num">
                      <StreakCount length={person.currentStreak} />
                      <span className="streak-best"> · best {person.longestStreak}</span>
                    </td>
                    <td className="num">{person.streakBonus}</td>
                    <td className="num is-season">{person.seasonTotal}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          {quiet.length > 0 ? (
            <p className="bar-zeros">No points yet: {quiet.map((person) => (isYou(person.person) ? `${shownName(person.person, nicknames)} (you)` : shownName(person.person, nicknames))).join(", ")}</p>
          ) : null}
        </div>

        <aside className="board-side-col">
          {teams.length > 0 ? (
            <section className="board-panel board-side">
              <h2>Teams</h2>
              <ul className="team-bars">
                {teams.map((team) => (
                  <li key={team.team}>
                    <span>{team.team}</span>
                    <span className="team-bar-track">
                      <span className={team.seasonTotal === lead && lead > 0 ? "is-lead" : undefined} style={{ width: lead > 0 ? `${Math.round((team.seasonTotal / lead) * 100)}%` : "0%" }} />
                    </span>
                    <strong>{team.seasonTotal}</strong>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <section className="board-panel board-side">
            <h2>Week winners</h2>
            {winners.length === 0 ? (
              <p className="scorecard-empty">No weeks yet.</p>
            ) : (
              <ul className="winner-list">
                {winners.map((week) => (
                  <li key={week.weekId}>
                    <p>{shortWeek(week.weekId)}</p>
                    <p>
                      <span>{week.names}</span>
                      <strong>{week.points}</strong>
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>

      {detail ? (
        <StreakDetail person={detail} nicknames={nicknames} />
      ) : detailKey ? (
        <section className="board-panel streak-detail" id="streak-detail">
          <p className="scorecard-empty">That person is not on this season.</p>
          <Link className="name-link" to="/leaderboard">
            Close
          </Link>
        </section>
      ) : null}

      <div className="board-panel">
        <h2 className="board-title">Streak tracker</h2>
        <p className="field-help board-note">Weekdays in a row with points. A weekend does not break a streak. Today stays open until it has points. A name opens that person's milestones.</p>
        <table className="scorecard board-table streak-table">
          <thead>
            <tr>
              <th>Name</th>
              <th className="num">Current streak</th>
              <th className="num">Longest streak</th>
              <th className="num">Bonus points earned</th>
              <th className="num">Last active</th>
            </tr>
          </thead>
          <tbody>
            {people.length === 0 ? (
              <tr>
                <td className="scorecard-empty" colSpan={5}>
                  No streaks yet.
                </td>
              </tr>
            ) : (
              people.map((person) => (
                <tr key={person.key} className={isYou(person.person) ? "is-you" : undefined}>
                  <td>
                    <Link className={detailKey === person.key ? "name-link is-open" : "name-link"} to={personDetailPath(person.key)}>
                      {shownName(person.person, nicknames)}
                    </Link>
                  </td>
                  <td className="num">
                    <StreakCount length={person.currentStreak} />
                  </td>
                  <td className="num">{person.longestStreak}</td>
                  <td className="num">{person.streakBonus}</td>
                  <td className="num">{prettyDate(person.lastActive)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function StreakDetail({ person, nicknames }: { person: PersonSeason; nicknames: Record<string, string> }) {
  const name = shownName(person.person, nicknames);
  return (
    <section className="board-panel streak-detail" id="streak-detail" aria-label={`${name} streak detail`}>
      <div className="streak-detail-head">
        <h2 className="board-title">{name}</h2>
        <Link className="name-link" to="/leaderboard">
          Close
        </Link>
      </div>
      <p className="board-note">
        {person.currentStreak}-day streak · longest {person.longestStreak} · {person.streakBonus} bonus points
        {person.lastActive ? ` · last active ${prettyDate(person.lastActive)}` : ""}
      </p>
      <h3>Milestones</h3>
      {person.awards.length === 0 ? (
        <p className="scorecard-empty">No milestones yet.</p>
      ) : (
        <ul className="streak-awards">
          {person.awards.map((award) => (
            <li key={`${award.date}-${award.day}`}>
              <span>Day {award.day}</span>
              <span>+{award.points}</span>
              <time dateTime={award.date}>{prettyDate(award.date)}</time>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function LeaderboardPage() {
  const { weeks, rates, scoringMode, season, nicknames, ready } = useBoard();
  const { profileName } = useAuth();
  const [searchParams] = useSearchParams();
  if (!ready) return <p className="status">Loading the scorecard…</p>;
  return (
    <section className="page">
      <SeasonBoards
        weeks={weeks}
        needle=""
        rates={rates}
        scoringMode={scoringMode}
        season={season}
        nicknames={nicknames}
        you={profileName}
        detailKey={searchParams.get("person") ?? ""}
      />
    </section>
  );
}
