// Read-only view of the selected week. Standings are one row per person.
// The task grid underneath is the same data, with editing turned off.

import { themeQuartz, type ColDef } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useMemo, useState } from "react";
import { ScoreGrid, useBoard } from "../board";
import { DAY_NAMES, dailyPoints, peopleInOrder } from "../points";
import type { Team } from "../types";

type Standing = {
  id: string;
  person: string;
  team: Team;
  mon: number;
  tue: number;
  wed: number;
  thu: number;
  fri: number;
  week: number;
};

const standingsTheme = themeQuartz.withParams({
  fontFamily: '"Segoe UI", sans-serif',
  headerBackgroundColor: "#1c1917",
  headerTextColor: "#fffdfb",
  backgroundColor: "#fffdfb",
  oddRowBackgroundColor: "#fbf7f4",
  accentColor: "#9f1239",
  borderColor: "#eadfd6",
  fontSize: 13,
});

// Sort ACES, then Alpha, then Awesomes. Week points break ties, highest first.
const teamRank: Record<Team, number> = { ACES: 0, Alpha: 1, Awesomes: 2 };

const standingColumns: ColDef<Standing>[] = [
  {
    field: "team",
    headerName: "Group",
    width: 130,
    sort: "asc",
    sortIndex: 0,
    comparator: (a: Team, b: Team) => teamRank[a] - teamRank[b],
  },
  { field: "person", headerName: "Person", flex: 1, minWidth: 140 },
  { field: "mon", headerName: "Mon", width: 90, type: "rightAligned" },
  { field: "tue", headerName: "Tue", width: 90, type: "rightAligned" },
  { field: "wed", headerName: "Wed", width: 90, type: "rightAligned" },
  { field: "thu", headerName: "Thu", width: 90, type: "rightAligned" },
  { field: "fri", headerName: "Fri", width: 90, type: "rightAligned" },
  {
    field: "week",
    headerName: "Week",
    width: 100,
    type: "rightAligned",
    sort: "desc",
    sortIndex: 1,
    cellClass: "points-cell week-cell",
  },
];

export function Dashboard() {
  const { rows, ready, selectedWeek } = useBoard();
  const [query, setQuery] = useState("");
  const standings = useMemo<Standing[]>(() => {
    return peopleInOrder(rows).map((person) => {
      const days = rows.filter((row) => row.person === person.person && row.team === person.team);
      const byDay = Object.fromEntries(days.map((row) => [row.day, dailyPoints(row)])) as Record<string, number>;
      return {
        id: person.key,
        person: person.person,
        team: person.team,
        mon: byDay.Mon ?? 0,
        tue: byDay.Tue ?? 0,
        wed: byDay.Wed ?? 0,
        thu: byDay.Thu ?? 0,
        fri: byDay.Fri ?? 0,
        week: DAY_NAMES.reduce((sum, day) => sum + (byDay[day] ?? 0), 0),
      };
    });
  }, [rows]);

  if (!ready) return <p className="status">Loading the scorecard…</p>;

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p>Everyone’s points for the week. The task grid below is the same scorecard, read only.</p>
        </div>
        <input
          className="filter"
          value={query}
          placeholder="Filter people or tasks"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="grid-wrap standings" style={{ height: Math.max(180, 58 + standings.length * 42) }}>
        <AgGridReact<Standing>
          theme={standingsTheme}
          rowData={standings}
          columnDefs={standingColumns}
          getRowId={(params) => params.data.id}
          key={selectedWeek}
          quickFilterText={query}
          defaultColDef={{ sortable: true, resizable: true, suppressMovable: true }}
          headerHeight={42}
          rowHeight={40}
        />
      </div>
      <h2>Tasks</h2>
      <ScoreGrid rows={rows} canEdit={false} showWeek quickFilter={query} height={560} />
    </section>
  );
}
