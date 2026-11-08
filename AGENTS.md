# AGENTS.md

This file gives coding agents guidance for working in this repository. `CLAUDE.md` is a symlink to it.

Setlist is a strength training log: users manage a library of movements, log sets (movement, weight, reps) in a current workout, and review completed workouts in their history. `README.md` describes the product and the open feature requests.

## Commands

Use **Bun** for everything.

- `bun install`: install dependencies. Also generates the Prisma client (`postinstall`) and installs git hooks (`prepare`).
- `bun run dev`: start Postgres and the app in Docker with watch mode at http://localhost:3000. Pending migrations are applied on container start.
- `bun run dev:down`: stop the Docker services
- `bun run db:migrate --name <change>`: create and apply a migration against the Docker Postgres (`localhost:55432`)
- `bun run db:reset`: drop the database and re-apply all migrations
- `bun run typecheck`: generate the route tree and run `tsc --noEmit`
- `bun run build`: production build
- `bun run test`: Playwright e2e tests against the running app. Run `bunx playwright install chromium` once before the first run.

## Architecture

- **Framework**: TanStack Start (React SSR) with Vite and Nitro
- **Routing**: TanStack Router, file-based, in `src/routes/`. `src/routeTree.gen.ts` is generated and gitignored.
- **Server state**: TanStack Query. Route loaders call `queryClient.ensureQueryData(...)` and components read the same data with `useSuspenseQuery`. Each route keeps its query options in a `-queries/` folder next to it.
- **Server logic**: `createServerFn` functions live in `src/lib/*.server.ts`. Protected functions use `authMiddleware` from `src/lib/auth.server.ts`, which puts `context.user` on the request.
- **Auth**: a random session token in a cookie. Its SHA-256 hash is stored in the `Session` table with the user and an expiry, and logout deletes the row. Set in `src/lib/auth.server.ts`. Sign-in and sign-up are rate limited in memory (`src/lib/rate-limit.server.ts`); `TRUST_PROXY=true` makes it read the last `X-Forwarded-For` entry. Signed-in routes live under `src/routes/__index/_layout*`, and the layout redirects to `/sign-in` when there's no user.
- **Database**: PostgreSQL with Prisma 7 through the `@prisma/adapter-pg` driver adapter. The schema is `prisma/schema.prisma`, and the client is generated into `prisma/generated/` (gitignored). Get a client with `getServerSidePrismaClient()` from `src/lib/db.server.ts`.
- **Styling**: Tailwind CSS v4. The brand color is `--color-primary` in `src/styles.css`. Small hand-rolled UI primitives live in `src/components/ui/`.
- **Path alias**: `@/*` maps to `src/*`.

## Configuration

- `.env` is committed and holds the non-secret local development defaults (`DATABASE_URL`, `VITE_ENVIRONMENT`, `ENVIRONMENT`). Overrides go in `.env.local`, which is gitignored.
- In Docker, the app reaches Postgres at `postgres:5432`. From the host, Postgres is at `localhost:55432`.
- The app container syncs `src/` and `public/` and rebuilds when `prisma/`, `package.json`, or `bun.lock` change.

## Conventions

- Commits must follow Conventional Commits. The commitlint `commit-msg` hook enforces this.
- Pushing to `main` runs `bun run typecheck` through the `pre-push` hook.
