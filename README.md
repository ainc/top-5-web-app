# 5 Across Top 5

A community tracker for daily Top 5 tasks. Each person plans five tasks for every weekday, checks them off, and picks up bonus points. This season scores individuals. A later season can score teams when a commissioner turns that on.

Everyone can see the board. You can only change your own tasks, notes, and checks.

## Season

A commissioner opens a season with a name, a Monday start date, and a length in weeks. Each week is Monday through Friday. People can fill in any weekday in the season, including days that have not happened yet.

The open season scores individuals. Only people on the roster show up on the board and the leaderboards. A commissioner can switch a season to team scoring, name the teams, and place each person on at most one team. ACES, Alpha, and Awesomes are not teams. They were section labels on the old sheet.

## A day

Each weekday has five slots:

1. Top
2. High
3. Medium
4. Medium
5. Low

Each slot is a task title and a done checkbox. The day also has a notes field.

## Scoring

Points come from bonuses. Checking a task marks it done. A commissioner can also award points for each completed task; that value starts at 0.

A new season starts with these bonuses:

- Top 5 complete = 15
- Exercise = 5
- Reading = 5

Admins can rename bonuses, change their point values, and retire them.

Daily points are completed tasks times the per-task value, plus every bonus checked that day. Week points are the sum of that week's days. Season total is the sum of the weeks. The leaderboard shows earlier weeks and the current week separately; those two add up to the season total.

Checking a bonus saves the point value from that moment. A later change to the bonus applies the next time someone checks it. Past days stay as they were.

## Roles

- **Member.** On the season roster. Edit your own tasks, notes, and bonus checks. Read everyone's board, leaderboard, and streaks.
- **Admin.** Logan's role. Create, edit, and retire bonus definitions for a season. Admins do not edit anyone else's tasks or checks, and they do not open seasons or manage teams.
- **Commissioner.** Opens seasons, chooses individual or team scoring, manages the roster and teams, sets points per completed task, and grants member and admin roles.

The developer is not one of these roles. Full database access is the Supabase service role, and that key stays out of the app. A commissioner is a signed-in person, granted in `user_roles` after they sign up.

## Screens

- **Week board** (`/`). Pick a week in the current season. People are listed individually. Your rows are editable. Everyone else's are read-only. Each day shows the five tasks, notes, bonus checks, and daily points. On a phone, you edit "my week" and browse everyone else as a read-only list. Checks from other people show up live. When a season uses teams, people are grouped by team.
- **Leaderboard** (`/leaderboard`). Current-week leader and individual standings. Individual rows show rank, name, earlier weeks, this week, and season total. Each past week lists its top scorer and score. Team standings appear only when that season scores teams: rank, team, this week, and season total.
- **Streaks** (`/streaks`). Current streak and longest streak. A streak is consecutive weekdays with points. Weekends do not break it. A missed weekday does.
- **Admin** (`/admin`). Bonuses for admins. Seasons, scoring mode, teams, roster, and points per completed task for the commissioner.

## Stack

- TanStack Start, React 19, Vite, Tailwind v4, shadcn/ui
- Supabase for Postgres, Auth, and Row Level Security
- Cloudflare Workers

The list above is the target stack. The app in this repository currently runs the AG Grid scorecard in [This build](#this-build).

The browser talks to Supabase with the anon key. There is no custom API. Leaderboard and streak numbers are calculated in SQL. The `day_scores` view is the daily total: completed tasks times points per task, plus the bonus values stored when those boxes were checked.

Signed-in users can read community data. Writes to tasks, notes, and checks are limited to the signed-in user. Bonus writes require an admin or commissioner. Season, roster, team, and scoring writes require a commissioner.

That access rule is the target. This build has no sign-in yet, so the current policies let the publishable key read and write the scorecard. Tighten them when authentication lands.

## Data

`profiles`, `user_roles` (`member`, `admin`, `commissioner`), `seasons` (`scoring_mode` is `individual` or `teams`), `season_members` (the roster), `teams`, `team_members` (used only when scoring mode is `teams`), `scoring_rules`, `bonus_definitions`, `day_entries` (notes), `tasks` (one row per person, date, and slot), and `bonus_checks` (checked flag plus the point value saved at check time). `week_meta` stores the label for a week, such as a CSV file name. `profiles.auth_user_id` stays empty until that person signs up.

## This build

The screen is the AG Grid scorecard. TanStack Start, Tailwind, shadcn/ui, and Cloudflare Workers are not installed. Vite, React, AG Grid Community, and Supabase are.

There is no sign-in yet, so My week has a menu for whose rows to edit. The open season is individual scoring, so the grid has no team column. Logan Zakeri is the admin once he signs up. The commissioner is a different person. Grant those roles after sign-up:

```sql
insert into public.user_roles (profile_id, role)
select id, 'admin' from public.profiles where auth_user_id = '<Logan auth user uuid>';

insert into public.user_roles (profile_id, role)
select id, 'commissioner' from public.profiles where auth_user_id = '<commissioner auth user uuid>';
```

The service role in `.env.local` is the developer key. It is not a commissioner account.

### Points in the grid

Daily points still use the sheet formula. Priority checkboxes do not add points, because `scoring_rules.points_per_task` starts at 0.

```
=SUM(IF(Top5=TRUE,+15,+0)+IF(Exercise=TRUE,+5,+0)+IF(Reading=TRUE,+5,+0))
```

| Checkbox | Points |
|---|---|
| Top 5 | 15 |
| Exercise | 5 |
| Reading | 5 |

A finished day is 25. A finished week is 125, Monday through Friday. Checking a bonus stores that point value on `bonus_checks`. The grid still displays 15 / 5 / 5, which matches the seeded bonuses.

### Run locally

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
| `npm run db:apply` | Apply the Supabase migration using `.env.local` |

`.env` holds the Supabase URL and publishable key and is safe to commit. `.env.local` holds the service role and database URL. Do not commit `.env.local`.

`npm run db:apply` runs any pending file in `supabase/migrations`. The open season starts Monday, September 28, 2026, runs twelve weeks, scores individuals, and starts with the three bonuses above. No teams are seeded.

### Pages

The week control sits under the title and applies to both pages. **Next week** stays disabled on the current week. **Previous week** opens the Monday before. If that week has no saved rows, the same people appear with blank days. Import CSV fills whichever week is selected.

**My week** (`/`) edits one person. The menu at the top picks who. Checking Top 5, Exercise, or Reading updates that day's points and the weekly total.

**Dashboard** (`/dashboard`) is read-only. The top grid is one row per person, with Monday through Friday and the week total. The grid below is the full task list. The filter box searches both grids.

Leaderboard, streaks, and admin from the spec above are not screens yet.

**Load sample** puts the bundled sample sheet on the current week and saves it. **Import CSV** replaces only the week you are looking at.

### Import the Google Sheet

1. Open the scorecard tab.
2. File → Download → Comma-separated values (.csv).
3. In the app, select the week that file belongs to.
4. Click Import CSV and choose the file.

Checkboxes arrive as `TRUE` or `FALSE`. The app ignores the Daily Points and Total Points cells and recalculates from the three scoring checkboxes. If a person's name is filled in only on the first of their five rows, the importer copies that name down.

The sheet layout the importer expects:

| Column | Contents |
|---|---|
| A | Person name. A row whose only text is a section banner is skipped. It is not a team. |
| Then five pairs | A checkbox column and a text column for Top, High, Medium, Medium, and Low |
| Notes | Free text |
| Top 5 | Checkbox worth 15 |
| Exercise | Checkbox worth 5 |
| Reading | Checkbox worth 5 |

`public/sample-top5.csv` still has those old section banners. The importer skips them and keeps the people.

### Where the data lives

Edits go to Supabase. Another browser on the same project sees them. Checks from other people refresh the grids live.

If Supabase has no days yet, a browser that still has the old `localStorage` board (`top5-board-v2`) copies that board up once. After that, Supabase is the copy that wins.

### Project layout

```
src/
  main.tsx            Starts React, routing, AG Grid, and the saved board
  App.tsx             Header, week switcher, and the two routes
  supabaseClient.ts   Publishable-key Supabase client
  remoteBoard.ts      Load and save person-days as roster, tasks, notes, and bonuses
  types.ts            A person-day row. Team is empty unless the season uses teams.
  points.ts           The 15 / 5 / 5 formula and weekly totals
  weeks.ts            Monday dates, blank weeks, and the roster copy
  parseSheetCsv.ts    Turns a Google Sheets CSV into rows
  cells.tsx           Checkbox and task-text cells inside the grid
  columns.tsx         Column definitions for the task grid
  board.tsx           Selected week, import, and the shared AG Grid
  pages/MyWeek.tsx    Editable scorecard for one person
  pages/Dashboard.tsx Read-only standings and the full task grid
public/
  sample-top5.csv     Sample scorecard
supabase/migrations/  Tables, open policies, and the day_scores view
```

AG Grid Community is the free edition. The grids use sorting, filtering, and custom cells. Row grouping is a paid feature, so a team season sorts by team name instead of grouping rows. This season has no team column. The dashboard sorts by week points.
