// Shell around every page. Nothing in here is a scorecard row.
//
// The bar across the top is "Awesome Inc" in the same Exo 2 as "Top 5",
// with a small red triangle in front. Both are text, so they stay sharp.
// The words are charcoal on the white bar and white on the dark bar.
// "Top 5" stays brand red. The words link to awesomeinc.org.
// On a phone the three pages move to a bottom bar. They are the whole app,
// so they stay on screen instead of sitting behind a hamburger. The top row
// keeps the mark, today's badges, the inbox, and the account. The theme
// switch moves into the account menu, because it is a preference, not a page.
// Load sample, Import CSV, New week, and Admin sit in the account menu.
// Those four are only there for an admin or a commissioner. Profile is in
// the same menu for everyone who is signed in. Team and nickname live there.
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
// is the season board and the streak tracker, /profile is team and nickname,
// /notifications is the staff inbox, /admin is staff only.
// The inbox icon is drawn only for an admin or a commissioner, just left of
// the account chip. Members do not get the icon or the page.
//
// Streaks used to be their own nav item and their own copy of the tracker on
// the dashboard. Both copies are gone. /streaks still answers, and sends the
// browser to /leaderboard, so an old bookmark does not 404.

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { BadgeCheck, BookOpenCheck, Dumbbell, LayoutDashboard, NotebookPen, Trophy, type LucideIcon } from "lucide-react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { canOpenAdmin, useAuth } from "./auth";
import { ThemeToggle } from "./theme";
import { useBoard } from "./board";
import { Dashboard } from "./pages/Dashboard";
import { Admin } from "./pages/Admin";
import { MyWeek } from "./pages/MyWeek";
import { NotificationsPage, StaffInbox } from "./pages/Notifications";
import { ProfilePage } from "./pages/Profile";
import { LeaderboardPage } from "./pages/SeasonBoards";
import { DAY_NAMES, withAutomaticTop5 } from "./points";
import { seasonProgress } from "./streaks";
import { addDays, currentMonday, formatISODate, formatWeekSpan, isPastPlan } from "./weeks";

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
    weeks,
    rates,
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
  // Today's row for the signed-in person, not the person open on My week
  // and not the week the stepper is showing. A weekend has no row, so the
  // marks stay hidden until Monday.
  const todayMarks = useMemo(() => {
    if (!profileName) return [];
    const today = formatISODate(new Date());
    const monday = currentMonday();
    const index = DAY_NAMES.findIndex((_, dayIndex) => addDays(monday, dayIndex) === today);
    if (index < 0) return [];
    const row = weeks[monday]?.rows.find((item) => item.person === profileName && item.day === DAY_NAMES[index]);
    if (!row) return [];
    const scored = withAutomaticTop5(row);
    // The hover text is the reason the mark is next to the name. The icon
    // alone does not say that it is today's finished item.
    const marks: { icon: LucideIcon; label: string }[] = [];
    if (scored.top5) marks.push({ icon: BadgeCheck, label: `${rates.top5Name} for today` });
    if (scored.exercise) marks.push({ icon: Dumbbell, label: `${rates.exerciseName} done for today` });
    if (scored.reading) marks.push({ icon: BookOpenCheck, label: `${rates.readingName} done for today` });
    return marks;
  }, [profileName, rates, weeks]);

  return (
    <div className="app">
      {/* Title, the two pages, and the buttons that replace the selected week's rows. */}
      <header className="topbar">
        <div className="brand">
          <a className="brand-logo" href="https://awesomeinc.org/" target="_blank" rel="noreferrer">
            <svg className="brand-mark" viewBox="0 0 16 14" aria-hidden="true">
              <path d="M8 0 L16 14 L0 14 Z" />
            </svg>
            <span className="brand-name">Awesome Inc</span>
          </a>
          {/* Same Exo 2, italic, heavy. CSS uppercases it. */}
          <p className="top5-word">Top 5</p>
        </div>
        <nav aria-label="Pages">
          {/* Line icons are Lucide (lucide.dev), the ISC set that continues
              Feather. Each mark is the same stroke weight as the others. */}
          <NavLink to="/" end>
            <NotebookPen aria-hidden="true" />
            My week
          </NavLink>
          <NavLink to="/leaderboard">
            <Trophy aria-hidden="true" />
            Leaderboard
          </NavLink>
          <NavLink to="/dashboard">
            <LayoutDashboard aria-hidden="true" />
            Dashboard
          </NavLink>
        </nav>
        <div className="actions">
          <div className="header-theme">
            <ThemeToggle />
          </div>
          {todayMarks.length ? (
            <span className="header-badges" aria-label="Done today">
              {todayMarks.map(({ icon: Icon, label }) => (
                <span key={label} className="header-badge" role="img" aria-label={label} title={label}>
                  <Icon aria-hidden="true" />
                </span>
              ))}
            </span>
          ) : null}
          {staff ? <StaffInbox /> : null}
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
          {/* Dashboard fills this. My week and the other pages leave it empty,
              and an empty slot takes no space. */}
          <div id="dashboard-toolbar" className="dashboard-toolbar" />
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
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        {/* Old Streaks address. The tracker is on the Leaderboard now. */}
        <Route path="/streaks" element={<Navigate to="/leaderboard" replace />} />
        <Route path="/admin" element={<AdminGate />} />
      </Routes>
    </div>
  );
}

// Staff tools used to be separate buttons in the header and the week row.
// They replace or create a week, or open setup, so they stay behind the
// avatar until an admin or a commissioner opens the menu. Profile is in
// that menu for every signed-in person. A member's menu is Profile and
// Sign out. Staff see those plus Load sample, Import CSV, New week, and Admin.
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
      {staff ? (
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
      ) : null}
      {open ? (
        <ul id={menuId} className="account-menu-list" role="menu" aria-label="Account">
          <li className="account-theme" role="none">
            <span>Theme</span>
            <ThemeToggle />
          </li>
          <li role="none">
            <NavLink to="/profile" role="menuitem" onClick={() => setOpen(false)}>
              Profile
            </NavLink>
          </li>
          {staff ? (
            <>
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
            </>
          ) : null}
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
