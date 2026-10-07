// Weeks are identified by Monday as YYYY-MM-DD. That string sorts in calendar order.

import { DAY_NAMES, peopleInOrder } from "./points";
import type { DayRow } from "./types";

// One saved scorecard. source is the label under the title, such as a CSV file name.
export type WeekRecord = {
  rows: DayRow[];
  source: string;
};

export type BoardState = {
  selectedWeek: string;
  weeks: Record<string, WeekRecord>;
};

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

// Local calendar date, not UTC, so Monday does not shift for US time zones.
export function formatISODate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseISODate(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

// Sheet weeks run Monday through Friday. Sunday's getDay() is 0, so it steps back six days.
export function mondayOf(date: Date): string {
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const weekday = copy.getDay();
  const daysFromMonday = weekday === 0 ? -6 : 1 - weekday;
  copy.setDate(copy.getDate() + daysFromMonday);
  return formatISODate(copy);
}

export function addDays(iso: string, days: number): string {
  const date = parseISODate(iso);
  date.setDate(date.getDate() + days);
  return formatISODate(date);
}

export function currentMonday(): string {
  return mondayOf(new Date());
}

// Each future week is a saved day for every person. Next week and New week
// stop here so planning cannot run months ahead of today.
export const PLAN_AHEAD_WEEKS = 4;

export function furthestPlannableMonday(today = currentMonday()): string {
  return addDays(today, PLAN_AHEAD_WEEKS * 7);
}

export function isPastPlan(weekId: string, today = currentMonday()): boolean {
  return mondayOf(parseISODate(weekId)) > furthestPlannableMonday(today);
}

export function planAheadMessage(): string {
  return `Love the energy. New weeks stop ${PLAN_AHEAD_WEEKS} weeks from this one, so we don't save a pile of empty days.`;
}

// New week adds the next Monday, or the Monday after the latest saved week
// when that next Monday is already on the board.
export function nextNewWeekId(selectedWeek: string, weekIds: readonly string[]): string {
  const following = addDays(selectedWeek, 7);
  const latest = [...weekIds].sort().at(-1) ?? selectedWeek;
  return weekIds.includes(following) ? addDays(latest, 7) : following;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function shortDate(iso: string): string {
  const date = parseISODate(iso);
  return `${WEEKDAYS[date.getDay()]}, ${MONTHS[date.getMonth()]} ${date.getDate()}`;
}

// Always Monday through Friday, even if a stored id is some other day of that week.
// "This week" is the Monday that contains today's date, not the latest week someone opened.
export function formatWeekLabel(iso: string): string {
  const monday = mondayOf(parseISODate(iso));
  return `${shortDate(monday)} – ${shortDate(addDays(monday, 4))}`;
}

export function formatWeekOption(iso: string, today = currentMonday()): string {
  const label = formatWeekLabel(iso);
  return mondayOf(parseISODate(iso)) === today ? `${label} (This week)` : label;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// Prefix row ids with the Monday so the same person can exist in two weeks
// without AG Grid treating them as one row.
export function withWeekIds(rows: DayRow[], weekId: string): DayRow[] {
  const prefix = `${weekId}-`;
  return rows.map((row) => ({
    ...row,
    id: row.id.startsWith(prefix) ? row.id : `${prefix}${row.id}`,
  }));
}

// A week that has not been imported yet. Same people, empty tasks, no points.
function personSlug(person: { person: string; team: string | null }): string {
  return person.team ? `${slug(person.team)}-${slug(person.person)}` : slug(person.person);
}

export function blankWeek(people: Array<{ person: string; team: string | null }>, weekId: string): DayRow[] {
  return people.flatMap((person) =>
    DAY_NAMES.map((day, index) => ({
      id: `${weekId}-${personSlug(person)}-${index + 1}`,
      person: person.person,
      team: person.team,
      day,
      topLabel: "",
      topDone: false,
      highLabel: "",
      highDone: false,
      med1Label: "",
      med1Done: false,
      med2Label: "",
      med2Done: false,
      lowLabel: "",
      lowDone: false,
      notes: "",
      top5: false,
      exercise: false,
      reading: false,
    })),
  );
}

// True when the roster was copied but nobody has typed a task or checked a box.
export function weekIsEmpty(rows: DayRow[]): boolean {
  return (
    rows.length > 0 &&
    rows.every(
      (row) =>
        !row.topLabel &&
        !row.highLabel &&
        !row.med1Label &&
        !row.med2Label &&
        !row.lowLabel &&
        !row.notes &&
        !row.topDone &&
        !row.highDone &&
        !row.med1Done &&
        !row.med2Done &&
        !row.lowDone &&
        !row.top5 &&
        !row.exercise &&
        !row.reading,
    )
  );
}

// People to copy onto a new blank week. Prefer the week the user is leaving.
export function rosterFrom(
  weeks: Record<string, WeekRecord>,
  preferredWeek: string,
): Array<{ person: string; team: string | null }> {
  const preferred = weeks[preferredWeek]?.rows ?? [];
  if (preferred.length > 0) return peopleInOrder(preferred);
  const ids = Object.keys(weeks).sort().reverse();
  for (const id of ids) {
    if (weeks[id].rows.length > 0) return peopleInOrder(weeks[id].rows);
  }
  return [];
}
