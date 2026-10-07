# Top 5

A weekday scorecard for the Top 5 challenge. Each person plans five tasks a day, checks them off, and picks up bonus points. Everyone can read the board. A signed-in person edits their own tasks. An admin or a commissioner can edit anyone's.

The site is https://top-5-web-app.netlify.app. Localhost and that site share one Supabase database, so a role or a saved day shows up in both places.

## Stack

This is the stack the app runs. 

- Vite, React 19, and TypeScript
- React Router for the pages
- AG Grid Community for the spreadsheet views and charts
- Supabase for Postgres, Google sign-in, and row-level security
- Netlify for the static site

The browser talks to Supabase with the publishable key. Postgres decides which writes are allowed.

## A day

Each weekday has five slots: Top, High, Medium, Medium, and Low. Each slot is a task title and a done checkbox. The day also has notes.

Top 5 checks itself. When all five task boxes on that day are checked, Top 5 turns on and adds its points (15 by default). Unchecking any of the five turns Top 5 off and removes those points. Exercise and Reading stay manual.

## Scoring

Daily points are the bonuses checked that day, plus completed tasks times the per-task value. That per-task value starts at 0, so the five priority boxes do not add points on their own. They only decide the Top 5 bonus.

A new season starts with:

| Checkbox | Points |
|---|---|
| Top 5 | 15 |
| Exercise | 5 |
| Reading | 5 |

A finished day is 25. A finished week, Monday through Friday, is 125.

Checking a bonus stores the point value from that moment. A later change to the bonus applies the next time someone earns it. Past days stay as they were.

Week points are the sum of that week's days. Season total is earlier weeks, plus this week, plus streak bonus. The leaderboard shows earlier weeks and the current week separately.

A streak is consecutive weekdays with points. Weekends do not break it. A missed weekday does. Today stays open until it has points. Milestone bonuses, paid again on each new run, are day 3, 5, and 8 for 5 points, day 10 for 10, day 15 for 20, and days 20 and 25 for 25. There is no milestone after day 25.

## Roles

Roles live on the roster profile in `user_roles`, not on the Google account by itself. Someone has to sign in once so their profile exists. An admin or commissioner then sets the role on the Admin page.

- **Member.** Edit your own tasks, notes, and Exercise and Reading checks. Read everyone's board, leaderboard, and streaks.
- **Admin or commissioner.** Both can open Admin, edit anyone's tasks, start a new week, and import a CSV. Admin covers the season, bonuses, roster, teams, points per completed task, and roles.

A signed-out visitor can read the board and cannot write. The developer key is the Supabase service role in `.env.local`. It is not a role in the app, and it never ships to the browser.

The same rules are enforced in the database. A member's session can update only their own `day_entries`, `tasks`, and `bonus_checks`. Season, roster, team, bonus, and role changes require an admin or commissioner.

## Screens

- **My week** (`/`). One person's Monday–Friday. **Board** is the default: five day columns. **Grid** is the AG Grid table. The choice is remembered in this browser. Signing in opens your own rows. You can look at someone else, and the fields stay locked unless you are that person or staff.
- **Dashboard** (`/dashboard`). Read-only. One row per person for the selected week, then the season leaderboard, the streak tracker, and the full task list. The filter box searches those grids.
- **Leaderboard** (`/leaderboard`). Rank, name, earlier weeks, this week, and season total. Team standings show up only when the season scores teams.
- **Streaks** (`/streaks`). Current streak, longest streak, and the milestone ladder.
- **Admin** (`/admin`). Hidden unless the signed-in profile is an admin or a commissioner. Season dates and length, individual or team scoring, bonuses, roster, teams, and roles.

The week control under the title applies to My week and Dashboard together.

## Weeks

**This week** is the Monday through Friday that contains today. When a staff member is signed in and that week is not saved yet, the app creates it from the current roster with blank days. A member does not create a week for the whole roster.

**Previous week** opens the Monday before. **Next week** moves forward through a week that already exists, or through any Monday that is still inside the planning window. **New week** is staff-only. It starts a later blank week, and it stops four weeks out from the current week. The button greys out past that. Creating that furthest week shows a short notice. Refreshing the page clears the notice. The grey buttons stay, because those follow the dates.

## How a save reaches Supabase

The SQL files in `supabase/migrations` create the tables and the policies. They run when someone applies them with `npm run db:apply`. A checkbox does not run those files.

A click updates the screen first, then `saveDays` in `src/remoteBoard.ts` sends the changed day through the Supabase client. One grid day becomes three upserts: notes in `day_entries`, five task rows in `tasks`, and Top 5, Exercise, and Reading in `bonus_checks`. The logged-in Google session is the token Postgres checks. The Admin page writes the setup tables the same way, with `supabase.from(...).update()` and `upsert()`, and it does not go through the day splitter.

If the database has no days yet, a browser that still has the old `localStorage` board (`top5-board-v2`) copies that board up once. After that, Supabase is the copy that wins. Other browsers on the same project see checks as they are saved.

**Load sample** fills empty task titles on the signed-in person's current week. Text that is already there is left alone, and other people are not touched. **Import CSV** is staff-only and replaces the week on screen.

## Sign in with Google

Supabase Auth owns the session. The Google provider has to be turned on in the Supabase project, with these redirect URLs:

- `http://localhost:5173`
- `https://top-5-web-app.netlify.app`

Set `VITE_GOOGLE_WORKSPACE_DOMAIN` (for example `awesomeinc.org`) to ask Google for that Workspace and reject other email domains. Leave it unset to allow any Google account.

The first sign-in links the Google user to a roster profile with the same display name, or creates a profile and adds them to the open season. My week opens on that person.

## Data

`profiles` (including `auth_user_id` once they sign in), `user_roles` (`member`, `admin`, `commissioner`), `seasons` (`scoring_mode` is `individual` or `teams`), `season_members`, `teams` and `team_members` (used when scoring mode is `teams`), `scoring_rules`, `bonus_definitions`, `day_entries`, `tasks` (one row per person, date, and slot), `bonus_checks` (checked flag plus the points saved at check time), and `week_meta` (the label for a week, such as a CSV file name). `day_scores` is a view of the daily total.

The seeded season starts Monday, September 28, 2026, and runs twelve weeks. Scoring mode, bonuses, and the roster are changed on the Admin page after that. ACES, Alpha, and Awesomes were section labels on the old sheet, not teams.

## Import a Google Sheet

1. Open the scorecard tab.
2. File → Download → Comma-separated values (.csv).
3. In the app, select the week that file belongs to.
4. Click Import CSV and choose the file. This button is only there for an admin or a commissioner.

Checkboxes arrive as `TRUE` or `FALSE`. The importer ignores the Daily Points and Total Points cells and recalculates from the bonuses. If a person's name is filled in only on the first of their five rows, the importer copies that name down. A row whose only text is a section banner is skipped.

| Column | Contents |
|---|---|
| A | Person name |
| Then five pairs | A checkbox column and a text column for Top, High, Medium, Medium, and Low |
| Notes | Free text |
| Top 5 | Checkbox worth 15 |
| Exercise | Checkbox worth 5 |
| Reading | Checkbox worth 5 |

`public/sample-top5.csv` is a sample of that sheet layout. Load sample in the header does not import that file. It writes generic titles into the signed-in person's blank slots.

## Run locally

```bash
npm install
npm run dev
```

Open the URL Vite prints, usually http://localhost:5173.

| Script | What it does |
|---|---|
| `npm run dev` | Start the local site |
| `npm run build` | Typecheck and build the static site |
| `npm run preview` | Serve the production build locally |
| `npm run db:apply` | Apply pending SQL in `supabase/migrations` using `.env.local` |

`.env` holds the Supabase URL and publishable key and is safe to commit. `.env.local` holds the service role and database URL. Do not commit `.env.local`.

Publish with the Netlify CLI from this folder: `netlify deploy --prod --build`. The build inlines the publishable key. Do not put `.env.local` on Netlify.

## Project layout

```
src/
  main.tsx              Starts React, routing, AG Grid, auth, and the board
  App.tsx               Header, Google account, week switcher, and routes
  auth.tsx              Google session, and who may edit or open Admin
  supabaseClient.ts     Publishable-key Supabase client
  remoteBoard.ts        Load and save person-days
  board.tsx             Selected week, import, sample load, and the shared grid
  pages/MyWeek.tsx      One person, Board or Grid
  pages/WeekBoard.tsx   Monday–Friday columns
  pages/Dashboard.tsx   Read-only scorecard, standings, and tasks
  pages/SeasonBoards.tsx  Leaderboard and streak pages
  pages/Admin.tsx       Season, bonuses, roster, teams, and roles
  points.ts             Daily and weekly points, including automatic Top 5
  streaks.ts            Season totals, streak runs, and the milestone ladder
  weeks.ts              Monday dates, blank weeks, and the four-week limit
  sampleTasks.ts        Generic titles for empty slots
  parseSheetCsv.ts      Turns a Google Sheets CSV into rows
  cells.tsx             Checkbox and task-text cells
  columns.tsx           Column definitions for the task grid
  types.ts              A person-day row
public/
  sample-top5.csv       Sample scorecard in the old sheet layout
supabase/migrations/    Tables, policies, and the day_scores view
```

AG Grid Community is the free edition. The grids use sorting, filtering, and custom cells. Row grouping is a paid feature, so a team season sorts by team name instead of grouping rows.
