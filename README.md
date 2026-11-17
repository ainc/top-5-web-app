# Top 5

A weekday scorecard for the Top 5 challenge. Each person plans five tasks per weekday, checks them off, and earns bonus points. Everyone can read the board. A signed-in member edits their own tasks (including past days on the active season). An admin or commissioner can edit anyone's tasks and configure seasons.

- **Production:** https://top5.awesomeinc.org (hosted on Netlify; deploys on push to GitHub)
- **Local & production backend:** Both talk directly to the same Supabase project (see `.env`), so roles, seasons, and saved days are shared.

---

## Stack

- **Vite 8, React 19, TypeScript** — Single-page app with no custom backend API server in production.
- **React Router 7** — Client-side routes (`netlify.toml` rewrites `/*` to `/index.html`).
- **AG Grid Community 36** — Spreadsheet Grid view on My week and the expandable **All tasks** table on Dashboard.
- **Quill 2** — Bubble rich-text editor inside task cells for bold text and clickable links (`src/taskRich.tsx`).
- **Supabase (`@supabase/supabase-js`)** — Postgres database, Google OAuth, Realtime subscriptions, RPCs, and Row Level Security (RLS).
- **Vitest 5** — Unit tests for scoring, roster-linking rules, reload subscribers, and roster filtering (`npm test`).

The browser connects to Supabase with `VITE_SUPABASE_PUBLISHABLE_KEY`. Postgres RLS policies (`auth.uid()` + `user_roles`) decide what each request may read or write.

---

## A Day & Task Slots

Each weekday (Monday–Friday) has **5 task slots**, numbered `1–5` on the Board and Grid, plus day notes, **Top 5 complete**, **Exercise**, **Reading**, and any custom extra bonuses added in Admin.

- **Single translator (`src/taskSlots.ts`):** The screen edits a flat `DayRow` (`topLabel`/`topDone`, `highLabel`/`highDone`, etc.), while Postgres stores one row per `(profile_id, entry_date, slot)` in `public.tasks`. `src/taskSlots.ts` owns `SLOT_COUNT = 5`, `TASK_SLOTS`, `TASK_COLUMNS`, and the mapped `TaskFields` type. Legacy slot names (`Top`, `High`, `Medium`, `Medium 2`, `Low`) stay in `TASK_SLOTS` for CSV import, edit-log diffs, and closed-season archives.
- **Database match:** `app_private.task_slot_count()` returns `5` for the `tasks` slot `CHECK` constraint, and `app_private.task_write_columns()` supplies the column list used dynamically by `restore_edit`.
- **Rich text & keyboard (`src/taskRich.tsx`, `src/taskMarkup.ts`):** Plain text stays plain text (with URLs auto-linkified on display). Adding bold or a link stores sanitized HTML. Inside a task editor: `Tab` / `Shift+Tab` move between fields, `Enter` commits and leaves, `Shift+Enter` inserts a newline, and `Ctrl+B` / `Ctrl+K` toggle bold / link.
- **Blank boxes do not score:** Checking a slot with an empty title is ignored by `withAutomaticTop5` in `src/points.ts`, and erasing a checked task's title unchecks it.

---

## Scoring & Streaks

Daily points = `(completed tasks with text × pointsPerTask)` + checked bonuses. `pointsPerTask` starts at `0`, so the five task checkboxes determine the **Top 5 complete** bonus without adding per-task points unless an admin sets a value.

Default bonus definitions created for a new season:

| Bonus | Key | Default points | How it toggles |
|---|---|---|---|
| Top 5 complete | `top5` | 15 | Automatic when all 5 task slots have text and are checked |
| Exercise | `exercise` | 5 | Manual pill button |
| Reading | `reading` | 5 | Manual pill button |

- A full day is **25** points; a full Monday–Friday week is **125** points.
- **Point snapshots (`points_awarded`):** Checking a bonus copies its current point value onto `bonus_checks.points_awarded`. Editing bonus values later in Admin does not rewrite past days.
- **Custom bonuses:** Admins can add extra bonuses in Admin (`BonusCard`). Retiring a bonus sets `retired_at`, hiding it from future checks while preserving points already earned on earlier days.

### Streaks (`src/streaks.ts`)

- A streak counts consecutive **weekdays** (Monday–Friday) with `points > 0` inside the active season window.
- Weekends do not break a streak. Today stays open until it has points so a morning before check-off does not reset yesterday's streak.
- Milestone awards are earned again on each new run:
  - **Day 3:** +5
  - **Day 5:** +5
  - **Day 8:** +5
  - **Day 10:** +10
  - **Day 15:** +20
  - **Day 20:** +25
  - **Day 25:** +25 (no milestones after day 25)
- `seasonTotal = earlierWeeks + thisWeek + streakBonus`.

---

## Roles & Permissions

Roles live on the roster profile in `public.user_roles` (`member`, `commissioner`, `admin`), checked in Postgres via `app_private.is_staff()` and `app_private.is_admin()` (never `user_metadata`).

- **Signed-out visitor:** Read-only access to the board, dashboard, and leaderboard. Cannot write.
- **Member (default when no role row exists or `role = 'member'`):** Edit own `day_entries`, `tasks`, and `bonus_checks` on the open season (including own past days), and set own nickname on `/profile`.
- **Commissioner:** Everything a member can do, plus: open `/admin` and `/notifications`, edit anyone's tasks, create blank weeks (`New week`), import CSVs, edit seasons/drafts/bonuses/roster/teams, restore edits from the Edit log, and toggle unlocked notification switches. Cannot assign roles, resolve waiting Google account holds, or lock/unlock notification switches.
- **Admin:** Everything a commissioner can do, plus: assign roles (`RolesCard`), attach or open held Google accounts (`RosterLinksCard`), and lock/unlock notification switches (`NotificationSettings`).
- **Closed seasons:** Database triggers reject edits to closed seasons for everyone. Closed seasons are read-only in **Admin → Past seasons**.

---

## Screens & Navigation

- **My week (`/`)** — One person's Monday–Friday. Supports **Board** (5 day columns, default) and **Grid** (weekday columns across, slots 1–5 down), saved per browser in `top5-week-layout`. Signing in opens your own week; viewing another person locks inputs unless you are staff.
- **Dashboard (`/dashboard`)** — Read-only week summary for the active roster: Tasks done %, Active this week, Week leader, Season leader, Points this week bars, Selected week heatmap, and an expandable **All tasks** AG Grid.
- **Leaderboard (`/leaderboard`, `/streaks` redirects here)** — Month holiday badge, podium (`2nd`, `1st`, `3rd` with confetti burst on `1st`), Season vs. This week toggle, team standings, week winners, streak tracker, and per-person milestone detail (`/leaderboard?person=...`).
- **Profile (`/profile`)** — Shows the signed-in user's team and lets them edit their nickname (displayed on the picker, leaderboard, and header chip; scores and sign-in still key off `profiles.display_name`).
- **Notifications (`/notifications`)** — Staff-only inbox for new signups, live-season team changes, waiting first-name holds, and the season-ending reminder. Each staff member tracks read state in `notification_reads`.
- **Admin (`/admin`)** — Staff-only page composed of independent cards (`src/pages/admin/`):
  - **Season (`SeasonCard`)** — Switch between active, draft, and closed seasons; edit name, start Monday, length, scoring mode (`individual` / `teams`), and `points_per_task`; **Plan next season** (`create_season_draft`), **Activate** (`activate_season`), or **Delete draft**. Editing a draft adds `is-draft-caution` (yellow/black caution-tape border frame).
  - **Bonuses (`BonusCard`)** — Edit point values and labels, add custom bonuses, or retire non-builtin bonuses.
  - **Waiting Google accounts (`RosterLinksCard`)** — Appears at `/admin#roster-links` when a sign-in hits a first-name collision (`roster_link_requests`). Admins can attach it to an unsigned roster row or open a brand-new profile.
  - **Roster (`RosterCard`)** — Add/remove members on the selected season, edit nicknames, and (when removing from the active season while drafts exist) optionally remove from future drafts too. Removing a member clears `season_members` and `team_members` so they leave the Dashboard, Leaderboard, Week winners, My week, and new weeks—while **preserving all saved `day_entries`, `tasks`, `bonus_checks`, and `edit_log` history**.
  - **Teams (`TeamsCard`)** — Visible when `scoring_mode === 'teams'`. Add teams and assign roster members.
  - **Local sign-in (dev only)** — Rendered only when `import.meta.env.DEV` is true; uses `POST /dev/sign-in-as` in `vite.config.ts` to test as any linked user locally. Never included in production builds.
  - **Roles (`RolesCard`)** — Assign `member`, `commissioner`, or `admin` per profile.
  - **Notifications (`NotificationSettings`)** — Toggle `signup`, `team`, and `season_end` feeds and (admins only) lock/unlock each switch.
  - **Past seasons (`PastSeasons`)** — Browse weeks and daily scores for closed seasons.
  - **Edit log (`EditLog`)** — Collapsible audit trail of `tasks`, `day_entries`, and `bonus_checks` mutations (capped at the newest 1,000 rows by database trigger), with search/date/table filters and **Restore** (`restore_edit`).

---

## Sign-in, Roster Linking & Workspace Domain

Google OAuth is handled by Supabase Auth (`src/auth.tsx`).

- Redirect URLs in Supabase must include both `http://localhost:5173` and `https://top5.awesomeinc.org` (and any Netlify preview/origin URL if used).
- `VITE_GOOGLE_WORKSPACE_DOMAIN` (optional, e.g. `awesomeinc.org`) passes Google's `hd` parameter as a UI hint and enforces domain checks inside `enrollSignedInUser` (`src/remoteBoard.ts`). Personal Gmail accounts listed explicitly in `ROSTER_BY_EMAIL` bypass the domain restriction.
- **Linking order (`linkRosterAccount` in `src/remoteBoard.ts`):**
  1. **Already linked:** Profile found by `auth_user_id`.
  2. **Confirmed email map (`ROSTER_BY_EMAIL`):** Claims an unsigned profile matching the mapped `display_name` (used for people whose Google name differs or who use Gmail).
  3. **Exact display name:** Claims the single unsigned profile matching `googleDisplayName(user)`.
  4. **First-name hold (`hold_roster_link` RPC):** If the first word matches one or more unsigned roster names, inserts a `roster_link_requests` row, posts a staff inbox notification (`/admin#roster-links`) regardless of the `New signups` toggle, throws an instruction banner, and `auth.tsx` signs the session out so they cannot open the board unsigned.
  5. **New person:** Inserts a new profile and adds them to `season_members` + 5 blank days for the current Monday.

---

## Data Flow, Queued Saves & Reloads

1. **Optimistic UI + serialized queue (`src/board.tsx`, `src/remoteBoard.ts`):**
   - Checkbox, title, and note edits flow through `BoardProvider.onPatch`, updating React state immediately and queuing `saveDays` on a single serialized `chain` so rapid clicks across different days cannot overtake each other.
   - One `DayRow` save upserts `day_entries`, `tasks` (one row per slot `1..SLOT_COUNT`), `bonus_checks` (`points_awarded` snapshotted), and `week_meta`.
2. **Coordinated reload (`src/reloadBoard.ts`):**
   - Saves outside `onPatch` (Admin cards, Profile nickname, Edit log restore) call `reload()` imported from `src/board.tsx` / `src/reloadBoard.ts`.
   - `BoardProvider` funnels both explicit `reload()` calls and Supabase Realtime (`subscribeToBoard`) through one guarded loader that waits for `writesInFlight()` and active text input (`isTextEditing()`), and drops stale responses using `editEpoch` and `generation` tickets so an in-flight fetch never unchecks a box toggled on another day.
   - `AuthProvider` also subscribes via `onReload` to refresh the signed-in user's nickname and role without a page reload.
3. **Themes (`src/theme.tsx`, `src/index.css`):**
   - Theme (`light` / `dark`) is stored under `top5-theme` in `localStorage`, applied before React mounts in `index.html` to prevent flash, and drives CSS custom properties defined on `:root` and overridden under `html[data-theme="dark"]` (plus AG Grid's `gridTheme` / `darkGridTheme` in `src/columns.tsx`).

---

## Database Schema & Migrations

All SQL lives in `supabase/migrations/` and is tracked in `public.schema_migrations`:

| Table / View / RPC | Purpose |
|---|---|
| `seasons`, `scoring_rules`, `teams`, `bonus_definitions` | Season config (`status`: `draft` / `active` / `closed`, single `is_open = true` row), per-task rate, teams, and bonus definitions |
| `profiles`, `user_roles`, `season_members`, `team_members` | People, staff roles, active/draft roster membership, and team assignments |
| `day_entries`, `tasks`, `bonus_checks`, `week_meta`, `day_scores` | Notes, 5 task slots per day, bonus checks + `points_awarded`, week labels, and daily point view |
| `edit_log` & `restore_edit(target)` | Trigger-recorded history capped at 1,000 newest rows, plus staff restore RPC |
| `notifications`, `notification_settings`, `notification_reads` | Staff inbox feed, org switches + admin locks, and per-user read marks |
| `roster_link_requests`, `hold_roster_link`, `attach_roster_link`, `open_roster_link` | First-name collision holds and admin resolution RPCs |
| `create_season_draft`, `activate_season` | Draft duplication and atomic season cutover RPCs |

> **Note:** Never enable `FORCE ROW LEVEL SECURITY` on these tables without verifying `SECURITY DEFINER` helpers in `app_private` (`search_path = ''`), and never edit migrations that have already been applied—add a new timestamped migration instead.

---

## Local Setup & Commands

```bash
npm install
npm run dev
```

Vite serves the app at http://127.0.0.1:5173 (or http://localhost:5173).

| Command | What it does |
|---|---|
| `npm run dev` | Start Vite dev server (includes `/dev/sign-in-as` local impersonation middleware) |
| `npm test` | Run Vitest unit suites (`src/*.test.ts`) |
| `npm run build` | Run `tsc --noEmit` and build static assets into `dist/` |
| `npm run preview` | Preview the `dist/` production build locally |
| `npm run db:apply` | Apply pending `supabase/migrations/*.sql` using `SUPABASE_DB_URL` from `.env.local` |
| `npm run import:workbook` | Import historical Google Sheets workbook data via `.env.local` |

### Environment files

- **`.env` (committed):** Holds public client values (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_GOOGLE_WORKSPACE_DOMAIN`). Safe to commit.
- **`.env.local` (never commit, never upload to Netlify):** Holds `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_DB_URL` used only by `vite dev` (`/dev/sign-in-as`), `npm run db:apply`, and `npm run import:workbook`.

### Testing (`npm test`)

Vitest (`vitest.config.ts`, `node` environment) covers core logic without touching the shared Supabase project or needing Google Cloud OAuth credentials:
- `src/points.test.ts` — Blank-checkbox clearing, automatic Top 5, daily/weekly totals (`125` ceiling).
- `src/claimRules.test.ts` — All 4 outcomes of `linkRosterAccount` using a mock Supabase client, plus comments documenting the future Google OAuth handshake tests for when Google Cloud Console access is available.
- `src/reloadBoard.test.ts` — `reload()` / `onReload()` fan-out and unsubscribe cleanup.
- `src/rosterFilter.test.ts` — Active-roster filtering across `peopleFromRoster`, `seasonBoard`, and `weekWinners` while preserving saved rows.

---

## Import a Google Sheet CSV

1. Download the scorecard tab as `.csv` (`File → Download → Comma-separated values`).
2. Select the target Monday on My week or Dashboard.
3. Open **Account menu → Import CSV** (staff-only) and select the file.
4. `src/parseSheetCsv.ts` skips section banners, fills down grouped person names, recalculates points from bonuses, and replaces that week's saved rows. `public/sample-top5.csv` shows the expected layout.

---

## Project Layout

```text
src/
  main.tsx                    Entry point: StrictMode, Router, Theme/Auth/Board providers, AG Grid registration
  App.tsx                     Top bar, account menu, theme switch, week stepper, season progress, routes
  auth.tsx                    Google OAuth session, profile/role lookup, enrollSignedInUser trigger
  supabaseClient.ts           Singleton browser Supabase client (publishable key only)
  board.tsx                   BoardProvider: selected week, queued saves, coordinated reload/realtime, ScoreGrid
  reloadBoard.ts              Pub/sub reload() bus shared by saves, BoardProvider, and AuthProvider
  remoteBoard.ts              Catalog/weeks loader, day splitter upserts, realtime subscription, linkRosterAccount
  taskSlots.ts                Single source of truth for SLOT_COUNT, TASK_SLOTS, TASK_COLUMNS, TaskFields
  types.ts                    DayRow and GridRow types
  points.ts                   withAutomaticTop5, dailyPoints, weekPoints, peopleInOrder, peopleFromRoster
  streaks.ts                  seasonBoard, weekWinners, teamStandings, streak milestones & season bounds
  weeks.ts                    Monday date math, blankWeek, missingRosterRows, 4-week planning cap
  names.ts                    Nickname display helpers (shownName, pickerName)
  theme.tsx                   Light/dark ThemeProvider + ThemeToggle
  notifications.ts            Staff inbox queries, read marks, realtime notices, season-end refresh
  parseSheetCsv.ts            Google Sheets CSV parser
  sampleTasks.ts              Generic placeholder tasks for "Load sample"
  taskRich.tsx                Quill 2 bubble editor & keyboard navigation for task cells
  taskMarkup.ts               URL linkification and safe HTML sanitization for task titles
  cells.tsx                   AG Grid custom cell renderers & useDraftText blur buffer
  columns.tsx                 AG Grid column definitions + light/dark grid themes
  StepMenu.tsx                Accessible prev/menu/next dropdown shared by PersonPicker & TeamMenu
  ScorecardLoading.tsx        Animated ripple loader (full-page and compact card modes)
  winnerConfetti.tsx          Canvas confetti burst for 1st place on the leaderboard
  index.css                   Design tokens (:root & dark theme overrides) and all component styles
  pages/
    MyWeek.tsx                Editable personal week (Board / Grid toggle + sidebar)
    WeekBoard.tsx             5-day Board cards, TaskLine, DayNote, DayScores pill toggles
    WeekMatrix.tsx            5-day Grid layout (slots down the side, days across)
    Dashboard.tsx             Read-only team overview, charts, heatmap, and All tasks grid
    SeasonBoards.tsx          Leaderboard, podium, team standings, week winners, and streak tracker
    PersonPicker.tsx          Person StepMenu wrapper
    Profile.tsx               Signed-in user's team readout and nickname editor
    Notifications.tsx         Staff inbox icon & feed page
    NotificationSettings.tsx  Org notification toggles and admin locks
    Admin.tsx                 Shell hosting independent admin cards, banners, draft frame, local sign-in
    admin/
      adminShared.tsx         Season types, sorting, SaveButtonView, useSaveFlash
      SeasonCard.tsx          Active/draft/closed season selector, rules, draft creation & activation
      BonusCard.tsx           Built-in and custom bonus definitions
      RosterLinksCard.tsx     First-name collision queue (attach or create profile)
      RosterCard.tsx          Roster add/remove (with future-draft cleanup), nicknames
      TeamsCard.tsx           Team creation and assignments (teams mode only)
      RolesCard.tsx           Profile role assignments (admin only)
    PastSeasons.tsx           Read-only browser for closed seasons
    EditLog.tsx               Searchable edit_log viewer and restore_edit trigger
    Forbidden.tsx             403 staff-only page
    NotFound.tsx              404 page
  *.test.ts                   Vitest unit tests (points, claimRules, reloadBoard, rosterFilter)
scripts/
  apply-schema.mjs            Applies pending SQL migrations using SUPABASE_DB_URL
  import-workbook.mjs         Historical Excel/CSV workbook importer
supabase/migrations/          Ordered Postgres schema, RLS policies, triggers, and RPCs
public/                       Logos, 404 illustration, and sample-top5.csv
```
