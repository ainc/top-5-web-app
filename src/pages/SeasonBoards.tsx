// Season leaderboard and streak tracker, matching the two sheet tabs.
// Numbers come from saved weeks. People who only exist on the old sheet are absent until those weeks are imported.

import { useMemo } from "react";
import { useBoard } from "../board";
import { DEFAULT_RATES, type ScoreRates } from "../points";
import { currentWeekLeader, seasonBoard, streakTone, teamStandings, weekWinners } from "../streaks";
import type { WeekRecord } from "../weeks";

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

export function SeasonBoards({
  weeks,
  needle,
  rates = DEFAULT_RATES,
  scoringMode = "individual",
  part = "all",
}: {
  weeks: Record<string, WeekRecord>;
  needle: string;
  rates?: ScoreRates;
  scoringMode?: "individual" | "teams";
  part?: "all" | "leaderboard" | "streaks";
}) {
  const people = useMemo(
    () =>
      seasonBoard(weeks, undefined, rates).filter(
        (person) => person.person.toLowerCase().includes(needle) || (person.team ?? "").toLowerCase().includes(needle),
      ),
    [needle, rates, weeks],
  );
  const winners = useMemo(() => weekWinners(weeks, undefined, rates), [rates, weeks]);
  const current = useMemo(() => currentWeekLeader(weeks, undefined, rates), [rates, weeks]);
  const teams = useMemo(() => (scoringMode === "teams" ? teamStandings(people) : []), [people, scoringMode]);
  const ranked = useMemo(() => {
    let place = 1;
    return people.map((person, index) => {
      if (index > 0 && person.seasonTotal < people[index - 1].seasonTotal) place = index + 1;
      return { ...person, place };
    });
  }, [people]);

  const showLeaderboard = part === "all" || part === "leaderboard";
  const showStreaks = part === "all" || part === "streaks";

  return (
    <>
      {showLeaderboard ? <h2>Season leaderboard</h2> : null}
      {showLeaderboard ? (
      <>
      <div className="season-layout">
        <div className="scorecard-wrap">
          <p className="current-week-banner">
            <strong>{current.label}</strong>
            <span>{current.detail}</span>
          </p>
          <table className="scorecard">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Name</th>
                <th>Earlier weeks</th>
                <th>This week</th>
                <th>Streak bonus</th>
                <th>Season total</th>
              </tr>
            </thead>
            <tbody>
              {ranked.length === 0 ? (
                <tr>
                  <td className="scorecard-empty" colSpan={6}>
                    No season scores yet.
                  </td>
                </tr>
              ) : (
                ranked.map((person) => (
                  <tr key={person.key}>
                    <td>{placeLabel(person.place)}</td>
                    <th scope="row">{person.person}</th>
                    <td>{person.earlierWeeks}</td>
                    <td>{person.thisWeek}</td>
                    <td>{person.streakBonus}</td>
                    <td>{person.seasonTotal}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="scorecard-wrap">
          <table className="scorecard">
            <thead>
              <tr>
                <th>Week</th>
                <th>Top scorer</th>
                <th>Score</th>
              </tr>
            </thead>
            <tbody>
              {winners.length === 0 ? (
                <tr>
                  <td className="scorecard-empty" colSpan={3}>
                    No weeks yet.
                  </td>
                </tr>
              ) : (
                winners.map((week) => (
                  <tr key={week.weekId} className={week.current ? "winner-current" : undefined}>
                    <td>{week.label}</td>
                    <td>{week.names}</td>
                    <td>{week.points}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      {teams.length > 0 ? (
        <div className="scorecard-wrap">
          <table className="scorecard">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Team</th>
                <th>This week</th>
                <th>Season total</th>
              </tr>
            </thead>
            <tbody>
              {teams.map((team, index) => (
                <tr key={team.team}>
                  <td>{placeLabel(index + 1)}</td>
                  <th scope="row">{team.team}</th>
                  <td>{team.thisWeek}</td>
                  <td>{team.seasonTotal}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      </>
      ) : null}

      {showStreaks ? <h2>Streak tracker</h2> : null}
      {showStreaks ? (
      <div className="scorecard-wrap">
        <table className="scorecard streak-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Current streak</th>
              <th>Longest streak</th>
              <th>Bonus points earned</th>
              <th>Next milestone</th>
              <th>Milestone log</th>
              <th>Last active</th>
            </tr>
          </thead>
          <tbody>
            {people.length === 0 ? (
              <tr>
                <td className="scorecard-empty" colSpan={7}>
                  No streaks yet.
                </td>
              </tr>
            ) : (
              people.map((person) => (
                <tr key={person.key}>
                  <th scope="row">{person.person}</th>
                  <td className={streakTone(person.currentStreak)}>{person.currentStreak}</td>
                  <td>{person.longestStreak}</td>
                  <td>{person.streakBonus}</td>
                  <td>{person.nextMilestone}</td>
                  <td className="log">{person.milestoneLog}</td>
                  <td>{person.lastActive}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <p className="streak-legend">
          <span className="streak-blue">Blue, 3–6 day streak</span>
          <span className="streak-green">Green, 7–20 day streak</span>
          <span className="streak-gold">Gold, 21+ day streak</span>
        </p>
      </div>
      ) : null}
    </>
  );
}

export function LeaderboardPage() {
  const { weeks, rates, scoringMode, ready } = useBoard();
  if (!ready) return <p className="status">Loading the scorecard…</p>;
  return (
    <section className="page">
      <SeasonBoards weeks={weeks} needle="" rates={rates} scoringMode={scoringMode} part="leaderboard" />
    </section>
  );
}

export function StreaksPage() {
  const { weeks, rates, ready } = useBoard();
  if (!ready) return <p className="status">Loading the scorecard…</p>;
  return (
    <section className="page">
      <SeasonBoards weeks={weeks} needle="" rates={rates} part="streaks" />
    </section>
  );
}
