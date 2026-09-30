// Scoring rules copied from the sheet formula:
// 15 if Top 5 is checked, 5 if Exercise is checked, 5 if Reading is checked.

import type { DayRow } from "./types";

export const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;
export const MAX_DAY_POINTS = 25;
export const MAX_WEEK_POINTS = MAX_DAY_POINTS * DAY_NAMES.length;

// The sheet formula is only the three bonuses. pointsPerTask stays 0 until a
// commissioner sets it, so priority checkboxes do not add points yet.
// A checked bonus uses the points stored on that day when we have them, so a
// later change to the bonus does not rewrite past days.
export type ScoreRates = {
  pointsPerTask: number;
  top5: number;
  exercise: number;
  reading: number;
};

export const DEFAULT_RATES: ScoreRates = { pointsPerTask: 0, top5: 15, exercise: 5, reading: 5 };

type ScoredDay = Pick<DayRow, "topDone" | "highDone" | "med1Done" | "med2Done" | "lowDone" | "top5" | "exercise" | "reading"> & {
  top5Awarded?: number;
  exerciseAwarded?: number;
  readingAwarded?: number;
};

export function completedTaskCount(row: Pick<DayRow, "topDone" | "highDone" | "med1Done" | "med2Done" | "lowDone">): number {
  return [row.topDone, row.highDone, row.med1Done, row.med2Done, row.lowDone].filter(Boolean).length;
}

export function dailyPoints(row: ScoredDay, rates: ScoreRates = DEFAULT_RATES): number {
  const tasks = completedTaskCount(row) * rates.pointsPerTask;
  const top = row.top5 ? (row.top5Awarded ?? rates.top5) : 0;
  const exercise = row.exercise ? (row.exerciseAwarded ?? rates.exercise) : 0;
  const reading = row.reading ? (row.readingAwarded ?? rates.reading) : 0;
  return tasks + top + exercise + reading;
}

// A team name is part of the key only when this season actually has teams.
export function personKey(row: Pick<DayRow, "team" | "person">): string {
  return row.team ? `${row.team}|${row.person}` : row.person;
}

// First time each person appears, in sheet order. Used for the person menu and standings.
export function peopleInOrder(rows: DayRow[]): Array<{ key: string; person: string; team: string | null }> {
  const seen = new Set<string>();
  const people: Array<{ key: string; person: string; team: string | null }> = [];
  for (const row of rows) {
    const key = personKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    people.push({ key, person: row.person, team: row.team });
  }
  return people;
}

// Sum of that person's days in the current set of rows. Max is 125.
export function weekPoints(rows: DayRow[], key: string, rates: ScoreRates = DEFAULT_RATES): number {
  return rows.reduce((sum, row) => (personKey(row) === key ? sum + dailyPoints(row, rates) : sum), 0);
}
