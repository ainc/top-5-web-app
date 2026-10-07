// Column layout for the task grid. Group, person, and day stay pinned
// so the scoring checkboxes remain reachable while scrolling sideways.

import { themeQuartz, type ColDef } from "ag-grid-community";
import { BoolCell, TaskCell } from "./cells";
import { DEFAULT_RATES, type ScoreRates } from "./points";
import type { GridRow } from "./types";

const gridBase = {
  fontFamily: '"Segoe UI", sans-serif',
  headerFontWeight: 650,
  fontSize: 13,
  cellHorizontalPadding: 10,
} as const;

export const gridTheme = themeQuartz.withParams({
  ...gridBase,
  headerBackgroundColor: "#f3d6d8",
  headerTextColor: "#3f1d24",
  backgroundColor: "#fffdfb",
  foregroundColor: "#1c1917",
  oddRowBackgroundColor: "#fbf7f4",
  accentColor: "#9f1239",
  borderColor: "#eadfd6",
});

// AG Grid paints its own colors, so the page stylesheet cannot restyle a cell.
// Dark mode swaps this theme when the header toggle changes.
export const darkGridTheme = themeQuartz.withParams({
  ...gridBase,
  browserColorScheme: "dark",
  headerBackgroundColor: "#4a2430",
  headerTextColor: "#ffe4e6",
  backgroundColor: "#221a1d",
  foregroundColor: "#f6f1ea",
  oddRowBackgroundColor: "#2a2024",
  accentColor: "#fb7185",
  borderColor: "#4c3e43",
});

// The value joins done + label so AG Grid refreshes the cell when either one changes.
function taskColumn(
  headerName: string,
  doneField: "topDone" | "highDone" | "med1Done" | "med2Done" | "lowDone",
  labelField: "topLabel" | "highLabel" | "med1Label" | "med2Label" | "lowLabel",
): ColDef<GridRow> {
  return {
    colId: labelField,
    headerName,
    minWidth: 190,
    flex: 1,
    valueGetter: (params) => {
      const row = params.data;
      if (!row) return "";
      return `${row[doneField] ? "1" : "0"}:${row[labelField]}`;
    },
    tooltipValueGetter: (params) => params.data?.[labelField] ?? "",
    cellRenderer: TaskCell,
    cellRendererParams: { doneField, labelField },
    comparator: (_a, _b, nodeA, nodeB) =>
      (nodeA.data?.[labelField] ?? "").localeCompare(nodeB.data?.[labelField] ?? ""),
  };
}

function scoreColumn(field: "top5" | "exercise" | "reading", headerName: string): ColDef<GridRow> {
  return {
    field,
    headerName,
    width: 118,
    cellRenderer: BoolCell,
    sortable: false,
  };
}

// showWeek is on for the dashboard detail grid and off for My week,
// where the big total already sits above the grid.
// showGroup is on only when this season scores teams.
// showPerson is off when the name is already a heading above the grid.
// showDay is off when each weekday is already its own card.
export function buildColumns(
  showWeek: boolean,
  showGroup: boolean,
  rates: ScoreRates = DEFAULT_RATES,
  showPerson = true,
  showDay = true,
): ColDef<GridRow>[] {
  const columns: ColDef<GridRow>[] = [];
  if (showGroup) {
    columns.push({ field: "team", headerName: "Team", width: 140, pinned: "left" });
  }
  if (showPerson) {
    columns.push({ field: "person", headerName: "Person", width: 140, pinned: "left" });
  }
  if (showDay) {
    columns.push({ field: "day", headerName: "Day", width: 84, pinned: "left" });
  }
  columns.push(
    taskColumn("Top priority", "topDone", "topLabel"),
    taskColumn("High priority", "highDone", "highLabel"),
    taskColumn("Medium", "med1Done", "med1Label"),
    taskColumn("Medium 2", "med2Done", "med2Label"),
    taskColumn("Low priority", "lowDone", "lowLabel"),
    { field: "notes", headerName: "Notes", minWidth: 140, flex: 0.6, editable: (params) => params.context.canEdit },
    scoreColumn("top5", `Top 5 (${rates.top5})`),
    scoreColumn("exercise", `Exercise (${rates.exercise})`),
    scoreColumn("reading", `Reading (${rates.reading})`),
    // rightAligned's cell class is dropped when cellClass is set, which left
    // "Daily" on the right of the header and the number on the left of the cell.
    {
      field: "daily",
      headerName: "Daily",
      width: 90,
      headerClass: "points-header",
      cellClass: "points-cell",
    },
  );

  if (showWeek) {
    columns.push({
      field: "week",
      headerName: "Week",
      width: 90,
      headerClass: "points-header",
      cellClass: "points-cell week-cell",
    });
  }

  return columns;
}
