// Builds downloadable CSV files for a season's final standings and daily rows.
// Used by SeasonCard (any selected season) and PastSeasons (closed seasons).

import { shownName } from "./names";
import { dailyPoints, DAY_NAMES, type ScoreRates } from "./points";
import type { LoadedBoard } from "./remoteBoard";
import { seasonBoard, seasonBounds } from "./streaks";
import { taskPlainText } from "./taskMarkup";
import { TASK_SLOTS } from "./taskSlots";
import { addDays, formatISODate } from "./weeks";

function csvCell(value: string | number | boolean): string {
  const raw = String(value);
  if (/[",\r\n]/.test(raw)) return `"${raw.replace(/"/g, '""')}"`;
  return raw;
}

function csvLine(cells: Array<string | number | boolean>): string {
  return cells.map(csvCell).join(",");
}

function ratesFromArchive(archive: LoadedBoard): ScoreRates {
  return { ...archive.bonusPoints, pointsPerTask: archive.pointsPerTask };
}

function slugFile(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "season"
  );
}

// One row per roster member, ranked by season total. Uses the season's end date
// once finished so closed seasons always export final completed standings.
export function buildStandingsCsv(archive: LoadedBoard, today = formatISODate(new Date())): string {
  const rates = ratesFromArchive(archive);
  const bounds = seasonBounds(archive.season);
  const cutoff = today > bounds.endsOn ? bounds.endsOn : today;
  const ranked = seasonBoard(archive.weeks, cutoff, rates, archive.season, archive.roster, archive.milestones);
  const header = [
    "Rank",
    "Name",
    "Nickname",
    "Team",
    "Weekly points",
    "Streak bonus",
    "Season total",
    "Current streak",
    "Longest streak",
    "Last active",
  ];
  let place = 1;
  const lines = [csvLine(header)];
  ranked.forEach((person, index) => {
    if (index > 0 && person.seasonTotal < ranked[index - 1].seasonTotal) place = index + 1;
    const nickname = archive.nicknames[person.person]?.trim() ?? "";
    lines.push(
      csvLine([
        place,
        person.person,
        nickname,
        person.team ?? "",
        person.weeklyPoints,
        person.streakBonus,
        person.seasonTotal,
        person.currentStreak,
        person.longestStreak,
        person.lastActive,
      ]),
    );
  });
  return `${lines.join("\r\n")}\r\n`;
}

// One row per saved person-day inside the season window (for backups or audits).
export function buildDaysCsv(archive: LoadedBoard): string {
  const rates = ratesFromArchive(archive);
  const bounds = seasonBounds(archive.season);
  const active = new Set(archive.roster.map((person) => person.person));
  const extras = archive.bonusPoints.extras;

  const header: string[] = ["Week Monday", "Date", "Day", "Person", "Nickname", "Team"];
  for (const slot of TASK_SLOTS) {
    header.push(`Task ${slot.slot} done`, `Task ${slot.slot}`);
  }
  header.push("Notes", rates.top5Name, rates.exerciseName, rates.readingName);
  for (const extra of extras) header.push(extra.name);
  header.push("Daily points");

  const lines = [csvLine(header)];
  const weekIds = Object.keys(archive.weeks).sort();
  for (const weekId of weekIds) {
    for (const row of archive.weeks[weekId]?.rows ?? []) {
      const offset = DAY_NAMES.indexOf(row.day as (typeof DAY_NAMES)[number]);
      if (offset < 0) continue;
      const date = addDays(weekId, offset);
      if (date < bounds.startsOn || date > bounds.endsOn) continue;
      if (!active.has(row.person)) continue;
      const cells: Array<string | number | boolean> = [
        weekId,
        date,
        row.day,
        row.person,
        shownName(row.person, archive.nicknames) === row.person ? "" : archive.nicknames[row.person] ?? "",
        row.team ?? "",
      ];
      for (const slot of TASK_SLOTS) {
        cells.push(Boolean(row[slot.done]), taskPlainText(String(row[slot.label] ?? "")));
      }
      cells.push(row.notes, row.top5, row.exercise, row.reading);
      for (const extra of extras) cells.push(Boolean(row.extraChecks?.[extra.key]?.checked));
      cells.push(dailyPoints(row, rates));
      lines.push(csvLine(cells));
    }
  }
  return `${lines.join("\r\n")}\r\n`;
}

export function downloadCsv(seasonName: string, kind: "standings" | "days", content: string): void {
  const blob = new Blob([`\uFEFF${content}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${slugFile(seasonName)}-${kind}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
