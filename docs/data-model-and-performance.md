# Data model and performance

The README asks: _"tell us what we're doing wrong, then show us how you'd handle harder problems such as an admin board that summarizes the users in the system."_

The answer has four parts: what was wrong and how it was fixed, what is still a trade-off, the admin board as a measured design, and what I would do next.

## How the numbers were measured

[`scripts/seed-load.ts`](../scripts/seed-load.ts) makes the data: `bun run db:seed-load -- --url <database url>`.

- **What it makes.** 2,000 users with up to a year of training each, plus `load-heavy@example.test`, who trains every day for 4,000 days: 47,093 workouts, 1,129,180 sets, 155,272 body weights, about 490 MB. The median user has 17 workouts, the most active normal user 105. `--users 20000 --heavy-workouts 0` makes 435,466 workouts and 10,452,642 sets (3.2 GB), for the admin board.
- **Same every time.** A seeded generator makes the rows, so before and after run on the same data (two runs gave the same checksum).
- **Safe.** It never reads `.env`, needs `--url`, refuses port 55432 (the development Postgres) and any host that is not this machine, and refuses a database that already has load users.
- **Where.** Postgres 16 in a container with default settings (128 MB of shared buffers) on a 32-core machine. Query timings are `EXPLAIN (ANALYZE)` execution times, the median of 5 runs, with a warm cache. Refresh timings are wall-clock from `psql`. They compare queries on one machine. They do not promise a production number.

## 1. What was wrong, and how it was fixed

Each is fixed on `main`, with a ticket in the project notes that says how it was proven.

| Problem in the original                                      | Fix                                                                                                                                                                                                                       |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Any user could change any movement, and there was no auth    | `Movement.userId`, and every query filters by owner ([`movements.server.ts`](../src/lib/movements.server.ts))                                                                                                             |
| Weights were integers, so `180.5` was cut to `180`           | `Decimal(6,2)`, summed in SQL, where decimals are exact ([`schema.prisma`](../prisma/schema.prisma))                                                                                                                      |
| No start date on workouts, no stored order of sets           | `Workout.startedAt`, and `Set.createdAt` with `id` to break a tie                                                                                                                                                         |
| A user could have several active workouts                    | A partial unique index, one row per user `WHERE "completedAt" IS NULL`. An index cannot be raced, a check in code can ([migration](../prisma/migrations/20261107170000_one_active_workout_per_user/migration.sql))        |
| Bad set data was cut silently (`reps: 1.5` became 1)         | zod validation on the server, shared with the forms. Unexpected errors are logged and answered generically ([`validation.ts`](../src/lib/validation.ts), [`errors.server.ts`](../src/lib/errors.server.ts))               |
| Server timezone decided the day, so a late workout was wrong | The browser sends its timezone in a cookie, and days are grouped in that zone in SQL ([`progression.server.ts`](../src/lib/progression.server.ts))                                                                        |
| No indexes on foreign keys                                   | `Workout(userId, completedAt)`, `Set(workoutId)`, `Set(movementId)`. On 200,000 sets the chart query went from about 12.4 ms to about 3.9 ms ([migration](../prisma/migrations/20261107200000_add_indexes/migration.sql)) |
| Deleting a workout could leave its sets behind               | `ON DELETE CASCADE` from workout to sets ([migration](../prisma/migrations/20261107230000_delete_sets_with_workout/migration.sql))                                                                                        |
| `Foo@x.com` and `foo@x.com` made two accounts                | Emails stored lowercase, and a `CHECK` refuses anything else ([migration](../prisma/migrations/20261107210000_emails_are_lowercase/migration.sql))                                                                        |
| History loaded every workout                                 | Cursor paging on `(completedAt, id)`, 20 a page, so a workout added meanwhile does not skip or repeat one ([`workouts.server.ts`](../src/lib/workouts.server.ts))                                                         |

Three more problems were still there when I looked again. Two are fixed, and one was measured and left.

### A user could not be deleted

`Workout`, `BodyWeight`, `WorkoutPreset` and `Movement` point at `User` with `ON DELETE RESTRICT`, so deleting a user failed. The fix is one function, [`deleteUserAndData`](../src/lib/account.server.ts), that deletes in a fixed order in one transaction: sessions, workouts (their sets cascade), body weights, presets, custom movements, then the user. I left the foreign keys alone, on purpose:

- **No `ON DELETE CASCADE` from `User`.** It would delete everything, silently, from any code path, including a mistaken `DELETE`. An explicit order in one function does the same work on purpose, and `RESTRICT` stays as a safety net.
- **`Movement.userId` stays `RESTRICT`.** The relation is optional, so Prisma's default `SET NULL` would turn a deleted user's custom movements into built-in ones that everyone sees.
- **A table added later fails loudly:** the last step fails and the transaction rolls back.

[`e2e/user-deletion.spec.ts`](../e2e/user-deletion.spec.ts) proves it, including that another user's rows are untouched and that a failure midway leaves every row in place. The app does not call it yet. Until an account page does, it runs from `bun run user:delete -- <email> --url <database url>`.

### The current workout downloaded each movement's whole history

For "last time" and the PR badges, the current workout page ran one progression query per movement, each returning every day and workout ever logged. [`getMovementBestsServerFn`](../src/lib/progression.server.ts) replaces them with one query grouped by movement: the top weight of the last day trained, that day, and the best ever. Opening the page with 8 movements, on the load seed:

| User                                      | Before               | After             |
| ----------------------------------------- | -------------------- | ----------------- |
| a user with 93 workouts                   | 8 requests, 112.8 KB | 1 request, 1.6 KB |
| the most active normal user, 105 workouts | 8 requests, 124.0 KB | 1 request, 1.7 KB |
| `load-heavy`, 4,000 workouts              | 8 requests, 4.77 MB  | 1 request, 1.7 KB |

Database time went from 16 queries and a median of 133 to 157 ms for the two normal users to one query and about 9 ms, and from 350 ms to 85 ms for the heavy user. The values did not change: old and new agree for every movement of 13 users, and the PR badge tests pass on both.

### Deep history pages: measured, not changed

Prisma writes the cursor as `completedAt < x OR (completedAt = x AND id < y)`, and a plan suggested a deep page reads every row before it. The fix is a row comparison, `("completedAt", id) < (x, y)`, in a raw query, plus an index on `("userId", "completedAt" DESC, id DESC)`. That is harder to maintain and one more index, so it had to earn its place. `EXPLAIN (ANALYZE, BUFFERS)` for `load-heavy` (4,000 workouts, 200 pages), with the index the table already has:

| Page | Prisma's `OR` cursor                           | Row comparison      |
| ---- | ---------------------------------------------- | ------------------- |
| 50   | 0.34 ms, 54 buffers, 980 rows read and dropped | 0.14 ms, 14 buffers |
| 100  | 0.66 ms, 74 buffers                            | 0.14 ms, 15 buffers |
| 200  | 0.15 ms, 13 buffers                            | 0.23 ms, 10 buffers |

The worry is real (page 50 reads and drops 980 rows), but the worst page is 0.66 ms, and the new index changes nothing that matters (0.77 ms against 0.09 ms at page 100). The whole request takes about 6 ms on every page with either form, so this saves under 1 ms of 6. The most active normal user has six pages.

**Decision: measured, not changed.** No raw query, no new index. A history of 100,000 workouts for one user, or a deep page that is slow in production, would change my mind.

## 2. What is still a trade-off, and why it stays

- **The workout timeline is JSON.** `Workout.timeline` holds which movement was current when, and the pauses. Only the current workout's ring reads it, as a whole, and zod validates every write ([`workout-timeline.ts`](../src/lib/workout-timeline.ts)). If analytics needed it, it would become a `TimelineEvent` table.
- **Sets have no `userId`.** A per-user sum joins `Set` to `Workout` on indexed keys, and it is fast over a million sets (section 3). A copied `userId` would save a join and must stay equal to the workout's.
- **Body weight history is loaded whole.** Ten years of daily entries is about 3,650 rows, drawn as one chart.
- **`Set.reps` has no `CHECK`.** Only the server's zod schema limits reps to 1 to 1,000 (`PresetSet` has a `CHECK`). Every write goes through the server functions, so no bad value can be stored today. A `CHECK` is a cheap migration once a script writes straight to the database.
- **Weights have no stored unit.** This one deserves a design.

### Weights have no unit

`lbs` is one constant, [`weightUnit`](../src/lib/units.ts), and the weight columns hold bare numbers, so if kg is added nothing says which unit an old row is in. It is not built: nobody has asked for kg, and it touches every weight in the app. The design:

1. **Store kilograms in every weight column.** Sums, maxes and PRs stay correct in SQL without a conversion in each query. A unit per row would put a `CASE` in every aggregate, and a mixed sum would be silently wrong.
2. **`User.weightUnit` (`kg` or `lbs`) decides only the display.** Forms convert to kg before sending, and charts and lists convert what they receive.
3. **One migration**: `UPDATE "Set" SET weight = weight * 0.45359237`, the same for `BodyWeight` and `PresetSet`, in one transaction. Existing users get `weightUnit = 'lbs'`.
4. **The column must grow first.** `Decimal(6,2)` does not give back what the user typed: 135 lbs is 61.23496 kg, stored as 61.23, which reads back as 134.989 lbs. Of all values with two decimals, 55% show a different number after the round trip. With `Decimal(8,4)` (0.1 g, enough for 9,999 kg), all 100,000 values with two decimals up to 1,000 lbs read back exactly. So the migration widens the columns and multiplies in the same statement.

## 3. The admin board

The README's harder problem. I did not build it, on purpose: it tests database thinking, not a feature people who lift asked for, and measured queries answer it with less code to defend. Nothing in the app or the migrations changes. I ran the SQL below as plain SQL on the load seed.

**What it shows:** totals (users, active in 7 and 30 days, workouts, sets); sign-ups, workouts, sets and active users per week; top movements in 30 days; a paged, sortable users table (never passwords or sessions); and "last refreshed" with a Refresh button.

**Who can open it:** a `User.role` column (`user` or `admin`, default `user`). No screen makes an admin: `bun run admin:grant <email>`, run by someone with database access, does. An `adminMiddleware` after `authMiddleware` answers 404, not 403, so the page's existence is not revealed. The navigation link is a convenience. The middleware is the guard.

### Why not just query live?

At this size you can. Same questions, **live** (a `GROUP BY` over the tables on every load) and **from the view** (a table computed earlier, below):

| Question                                   | 2,000 users, 1.1M sets: live | from the view | 20,000 users, 10.5M sets: live | from the view |
| ------------------------------------------ | ---------------------------- | ------------- | ------------------------------ | ------------- |
| Totals (users, active 7 and 30 days, etc.) | 143 ms                       | 0.7 ms        | 2,361 ms                       | 8.4 ms        |
| Per week, last 12 weeks                    | 383 ms                       | 0.1 ms        | 5,161 ms                       | 0.1 ms        |
| Users table, first 50 by volume            | 331 ms                       | 0.1 ms        | 4,330 ms                       | 0.2 ms        |
| Users table, first 50 by last workout      | 363 ms                       | 0.1 ms        | 4,262 ms                       | 0.1 ms        |
| Top movements in the last 30 days          | 123 ms                       | still live    | 692 ms                         | still live    |

A third of a second at 2,000 users is fine for a page that three people open. Ten times the data is twelve times slower or more (4.3 s): the live query reads every row of `Set` (55,395 buffers, about 430 MB at 2,000 users) to build one row per user, then throws almost all of it away to show 50. Past this size the summary has to be computed ahead of time. Paging the view by keyset (50 rows after the 1,000th) takes 0.1 ms at both sizes.

### The design: materialized views

Two views, one `GROUP BY` each. This is the exact SQL that produced the numbers. It is not a migration, because the board is not built.

```sql
-- One row per user. Completed workouts only, like everywhere else in the app.
-- Sets are added up per workout first, so each set is read once.
CREATE MATERIALIZED VIEW admin_user_summary AS
SELECT
  u."id"                                   AS "userId",
  u."email"                                AS "email",
  u."createdAt"                            AS "joinedAt",
  COUNT(w."id")::int                       AS "workouts",
  COALESCE(SUM(t."sets"), 0)::int          AS "sets",
  COALESCE(SUM(t."volume"), 0)::float8     AS "volume",
  MAX(w."completedAt")                     AS "lastWorkoutAt"
FROM "User" u
LEFT JOIN "Workout" w ON w."userId" = u."id" AND w."completedAt" IS NOT NULL
LEFT JOIN (
  SELECT "workoutId", COUNT(*) AS "sets", SUM("weight" * "reps") AS "volume"
  FROM "Set"
  GROUP BY "workoutId"
) t ON t."workoutId" = w."id"
GROUP BY u."id";

-- REFRESH ... CONCURRENTLY needs a unique index. The others serve the sort orders of the table.
CREATE UNIQUE INDEX admin_user_summary_user ON admin_user_summary ("userId");
CREATE INDEX admin_user_summary_last_workout ON admin_user_summary ("lastWorkoutAt" DESC NULLS LAST, "userId" DESC);
CREATE INDEX admin_user_summary_volume ON admin_user_summary ("volume" DESC, "userId" DESC);
CREATE INDEX admin_user_summary_joined ON admin_user_summary ("joinedAt" DESC, "userId" DESC);

-- One row per week (UTC, weeks start on Monday): sign-ups, and what was trained.
CREATE MATERIALIZED VIEW admin_weekly_activity AS
WITH per_workout AS (
  SELECT w."userId", w."completedAt", COUNT(s."id") AS "sets"
  FROM "Workout" w
  LEFT JOIN "Set" s ON s."workoutId" = w."id"
  WHERE w."completedAt" IS NOT NULL
  GROUP BY w."id"
),
activity AS (
  SELECT
    date_trunc('week', "completedAt")::date AS "week",
    COUNT(*)::int                           AS "workouts",
    SUM("sets")::int                        AS "sets",
    COUNT(DISTINCT "userId")::int           AS "activeUsers"
  FROM per_workout
  GROUP BY 1
),
signups AS (
  SELECT date_trunc('week', "createdAt")::date AS "week", COUNT(*)::int AS "signups"
  FROM "User"
  GROUP BY 1
)
SELECT
  COALESCE(a."week", g."week")  AS "week",
  COALESCE(g."signups", 0)      AS "signups",
  COALESCE(a."workouts", 0)     AS "workouts",
  COALESCE(a."sets", 0)         AS "sets",
  COALESCE(a."activeUsers", 0)  AS "activeUsers"
FROM activity a
FULL JOIN signups g ON g."week" = a."week";

CREATE UNIQUE INDEX admin_weekly_activity_week ON admin_weekly_activity ("week");
```

The board's queries read those two views, plus one live query:

```sql
-- Totals. "Active in the last N days" is "last workout within N days".
SELECT
  COUNT(*)                                                              AS users,
  COUNT(*) FILTER (WHERE "lastWorkoutAt" >= now() - interval '7 days')  AS active_7d,
  COUNT(*) FILTER (WHERE "lastWorkoutAt" >= now() - interval '30 days') AS active_30d,
  SUM("workouts")                                                       AS workouts,
  SUM("sets")                                                           AS sets
FROM admin_user_summary;

-- Sign-ups, workouts and sets per week, last 12 weeks.
SELECT * FROM admin_weekly_activity ORDER BY "week" DESC LIMIT 12;

-- The users table: first page, by volume (the other sort orders use another ORDER BY and index).
SELECT * FROM admin_user_summary ORDER BY "volume" DESC, "userId" DESC LIMIT 50;
-- The next page: the same query after the last row shown. A row comparison is an index condition,
-- so page 20 costs as much as page 1, which OFFSET would not.
SELECT * FROM admin_user_summary
WHERE ("volume", "userId") < (1196827829.8, 'the-last-row-user-id')
ORDER BY "volume" DESC, "userId" DESC
LIMIT 50;

-- Top movements by sets in the last 30 days. Live: it only reads the last month.
SELECT m."name", COUNT(*)::int AS "sets"
FROM "Set" s
JOIN "Workout" w ON w."id" = s."workoutId"
JOIN "Movement" m ON m."id" = s."movementId"
WHERE w."completedAt" >= now() - interval '30 days'
GROUP BY m."id"
ORDER BY "sets" DESC, m."name"
LIMIT 10;
```

The views match the tables: their sums equal a plain count over the tables (47,093 workouts, 1,129,180 sets, volume 1,196,827,829.80, 2,001 sign-ups). To run it yourself:

```bash
# A database that is not your development one, here on the check Postgres at 55433:
docker exec setlist-check-db psql -U postgres -c 'CREATE DATABASE setlist_load'
URL=postgresql://postgres:postgres@localhost:55433/setlist_load
DATABASE_URL=$URL bunx prisma migrate deploy
DATABASE_URL=$URL bun scripts/seed-movements.ts
bun run db:seed-load -- --url $URL
# Save the SQL above as admin-board.sql, then:
docker exec -i setlist-check-db psql -U postgres -d setlist_load < admin-board.sql
```

### Refreshing

A materialized view is only as fresh as its last refresh. `REFRESH MATERIALIZED VIEW CONCURRENTLY` swaps in the new answer without blocking readers. The plain `REFRESH` locks the view while it runs. Median of 3 runs, default `work_mem` (4 MB):

|                                       | 2,000 users (1.1M sets) | 20,000 users (10.5M sets) |
| ------------------------------------- | ----------------------- | ------------------------- |
| `admin_user_summary`, concurrently    | 0.39 s                  | 6.3 s                     |
| `admin_weekly_activity`, concurrently | 0.28 s                  | 10.5 s                    |
| Both, plain `REFRESH`, locks readers  | 0.69 s                  | 12.7 s                    |

Ten times the data is 16 times slower for the user view and 37 times for the weekly view, and that is the number to watch. Part of it is memory: with `work_mem` at 64 to 256 MB for the refresh's session, the user view went from 6.3 s to about 2.5 to 3.7 s, and the weekly view from 10.5 s to 4.3 s. I did not tune further.

- **Button and timer.** The Refresh button calls a server function behind `adminMiddleware`. A timer does the same every few minutes, but in production that is a cron job, because a timer in the process runs once per instance. A Postgres advisory lock stops two refreshes from overlapping.
- **"Last refreshed" is stored by us.** Postgres does not keep it, so a one-row table, `admin_refresh_log`, gets the time after each refresh. Prisma reads the views with `$queryRaw`.

### Why a materialized view, and when I would switch

| Option                                                     | Good                                                                  | Bad                                                                                                                                                |
| ---------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Materialized view**                                      | Correct by construction: one SQL definition, the same as the live one | Stale between refreshes, and each refresh recomputes everything (6 to 10 s at 10M sets)                                                            |
| Rollup table updated in the same transaction as each write | Current, and cheap at any size                                        | Every write path has to keep it right (add, edit and delete a set, complete and delete a workout, delete a user). One missed and the numbers drift |

Live is the comparison above. I chose the view because it cannot be wrong in a way the data does not show, and a few admins read the board, so a few minutes of staleness costs nothing. The switch point is a number: **when a refresh takes longer than the staleness the board is allowed to have.** Then I would move to an incremental rollup, one row per user per day, updated in the same transaction as each write and **rebuilt from the source every night** and compared with the live value, so a missed write path shows up as a difference. The top movements stay live (0.7 s at 20,000 users) and would be the third view if they grew. Weeks are UTC, and "active" means "completed a workout".

## 4. What I would do next

In this order:

1. **Add `Workout(completedAt)`** for the cross-user questions. The app's index starts with `userId`, so "everyone's workouts in the last 30 days" scans. That is invisible at 47,000 workouts, and is the first thing the 30-day queries would feel (0.7 s for the top movements at 20,000 users).
2. **A read replica for the admin queries**, once the board exists, so a refresh that reads all of `Set` does not compete with someone logging a set.
3. **Partition `Set` by month** (on `createdAt`) at hundreds of millions of rows, so a refresh reads only what changed and old months can be archived.
4. **The kilogram migration**, if anyone asks for kg (section 2). Widen the column first.
5. **A `CHECK` on `Set.reps`**, with the next migration that touches the table.
6. **Wire `deleteUserAndData` into an account page**, behind the user's own password.
