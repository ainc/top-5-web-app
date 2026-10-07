// Shared shapes for one person-day.
// Points are not stored on DayRow. GridRow adds daily and week when the grid renders.

// A single weekday for one person. The five priority slots are the task list.
// top5, exercise, and reading are always on the day. extraChecks holds any
// bonus a commissioner added. A removed bonus can still be here so a day that
// already earned it keeps those points.
// team is null while the season scores individuals. A commissioner can assign one later.
export type DayRow = {
  id: string;
  person: string;
  team: string | null;
  day: string;
  topLabel: string;
  topDone: boolean;
  highLabel: string;
  highDone: boolean;
  med1Label: string;
  med1Done: boolean;
  med2Label: string;
  med2Done: boolean;
  lowLabel: string;
  lowDone: boolean;
  notes: string;
  top5: boolean;
  exercise: boolean;
  reading: boolean;
  // Points copied onto the check when it was saved. Missing means "use today's bonus value".
  top5Awarded?: number;
  exerciseAwarded?: number;
  readingAwarded?: number;
  extraChecks: Record<string, { checked: boolean; awarded?: number }>;
};

// DayRow plus the numbers the grid displays. Those numbers are derived, not saved.
export type GridRow = DayRow & {
  daily: number;
  week: number;
};
