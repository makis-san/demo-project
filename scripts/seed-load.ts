/**
 * Fills a database with a realistic amount of data, to measure queries on instead of guessing. Not part of the app and
 * never run by it. Users have the history of a year of training: workouts a few times a week with 4 to 8 movements
 * of 3 to 5 sets each, and a body weight most days. About 2,000 users make roughly a million sets.
 *
 *   bun run db:seed-load -- --url postgresql://postgres:postgres@localhost:55433/setlist_load
 *
 * Flags (all but --url are optional):
 *   --url <database url>   Required. There is no default on purpose, see "Safety" below.
 *   --users <n>            How many users to make. Default 2000.
 *   --days <n>             How far back history can start. Default 365.
 *   --end <YYYY-MM-DD>     The last day of history. Default today. Pin it to get the same rows on another day.
 *   --seed <n>             The seed of the random numbers. Default 1. The same flags and seed give the same rows.
 *   --heavy-workouts <n>   Also make one user, load-heavy@example.test, with this many completed workouts, one a day
 *                          going back from the end date. It is for measuring deep pages of history. Default 4000, 0 for none.
 *
 * Safety: the script never reads .env, so it cannot fall back to the development database. It refuses to run without
 * --url, refuses port 55432 (the development database in docker-compose.dev.yml) and any host that is not this machine,
 * and refuses a database that already holds load users, so a second run cannot pile up. Built-in movements must exist
 * first (`prisma migrate deploy`, then `bun scripts/seed-movements.ts`, both with the same URL).
 *
 * Every user has the password `load-test-password`, so a load user can be signed in to see the app at this size.
 * The rows are made in JavaScript from a seeded random generator, so they are the same on every run, and written with
 * a few large INSERT ... unnest statements instead of one call per row.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../prisma/generated/client/client";
import { hashPassword } from "../src/lib/password.server";

const devDatabasePort = "55432";
const password = "load-test-password";
const dayMs = 24 * 60 * 60 * 1000;

/* ------------------------------------------------------------------------------------------------------------ */
/* Flags and safety checks                                                                                      */
/* ------------------------------------------------------------------------------------------------------------ */

function parseFlags(argv: string[]) {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") continue;
    if (!arg.startsWith("--") || i + 1 >= argv.length) throw new Error(`Unknown or incomplete flag: ${arg}`);
    values.set(arg.slice(2), argv[++i]);
  }
  const known = ["url", "users", "days", "end", "seed", "heavy-workouts"];
  for (const key of values.keys()) if (!known.includes(key)) throw new Error(`Unknown flag: --${key}`);

  const url = values.get("url");
  if (!url) {
    throw new Error("--url is required, for example --url postgresql://postgres:postgres@localhost:55433/setlist_load");
  }
  const count = (name: string, fallback: number) => {
    const n = Number(values.get(name) ?? fallback);
    if (!Number.isInteger(n) || n < 0) throw new Error(`--${name} must be a whole number, 0 or more`);
    return n;
  };
  const endText = values.get("end") ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endText) || Number.isNaN(Date.parse(endText)))
    throw new Error("--end must be YYYY-MM-DD");
  return {
    url,
    users: count("users", 2000),
    days: Math.max(count("days", 365), 1),
    seed: count("seed", 1),
    heavyWorkouts: count("heavy-workouts", 4000),
    end: new Date(`${endText}T00:00:00Z`),
  };
}

function checkUrl(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("--url is not a valid database URL");
  }
  if ((parsed.port || "5432") === devDatabasePort) {
    throw new Error(`Refusing port ${devDatabasePort}: that is the development database. Use the check stack (55433).`);
  }
  if (!["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) {
    throw new Error(`Refusing host ${parsed.hostname}: the load seed only runs against a database on this machine.`);
  }
}

/* ------------------------------------------------------------------------------------------------------------ */
/* Random numbers                                                                                               */
/* ------------------------------------------------------------------------------------------------------------ */

/** mulberry32: a tiny seeded generator. Math.random cannot be seeded, and the rows must be the same every run. */
function makeRandom(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    /** A whole number from `min` to `max`, both included. */
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    pick: <T>(items: T[]) => items[Math.floor(next() * items.length)],
    /** A v4-shaped UUID, made from the generator so ids are the same on every run. */
    uuid: () => {
      const hex = Array.from({ length: 32 }, () => Math.floor(next() * 16).toString(16));
      hex[12] = "4";
      hex[16] = "89ab"[Math.floor(next() * 4)];
      const s = hex.join("");
      return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
    },
  };
}
type Random = ReturnType<typeof makeRandom>;

/** `count` different items, picked at random. */
function sample<T>(random: Random, items: T[], count: number) {
  const pool = [...items];
  const out: T[] = [];
  for (let i = 0; i < count && pool.length > 0; i++) out.push(pool.splice(random.int(0, pool.length - 1), 1)[0]);
  return out;
}

/* ------------------------------------------------------------------------------------------------------------ */
/* Rows                                                                                                         */
/* ------------------------------------------------------------------------------------------------------------ */

type Movement = { id: string; isBodyWeight: boolean };

type Rows = {
  users: { id: string; email: string; name: string; passwordHash: string; createdAt: string; updatedAt: string }[];
  workouts: { id: string; userId: string; startedAt: string; completedAt: string }[];
  sets: { id: string; workoutId: string; movementId: string; reps: number; weight: number; createdAt: string }[];
  bodyWeights: { id: string; userId: string; weight: number; recordedAt: string }[];
};
const emptyRows = (): Rows => ({ users: [], workouts: [], sets: [], bodyWeights: [] });

const iso = (ms: number) => new Date(ms).toISOString();
/** A weight a plate set can make: a multiple of 2.5. */
const roundToPlates = (weight: number) => Math.round(weight / 2.5) * 2.5;

/**
 * One workout: 4 to 8 movements from the user's favourites, 3 to 5 sets of each, in the order they were done.
 * `lifts` holds the weight each movement is at for this user, and it creeps up so charts have something to show.
 */
function addWorkout(
  rows: Rows,
  random: Random,
  userId: string,
  day: number,
  favourites: Movement[],
  lifts: Map<string, number>,
  bodyWeight: number,
) {
  const completedAt = day + random.int(6, 21) * 3_600_000 + random.int(0, 59) * 60_000;
  const startedAt = completedAt - random.int(40, 90) * 60_000;
  const workoutId = random.uuid();
  rows.workouts.push({ id: workoutId, userId, startedAt: iso(startedAt), completedAt: iso(completedAt) });

  let clock = startedAt;
  for (const movement of sample(random, favourites, random.int(4, 8))) {
    const lift = lifts.get(movement.id)!;
    for (let i = 0, sets = random.int(3, 5); i < sets; i++) {
      clock += random.int(60, 150) * 1000;
      rows.sets.push({
        id: random.uuid(),
        workoutId,
        movementId: movement.id,
        reps: random.int(5, 12),
        weight: movement.isBodyWeight ? bodyWeight : lift,
        createdAt: iso(Math.min(clock, completedAt)),
      });
    }
    if (random.next() < 0.25) lifts.set(movement.id, lift + 2.5);
  }
}

function addBodyWeights(rows: Rows, random: Random, userId: string, from: number, to: number, start: number) {
  let weight = start;
  for (let day = from; day <= to; day += dayMs) {
    if (random.next() > 0.85) continue;
    weight = Math.min(Math.max(weight + (random.next() - 0.5) * 0.4, 45), 160);
    rows.bodyWeights.push({
      id: random.uuid(),
      userId,
      weight: Math.round(weight * 10) / 10,
      recordedAt: iso(day + random.int(6, 9) * 3_600_000 + random.int(0, 59) * 60_000),
    });
  }
}

/**
 * A user's history. People differ a lot, so each user gets a rate (1, 2 or 3 workouts a week), a start (they join
 * at some point in the window) and a span of activity (some stop after a month, some go on for half a year), and a favourite
 * set of 12 movements. That is what makes the table of users and the weekly numbers look like a real population.
 */
function makeUser(
  rows: Rows,
  random: Random,
  index: number,
  movements: Movement[],
  windowStart: number,
  end: number,
  passwordHash: string,
) {
  const id = random.uuid();
  const roll = random.next();
  const workoutsPerWeek = roll < 0.5 ? 1 : roll < 0.85 ? 2 : 3;
  const joined = windowStart + random.int(0, Math.floor((end - windowStart) / dayMs)) * dayMs;
  const lastDay = Math.min(joined + random.int(28, 200) * dayMs, end);
  const createdAt = iso(joined + random.int(8, 20) * 3_600_000);
  rows.users.push({
    id,
    email: `load-user-${index}@example.test`,
    name: `Load User ${index}`,
    passwordHash,
    createdAt,
    updatedAt: createdAt,
  });

  const favourites = sample(random, movements, 12);
  const bodyWeight = Math.round((random.int(55, 105) + random.next()) * 10) / 10;
  const lifts = new Map(favourites.map((m) => [m.id, roundToPlates(random.int(20, 120))]));
  for (let day = joined; day <= lastDay; day += dayMs) {
    if (random.next() < workoutsPerWeek / 7) addWorkout(rows, random, id, day, favourites, lifts, bodyWeight);
  }
  addBodyWeights(rows, random, id, joined, lastDay, bodyWeight);
}

/** The user for deep pages: a completed workout on each of the last `count` days. */
function makeHeavyUser(
  rows: Rows,
  random: Random,
  count: number,
  movements: Movement[],
  end: number,
  passwordHash: string,
) {
  const id = random.uuid();
  const first = end - (count - 1) * dayMs;
  rows.users.push({
    id,
    email: "load-heavy@example.test",
    name: "Load Heavy",
    passwordHash,
    createdAt: iso(first),
    updatedAt: iso(first),
  });
  const favourites = sample(random, movements, 12);
  const lifts = new Map(favourites.map((m) => [m.id, roundToPlates(random.int(20, 120))]));
  for (let day = first; day <= end; day += dayMs) addWorkout(rows, random, id, day, favourites, lifts, 80);
}

/* ------------------------------------------------------------------------------------------------------------ */
/* Writing                                                                                                      */
/* ------------------------------------------------------------------------------------------------------------ */

/** Both the client and a transaction have this, so the same insert works inside the transaction. */
type Executor = Pick<PrismaClient, "$executeRawUnsafe">;
const batchSize = 20_000;

/**
 * Inserts rows with one statement per batch: each column is passed as one array and `unnest` turns the arrays back
 * into rows. A batch of 20,000 rows is 5 or 6 parameters, far under Postgres's limit of 65,535, which a multi-row
 * VALUES list would hit at 10,000 rows of 6 columns.
 */
async function insertRows<Row extends Record<string, string | number>>(
  db: Executor,
  table: string,
  columns: { name: keyof Row & string; type: string }[],
  rows: Row[],
) {
  for (let from = 0; from < rows.length; from += batchSize) {
    const batch = rows.slice(from, from + batchSize);
    const names = columns.map((c) => `"${c.name}"`).join(", ");
    const arrays = columns.map((c, i) => `$${i + 1}::${c.type}[]`).join(", ");
    await db.$executeRawUnsafe(
      `INSERT INTO "${table}" (${names}) SELECT * FROM unnest(${arrays})`,
      ...columns.map((c) => batch.map((row) => row[c.name])),
    );
  }
}

async function writeRows(db: PrismaClient, rows: Rows) {
  await db.$transaction(
    async (tx) => {
      await insertRows(
        tx,
        "User",
        [
          { name: "id", type: "text" },
          { name: "email", type: "text" },
          { name: "name", type: "text" },
          { name: "passwordHash", type: "text" },
          { name: "createdAt", type: "timestamp" },
          { name: "updatedAt", type: "timestamp" },
        ],
        rows.users,
      );
      await insertRows(
        tx,
        "Workout",
        [
          { name: "id", type: "text" },
          { name: "userId", type: "text" },
          { name: "startedAt", type: "timestamp" },
          { name: "completedAt", type: "timestamp" },
        ],
        rows.workouts,
      );
      await insertRows(
        tx,
        "Set",
        [
          { name: "id", type: "text" },
          { name: "workoutId", type: "text" },
          { name: "movementId", type: "text" },
          { name: "reps", type: "integer" },
          { name: "weight", type: "numeric" },
          { name: "createdAt", type: "timestamp" },
        ],
        rows.sets,
      );
      await insertRows(
        tx,
        "BodyWeight",
        [
          { name: "id", type: "text" },
          { name: "userId", type: "text" },
          { name: "weight", type: "numeric" },
          { name: "recordedAt", type: "timestamp" },
        ],
        rows.bodyWeights,
      );
    },
    { timeout: 120_000 },
  );
}

/* ------------------------------------------------------------------------------------------------------------ */

/** A refusal or a bad flag is a message and exit code 1, not a stack trace. */
function fail(error: unknown): never {
  console.error(`\n${error instanceof Error ? error.message : error}`);
  process.exit(1);
}

const flags = (() => {
  try {
    const parsed = parseFlags(process.argv.slice(2));
    checkUrl(parsed.url);
    return parsed;
  } catch (error) {
    return fail(error);
  }
})();

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: flags.url }) });
const started = Date.now();
try {
  const [{ builtIns }] = await db.$queryRaw<
    { builtIns: number }[]
  >`SELECT COUNT(*)::int AS "builtIns" FROM "Movement" WHERE "userId" IS NULL`;
  if (builtIns === 0)
    throw new Error("No built-in movements. Run `bun scripts/seed-movements.ts` with the same URL first.");
  const [{ existing }] = await db.$queryRaw<
    { existing: number }[]
  >`SELECT COUNT(*)::int AS "existing" FROM "User" WHERE "email" LIKE 'load-%@example.test'`;
  if (existing > 0)
    throw new Error(`${existing} load users are already there. Use a fresh database, a second run would pile up.`);

  const movements = await db.$queryRaw<
    Movement[]
  >`SELECT "id", "isBodyWeight" FROM "Movement" WHERE "userId" IS NULL ORDER BY "slug"`;
  const passwordHash = await hashPassword(password);
  const random = makeRandom(flags.seed);
  const end = flags.end.getTime();
  const windowStart = end - (flags.days - 1) * dayMs;

  // Users are made and written in chunks, so memory stays small however many users are asked for.
  const totals = { users: 0, workouts: 0, sets: 0, bodyWeights: 0 };
  const write = async (rows: Rows) => {
    await writeRows(db, rows);
    for (const key of Object.keys(totals) as (keyof typeof totals)[]) totals[key] += rows[key].length;
    if (process.stdout.isTTY) process.stdout.write(`\r${totals.users} users, ${totals.sets} sets`);
  };
  const chunk = 100;
  for (let from = 1; from <= flags.users; from += chunk) {
    const rows = emptyRows();
    for (let index = from; index < from + chunk && index <= flags.users; index++) {
      makeUser(rows, random, index, movements, windowStart, end, passwordHash);
    }
    await write(rows);
  }
  if (flags.heavyWorkouts > 0) {
    const rows = emptyRows();
    makeHeavyUser(rows, random, flags.heavyWorkouts, movements, end, passwordHash);
    await write(rows);
  }

  // The planner needs fresh statistics to choose plans like it would on a database that has been in use.
  await db.$executeRawUnsafe(`ANALYZE "User", "Workout", "Set", "BodyWeight"`);

  console.log(
    `\nDone in ${((Date.now() - started) / 1000).toFixed(1)}s. Flags: users=${flags.users} days=${flags.days} ` +
      `end=${flags.end.toISOString().slice(0, 10)} seed=${flags.seed} heavy-workouts=${flags.heavyWorkouts}`,
  );
  console.log(
    `Rows made: ${totals.users} users, ${totals.workouts} workouts, ${totals.sets} sets, ${totals.bodyWeights} body weights.`,
  );
  console.log(`Every user's password is "${password}", for example load-user-1@example.test.`);
} catch (error) {
  fail(error);
} finally {
  await db.$disconnect();
}
