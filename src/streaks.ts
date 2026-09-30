// Season totals and streaks, computed from saved weekdays.
// A streak is consecutive weekdays with points. Saturday and Sunday are skipped.
// Today stays open until it has points, so a Wednesday morning does not wipe Tuesday's streak.
//
// Milestone points are the ones visible on the streak sheet. Each new run can earn them again.
// The sheet screenshot stops at day 25. A longer run keeps counting, and the next milestone stays blank.

import { DAY_NAMES, dailyPoints, personKey } from "./points";
import { addDays, currentMonday, formatISODate, formatWeekLabel, parseISODate, type WeekRecord } from "./weeks";

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
  weeklyPoints: number;
  streakBonus: number;
  seasonTotal: number;
  currentStreak: number;
  longestStreak: number;
  nextMilestone: string;
  milestoneLog: string;
  lastActive: string;
};

export type WeekWinner = { weekId: string; label: string; names: string; points: number; current: boolean };

function sheetDate(iso: string): string {
  const date = parseISODate(iso);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${month}/${day}/${date.getFullYear()}`;
}

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

function nextMilestoneLabel(current: number): string {
  const next = STREAK_MILESTONES.find((milestone) => milestone.day > current);
  return next ? `Day ${next.day} (+${next.points} pts)` : "—";
}

type DatedPoints = { date: string; points: number };

function datedPoints(weeks: Record<string, WeekRecord>): Map<string, { person: string; team: string | null; days: DatedPoints[] }> {
  const people = new Map<string, { person: string; team: string | null; days: DatedPoints[] }>();
  const weekIds = Object.keys(weeks).sort();
  for (const weekId of weekIds) {
    for (const row of weeks[weekId]?.rows ?? []) {
      const offset = DAY_NAMES.indexOf(row.day as (typeof DAY_NAMES)[number]);
      if (offset < 0) continue;
      const key = personKey(row);
      const record = people.get(key) ?? { person: row.person, team: row.team, days: [] };
      record.days.push({ date: addDays(weekId, offset), points: dailyPoints(row) });
      people.set(key, record);
    }
  }
  return people;
}

function summarize(days: DatedPoints[], today: string): Omit<PersonSeason, "key" | "person" | "team"> {
  const end = streakEnd(today);
  const scored = new Set(days.filter((day) => day.points > 0 && day.date <= end).map((day) => day.date));
  const weeklyPoints = days.reduce((sum, day) => (day.date <= today ? sum + day.points : sum), 0);
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

  const lastActive = days
    .map((day) => day.date)
    .filter((date) => date <= today)
    .sort()
    .at(-1);

  return {
    weeklyPoints,
    streakBonus: awards.reduce((sum, award) => sum + award.points, 0),
    seasonTotal: weeklyPoints + awards.reduce((sum, award) => sum + award.points, 0),
    currentStreak: current,
    longestStreak: longest,
    nextMilestone: nextMilestoneLabel(current),
    milestoneLog: awards.length === 0 ? "—" : awards.map((award) => `Day ${award.day}: +${award.points} pts (${sheetDate(award.date)})`).join(" | "),
    lastActive: lastActive ? sheetDate(lastActive) : "—",
  };
}

export function seasonBoard(weeks: Record<string, WeekRecord>, today = todayISO()): PersonSeason[] {
  return [...datedPoints(weeks).entries()]
    .map(([key, record]) => ({ key, person: record.person, team: record.team, ...summarize(record.days, today) }))
    .sort((a, b) => b.seasonTotal - a.seasonTotal || a.person.localeCompare(b.person));
}

export function weekWinners(weeks: Record<string, WeekRecord>, today = todayISO()): WeekWinner[] {
  const currentWeek = currentMonday();
  return Object.keys(weeks)
    .filter((weekId) => weekId <= currentWeek)
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
        current.points += dailyPoints(row);
        totals.set(key, current);
      }
      const ranked = [...totals.values()].sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
      const top = ranked[0]?.points ?? 0;
      const names = ranked.filter((person) => person.points === top).map((person) => person.name);
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

export function streakTone(length: number): string {
  if (length >= 21) return "streak-gold";
  if (length >= 7) return "streak-green";
  if (length >= 3) return "streak-blue";
  return "";
}

export function currentWeekLeader(weeks: Record<string, WeekRecord>, today = todayISO()): { label: string; detail: string } {
  const weekId = currentMonday();
  const winner = weekWinners({ [weekId]: weeks[weekId] ?? { rows: [], source: "" } }, today)[0];
  return {
    label: `This week · ${formatWeekLabel(weekId)}`,
    detail: winner && winner.points > 0 ? `${winner.names} — ${winner.points} pts` : "No points yet",
  };
}
