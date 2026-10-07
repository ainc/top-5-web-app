// Shell shared by both pages: title, navigation, import, and the week control.
// The selected week lives in BoardProvider, so My week and Dashboard stay in sync.

import { useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { canOpenAdmin, useAuth } from "./auth";
import { useTheme } from "./theme";
import { useBoard } from "./board";
import { Dashboard } from "./pages/Dashboard";
import { Admin } from "./pages/Admin";
import { MyWeek } from "./pages/MyWeek";
import { LeaderboardPage, StreaksPage } from "./pages/SeasonBoards";
import { maxDayPoints, maxWeekPoints } from "./points";
import { seasonProgress } from "./streaks";
import { addDays, currentMonday, formatWeekOption, isPastPlan, nextNewWeekId } from "./weeks";

export function App() {
  const {
    source,
    notice,
    importCsv,
    selectedWeek,
    weekIds,
    weekIsBlank,
    season,
    rates,
    selectWeek,
    goToPreviousWeek,
    goToNextWeek,
    goToCurrentWeek,
    createNewWeek,
    loadSample,
    dismissNotice,
  } = useBoard();
  const { avatarUrl, displayName, error: authError, nickname, profileName, ready: authReady, role, roleReady, signInWithGoogle, signOut, user } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [photoFailed, setPhotoFailed] = useState(false);
  useEffect(() => {
    setPhotoFailed(false);
  }, [avatarUrl]);
  const nextWeekId = addDays(selectedWeek, 7);
  const nextPastPlan = isPastPlan(nextWeekId);
  const canGoNext = !nextPastPlan && (nextWeekId <= currentMonday() || weekIds.includes(nextWeekId));
  const newWeekPastPlan = isPastPlan(nextNewWeekId(selectedWeek, weekIds));
  const staff = authReady && roleReady && canOpenAdmin(role);
  const accountName = nickname || profileName || displayName;
  const progress = season.name ? seasonProgress(season) : null;

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
          <button type="button" className="theme-toggle" aria-pressed={theme === "dark"} onClick={toggleTheme}>
            {theme === "dark" ? "Dark" : "Light"}
          </button>
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
                  {accountName.slice(0, 1).toUpperCase()}
                </span>
              )}
              <span className="account-name">{accountName}</span>
              <button type="button" onClick={() => void signOut()}>
                Sign out
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => void signInWithGoogle()}>
              Sign in with Google
            </button>
          )}
          {/* Fills empty slots on the signed-in person's current week.
              A task that already has text, on any day, is not replaced.
              Import CSV stays staff-only because that file replaces a whole week. */}
          <button type="button" onClick={() => void loadSample()} disabled={Boolean(user) && !roleReady}>
            Load sample
          </button>
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
      {/* Both pages read this week. New week can start a Monday up to four weeks from this one. */}
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
          <button type="button" onClick={createNewWeek} disabled={newWeekPastPlan}>
            New week
          </button>
        ) : null}
      </div>
      {progress ? (
        <section className="season-strip" aria-label={`Season ${season.name}`}>
          <span className="season-strip-label">Season</span>
          <strong>{season.name}</strong>
          <div
            className="season-track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={progress.weeks}
            aria-valuenow={progress.week}
            aria-label={progress.finished ? `${season.name} is complete` : `${season.name}, week ${progress.week} of ${progress.weeks}`}
          >
            <span style={{ width: `${progress.percent}%` }} />
          </div>
          <small>{progress.finished ? "Complete" : progress.week === 0 ? "Not started" : `Week ${progress.week} of ${progress.weeks}`}</small>
        </section>
      ) : null}
      {authError ? <p className="banner error">{authError}</p> : null}
      {notice?.planLimit ? (
        <p className="banner plan-limit">
          <span>{notice.text}</span>
          <button type="button" className="plan-limit-close" aria-label="Close message" onClick={dismissNotice}>
            ×
          </button>
        </p>
      ) : notice ? (
        <p className={`banner ${notice.tone}`}>{notice.text}</p>
      ) : null}
      {weekIsBlank ? (
        <p className="banner">No tasks for this week yet. Load sample fills your empty slots, or type them on My week.</p>
      ) : null}
      <p className="legend">
        Daily points are {rates.top5} for {rates.top5Name} when all five tasks are checked, {rates.exercise} for {rates.exerciseName}, and {rates.reading} for {rates.readingName}.
        {rates.extras.length > 0 ? ` ${rates.extras.map((bonus) => `${bonus.name} is ${bonus.points}`).join(", ")}.` : ""} A full day is {maxDayPoints(rates)}, and a full week is {maxWeekPoints(rates)}.
        Unchecking any task removes the {rates.top5Name} points.
        {rates.pointsPerTask > 0 ? ` Each finished priority task also adds ${rates.pointsPerTask} points.` : ""}
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
