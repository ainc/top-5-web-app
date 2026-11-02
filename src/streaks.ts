// Season totals and streaks, computed from saved weekdays.
// A streak is consecutive weekdays with points. Saturday and Sunday are skipped.
// Today stays open until it has points, so a Wednesday morning does not wipe Tuesday's streak.
//
// Milestone points are the ones visible on the streak sheet. Each new run can earn them again.
// The sheet screenshot stops at day 25. A longer run keeps counting. There is no
// milestone after 25, so the personal cue on My week stays blank past that day.
//
// The shared tracker used to print three private columns for every person:
// the next milestone (the same "Day N" sentence on every short streak), a
// pipe-joined log, and last active. Last active was the latest saved row,
// and a blank Monday is saved for the whole roster, so the column read as
// today for people who had not scored. It is now the latest weekday with
// points. The next milestone is a countdown, and only My week shows it, and
// only for the signed-in person. The log is the award list on that person's
// detail, not a cell in the shared table.

import { shownName } from "./names";
import { DAY_NAMES, dailyPoints, DEFAULT_RATES, personKey, type ScoreRates } from "./points";
import { addDays, currentMonday, formatISODate, formatWeekLabel, mondayOf, parseISODate, type WeekRecord } from "./weeks";

export const STREAK_MILESTONES = [
  { day: 3, points: 5 },
  { day: 5, points: 5 },
  { day: 8, points: 5 },
  { day: 10, points: 10 },
  { day: 15, points: 20 },
  { day: 20, points: 25 },
  { day: 25, points: 25 },
] as const;

export type StreakAward = { day: number; points: number; date: string };

export type PersonSeason = {
  key: string;
  person: string;
  team: string | null;
  earlierWeeks: number;
  thisWeek: number;
  weeklyPoints: number;
  streakBonus: number;
  seasonTotal: number;
  currentStreak: number;
  longestStreak: number;
  // Each hit on the current season's runs, in the order they were earned.
  // The detail view reads this. The shared table does not.
  awards: StreakAward[];
  // ISO date of the latest weekday with points, or "" when this season has none.
  lastActive: string;
};

export type WeekWinner = { weekId: string; label: string; names: string; points: number; current: boolean };

function todayISO(): string {
  return formatISODate(new Date());
}

// The weekday the streak is allowed to end on. A weekend uses the Friday just past.
function streakEnd(today: string): string {
  const date = parseISODate(today);
  const weekday = date.getDay();
  if (weekday === 6) return addDays(today, -1);
  if (weekday === 0) return addDays(today, -2);
  return today;
}

function milestoneFor(length: number): (typeof STREAK_MILESTONES)[number] | undefined {
  return STREAK_MILESTONES.find((milestone) => milestone.day === length);
}

// "1 more day for +5". Empty once the run is past the last milestone on the
// sheet. My week is the only place that prints this, and only for the person
// who is signed in. The leaderboard used to repeat it on every row.
export function streakCue(current: number): string {
  const next = STREAK_MILESTONES.find((milestone) => milestone.day > current);
  if (!next) return "";
  const left = next.day - current;
  return `${left} more ${left === 1 ? "day" : "days"} for +${next.points}`;
}

// One mark, not a color per band. 7 and 21 are the lengths worth a badge.
// A run that has passed 7 and not yet reached 21 keeps the 7 badge. Under 7
// the cell is only the number.
export function streakBadge(length: number): 7 | 21 | null {
  if (length >= 21) return 21;
  if (length >= 7) return 7;
  return null;
}

type DatedPoints = { date: string; points: number };

function datedPoints(
  weeks: Record<string, WeekRecord>,
  rates: ScoreRates,
): Map<string, { person: string; team: string | null; days: DatedPoints[] }> {
  const people = new Map<string, { person: string; team: string | null; days: DatedPoints[] }>();
  const weekIds = Object.keys(weeks).sort();
  for (const weekId of weekIds) {
    for (const row of weeks[weekId]?.rows ?? []) {
      const offset = DAY_NAMES.indexOf(row.day as (typeof DAY_NAMES)[number]);
      if (offset < 0) continue;
      const key = personKey(row);
      const record = people.get(key) ?? { person: row.person, team: row.team, days: [] };
      record.days.push({ date: addDays(weekId, offset), points: dailyPoints(row, rates) });
      people.set(key, record);
    }
  }
  return people;
}

export type SeasonSpan = { name: string; startsOn: string; lengthWeeks: number };

export function seasonProgress(
  span: SeasonSpan,
  today = todayISO(),
): { week: number; weeks: number; percent: number; finished: boolean } {
  const bounds = seasonBounds(span);
  const weeks = span.lengthWeeks;
  if (today < bounds.startsOn) return { week: 0, weeks, percent: 0, finished: false };
  if (today > bounds.endsOn) return { week: weeks, weeks, percent: 100, finished: true };
  const start = mondayOf(parseISODate(bounds.startsOn));
  const current = mondayOf(parseISODate(today));
  const [y1, m1, d1] = start.split("-").map(Number);
  const [y2, m2, d2] = current.split("-").map(Number);
  const days = Math.round((new Date(y2, m2 - 1, d2).getTime() - new Date(y1, m1 - 1, d1).getTime()) / 86_400_000);
  const week = Math.min(weeks, Math.floor(days / 7) + 1);
  return { week, weeks, percent: Math.round((week / weeks) * 100), finished: false };
}

// The open season is a run of Monday–Friday weeks. Imported history stays
// outside this window, so it can be opened from the week menu without
// changing the current season total or streak.
export function seasonBounds(span: SeasonSpan): { startsOn: string; endsOn: string } {
  const start = mondayOf(parseISODate(span.startsOn));
  const lastMonday = addDays(start, (span.lengthWeeks - 1) * 7);
  return { startsOn: start, endsOn: addDays(lastMonday, 4) };
}

function inSpan(date: string, bounds: { startsOn: string; endsOn: string } | null): boolean {
  if (!bounds) return true;
  return date >= bounds.startsOn && date <= bounds.endsOn;
}

function summarize(
  days: DatedPoints[],
  today: string,
  bounds: { startsOn: string; endsOn: string } | null = null,
): Omit<PersonSeason, "key" | "person" | "team"> {
  const counted = days.filter((day) => inSpan(day.date, bounds));
  const endLimit = bounds ? (streakEnd(today) < bounds.endsOn ? streakEnd(today) : bounds.endsOn) : streakEnd(today);
  const end = bounds && endLimit < bounds.startsOn ? bounds.startsOn : endLimit;
  const scored = new Set(counted.filter((day) => day.points > 0 && day.date <= end).map((day) => day.date));
  // Earlier weeks and this week are the README split. Season total also adds
  // the streak bonus, which is how the sheet's season leaderboard adds up.
  const thisMonday = currentMonday();
  let earlierWeeks = 0;
  let thisWeek = 0;
  for (const day of counted) {
    if (day.date > today) continue;
    if (mondayOf(parseISODate(day.date)) === thisMonday) thisWeek += day.points;
    else earlierWeeks += day.points;
  }
  const weeklyPoints = earlierWeeks + thisWeek;
  const first = [...scored].sort()[0];
  const awards: StreakAward[] = [];
  let run = 0;
  let longest = 0;
  let current = 0;

  if (first) {
    for (let date = first; date <= end; date = addDays(date, 1)) {
      const weekday = parseISODate(date).getDay();
      if (weekday === 0 || weekday === 6) continue;
      const stillOpen = date === end && date === today && !scored.has(date);
      if (stillOpen) {
        current = run;
        break;
      }
      if (scored.has(date)) {
        run += 1;
        longest = Math.max(longest, run);
        const hit = milestoneFor(run);
        if (hit) awards.push({ day: hit.day, points: hit.points, date });
      } else {
        run = 0;
      }
      current = run;
    }
  }

  // Points only. An empty day row exists so the week grid can render, and
  // counting it made last active "today" for every person on the roster.
  const lastActive =
    counted
      .filter((day) => day.points > 0 && day.date <= today)
      .map((day) => day.date)
      .sort()
      .at(-1) ?? "";

  return {
    earlierWeeks,
    thisWeek,
    weeklyPoints,
    streakBonus: awards.reduce((sum, award) => sum + award.points, 0),
    seasonTotal: weeklyPoints + awards.reduce((sum, award) => sum + award.points, 0),
    currentStreak: current,
    longestStreak: longest,
    awards,
    lastActive,
  };
}

export function seasonBoard(
  weeks: Record<string, WeekRecord>,
  today = todayISO(),
  rates: ScoreRates = DEFAULT_RATES,
  span?: SeasonSpan,
): PersonSeason[] {
  const bounds = span ? seasonBounds(span) : null;
  return [...datedPoints(weeks, rates).entries()]
    .map(([key, record]) => {
      const summary = summarize(record.days, today, bounds);
      const counted = record.days.some((day) => inSpan(day.date, bounds));
      if (!counted) return null;
      return { key, person: record.person, team: record.team, ...summary };
    })
    .filter((person): person is PersonSeason => person !== null)
    .sort((a, b) => b.seasonTotal - a.seasonTotal || a.person.localeCompare(b.person));
}

export function weekWinners(
  weeks: Record<string, WeekRecord>,
  today = todayISO(),
  rates: ScoreRates = DEFAULT_RATES,
  span?: SeasonSpan,
  nicknames: Record<string, string> = {},
): WeekWinner[] {
  const currentWeek = currentMonday();
  const bounds = span ? seasonBounds(span) : null;
  return Object.keys(weeks)
    .filter((weekId) => weekId <= currentWeek && inSpan(weekId, bounds))
    .sort()
    .reverse()
    .map((weekId) => {
      const totals = new Map<string, { name: string; points: number }>();
      for (const row of weeks[weekId]?.rows ?? []) {
        const offset = DAY_NAMES.indexOf(row.day as (typeof DAY_NAMES)[number]);
        if (offset < 0) continue;
        const date = addDays(weekId, offset);
        if (date > today) continue;
        const key = personKey(row);
        const current = totals.get(key) ?? { name: row.person, points: 0 };
        current.points += dailyPoints(row, rates);
        totals.set(key, current);
      }
      const ranked = [...totals.values()].sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
      const top = ranked[0]?.points ?? 0;
      const names = ranked.filter((person) => person.points === top).map((person) => shownName(person.name, nicknames));
      return {
        weekId,
        label: formatWeekLabel(weekId),
        names: names.join(", ") || "—",
        points: top,
        current: weekId === currentWeek,
      };
    })
    .filter((week) => week.current || week.points > 0);
}

export type TeamStanding = { team: string; thisWeek: number; seasonTotal: number };

// Team rows exist only in a team season. Someone with no team is still a
// score, so they add up under Unassigned instead of disappearing. The row is
// omitted when every person already has a team.
export function teamStandings(people: PersonSeason[]): TeamStanding[] {
  const teams = new Map<string, TeamStanding>();
  let unassigned = false;
  for (const person of people) {
    const name = person.team?.trim() || "";
    if (!name) unassigned = true;
    const label = name || "Unassigned";
    const row = teams.get(label) ?? { team: label, thisWeek: 0, seasonTotal: 0 };
    row.thisWeek += person.thisWeek;
    row.seasonTotal += person.seasonTotal;
    teams.set(label, row);
  }
  if (!unassigned) teams.delete("Unassigned");
  return [...teams.values()].sort((a, b) => b.seasonTotal - a.seasonTotal || a.team.localeCompare(b.team));
}

export function currentWeekLeader(
  weeks: Record<string, WeekRecord>,
  today = todayISO(),
  rates: ScoreRates = DEFAULT_RATES,
  nicknames: Record<string, string> = {},
): { label: string; detail: string } {
  const weekId = currentMonday();
  const winner = weekWinners({ [weekId]: weeks[weekId] ?? { rows: [], source: "" } }, today, rates, undefined, nicknames)[0];
  return {
    label: `This week · ${formatWeekLabel(weekId)}`,
    detail: winner && winner.points > 0 ? `${winner.names} — ${winner.points} pts` : "No points yet",
  };
}
