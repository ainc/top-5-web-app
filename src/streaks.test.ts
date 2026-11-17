// Per-season streak milestones. Each season stores its own day/point ladder
// in streak_milestones rather than hardcoding 3/5/8/10/15/20/25 for every season.

import { expect, it } from "vitest";
import { seasonBoard, streakCue, type StreakMilestone } from "./streaks";
import { blankTaskFields } from "./taskSlots";
import type { DayRow } from "./types";
import type { WeekRecord } from "./weeks";

function scoredMondayThroughWednesday(weekId: string): DayRow[] {
  return ["Mon", "Tue", "Wed"].map((day) => ({
    id: `${weekId}-Logan-${day}`,
    person: "Logan",
    team: "Awesomes",
    day,
    ...blankTaskFields(),
    notes: "",
    top5: false,
    exercise: true,
    reading: false,
    extraChecks: {},
  }));
}

it("scores streaks and next-milestone cues using the season's custom milestones", () => {
  const milestones: StreakMilestone[] = [
    { day: 2, points: 10 },
    { day: 5, points: 30 },
  ];
  const weeks: Record<string, WeekRecord> = {
    "2026-10-12": { rows: scoredMondayThroughWednesday("2026-10-12"), source: "Supabase" },
  };
  const season = { name: "Custom", startsOn: "2026-10-12", lengthWeeks: 8 };
  const roster = [{ person: "Logan", team: "Awesomes" }];

  const board = seasonBoard(weeks, "2026-10-14", undefined, season, roster, milestones);
  expect(board[0]?.currentStreak).toBe(3);
  expect(board[0]?.weeklyPoints).toBe(15);
  expect(board[0]?.streakBonus).toBe(10);
  expect(board[0]?.seasonTotal).toBe(25);
  expect(board[0]?.awards).toEqual([{ day: 2, points: 10, date: "2026-10-13" }]);

  expect(streakCue(3, milestones)).toBe("2 more days for +30");
  expect(streakCue(5, milestones)).toBe("");
});
