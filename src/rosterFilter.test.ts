// Removing someone from season_members keeps their saved day_entries, tasks,
// and bonus_checks in the database while dropping them from the active roster,
// the dashboard week list, the leaderboard, and week winners.

import { expect, it } from "vitest";
import { peopleFromRoster } from "./points";
import { seasonBoard, weekWinners } from "./streaks";
import { blankTaskFields } from "./taskSlots";
import type { DayRow } from "./types";
import type { WeekRecord } from "./weeks";

function makeDay(person: string, team: string | null, weekId: string, day: string, topTitle = "", done = false): DayRow {
  return {
    id: `${weekId}-${person}-${day}`,
    person,
    team,
    day,
    ...blankTaskFields(),
    topLabel: topTitle,
    topDone: done,
    notes: "",
    top5: false,
    exercise: done,
    reading: false,
    extraChecks: {},
  };
}

it("drops removed members from the week, leaderboard, and winners while keeping saved rows", () => {
  const weekId = "2026-11-09";
  const rows: DayRow[] = [
    makeDay("Logan", "Awesomes", weekId, "Mon", "Ship fix", true),
    makeDay("Ben Starling", null, weekId, "Mon"),
  ];
  const weeks: Record<string, WeekRecord> = {
    [weekId]: { rows, source: "Supabase" },
  };
  const season = { name: "Q4 2026", startsOn: "2026-10-12", lengthWeeks: 8 };
  const activeRoster = [{ person: "Logan", team: "Awesomes" }];

  // Week list only shows people on the active roster, plus anyone new on it.
  const weekPeople = peopleFromRoster(rows, [
    ...activeRoster,
    { person: "Emily", team: "Alphas" },
  ]);
  expect(weekPeople.map((p) => p.person)).toEqual(["Logan", "Emily"]);

  // Leaderboard and streak table exclude Ben Starling, while keeping Logan and Emily.
  const board = seasonBoard(weeks, "2026-11-12", undefined, season, [
    ...activeRoster,
    { person: "Emily", team: "Alphas" },
  ]);
  expect(board.map((p) => p.person)).toEqual(["Logan", "Emily"]);

  // Week winners ignore off-roster rows (even if nobody scored yet).
  const emptyWeek: Record<string, WeekRecord> = {
    "2026-11-16": {
      rows: [
        makeDay("Logan", "Awesomes", "2026-11-16", "Mon"),
        makeDay("Ben Starling", null, "2026-11-16", "Mon"),
      ],
      source: "Blank week",
    },
  };
  const winners = weekWinners(emptyWeek, "2026-11-16", undefined, season, {}, activeRoster);
  expect(winners[0]?.names).toBe("Logan");

  // Underlying week rows stay untouched so task history is preserved.
  expect(weeks[weekId].rows).toHaveLength(2);
});
