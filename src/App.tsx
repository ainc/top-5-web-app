// Shell shared by both pages: title, navigation, import, and the week control.
// The selected week lives in BoardProvider, so My week and Dashboard stay in sync.

import { useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { canOpenAdmin, useAuth } from "./auth";
import { useBoard } from "./board";
import { Dashboard } from "./pages/Dashboard";
import { Admin } from "./pages/Admin";
import { MyWeek } from "./pages/MyWeek";
import { LeaderboardPage, StreaksPage } from "./pages/SeasonBoards";
import { addDays, formatWeekOption, currentMonday } from "./weeks";

export function App() {
  const {
    source,
    notice,
    importCsv,
    selectedWeek,
    weekIds,
    weekIsBlank,
    rates,
    selectWeek,
    goToPreviousWeek,
    goToNextWeek,
    goToCurrentWeek,
    createNewWeek,
  } = useBoard();
  const { avatarUrl, displayName, error: authError, ready: authReady, role, roleReady, signInWithGoogle, signOut, user } = useAuth();
  const [photoFailed, setPhotoFailed] = useState(false);
  useEffect(() => {
    setPhotoFailed(false);
  }, [avatarUrl]);
  const nextWeekId = addDays(selectedWeek, 7);
  const canGoNext = nextWeekId <= currentMonday() || weekIds.includes(nextWeekId);
  const staff = authReady && roleReady && canOpenAdmin(role);

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
            📝 My week
          </NavLink>
          <NavLink to="/dashboard">📊 Dashboard</NavLink>
          <NavLink to="/leaderboard">🏆 Leaderboard</NavLink>
          <NavLink to="/streaks">🔥 Streaks</NavLink>
          {/* Hidden until the signed-in profile is admin or commissioner. A loading gap stays hidden so the link does not flash for everyone else. */}
          {authReady && roleReady && canOpenAdmin(role) ? <NavLink to="/admin">⚙️ Admin</NavLink> : null}
        </nav>
        <div className="actions">
          {user ? (
            <div className="account">
              {avatarUrl && !photoFailed ? (
                <img
                  className="account-photo"
                  src={avatarUrl}
                  alt=""
                  referrerPolicy="no-referrer"
                  onError={() => setPhotoFailed(true)}
                />
              ) : (
                <span className="account-photo account-initial" aria-hidden="true">
                  {displayName.slice(0, 1).toUpperCase()}
                </span>
              )}
              <span className="account-name">{displayName}</span>
              <button type="button" onClick={() => void signOut()}>
                Sign out
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => void signInWithGoogle()}>
              Sign in with Google
            </button>
          )}
          {staff ? (
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
          ) : null}
        </div>
      </header>
      {/* Both pages read this week. New week can start a Monday that has not arrived yet. */}
      <div className="week-switcher">
        <button type="button" onClick={goToPreviousWeek}>
          Previous week
        </button>
        <label>
          Week
          <select value={weekIds.includes(selectedWeek) ? selectedWeek : ""} onChange={(event) => selectWeek(event.target.value)}>
            {weekIds.map((weekId) => (
              <option key={weekId} value={weekId}>
                {formatWeekOption(weekId)}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={goToCurrentWeek} disabled={selectedWeek === currentMonday()}>
          This week
        </button>
        <button type="button" onClick={goToNextWeek} disabled={!canGoNext}>
          Next week
        </button>
        {staff ? (
          <button type="button" onClick={createNewWeek}>
            New week
          </button>
        ) : null}
      </div>
      {authError ? <p className="banner error">{authError}</p> : null}
      {notice ? <p className={`banner ${notice.tone}`}>{notice.text}</p> : null}
      {weekIsBlank ? (
        <p className="banner">No tasks for this week yet. Import that week’s CSV, or fill the grid in on My week.</p>
      ) : null}
      <p className="legend">
        Daily points are 15 for Top 5, 5 for Exercise, and 5 for Reading. A full day is 25, and a full week is 125.
        The priority checkboxes mark tasks done.
        {rates.pointsPerTask > 0 ? ` Each finished priority task adds ${rates.pointsPerTask} points.` : " They do not add points."}
      </p>
      {/* My week edits one person. Dashboard is the same week, read only. */}
      <Routes>
        <Route path="/" element={<MyWeek />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/leaderboard" element={<LeaderboardPage />} />
        <Route path="/streaks" element={<StreaksPage />} />
        <Route path="/admin" element={<AdminGate />} />
      </Routes>
    </div>
  );
}

function AdminGate() {
  const { ready, role, roleReady } = useAuth();
  if (!ready || !roleReady) return null;
  if (!canOpenAdmin(role)) return <Navigate to="/" replace />;
  return <Admin />;
}
