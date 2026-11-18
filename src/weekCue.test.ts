// Sidebar week encouragement never shows "Down X from last week" when a
// week is below the prior week's total.

import { expect, it } from "vitest";
import { AWESOME_INC_CUES, weekEncouragement } from "./weekCue";

it("shows gains positively and rotates Awesome Inc cues instead of 'Down from last week'", () => {
  expect(
    weekEncouragement({
      total: 40,
      priorExists: true,
      priorPoints: 25,
      selectedWeek: "2026-11-16",
      personKey: "Awesomes|Cam",
    }),
  ).toEqual({ text: "Up 15 from last week", tone: "up" });

  expect(
    weekEncouragement({
      total: 25,
      priorExists: true,
      priorPoints: 25,
      selectedWeek: "2026-11-16",
      personKey: "Awesomes|Cam",
    }),
  ).toEqual({ text: "Matched last week", tone: "up" });

  const behind = weekEncouragement({
    total: 25,
    priorExists: true,
    priorPoints: 100,
    selectedWeek: "2026-11-16",
    personKey: "Awesomes|Cam",
  });
  expect(behind.tone).toBe("cue");
  expect(behind.text).not.toMatch(/down/i);
  expect(AWESOME_INC_CUES).toContain(behind.text);

  // Deterministic for a given week and person so checking a task does not flicker.
  expect(
    weekEncouragement({
      total: 30,
      priorExists: true,
      priorPoints: 100,
      selectedWeek: "2026-11-16",
      personKey: "Awesomes|Cam",
    }),
  ).toEqual(behind);
});
