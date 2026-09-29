# 5 Across Top 5

A community tracker for daily Top 5 tasks. Each person plans five tasks for every weekday, checks them off, and picks up bonus points. Teams compete across a season of a few weeks.

Everyone can see the board. You can only change your own tasks, notes, and checks.

## Season

A super admin opens a season with a name, a Monday start date, and a length in weeks. Each week is Monday through Friday. People can fill in any weekday in the season, including days that have not happened yet.

A season has competing teams. A person is on at most one team in that season. Only people on a roster show up on the board and the leaderboards.

## A day

Each weekday has five slots:

1. Top
2. High
3. Medium
4. Medium
5. Low

Each slot is a task title and a done checkbox. The day also has a notes field.

## Scoring

Points come from bonuses. Checking a task marks it done. A super admin can also award points for each completed task; that value starts at 0.

A new season starts with these bonuses:

- Top 5 complete = 15
- Exercise = 5
- Reading = 5

Admins can rename bonuses, change their point values, and retire them.

Daily points are completed tasks times the per-task value, plus every bonus checked that day. Week points are the sum of that week's days. Season total is the sum of the weeks. The leaderboard shows earlier weeks and the current week separately; those two add up to the season total.

Checking a bonus saves the point value from that moment. A later change to the bonus applies the next time someone checks it. Past days stay as they were.

## Roles

- **Member.** Sign up, then get assigned to a team. Edit your own tasks, notes, and bonus checks. Read everyone's board, leaderboard, and streaks.
- **Admin.** Create, edit, and retire bonus definitions for a season.
- **Super admin.** Everything an admin can do, plus seasons, teams, the roster, points per completed task, and granting roles.

Admins do not edit anyone else's tasks or checks. The first super admin is granted with a SQL insert after that person signs up.

## Screens

- **Week board** (`/`). Pick a week in the current season. People are grouped by team. Your rows are editable. Everyone else's are read-only. Each day shows the five tasks, notes, bonus checks, and daily points. On a phone, you edit "my week" and browse everyone else as a read-only list. Checks from other people show up live.
- **Leaderboard** (`/leaderboard`). Current-week leader, team standings, and individual standings. Team rows show rank, team, this week, and season total. Individual rows show rank, name, team, earlier weeks, this week, and season total. Each past week lists its top scorer and score.
- **Streaks** (`/streaks`). Current streak and longest streak. A streak is consecutive weekdays with points. Weekends do not break it. A missed weekday does.
- **Admin** (`/admin`). Seasons, teams, roster, bonuses, and points per completed task. Admins can edit bonuses. Season and team controls are super-admin only.

## Stack

- TanStack Start, React 19, Vite, Tailwind v4, shadcn/ui
- Supabase for Postgres, Auth, and Row Level Security
- Cloudflare Workers

The list above is the target stack. The app in this repository currently runs the AG Grid scorecard in [This build](#this-build).

The browser talks to Supabase with the anon key. There is no custom API. Leaderboard and streak numbers are calculated in SQL. The `day_scores` view is the daily total: completed tasks times points per task, plus the bonus values stored when those boxes were checked.

Signed-in users can read community data. Writes to tasks, notes, and checks are limited to the signed-in user. Season, team, and scoring writes require an admin or super-admin role.

That access rule is the target. This build has no sign-in yet, so the current policies let the publishable key read and write the scorecard. Tighten them when authentication lands.

## Data

`profiles`, `user_roles`, `seasons`, `teams`, `team_members`, `scoring_rules`, `bonus_definitions`, `day_entries` (notes), `tasks` (one row per person, date, and slot), and `bonus_checks` (checked flag plus the point value saved at check time). `week_meta` stores the label for a week, such as a CSV file name. `profiles.auth_user_id` stays empty until that person signs up.

## This build

The screen is the AG Grid scorecard. TanStack Start, Tailwind, shadcn/ui, and Cloudflare Workers are not installed. Vite, React, AG Grid Community, and Supabase are.

There is no sign-in yet, so My week has a menu for whose rows to edit. Logan Zakeri is the admin once sign-in exists. That role is separate from his group. The first super admin is still a SQL insert after that person signs up:

```sql
insert into public.user_roles (profile_id, role)
select id, 'super_admin' from public.profiles where auth_user_id = '<user uuid>';
```

### Groups

The colored bars on the sheet are three groups on one scorecard. Each person still has the same five days and the same points.

| Group | Who |
|---|---|
| ACES | The ACES section of the sheet |
| Alpha | Team Alpha, the internship program. The sheet banner reads ALPHIAS |
| Awesomes | Full-time Awesome Inc staff |

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

Apply `supabase/migrations/20260929160000_initial_schema.sql` to the Supabase project before the first run. It opens one season starting Monday, September 28, 2026, twelve weeks long, with ACES, Alpha, and Awesomes, and the three bonuses above.

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
| A | Person name, or a group banner (`ACES`, `ALPHIAS`, `AWESOMES`) on its own row |
| Then five pairs | A checkbox column and a text column for Top, High, Medium, Medium, and Low |
| Notes | Free text |
| Top 5 | Checkbox worth 15 |
| Exercise | Checkbox worth 5 |
| Reading | Checkbox worth 5 |

A group banner has to be the only text in its row. `public/sample-top5.csv` is a small file in that shape.

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
  types.ts            A person-day row and the three groups
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

AG Grid Community is the free edition. The grids use sorting, filtering, and custom cells. Row grouping is a paid feature, so the dashboard sorts by group instead of grouping rows.
