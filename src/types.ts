// Shared shapes for one person-day.
// Points are not stored on DayRow. GridRow adds daily and week when the grid renders.

export type Team = "ACES" | "Alpha" | "Awesomes";

// A single weekday for one person. The five priority slots are the task list.
// top5, exercise, and reading are the only boxes that add points.
export type DayRow = {
  id: string;
  person: string;
  team: Team;
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
};

// DayRow plus the numbers the grid displays. Those numbers are derived, not saved.
export type GridRow = DayRow & {
  daily: number;
  week: number;
};
