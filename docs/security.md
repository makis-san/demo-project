# Security

The README asks: _"beyond password hashing, what would you improve? Consider rate limiting, CSRF protection, and session management."_

Most of that was already built, and the rest was added with this write-up. It says what was found, what was proven by running it, and what is left out on purpose.

## 1. What was wrong in the original code

In order of damage. Each is fixed, and each was shown to be real first.

| Problem                                                                                                                             | Fix                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| A public server function returned the server config, including `DATABASE_URL` with its password, with no sign-in                    | Gone                                                                                           |
| A public server function returned every user with their password. Its only guard blocked the exact value `production`               | Gone                                                                                           |
| Passwords were stored and compared as plain text                                                                                    | argon2id (section 2)                                                                           |
| The user row, password included, was sent to the browser on every page, and the sign-up form logged it to the console               | The user function returns only `id`, `email` and `name`. The logging is gone                   |
| The session token was the user id plus a signature. It never changed, survived logout, and the signing secret had a public fallback | Random tokens stored as hashes (section 3)                                                     |
| Nothing limited password guessing                                                                                                   | Rate limits (section 5)                                                                        |
| Sign-in and sign-up returned raw Prisma errors, with the query and the database host, to the browser                                | `errorMiddleware` on every server function ([`errors.server.ts`](../src/lib/errors.server.ts)) |
| Logging out was a link that ran when the page loaded, so any other site could sign a user out                                       | Log out is a POST made by a button                                                             |

## 2. Passwords

- **argon2id** through `@node-rs/argon2`, with 19 MiB of memory, 2 passes and 1 lane ([`password.server.ts`](../src/lib/password.server.ts)). That is one of the minimum settings in the OWASP Password Storage Cheat Sheet. It hashed in 14 ms in the Docker image, against 154 ms for bcrypt at cost 12, and unlike bcrypt it does not stop reading after 72 bytes.
- **Unknown emails cost the same as known ones.** Sign-in verifies against a throwaway hash when the email has no account, so the response time does not say whether the account exists.
- **8 characters minimum, 128 maximum** ([`validation.ts`](../src/lib/validation.ts)), checked when a password is set (sign-up and password change) and not when one is checked, so an account made under an older rule can still sign in. 8 is what NIST SP 800-63B asks for. It also advises against composition rules ("needs a digit and a symbol"), because they push people toward predictable patterns, so there are none. The maximum limits the work of hashing.
- **A user can change it** on the Account page. The current password is required, every other device is signed out in the same transaction, and this one stays signed in ([`account-settings.server.ts`](../src/lib/account-settings.server.ts)).

## 3. Sessions

A session is a row in the `Session` table. The cookie holds 32 random bytes, and the table holds only their SHA-256 ([`auth.server.ts`](../src/lib/auth.server.ts)). The cookie is `httpOnly`, `sameSite=lax`, and `secure` unless `ENVIRONMENT=development`.

**Why a database session and not a signed cookie.** A signed cookie cannot be taken back. Logging out would only clear it in one browser, and a copy of it would keep working until it expired or the secret changed, which is exactly what the original did. With a row, logging out deletes the row and a copy stops working at once. The cost is one indexed read per request, which also gives the user the page needs. The token is random and long, so a fast hash is enough. A slow one like argon2 is for passwords, which people choose.

**Seeing and revoking sessions.** The Account page lists every device the user is signed in on, with a name made from the user agent ("Chrome on macOS", see [`device-label.ts`](../src/lib/device-label.ts)), when it signed in and when it was last used. It marks this device and signs one or all the others out ([`sessions.server.ts`](../src/lib/sessions.server.ts)). Every query filters by the user id, and a test sends another user's session id and checks that nothing is deleted.

**Expiry.**

- A session expires 7 days after it was last used. The first request an hour or more after the last write sets `lastSeenAt` to now and `expiresAt` to 7 days from now, and sends the cookie again with the new date. So someone who uses the app every day is not signed out once a week.
- The write happens at most once an hour. Without that, every page load would write. It is an `updateMany` on the old `lastSeenAt`, so requests that arrive together do not all write: one wins. The cost is that "last active" is only exact to the hour, and the page says so.
- **An absolute cap of 30 days** from sign-in. It is checked on its own in the lookup, and `expiresAt` is never slid past it. Without a cap a stolen token that keeps being used would never expire.

Both rules are tested by changing the dates in the database and loading a page: a session near its expiry is extended, one at 29 days only to day 30, one at 31 days is refused although its `expiresAt` is in the future, and one used 10 minutes ago is not written to.

## 4. CSRF

### What was proven first

Writes are POST server functions. TanStack Start 1.150.0 reads the `x-tsr-serverFn` header only to choose the response format (`start-server-core/dist/esm/server-functions-handler.js`) and does not refuse a request without it. So the question was whether a form on another site can make the browser call one.

A script signs in, then opens an attacker page that auto-submits a `text/plain` form to the **log out** server function, with Chromium. Log out is the one POST function with no input, so it is the one a plain form can call: the others need a JSON body, which a form cannot send, and a `fetch` with one needs a CORS preflight that the app never allows. (Read from the handler's code, not tried for each function.) Four cases, before the check existed:

| Attacker page                                   | Cookie sent by the browser | Result                                                                        |
| ----------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------- |
| `127.0.0.1:4000` (cross-site), victim signed in | No                         | HTTP 200. **The victim was signed out**, but the database row was still there |
| `127.0.0.1:4000`, no cookie                     | No                         | HTTP 200                                                                      |
| `localhost:4000` (same-site), victim signed in  | Yes                        | HTTP 200. **The victim was signed out and the session row was deleted**       |
| `localhost:4000`, no cookie                     | No                         | HTTP 200                                                                      |

Two things this shows. `SameSite=Lax` did its job for the cross-site case: the cookie was not sent. But the response to a top-level form POST can still **set** cookies, and the log out response clears the cookie, so even a cross-site page could sign a user out of that browser. And for a **same-site** page (another port here, another subdomain in real life) the cookie was sent and the action ran in full. Lax is not meant to stop that.

### The fix

A request middleware, registered in [`start.ts`](../src/start.ts), refuses any request that is not GET, HEAD or OPTIONS and did not come from the app's own pages ([`csrf.server.ts`](../src/lib/csrf.server.ts)):

1. If `Sec-Fetch-Site` is present, it must be `same-origin` (our page) or `none` (the user typed the address). The browser sets it, and a page cannot change it. `same-site` is refused on purpose, and that is the case Lax misses.
2. If it is missing (an old browser), `Origin` must match the `Host` the request was sent to. Only the host is compared, because behind a proxy that ends TLS the app sees `http` while the browser sent `https`. `Origin: null` is refused.
3. With neither header the caller is not a browser. It is allowed only without the session cookie.

The same four cases after it: **HTTP 403 in all four, the victim stayed signed in, and the session row stayed.** The e2e tests ([`csrf.spec.ts`](../e2e/csrf.spec.ts)) send `cross-site`, `same-site`, three foreign `Origin` values and the no-header case with a cookie, and check that nothing changed. They also check that `same-origin`, the app's own `Origin`, and no headers without a cookie all work.

### Why no token

Fetch Metadata with SameSite cookies is listed as a full defence in the OWASP CSRF cheat sheet. A token would have to be put in every form and sent with every server function call, for no gain in browsers that send the header, and every current one does. The Origin fallback covers the rest. A request with neither header but with the cookie is refused, so a very old client that sends neither would be refused too.

## 5. Rate limiting

[`rate-limit.server.ts`](../src/lib/rate-limit.server.ts). In memory, per process.

- **Sign-in:** 5 attempts per email and address per 15 minutes, and 200 per address. The first stops guessing at one account, the second one address trying many. The first is keyed by address and email together, so someone elsewhere cannot lock a user out by typing their email.
- **Sign-up:** shares the 200 per address.
- **Counted when the attempt starts, not when it fails.** Hashing takes time, so counting afterwards would let a burst of parallel requests all pass before the first was counted. Attempts that work are given back.
- **Change password and delete account** use the sign-in counter, since they are the same guess at the same password.
- **The address** is the socket address. `X-Forwarded-For` is believed only with `TRUST_PROXY=true`, and then only its last entry, which is the one a single trusted proxy adds.

**What it does not cover.** A restart forgets the counters. With several instances each counts alone. An attacker with many addresses gets the limit once per address. That is fine for one instance, which is what runs today. The next step is a shared store (Redis, or a Postgres table with an upsert) or the proxy's own limits. A restart forgetting counters is acceptable because the argon2 cost still bounds the guess rate.

## 6. Headers and CSP

Set on every response, pages and server functions alike, by one middleware ([`security-headers.server.ts`](../src/lib/security-headers.server.ts)), including the 403 above and redirects.

| Header                                             | Why                                                                                                                                                        |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Content-Security-Policy`                          | Below                                                                                                                                                      |
| `X-Content-Type-Options: nosniff`                  | The browser must not guess a type for a file                                                                                                               |
| `Referrer-Policy: strict-origin-when-cross-origin` | Other sites see only the origin, never a path                                                                                                              |
| `X-Frame-Options: DENY`                            | The same as `frame-ancestors 'none'`, for browsers that do not know that directive                                                                         |
| `Strict-Transport-Security: max-age=31536000`      | Not in development: a browser would force HTTPS on localhost for a year. No `includeSubDomains` and no `preload`, which depend on the domain it ends up on |

### CSP: strict, with a nonce

The SSR page has inline scripts: the data the router sends along so the browser does not fetch it again. A strict `script-src` needs a nonce on them, so the first question was whether the router can add one. It can: `router.options.ssr.nonce` is written on every inline script it makes, and in a `<meta property="csp-nonce">` that the browser side reads (`router-core/dist/esm/ssr/ssr-server.js` and `ssr-client.js`). So it is a strict policy, not report-only.

The middleware makes a new random nonce per response and puts it in the request context. [`router.tsx`](../src/router.tsx) reads it from there when it creates the router for that request.

```
default-src 'self'; script-src 'self' 'nonce-…'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none';
base-uri 'self'; form-action 'self'; frame-ancestors 'none'
```

- **`script-src`** has no `unsafe-inline` and no `unsafe-eval`. This is the part that stops cross-site scripting, and a test inserts an inline script without the nonce and checks the browser refuses it.
- **`style-src` keeps `unsafe-inline`.** React writes `style="…"` attributes for the dials and charts, and two libraries (react-toastify and torph) add a `<style>` element from JavaScript, and none of them can take a nonce. A hash per library was tried and dropped: it would silently break the look of the page on every upgrade. Styles cannot run code, so this is a much smaller opening than it would be for scripts.
- **Google Fonts** work: the stylesheet comes from `fonts.googleapis.com` and the files from `fonts.gstatic.com`. Checked in the browser on the dev server and on the production build: both requests answered 200 and the font loaded.
- **One side effect.** Zod checks whether it may build validators with `new Function`, which a CSP without `unsafe-eval` blocks. It falls back and nothing breaks, but the browser reports a violation on every page load. [`zod-config.ts`](../src/lib/zod-config.ts) turns that fast path off in the browser only.

Development and production use the same policy. An e2e test opens every page with the console watched and fails on any CSP violation, and the same scan on the production build found none. The headers were also read from the production build with `curl`, HSTS included.

## 7. Deleting an account

On the Account page, in two steps in the page itself (no `window.confirm`, which a page cannot style and which blocks automated tests): "Delete account" opens the confirmation, which asks for the password and says what goes. It then calls `deleteUserAndData` ([`account.server.ts`](../src/lib/account.server.ts)), which deletes sessions, workouts and their sets, body weights, presets and custom movements and then the user, in one transaction, and the browser is sent to the sign-in page.

**How long it takes.** Prisma ends an interactive transaction after 5 seconds. On the load seed (see [data-model-and-performance.md](data-model-and-performance.md)), deleting `load-heavy@example.test`, with 4,000 workouts and 96,314 sets, took **0.20 s** in the database (3 runs, 0.20 to 0.21 s). A typical user took 0.02 s. Through the app on the production build, from the button to the sign-in page, it took 0.43 s, password check included. So the default would be enough today. The transaction limit is still set to 30 seconds: it costs nothing when the work is quick, and a much larger account or a slow disk would otherwise roll back and leave the user unable to leave. A test passes a 1 ms limit and checks that the whole delete rolls back.

## 8. Sign-up says when an email has an account

Sign-up answers "An account with this email already exists", so anyone can check whether an address uses the app. This is **not fixed**, on purpose.

The real fix is email verification: sign-up always says "check your inbox", and the email says either "confirm your account" or "you already have one". That needs an email provider, which this project does not have. Only changing the message is not a fix: a real user who forgot they signed up would get a vague answer and no email. Without email, honesty beats hiding. Meanwhile the sign-up limit makes probing slow: 200 attempts per address per 15 minutes.

## 9. Not done, and why

- **Email verification and password reset.** Both need an email provider. Verification would also fix section 8.
- **MFA.** Out of scope. TOTP is the next step, and `Session` could hold a "second factor done" flag so a password alone gives a session that cannot reach anything.
- **A shared rate limit store.** Section 5.
- **An audit log** of sign-ins, password changes and revocations. Sessions show where a user is signed in now, not what happened before.
- **Data export** before deleting. Deletion exists, export does not. A JSON or CSV download of workouts, sets and body weights is the next step, and it overlaps with the idea of import and export in the backlog.
- **Dependency audit.** `bun audit` in CI and Dependabot are the next step. Not set up.

## How it was tested

- The e2e specs [`csrf`](../e2e/csrf.spec.ts), [`security-headers`](../e2e/security-headers.spec.ts), [`sessions`](../e2e/sessions.spec.ts) and [`account`](../e2e/account.spec.ts), and the password length tests in [`auth`](../e2e/auth.spec.ts).
- The form attack was run from a small script in Chromium with two attacker pages: `127.0.0.1` for cross-site and `localhost` on another port for same-site, against `localhost:3300`. A port is part of the origin but not of the site, so the second stands in for another subdomain. The e2e tests set the headers by hand instead.
- Deleting `load-heavy` was timed on a separate database made with `bun run db:seed-load`, and nothing was run against the development database.
