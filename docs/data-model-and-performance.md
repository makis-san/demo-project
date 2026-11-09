# Data model and performance

The README asks: _"tell us what we're doing wrong, then show us how you'd handle harder problems such as an admin board that summarizes the users in the system."_

This is the answer in four parts: what was wrong in the original code and how it was fixed, what is still a trade-off and why it stays, the admin board as a design with measured queries, and what I would do next. Where a number appears, I measured it, and the section says on what.

## How the numbers were measured

Guessing about performance is cheap, so there is a script that makes data worth measuring on: [`scripts/seed-load.ts`](../scripts/seed-load.ts), run as `bun run db:seed-load -- --url <database url>`.

- **What it makes.** 2,000 users with up to a year of training each. A user trains 1, 2 or 3 times a week, joins at some point in the year and keeps going for 4 to 29 weeks (or until the end of the year, for those who joined late), with 4 to 8 movements of 3 to 5 sets per workout, and a body weight most days. On top of that one user, `load-heavy@example.test`, trains every day for 4,000 days, to have a history deep enough to test deep pages.
- **What came out** (default flags, seed 1): 2,001 users, 47,093 workouts, 1,129,180 sets and 155,272 body weights, in 54 seconds, about 490 MB. The median user has 17 workouts, the 99th percentile 79, and the most active normal user 105.
- **It is the same every time.** The rows come from a seeded random generator, so before and after timings run on the same data. I checked it: two runs gave the same checksum over every set.
- **It cannot touch the development database.** It never reads `.env`, refuses to run without `--url`, refuses port 55432 (the development Postgres) and any host that is not this machine, and refuses a database that already has load users.
- **A bigger one for the admin board.** The same script with `--users 20000 --heavy-workouts 0` made 20,000 users, 435,466 workouts, 10,452,642 sets and 1,581,113 body weights (3.2 GB). It took 30 minutes, because the machine was busy with other work and I turned `fsync` off in that Postgres while loading, then turned it back on and ran a checkpoint before measuring anything.
- **Where the numbers were taken.** A Postgres 16 container with its default settings (128 MB of shared buffers) on a 32-core development machine, with the data in a separate database from the app's. Query timings are `EXPLAIN (ANALYZE)` execution times, the median of 5 runs when a median is given, and refresh timings are wall-clock times from `psql`. The cache was warm, except where a plan says buffers were read. They are for comparing a query with another on the same machine, not for promising a number in production.

## 1. What was wrong, and how it was fixed

The original code had these problems. Each is fixed on `main`, and each has a ticket in the project notes that says how it was proven. Here is each one with its fix in a line.

| Problem in the original                                                                                   | Fix                                                                                                                                                                                           | Where                                                                                          |
| --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Movements had no owner, so any user could change any movement, and the server functions had no auth check | `Movement.userId`, and every query filters by the owner. Built-in movements have no owner and nobody can change them                                                                          | [`movements.server.ts`](../src/lib/movements.server.ts)                                        |
| Weights were integers, so `180.5` was silently cut to `180`                                               | `Decimal(6,2)`. Sums run in SQL, where decimals are exact, and become a JavaScript number only at the end                                                                                     | [`schema.prisma`](../prisma/schema.prisma)                                                     |
| Workouts had no start date                                                                                | `Workout.startedAt`                                                                                                                                                                           | [`schema.prisma`](../prisma/schema.prisma)                                                     |
| The order of the sets was not stored                                                                      | `Set.createdAt`, with `id` to break a tie, so the order is the same on every read                                                                                                             | [`workouts.server.ts`](../src/lib/workouts.server.ts)                                          |
| A user could have several active workouts                                                                 | A partial unique index, one row per user `WHERE "completedAt" IS NULL`. A database index cannot be raced, a check in the code can                                                             | [`migration`](../prisma/migrations/20261107170000_one_active_workout_per_user/migration.sql)   |
| The server accepted bad set data and cut it silently (`reps: 1.5` became 1)                               | zod validation on the server for every input, shared with the forms. Anything unexpected is logged and answered with a generic message, so no database detail reaches the browser             | [`validation.ts`](../src/lib/validation.ts), [`errors.server.ts`](../src/lib/errors.server.ts) |
| Dates used the server's timezone, so a late workout landed on the wrong day                               | The browser sends its timezone in a cookie and days are grouped in that zone, in SQL                                                                                                          | [`progression.server.ts`](../src/lib/progression.server.ts)                                    |
| No indexes on foreign keys                                                                                | Indexes on `Workout(userId, completedAt)`, `Set(workoutId)` and `Set(movementId)`, each matching a query that exists. On 200,000 sets the chart query went from about 12.4 ms to about 3.9 ms | [`migration`](../prisma/migrations/20261107200000_add_indexes/migration.sql)                   |
| Deleting a workout was not atomic, a failure could leave sets without their workout                       | `ON DELETE CASCADE` from workout to sets, so one statement removes both                                                                                                                       | [`migration`](../prisma/migrations/20261107230000_delete_sets_with_workout/migration.sql)      |
| The same email could make two accounts (`Foo@x.com` and `foo@x.com`)                                      | Emails are stored trimmed and lowercase, and a `CHECK` makes the database refuse anything else                                                                                                | [`migration`](../prisma/migrations/20261107210000_emails_are_lowercase/migration.sql)          |
| History loaded every workout                                                                              | Cursor paging on `(completedAt, id)`, 20 a page. The cursor is the last row of the previous page, so a workout added meanwhile does not skip or repeat one                                    | [`workouts.server.ts`](../src/lib/workouts.server.ts)                                          |

Three problems were still there when I looked again, and were fixed in this batch.

### A user could not be deleted

`Workout`, `BodyWeight`, `WorkoutPreset` and `Movement` point at `User` with `ON DELETE RESTRICT`, so deleting a user failed. On a database with data:

```
ERROR:  update or delete on table "User" violates foreign key constraint "Workout_userId_fkey" on table "Workout"
DETAIL:  Key (id)=(a08ff49b-...) is still referenced from table "Workout".
```

So there was no way to remove a user who asks to leave, or to clean up a test user. The fix is one function, [`deleteUserAndData`](../src/lib/account.server.ts), that deletes in a fixed order inside one transaction: sessions, workouts (their sets go with them by cascade), body weights, presets (their exercises, series and weekdays cascade), custom movements, then the user.

I did not change the foreign keys, and this was deliberate:

- **Why not `ON DELETE CASCADE` from `User`?** A cascade deletes everything, silently, from any code path, including a mistaken `DELETE`. An explicit order in one reviewable function does the same work on purpose, and the `RESTRICT` stays as a safety net for every other path.
- **Why does `Movement.userId` stay `RESTRICT`?** That relation is optional, so Prisma's default would be `SET NULL`, which would turn a deleted user's custom movements into built-in ones that every user sees. The schema says `Restrict` on purpose.
- **A table added later fails loudly.** If a new table points at `User` and the function does not know it, the last step fails on the foreign key and the whole transaction rolls back. The mistake shows up as an error, not as rows left behind.

How it was proven, in [`e2e/user-deletion.spec.ts`](../e2e/user-deletion.spec.ts): a user with two sessions, a completed and an active workout (one repeated from the other, one started from a preset), sets on a built-in and on their own movement, body weights, and a preset holding their own movement with a series and a weekday. After the call, every table has zero rows for them, found by id (so tables without a `userId` are covered) and again by asking the database for every table that has a `userId` column (so a table added later is covered). A second user's rows are exactly the same as before. A trigger that raises an error after the workouts were deleted, and another at the very last step, both leave every row in place. The function is not called from the app yet: the account page of a later batch will call it. Until then it is reachable from `bun run user:delete -- <email> --url <database url>`, which has no default database on purpose, and the same proof ran against it.

### The current workout downloaded each movement's whole history

To show "last time" and the PR badges, the current workout page ran one progression query for each movement in the workout. Each returned every day and every workout ever logged for that movement, and the page read two numbers from it (the last day's top weight and the best). A workout with 8 movements was 8 requests that grow forever.

[`getMovementBestsServerFn`](../src/lib/progression.server.ts) answers the question that is actually asked: one SQL query grouped by movement returns, for each, the top weight of the last day it was trained, that day, and the best ever. Same rules as the chart: completed workouts only, days in the user's timezone. The page calls it once with every movement id.

Measured on the load seed, opening the current workout page of a user with 8 movements in the workout (requests the browser makes, and the bytes of their responses):

| User                                      | Before               | After             |
| ----------------------------------------- | -------------------- | ----------------- |
| a user with 93 workouts                   | 8 requests, 112.8 KB | 1 request, 1.6 KB |
| the most active normal user, 105 workouts | 8 requests, 124.0 KB | 1 request, 1.7 KB |
| `load-heavy`, 4,000 workouts              | 8 requests, 4.77 MB  | 1 request, 1.7 KB |

The database time for the same question (8 movements) went from 16 queries and a median of 133 to 157 ms for the two normal users to one query and about 9 ms, and from 350 ms to 85 ms for the heavy user. The values did not change: I called the old chart function and the new one for every movement of 13 users (including the heavy one) and compared the last top set, its day and the best, with no difference, and four end-to-end tests of the PR badges pass on the old code and on the new.

The new query shares a key prefix with the charts, so everything that refreshes the charts refreshes it: completing a workout, deleting workouts, editing a set in a completed workout. The tests that edit a set up or down in history, and delete the workout that held the best, check that the badge follows.

### Deep history pages: measured, not changed

Paging uses a cursor on `(completedAt, id)`, and Prisma writes it as `completedAt < x OR (completedAt = x AND id < y)`. An earlier look at a query plan suggested Postgres treats that as a filter, so a deep page reads every row before it and throws them away. The fix would be a row comparison, `("completedAt", id) < (x, y)`, in a raw query, with an index on `("userId", "completedAt" DESC, id DESC)`. That is code that is harder to maintain than Prisma's and one more index to keep, so it had to earn its place with numbers.

`EXPLAIN (ANALYZE, BUFFERS)` of the page query for `load-heavy`, who has 4,000 completed workouts (200 pages, about eleven years of training every day), with the index the table already has:

| Page | Prisma's `OR` cursor                           | Row comparison      |
| ---- | ---------------------------------------------- | ------------------- |
| 10   | 0.15 ms, 18 buffers, 180 rows read and dropped | 0.15 ms, 14 buffers |
| 50   | 0.34 ms, 54 buffers, 980 rows read and dropped | 0.14 ms, 14 buffers |
| 100  | 0.66 ms, 74 buffers                            | 0.14 ms, 15 buffers |
| 150  | 0.41 ms, 44 buffers                            | 0.15 ms, 14 buffers |
| 200  | 0.15 ms, 13 buffers                            | 0.23 ms, 10 buffers |

So the worry is real: on the way to page 50 the `OR` form does read about a thousand rows and drop them, and the row comparison reads about twenty. But it costs a third of a millisecond, and the worst page of the 200 is 0.66 ms. Adding the new index changes nothing that matters (0.77 ms against 0.09 ms at page 100). The page query is also not the whole request. The function runs it, then loads the sets of the 20 workouts and their movements, and through Prisma the three together take about 6 ms on every page, page 1 and page 200 alike, with either form (page 1 6.9 and 8.1 ms, page 200 5.8 and 6.5 ms). The part this would save is under 1 ms of 6, and a realistic user is nowhere near this: the most active normal user in the seed has 105 workouts, six pages.

**Decision: measured, not changed.** No raw query, no new index. What would change my mind is a history of 100,000 workouts for one user, or a deep page that is slow in production.

## 2. What is still a trade-off, and why it stays

These are choices I would defend, not accidents.

- **The workout timeline is JSON.** `Workout.timeline` holds which movement was current when, and the pauses. Only the ring on the current workout page reads it, as a whole, and it is validated by zod on every write ([`workout-timeline.ts`](../src/lib/workout-timeline.ts)). It cannot be queried, and nothing needs to. If analytics ever needed it ("how long do people rest?"), it would become a `TimelineEvent` table, with the JSON migrated once.
- **Sets have no `userId`.** Ownership goes through the workout, so a per-user sum joins `Set` to `Workout` on indexed keys. Copying `userId` onto every set would save one join and add a column that must be kept equal to the workout's. The queries here, over a million sets, are fast with the join (see below), so the copy buys nothing yet.
- **Body weight history is loaded whole.** One entry a day for ten years is about 3,650 rows, which is a few hundred KB at most and drawn as one chart. Paging it would complicate the chart for no gain.
- **`Set.reps` has no `CHECK` in the database.** The server's zod schema is the only place that limits reps to 1 to 1,000 (`PresetSet` has one, `Set` does not). Weight is bounded by its column type. Every write goes through the server functions, so nothing can store a bad value today. A `CHECK` would protect against a future script that writes straight to the database, and it is a cheap migration to add when one appears.
- **Weights have no stored unit.** See the next section. It is the one trade-off big enough to deserve a design.

### Weights have no unit

`lbs` is one constant, [`weightUnit`](../src/lib/units.ts), and the `Set`, `BodyWeight` and `PresetSet` rows hold bare numbers. If a kg option is ever added, nothing says which unit an old row is in. It is not built: no user has asked for kg, and it touches every weight in the app (forms, charts, PR badges, the muscle view).

The design, if it is asked for:

1. **Store kilograms in every weight column**, always. One unit means sums, maxes, PRs and the progression queries stay correct in SQL without a conversion inside each query. A unit on each row would put a `CASE` in every aggregate, and a mixed sum would be wrong without a warning.
2. **A `User.weightUnit` (`kg` or `lbs`) decides only the display**, and conversion happens at the edges: the forms convert what the user types to kg before sending, and the charts and lists convert what they receive. The server and the database never see lbs.
3. **The migration runs once**: `UPDATE "Set" SET weight = weight * 0.45359237`, the same for `BodyWeight` and `PresetSet`, in one transaction, and every existing user gets `weightUnit = 'lbs'` so nothing looks different to them.
4. **One correction to make before building it: the column must grow.** `Decimal(6,2)` keeps 10 g, which is far below what a plate can measure, but it does not give back the number the user typed. 135 lbs is 61.23496 kg, stored as 61.23, which reads back as 134.989 lbs. I checked every case by arithmetic: with two decimals of kg, the multiples of 0.5 lbs up to 1,000 come back right only if the display rounds to 0.1 lbs, and of all the values with two decimals (which the app allows today) 55% show a different number when displayed with two decimals. With `Decimal(8,4)` (0.1 g, enough for 9,999 kg), all 100,000 values with two decimals up to 1,000 lbs read back exactly. So the migration would widen the columns and multiply in the same statement.

Why not decide at the edges only, with a unit per row? Because every number the app computes is a sum or a max over rows. A conversion belongs where the number is shown, not where it is added up.

## 3. The admin board

The README's harder problem: an admin board that summarizes the users in the system. I did not build it, and decided that on purpose: it is a test of database thinking, not a feature people who lift asked for, and a design with real measurements answers it with less code to defend. Nothing in the app or in the migrations changes. The SQL below was run as plain SQL on the load seed and timed.

### What the board shows

- **Totals**: users, users active in the last 7 and 30 days, workouts and sets.
- **Per week**: sign-ups, workouts, sets and active users.
- **Top movements** by number of sets in the last 30 days.
- **A users table**, paged and sortable: email, joined, last workout, workouts, sets, total volume. Never passwords or sessions.
- **"Last refreshed"**, and a Refresh button.

### Who can open it

- A `User.role` column (`user` or `admin`, default `user`). No screen can make an admin: a command, `bun run admin:grant <email>`, run by someone with access to the database, does.
- An `adminMiddleware` after `authMiddleware` refuses anyone else. It answers 404 and not 403, so the page's existence is not revealed.
- The page is `/admin` in the signed-in layout, and the link in the navigation exists only for admins. The link is a convenience. The middleware on every server function is the guard.

### Why not just query live?

At this size you can. The table below runs the same questions two ways, on the load seed: **live**, which is a `GROUP BY` over the tables on every page load, and **from the view**, which reads a table that was computed earlier (described next).

| Question                                             | 2,000 users, 1.1M sets: live | from the view | 20,000 users, 10.5M sets: live | from the view |
| ---------------------------------------------------- | ---------------------------- | ------------- | ------------------------------ | ------------- |
| Totals (users, active 7 and 30 days, workouts, sets) | 143 ms                       | 0.7 ms        | 2,361 ms                       | 8.4 ms        |
| Per week, last 12 weeks                              | 383 ms                       | 0.1 ms        | 5,161 ms                       | 0.1 ms        |
| Users table, first 50 by volume                      | 331 ms                       | 0.1 ms        | 4,330 ms                       | 0.2 ms        |
| Users table, first 50 by last workout                | 363 ms                       | 0.1 ms        | 4,262 ms                       | 0.1 ms        |
| Users table, 50 after the 1,000th row (keyset)       | not measured                 | 0.1 ms        | not measured                   | 0.1 ms        |
| Top movements in the last 30 days                    | 123 ms                       | still live    | 692 ms                         | still live    |

Medians of 5 runs of `EXPLAIN (ANALYZE)`, which is the database's time, without the network or the page. A third of a second at 2,000 users would be acceptable for an admin page that three people open. Ten times the data is twelve times slower or more (4.3 s), and the plan says why: the live query reads every row of `Set` (`Parallel Seq Scan on "Set"`, 55,395 buffers, about 430 MB at 2,000 users) to build one row per user, and then throws almost all of it away to show 50. The summary has to be computed ahead of time once the data is large.

### The design: materialized views

Two views, built from one `GROUP BY` each. The SQL is below, and it is the exact SQL that produced the numbers. Run as plain SQL on the load seed, never added as a migration, because the board is not built.

```sql
-- One row per user: what the users table shows. Completed workouts only, like everywhere else in the app.
-- Sets are added up per workout first, so each set is read once, and then per user.
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

The board's queries are then reads of those two views, and one live query:

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

-- The users table: first page, by volume (the other sort orders are the same with another ORDER BY and index).
SELECT * FROM admin_user_summary ORDER BY "volume" DESC, "userId" DESC LIMIT 50;
-- The next page is the same query after the last row shown. A row comparison is an index condition,
-- so page 20 costs as much as page 1, which OFFSET would not. The two values are the last row's.
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

I checked the views against the tables directly: the sum of `workouts`, `sets` and `volume` over the user view, and the sums of the weekly view, equal a plain count over the tables (47,093 workouts, 1,129,180 sets, volume 1,196,827,829.80, 2,001 sign-ups).

To run it yourself:

```bash
# A database that is not your development one. Here, on the check Postgres at 55433:
docker exec setlist-check-db psql -U postgres -c 'CREATE DATABASE setlist_load'
URL=postgresql://postgres:postgres@localhost:55433/setlist_load
DATABASE_URL=$URL bunx prisma migrate deploy
DATABASE_URL=$URL bun scripts/seed-movements.ts
bun run db:seed-load -- --url $URL
# Save the SQL above as admin-board.sql, then:
docker exec -i setlist-check-db psql -U postgres -d setlist_load < admin-board.sql
```

### Refreshing

A materialized view is a table that remembers the answer, so it is only as fresh as its last refresh. `REFRESH MATERIALIZED VIEW CONCURRENTLY` rebuilds the answer beside the old one and swaps it in, so readers are never blocked (the plain `REFRESH` locks the view while it runs, and the timings below show how long that would be). Measured on the load seed, default Postgres settings (`work_mem` 4 MB), 3 runs, with the median:

|                                       | 2,000 users (1.1M sets)   | 20,000 users (10.5M sets) |
| ------------------------------------- | ------------------------- | ------------------------- |
| `admin_user_summary`, concurrently    | 0.39 s (0.38, 0.39, 0.70) | 6.3 s (6.1, 6.3, 6.9)     |
| `admin_weekly_activity`, concurrently | 0.28 s (0.27, 0.27, 0.32) | 10.5 s (8.1, 10.5, 11.2)  |
| Both, plain `REFRESH`, locks readers  | 0.69 s                    | 12.7 s                    |
| First creation of the user view       | 0.43 s                    | 6.5 s                     |

Ten times the data is 16 times slower for the user view and 37 times for the weekly view, so it does not scale linearly, and that is the number to watch. Part of it is memory: the user view's refresh went from 6.3 s to about 2.5 to 3.7 s with `work_mem` raised to 64 to 256 MB for the refresh's session, and the weekly view from 10.5 s to 4.3 s with the same and no parallel workers. I did not tune further. (In this container, a larger `work_mem` with parallel workers fails on Docker's 64 MB `/dev/shm`, which is a limit of the container and not of Postgres.)

How the refresh would run:

- **Button and timer.** The Refresh button calls a server function, behind `adminMiddleware`, that runs both statements. A timer in the server process does the same every few minutes. In production this belongs in a cron job, because a timer in the process runs once per instance. A Postgres advisory lock around the refresh makes sure two refreshes never run at once.
- **"Last refreshed" is stored by us.** Postgres does not keep when a materialized view was refreshed, so a one-row table, `admin_refresh_log`, gets its time after each successful refresh, and the board shows it. Stale numbers are never hidden.
- **Prisma reads it with `$queryRaw`** and typed results, as the progression queries do. Prisma's preview `view` support is not needed for read-only rows.

### Why a materialized view, and when I would switch

| Option                                                     | Good                                                                                                 | Bad                                                                                                                                                                     |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Live `GROUP BY` on each page load                          | Always current. No new objects                                                                       | Reads every set on every load. 0.3 s at 1M sets, 4.3 s at 10M                                                                                                           |
| **Materialized view**                                      | Correct by construction: one SQL definition, the same one that would be run live. Reads cost 0.1 ms. | Stale between refreshes, and each refresh recomputes everything (6 to 10 s at 10M sets)                                                                                 |
| Rollup table updated in the same transaction as each write | Current, and cheap at any size                                                                       | Every write path has to keep it right: add, edit and delete a set, complete and delete a workout, delete a user. One path missed and the numbers drift without an error |

I chose the view because it cannot be wrong in a way the data does not show, and the board is read by a few admins, which is exactly where a few minutes of staleness costs nothing. The switch point is a number, not a feeling: **when a refresh takes longer than the staleness the board is allowed to have.** If admins accept ten minutes, the refresh must stay well under ten minutes, and the table above is the way to see how close that is. At that point I would move to an incremental rollup, one row per user per day, updated in the same transaction as each write and **rebuilt from the source every night** and compared with the live value, so a missed write path shows up as a difference, not a mystery. The "last 30 days" top movements are the one question still live; at 20,000 users it is 0.7 s, which is fine for an admin page, and would be the third view if it grew.

What the board does not do, on purpose: weeks are UTC (an admin summary is not one person's day), and "active" means "completed a workout" (an open workout that was never finished is not activity).

## 4. What I would do next

In the order I would do them, and what makes each worth it:

1. **Add `Workout(completedAt)` for the cross-user questions.** The index the app has starts with `userId`, so "everyone's workouts in the last 30 days" scans. It is invisible at 47,000 workouts and is the first thing the 30-day queries would feel (0.7 s for the top movements at 20,000 users).
2. **A read replica for the admin queries**, when the board exists. A refresh reads the whole of `Set` for several seconds, and that should not compete with someone logging a set. The views would be built on the replica, or the refresh pointed at it.
3. **Partition `Set` by time** (by month, on `createdAt`) at hundreds of millions of rows, so the nightly checks and the refresh read only the partitions that changed, and old months can be archived. Not before the table is a size where a refresh stops fitting in the staleness the board allows.
4. **The kilogram migration**, if anyone asks for kg (section 2). Widen the column first.
5. **A `CHECK` on `Set.reps`**, the small gap in section 2, with the next migration that touches the table.
6. **Wire `deleteUserAndData` into an account page**, behind the user's own password. The function already exists and is proven, and a later batch calls it.
