// Placeholders for one person's current week.
// The old sample CSV filled the whole roster. This does not. A signed-in person
// can only write their own days, and Load sample is meant to be a starting
// list, not a replacement for work they already typed.
// Score boxes stay as they are. Top 5, Exercise, and Reading are the only
// boxes that add points, so sample text must not check them.

import { DAY_NAMES } from "./points";
import { SLOT_COUNT, TASK_SLOTS } from "./taskSlots";
import type { DayRow } from "./types";
import { blankWeek } from "./weeks";

function sampleDay<T extends readonly string[]>(samples: T & { length: typeof SLOT_COUNT }): T {
  return samples;
}

const SAMPLE_BY_DAY: Record<(typeof DAY_NAMES)[number], ReturnType<typeof sampleDay>> = {
  Mon: sampleDay(["Plan the week", "Clear the inbox", "Team check-in", "Send a follow-up", "Tidy notes"]),
  Tue: sampleDay(["Deep work block", "Review priorities", "Reply to messages", "Prep tomorrow", "File a receipt"]),
  Wed: sampleDay(["Finish the top task", "Status update", "Read one chapter", "Schedule a meeting", "Desk reset"]),
  Thu: sampleDay(["Ship a small win", "Unblock someone", "Review the board", "Write a note", "Stretch break"]),
  Fri: sampleDay(["Close the week", "Share progress", "Plan Monday", "Inbox pass", "Note a win"]),
};

function hasWrittenTask(row: DayRow, field: (typeof TASK_SLOTS)[number]["label"]): boolean {
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
    TASK_SLOTS.forEach((slot, index) => {
      if (hasWrittenTask(next, slot.label)) return;
      next[slot.label] = samples[index];
      filled += 1;
      dayChanged = true;
    });
    if (dayChanged) changed.push(next);
    return next;
  });
  return { rows, changed, filled };
}
