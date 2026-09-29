// Scoring rules copied from the sheet formula:
// 15 if Top 5 is checked, 5 if Exercise is checked, 5 if Reading is checked.

import type { DayRow, Team } from "./types";

export const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;
export const MAX_DAY_POINTS = 25;
export const MAX_WEEK_POINTS = MAX_DAY_POINTS * DAY_NAMES.length;

// One day's points. Priority-task checkboxes are intentionally ignored.
export function dailyPoints(row: Pick<DayRow, "top5" | "exercise" | "reading">): number {
  return (row.top5 ? 15 : 0) + (row.exercise ? 5 : 0) + (row.reading ? 5 : 0);
}

// Team is part of the key so two people with the same first name stay separate.
export function personKey(row: Pick<DayRow, "team" | "person">): string {
  return `${row.team}|${row.person}`;
}

// First time each person appears, in sheet order. Used for the person menu and standings.
export function peopleInOrder(rows: DayRow[]): Array<{ key: string; person: string; team: Team }> {
  const seen = new Set<string>();
  const people: Array<{ key: string; person: string; team: Team }> = [];
  for (const row of rows) {
    const key = personKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    people.push({ key, person: row.person, team: row.team });
  }
  return people;
}

// Sum of that person's days in the current set of rows. Max is 125.
export function weekPoints(rows: DayRow[], key: string): number {
  return rows.reduce((sum, row) => (personKey(row) === key ? sum + dailyPoints(row) : sum), 0);
}
