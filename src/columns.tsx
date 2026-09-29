// Column layout for the task grid. Group, person, and day stay pinned
// so the scoring checkboxes remain reachable while scrolling sideways.

import { themeQuartz, type ColDef } from "ag-grid-community";
import { BoolCell, TaskCell } from "./cells";
import type { GridRow, Team } from "./types";

export const gridTheme = themeQuartz.withParams({
  fontFamily: '"Segoe UI", sans-serif',
  headerBackgroundColor: "#f3d6d8",
  headerTextColor: "#3f1d24",
  backgroundColor: "#fffdfb",
  foregroundColor: "#1c1917",
  oddRowBackgroundColor: "#fbf7f4",
  accentColor: "#9f1239",
  borderColor: "#eadfd6",
  headerFontWeight: 650,
  fontSize: 13,
  cellHorizontalPadding: 10,
});

const teamColor: Record<Team, string> = {
  ACES: "#6d28d9",
  Alpha: "#0f766e",
  Awesomes: "#9f1239",
};

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
export function buildColumns(showWeek: boolean): ColDef<GridRow>[] {
  const columns: ColDef<GridRow>[] = [
    {
      field: "team",
      headerName: "Group",
      width: 120,
      pinned: "left",
      cellStyle: (params) => {
        const team = params.value as Team | undefined;
        return {
          color: team ? teamColor[team] : "#1c1917",
          fontWeight: 700,
        };
      },
    },
    { field: "person", headerName: "Person", width: 120, pinned: "left" },
    { field: "day", headerName: "Day", width: 84, pinned: "left" },
    taskColumn("Top priority", "topDone", "topLabel"),
    taskColumn("High priority", "highDone", "highLabel"),
    taskColumn("Medium", "med1Done", "med1Label"),
    taskColumn("Medium 2", "med2Done", "med2Label"),
    taskColumn("Low priority", "lowDone", "lowLabel"),
    { field: "notes", headerName: "Notes", minWidth: 140, flex: 0.6, editable: (params) => params.context.canEdit },
    scoreColumn("top5", "Top 5 (15)"),
    scoreColumn("exercise", "Exercise (5)"),
    scoreColumn("reading", "Reading (5)"),
    {
      field: "daily",
      headerName: "Daily",
      width: 90,
      type: "rightAligned",
      cellClass: "points-cell",
    },
  ];

  if (showWeek) {
    columns.push({
      field: "week",
      headerName: "Week",
      width: 90,
      type: "rightAligned",
      cellClass: "points-cell week-cell",
    });
  }

  return columns;
}
