// Placeholders for one person's current week.
// The old sample CSV filled the whole roster. This does not. A signed-in person
// can only write their own days, and Load sample is meant to be a starting
// list, not a replacement for work they already typed.
// Score boxes stay as they are. Top 5, Exercise, and Reading are the only
// boxes that add points, so sample text must not check them.

import type { DayRow } from "./types";
import { blankWeek } from "./weeks";
import { DAY_NAMES } from "./points";

const SAMPLE_BY_DAY: Record<(typeof DAY_NAMES)[number], readonly [string, string, string, string, string]> = {
  Mon: ["Plan the week", "Clear the inbox", "Team check-in", "Send a follow-up", "Tidy notes"],
  Tue: ["Deep work block", "Review priorities", "Reply to messages", "Prep tomorrow", "File a receipt"],
  Wed: ["Finish the top task", "Status update", "Read one chapter", "Schedule a meeting", "Desk reset"],
  Thu: ["Ship a small win", "Unblock someone", "Review the board", "Write a note", "Stretch break"],
  Fri: ["Close the week", "Share progress", "Plan Monday", "Inbox pass", "Note a win"],
};

const LABEL_FIELDS = ["topLabel", "highLabel", "med1Label", "med2Label", "lowLabel"] as const;

function hasWrittenTask(row: DayRow, field: (typeof LABEL_FIELDS)[number]): boolean {
  return row[field].trim().length > 0;
}

// Every priority slot on Monday through Friday is checked on its own.
// A title that is already written, on any day, stays exactly as it is.
// Only a blank slot receives a sample title. Checkboxes, notes, and point
// boxes are copied through and never replaced.
export function fillBlankSampleTasks(
  person: string,
  team: string | null,
  weekId: string,
  existing: DayRow[],
): { rows: DayRow[]; changed: DayRow[]; filled: number } {
  const byDay = new Map(existing.filter((row) => row.person === person).map((row) => [row.day, row]));
  let filled = 0;
  const changed: DayRow[] = [];
  const rows = blankWeek([{ person, team }], weekId).map((blank) => {
    const current = byDay.get(blank.day) ?? blank;
    const next: DayRow = { ...current };
    const samples = SAMPLE_BY_DAY[blank.day as (typeof DAY_NAMES)[number]];
    if (!samples) return next;
    let dayChanged = false;
    LABEL_FIELDS.forEach((field, index) => {
      if (hasWrittenTask(next, field)) return;
      next[field] = samples[index];
      filled += 1;
      dayChanged = true;
    });
    if (dayChanged) changed.push(next);
    return next;
  });
  return { rows, changed, filled };
}
