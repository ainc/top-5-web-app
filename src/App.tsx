// Shell around every page. Nothing in here is a scorecard row.
//
// The bar across the top is the Awesome Inc logo (a link to awesomeinc.org)
// plus the words "Top 5" in Exo 2. That word is text, not an image, so it
// stays sharp next to the 32px logo and picks up the brand red from CSS.
// The same bar holds the page links, the theme toggle, and Google sign-in.
// Load sample, Import CSV, New week, and Admin sit in the account menu.
// That menu is only there for an admin or a commissioner.
//
// Under the bar, one row is shared by every route. The left side is a week
// stepper: previous, the short range (Oct 26 – 30), next, then a Today link
// back to the Monday that contains today. That replaced five controls
// (previous, a week menu, this week, next, and a season card under them).
// The season progress sits on the right of the same row: the season name,
// a thin bar, and "Week 3 of 8". BoardProvider owns the selected Monday, so
// opening Dashboard does not jump to a different week than My week.
// Scoring lives in a compact panel on My week only.
//
// Routes: / edits one person, /dashboard is the read-only glance, /leaderboard
// is the season board and the streak tracker, /admin is staff only.
//
// Streaks used to be their own nav item and their own copy of the tracker on
// the dashboard. Both copies are gone. /streaks still answers, and sends the
// browser to /leaderboard, so an old bookmark does not 404.

import { useEffect, useId, useRef, useState } from "react";
import { LayoutDashboard, NotebookPen, Trophy } from "lucide-react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { canOpenAdmin, useAuth } from "./auth";
import { ThemeToggle } from "./theme";
import { useBoard } from "./board";
import { Dashboard } from "./pages/Dashboard";
import { Admin } from "./pages/Admin";
import { MyWeek } from "./pages/MyWeek";
import { LeaderboardPage } from "./pages/SeasonBoards";
import { seasonProgress } from "./streaks";
import { addDays, currentMonday, formatWeekSpan, isPastPlan } from "./weeks";

export function App() {
  const {
    notice,
    importCsv,
    selectedWeek,
    weekIds,
    weekIsBlank,
    season,
    goToPreviousWeek,
    goToNextWeek,
    goToCurrentWeek,
    createNewWeek,
    loadSample,
    dismissNotice,
  } = useBoard();
  const { avatarUrl, displayName, error: authError, nickname, profileName, ready: authReady, role, roleReady, signInWithGoogle, signOut, user } = useAuth();
  const [photoFailed, setPhotoFailed] = useState(false);
  useEffect(() => {
    setPhotoFailed(false);
  }, [avatarUrl]);
  const nextWeekId = addDays(selectedWeek, 7);
  const nextPastPlan = isPastPlan(nextWeekId);
  // Past the four-week line the button stays on, so the click can show the
  // planning note. Further ahead with no saved week stays disabled, because
  // Next week does not create one.
  const canGoNext = nextPastPlan || nextWeekId <= currentMonday() || weekIds.includes(nextWeekId);
  const staff = authReady && roleReady && canOpenAdmin(role);
  const accountName = nickname || profileName || displayName;
  const progress = season.name ? seasonProgress(season) : null;

  return (
    <div className="app">
      {/* Title, the two pages, and the buttons that replace the selected week's rows. */}
      <header className="topbar">
        <div className="brand">
          <a className="brand-logo" href="https://awesomeinc.org/" target="_blank" rel="noreferrer" aria-label="Awesome Inc">
            <img className="logo-for-light" src="/ainc-logo-dark.png" alt="" />
            <img className="logo-for-dark" src="/ainc-logo.png" alt="" />
          </a>
          {/* Exo 2, italic, heavy. Sized to the Awesome Inc mark beside it.
              CSS uppercases it. An image wordmark was tried first; text keeps
              the credit off the header and matches light and dark without a
              second file. */}
          <p className="top5-word">Top 5</p>
        </div>
        <nav>
          {/* Line icons are Lucide (lucide.dev), the ISC set that continues
              Feather. Each mark is the same stroke weight as the others. */}
          <NavLink to="/" end>
            <NotebookPen aria-hidden="true" />
            My week
          </NavLink>
          <NavLink to="/dashboard">
            <LayoutDashboard aria-hidden="true" />
            Dashboard
          </NavLink>
          <NavLink to="/leaderboard">
            <Trophy aria-hidden="true" />
            Leaderboard
          </NavLink>
        </nav>
        <div className="actions">
          <ThemeToggle />
          {user ? (
            <AccountMenu
              staff={staff}
              accountName={accountName}
              avatarUrl={avatarUrl}
              photoFailed={photoFailed}
              onPhotoError={() => setPhotoFailed(true)}
              onSignOut={() => void signOut()}
              onLoadSample={() => void loadSample()}
              onNewWeek={createNewWeek}
              onImport={(file) => void importCsv(file)}
            />
          ) : authReady ? (
            <div className="signin-cue">
              <span className="signin-cue-label">Not signed in · view only</span>
              <span className="signin-arrow" aria-hidden="true">
                ➜
              </span>
              <button type="button" onClick={() => void signInWithGoogle()}>
                Sign in with Google
              </button>
            </div>
          ) : null}
        </div>
      </header>
      {/* Both pages read this week. The stepper moves one Monday at a time.
          Today jumps back to the Monday that contains today's date. */}
      <div className="week-switcher">
        <div className="week-nav">
          <button type="button" className="week-step" aria-label="Previous week" onClick={goToPreviousWeek}>
            ‹
          </button>
          <span className="week-span">{formatWeekSpan(selectedWeek)}</span>
          <button type="button" className="week-step" aria-label="Next week" onClick={goToNextWeek} disabled={!canGoNext}>
            ›
          </button>
          <button type="button" className="week-today" onClick={goToCurrentWeek} disabled={selectedWeek === currentMonday()}>
            Today
          </button>
        </div>
        {progress ? (
          <div className="season-strip" aria-label={`Season ${season.name}`}>
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
          </div>
        ) : null}
      </div>
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
        <p className="banner">
          {staff
            ? "No tasks for this week yet. Type them on My week, or load a sample from the account menu."
            : "No tasks for this week yet. Type them on My week."}
        </p>
      ) : null}
      {/* My week edits one person. Dashboard is the same week, read only. */}
      <Routes>
        <Route path="/" element={<MyWeek />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/leaderboard" element={<LeaderboardPage />} />
        {/* Old Streaks address. The tracker is on the Leaderboard now. */}
        <Route path="/streaks" element={<Navigate to="/leaderboard" replace />} />
        <Route path="/admin" element={<AdminGate />} />
      </Routes>
    </div>
  );
}

// Staff tools used to be separate buttons in the header and the week row.
// They replace or create a week, or open setup, so they stay behind the
// avatar until an admin or a commissioner opens the menu. A member still
// sees their name and Sign out, with none of those four actions.
function AccountMenu({
  staff,
  accountName,
  avatarUrl,
  photoFailed,
  onPhotoError,
  onSignOut,
  onLoadSample,
  onNewWeek,
  onImport,
}: {
  staff: boolean;
  accountName: string;
  avatarUrl: string;
  photoFailed: boolean;
  onPhotoError: () => void;
  onSignOut: () => void;
  onLoadSample: () => void;
  onNewWeek: () => void;
  onImport: (file: File) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const menuId = useId();
  const photo =
    avatarUrl && !photoFailed ? (
      <img className="account-photo" src={avatarUrl} alt="" referrerPolicy="no-referrer" onError={onPhotoError} />
    ) : (
      <span className="account-photo account-initial" aria-hidden="true">
        {accountName.slice(0, 1).toUpperCase()}
      </span>
    );

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!staff) {
    return (
      <div className="account">
        {photo}
        <span className="account-name">{accountName}</span>
        <button type="button" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="account-menu" ref={rootRef}>
      <button
        type="button"
        className="account account-menu-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((shown) => !shown)}
      >
        {photo}
        <span className="account-name">{accountName}</span>
      </button>
      {/* The file input stays mounted. Closing the menu before the dialog
          returns would drop the chosen file. */}
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          setOpen(false);
          onImport(file);
        }}
      />
      {open ? (
        <ul id={menuId} className="account-menu-list" role="menu" aria-label="Account">
          <li role="none">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onLoadSample();
              }}
            >
              Load sample
            </button>
          </li>
          <li role="none">
            <button type="button" role="menuitem" onClick={() => fileRef.current?.click()}>
              Import CSV
            </button>
          </li>
          <li role="none">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onNewWeek();
              }}
            >
              New week
            </button>
          </li>
          <li role="none">
            <NavLink to="/admin" role="menuitem" onClick={() => setOpen(false)}>
              Admin
            </NavLink>
          </li>
          <li role="none">
            <button
              type="button"
              role="menuitem"
              className="account-menu-signout"
              onClick={() => {
                setOpen(false);
                onSignOut();
              }}
            >
              Sign out
            </button>
          </li>
        </ul>
      ) : null}
    </div>
  );
}

function AdminGate() {
  const { ready, role, roleReady } = useAuth();
  if (!ready || !roleReady) return null;
  if (!canOpenAdmin(role)) return <Navigate to="/" replace />;
  return <Admin />;
}
