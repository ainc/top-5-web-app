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

The browser talks to Supabase with the anon key. There is no custom API. Leaderboard and streak numbers are calculated in SQL.

Signed-in users can read community data. Writes to tasks, notes, and checks are limited to the signed-in user. Season, team, and scoring writes require an admin or super-admin role.

## Data

`profiles`, `user_roles`, `seasons`, `teams`, `team_members`, `scoring_rules`, `bonus_definitions`, `day_entries` (notes), `tasks` (one row per person, date, and slot), and `bonus_checks` (checked flag plus the point value saved at check time).
