// Week scoring, the path that has already gone wrong.
// A checked box with no words used to count as a finished task, and Top 5
// stayed on after that title was erased. pointsPerTask is 0 until a
// commissioner sets it, so the five boxes decide the 15-point Top 5 bonus
// and do not add points of their own. Exercise and Reading are 5 each and
// are still checked by hand. Five full days is 125.
//
// This file never signs anyone in. A Google account test belongs in
// src/claimRules.test.ts, and the note there is for Kyle.

import { expect, it } from "vitest";
import { dailyPoints, weekPoints, withAutomaticTop5 } from "./points";
import { blankTaskFields, TASK_SLOTS } from "./taskSlots";
import type { DayRow } from "./types";

function day(person: string, weekday: string, patch: Partial<DayRow> = {}): DayRow {
  return {
    id: `${person}-${weekday}`,
    person,
    team: null,
    day: weekday,
    ...blankTaskFields(),
    notes: "",
    top5: false,
    exercise: false,
    reading: false,
    extraChecks: {},
    ...patch,
  };
}

// Writes and checks every slot. The titles are real words, so each one counts.
function finishedDay(person: string, weekday: string, patch: Partial<DayRow> = {}): DayRow {
  const row = day(person, weekday, patch);
  for (const slot of TASK_SLOTS) {
    row[slot.label] = `${weekday} task ${slot.slot}`;
    row[slot.done] = true;
  }
  return row;
}

it("scores a week from written tasks and ignores an empty check", () => {
  // Four written tasks plus a checked blank used to look finished. The blank
  // is cleared, Top 5 stays off, and the day is worth nothing at the default rates.
  const almost = finishedDay("Logan", "Mon");
  almost.lowLabel = "   ";
  almost.top5 = true;
  const cleared = withAutomaticTop5(almost);
  expect(cleared.lowDone).toBe(false);
  expect(cleared.top5).toBe(false);
  expect(dailyPoints(cleared)).toBe(0);

  // Five written, checked tasks turn Top 5 on. The boxes themselves still add 0.
  const monday = withAutomaticTop5(finishedDay("Logan", "Mon"));
  expect(monday.top5).toBe(true);
  expect(dailyPoints(monday)).toBe(15);

  // Exercise and Reading are separate from the task boxes.
  const full = withAutomaticTop5(finishedDay("Logan", "Tue", { exercise: true, reading: true }));
  expect(dailyPoints(full)).toBe(25);

  // The week total is only this person's days. Someone else's Tuesday is not Logan's.
  const rows = [
    monday,
    full,
    withAutomaticTop5(finishedDay("Logan", "Wed", { exercise: true, reading: true })),
    withAutomaticTop5(finishedDay("Logan", "Thu", { exercise: true, reading: true })),
    withAutomaticTop5(finishedDay("Logan", "Fri", { exercise: true, reading: true })),
    withAutomaticTop5(finishedDay("Kevin", "Tue", { exercise: true, reading: true })),
  ];
  expect(weekPoints(rows, "Logan")).toBe(15 + 25 * 4);
  expect(weekPoints(rows, "Kevin")).toBe(25);

  // Five days with Top 5, Exercise, and Reading is the 125 ceiling.
  const fullWeek = ["Mon", "Tue", "Wed", "Thu", "Fri"].map((weekday) =>
    withAutomaticTop5(finishedDay("Logan", weekday, { exercise: true, reading: true })),
  );
  expect(weekPoints(fullWeek, "Logan")).toBe(125);
});
