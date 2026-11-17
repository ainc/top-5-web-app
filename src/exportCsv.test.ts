// Season CSV export formatting, quoting, and roster filtering.

import { expect, it } from "vitest";
import { buildDaysCsv, buildStandingsCsv } from "./exportCsv";
import type { LoadedBoard } from "./remoteBoard";
import { DEFAULT_STREAK_MILESTONES } from "./streaks";
import { blankTaskFields } from "./taskSlots";
import type { DayRow } from "./types";

function makeRow(person: string, team: string | null, day: string, notes = "", done = false): DayRow {
  return {
    id: `2026-10-12-${person}-${day}`,
    person,
    team,
    day,
    ...blankTaskFields(),
    topLabel: done ? "Ship report" : "",
    topDone: done,
    highLabel: done ? "Inbox" : "",
    highDone: done,
    med1Label: done ? "Review" : "",
    med1Done: done,
    med2Label: done ? "Sync" : "",
    med2Done: done,
    lowLabel: done ? "Notes" : "",
    lowDone: done,
    notes,
    top5: done,
    exercise: done,
    reading: false,
    extraChecks: {},
  };
}

it("exports ranked standings and escaped daily rows for active roster members", () => {
  const archive: LoadedBoard = {
    weeks: {
      "2026-10-12": {
        source: "Supabase",
        rows: [
          makeRow("Logan", "Awesomes", "Mon", 'Quoted "note", with comma', true),
          makeRow("Ben Starling", null, "Mon", "Removed member", true),
        ],
      },
    },
    roster: [{ person: "Logan", team: "Awesomes" }],
    migratedFromBrowser: false,
    empty: false,
    scoringMode: "teams",
    pointsPerTask: 0,
    bonusPoints: {
      top5: 15,
      exercise: 5,
      reading: 5,
      top5Name: "Top 5 complete",
      exerciseName: "Exercise",
      readingName: "Reading",
      extras: [],
    },
    milestones: [...DEFAULT_STREAK_MILESTONES],
    season: { name: "Q4 2026", startsOn: "2026-10-12", lengthWeeks: 8 },
    nicknames: { Logan: "Bigdog" },
  };

  const standings = buildStandingsCsv(archive, "2026-10-12");
  expect(standings).toContain("1,Logan,Bigdog,Awesomes,20,0,20,1,1,2026-10-12");
  expect(standings).not.toContain("Ben Starling");

  const days = buildDaysCsv(archive);
  expect(days).toContain('"Quoted ""note"", with comma"');
  expect(days).toContain("2026-10-12,2026-10-12,Mon,Logan,Bigdog,Awesomes,true,Ship report");
  expect(days).not.toContain("Ben Starling");
});
