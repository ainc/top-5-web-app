// Shell shared by both pages: title, navigation, import, and the week control.
// The selected week lives in BoardProvider, so My week and Dashboard stay in sync.

import { NavLink, Route, Routes } from "react-router-dom";
import { useBoard } from "./board";
import { Dashboard } from "./pages/Dashboard";
import { MyWeek } from "./pages/MyWeek";
import { formatWeekLabel, currentMonday } from "./weeks";

export function App() {
  const {
    source,
    notice,
    importCsv,
    loadSample,
    selectedWeek,
    weekIds,
    isCurrentWeek,
    weekIsBlank,
    selectWeek,
    goToPreviousWeek,
    goToNextWeek,
  } = useBoard();

  return (
    <div className="app">
      {/* Title, the two pages, and the buttons that replace the selected week's rows. */}
      <header className="topbar">
        <div className="brand">
          <strong>Top 5</strong>
          <small>{source === "Supabase" ? "Supabase" : `${source} · Supabase`}</small>
        </div>
        <nav>
          <NavLink to="/" end>
            My week
          </NavLink>
          <NavLink to="/dashboard">Dashboard</NavLink>
        </nav>
        <div className="actions">
          <button type="button" onClick={() => void loadSample()}>
            Load sample
          </button>
          <label className="button">
            Import CSV
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void importCsv(file);
              }}
            />
          </label>
        </div>
      </header>
      {/* Both pages read this week. Next week cannot move past the current Monday. */}
      <div className="week-switcher">
        <button type="button" onClick={goToPreviousWeek}>
          Previous week
        </button>
        <label>
          Week
          <select value={weekIds.includes(selectedWeek) ? selectedWeek : ""} onChange={(event) => selectWeek(event.target.value)}>
            {weekIds.map((weekId) => (
              <option key={weekId} value={weekId}>
                {formatWeekLabel(weekId)}
                {weekId === currentMonday() ? " (This week)" : ""}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={goToNextWeek} disabled={isCurrentWeek}>
          Next week
        </button>
      </div>
      {notice ? <p className={`banner ${notice.tone}`}>{notice.text}</p> : null}
      {weekIsBlank ? (
        <p className="banner">No tasks for this week yet. Import that week’s CSV, or fill the grid in on My week.</p>
      ) : null}
      <p className="legend">
        Daily points are 15 for Top 5, 5 for Exercise, and 5 for Reading. A full day is 25, and a full week is 125.
        The priority checkboxes mark tasks done. They do not add points.
      </p>
      {/* My week edits one person. Dashboard is the same week, read only. */}
      <Routes>
        <Route path="/" element={<MyWeek />} />
        <Route path="/dashboard" element={<Dashboard />} />
      </Routes>
    </div>
  );
}
