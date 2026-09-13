# Security Report

Part of the [13 Sep 2026 audit](AUDIT_REPORT.md). Findings come from reading the code, plus these direct tests: the auth middleware against forged tokens, the async-crash behaviour on the installed Express, `npm audit`, and a secret scan of the full git history. No credential or token value was printed or logged during the audit.

---

## 1. Summary

| ID | P | Finding |
|---|---|---|
| SEC-01 | **P0**\* | Any Google account can sign in and read all plant data. \*Unless the OAuth consent screen is set to *Internal*. |
| SEC-08 | P1\* | Session and token-encryption secrets fall back to public strings when unset. \*P0 if they are unset on Render. |
| SEC-02 | P1 | `email_verified` is not checked; admin is granted by an email-string match. |
| SEC-03 | P1 | No OAuth `state`: login CSRF, and a planted Drive grant. |
| REL-01 | P1 | Any async handler error terminates the server (availability; see the Reliability report). |
| SEC-04 | P2 | Cross-site POST can disconnect Drive or trigger syncs (the cookie is `SameSite=None`). |
| SEC-05 | P2 | 20 MB JSON bodies are parsed on `/api/email/*` before authentication. |
| SEC-07 | P2 | The role lives in the JWT for 12 h; revocation is impossible without rotating `JWT_SECRET`. |
| SEC-09 | P2 | `xlsx` (high, no npm fix), `nodemailer` (high), 8 moderate. |
| SEC-10 | P3 | Unauthenticated Socket.IO broadcast. |
| SEC-11 | P3 | Internal error text and Drive IDs returned to clients. |
| SEC-12 | P3 | Plant figures are sent to Gemini. |
| SEC-13 | P3 | No Content-Security-Policy on the client. |

**What is done well** (verified):
- JWTs are verified with the secret, and `alg:none`, forged, tampered and expired tokens are all rejected (test below).
- The cookie is `httpOnly`, and its cross-site shape follows `req.secure` behind `trust proxy`.
- Every privileged route is guarded server-side, independent of the UI.
- Refresh tokens are encrypted at rest with AES-256-GCM using a random IV.
- `express-mongo-sanitize` strips `$` and `.` keys.
- The Drive scope is `drive.readonly`.
- The Gmail grant is checked against `EMAIL_USER`.
- No secrets in any commit (full-history scan for Google API keys, OAuth client secrets, Mongo URIs and private keys: 0 hits).
- `.env` has never been committed.
- `helmet`, CORS pinned to one origin, and rate limits are all in place.

---

## 2. Authentication and OAuth

### SEC-01 · P0\* · No sign-in restriction

`handleGoogleLoginCallback` (`auth.controller.js:44`) upserts **any** Google identity and assigns `manager` to anyone not in `ADMIN_EMAILS`. The login page tells users *"Sign in with any Google account"* (`Login.jsx:65`). A `manager` can read:
- every production, dispatch and manpower figure;
- client names and targets;
- sync logs, including Drive folder IDs and which account connected Drive;
- Gemini insights, where each new filter combination costs a paid Gemini call.

- **Condition:** the flaw is closed only if the Google Cloud OAuth consent screen is *Internal* (Workspace users only). The code cannot show which setting is in use, so **verify it in the Google Cloud console.**
- **Fix:** in the callback, require `payload.hd === 'salasartechno.com'` and `payload.email_verified === true`, or an explicit allowlist collection (BR-12). Also pass `hd` to `generateAuthUrl` as a UX hint (it is not a control). Change the login-page text.

### SEC-02 · P1 · `email_verified` not checked

Role assignment trusts `payload.email`. Google marks some addresses unverified, for example accounts created with a non-Gmail address that has not been confirmed. Admin rights and the `EMAIL_USER` gate are both decided by string equality on that field. **Fix:** reject when `email_verified !== true`.

### SEC-03 · P1 · No OAuth `state` parameter

None of the three `generateAuthUrl` calls sets `state`, and no callback checks one.
- **Login CSRF:** a victim can be signed into the attacker's account. Low impact here.
- **Drive-connect CSRF:** `/connect-drive/callback` only needs an admin cookie. The cookie is `SameSite=None`, so a top-level GET from any site carries it. An attacker obtains a `code` for *their own* Google account against this app and sends an admin a link to the callback. The server then stores the **attacker's** refresh token as the sync credential. File IDs are global, so the attacker cannot substitute data. But the sync fails from then on (a silent denial of service), and the app now acts under the attacker's account.
- The Gmail callback is protected by its `wrong_account` check.

**Fix:** generate a random `state`, store it in a short-lived signed httpOnly cookie, and compare it in each callback. Add PKCE while there.

### SEC-04 · P2 · CSRF on cookie-authenticated POSTs

The production cookie is `SameSite=None`, because the client (Vercel) and API (Render) are different sites. CORS stops a hostile page *reading* responses, but not *sending* a "simple" request (a POST with no body or a `text/plain` body). Any page an admin visits can:
- `POST /api/auth/google/disconnect-drive`: deletes the Drive token, and sync stops until someone reconnects;
- `POST /api/sync/run`: triggers syncs, which widens the concurrency race in REL-02.

JSON endpoints are safe by accident, because a cross-site `application/json` request needs a preflight. **Fix:** on every state-changing route, reject requests whose `Origin` is not `CLIENT_ORIGIN`, or require a custom header such as `X-Requested-With`.

---

## 3. Sessions

| Property | Value | Assessment |
|---|---|---|
| Storage | `session` cookie, JWT HS256 | ✅ |
| `httpOnly` | true | ✅ |
| `secure` / `SameSite` | `req.secure` → `Secure; SameSite=None`, else `Lax` | ✅ correct for cross-site; see SEC-04 |
| Expiry | JWT `12h` (`JWT_EXPIRES_IN`), cookie `maxAge` 12 h hard-coded | ⚠ The two can diverge if the env var changes |
| Logout | `clearCookie` with the same options | ✅ The JWT stays valid until expiry (no denylist) |
| Rotation | None | ⚠ acceptable for 12 h |

**JWT tests** (run against `middleware/auth.js` with the local secret):

| Case | Result |
|---|---|
| No cookie | 401 |
| Valid manager token → admin route | 403 |
| Signed with another secret | 401 |
| Signed with the dev fallback secret | 401 (because this `.env` sets a real secret) |
| `alg: none`, role admin | 401 |
| Payload tampered to admin, original signature | 401 |
| Expired | 401 |

### SEC-08 · P1\* · Secret fallbacks

`config/env.js` supplies `'dev-only-change-me'` and `'dev-only-32-char-change-me-please!!'` whenever `JWT_SECRET` / `TOKEN_ENCRYPTION_KEY` are unset. `required()` therefore never throws for them, and nothing warns.
- If either is unset on Render, anyone can mint an admin JWT with the public string.
- The local `.env` has strong values (96 and 64 characters). Render's are **not verified**.

**Fix:** throw at boot when either is missing or equals a fallback, whenever `RENDER` / `RENDER_EXTERNAL_URL` is present or `NODE_ENV=production`.

### SEC-07 · P2 · Role frozen in the token

`requireAdmin` trusts the `role` claim, and `requireAuth` never checks that the user still exists. Removing someone from `ADMIN_EMAILS` takes effect only at their next login, up to 12 h later. **Fix:** load the user, or at least the role, per request. It is one indexed read, and `/auth/me` already does it.

---

## 4. Authorization and input handling

### Endpoint matrix (server-side enforcement, verified in the routes files)

| Endpoint | Guard | Who | Validation | Notes |
|---|---|---|---|---|
| `GET /health` | — | anyone | — | |
| `GET /auth/google`, `/callback` | rate 30/15 min | anyone | code required | SEC-01/02/03 |
| `GET /auth/me` | auth | any user | — | |
| `POST /auth/logout` | — | anyone | — | harmless |
| `GET /auth/google/connect-drive[/callback]` | auth + admin | admin | code | SEC-03 |
| `POST /auth/google/disconnect-drive` | auth + admin | admin | — | SEC-04 |
| `GET /auth/google/connect-gmail[/callback]`, `gmail-send-status` | auth + `EMAIL_USER` | 1 account | account check ✅ | |
| `GET /dashboard/hsd/summary` | auth | any user | ❌ `from`/`to` not validated; Invalid Date is silently treated as epoch | |
| `GET /dashboard/hsd/insights` | auth | any user | ❌ same; each new key is a paid Gemini call | |
| `GET /dashboard/manpower` | auth | any user | ❌ unbounded range | unused by the client |
| `GET /dashboard/synopsis` | auth | any user | ✅ validated, but the query rebuilds `${from}T00:00Z`, so e.g. `2026-01-01T05:00` passes validation and yields Invalid Date | |
| `GET /sync/status` | auth | any user | — | returns full `issues[]` |
| `POST /sync/run` | auth + admin | admin | — | SEC-04, REL-02 |
| `GET /targets` | auth | any user | — | |
| `POST /targets`, `DELETE /targets/:client` | auth + admin | admin | ✅ qty ≥ 0; ⚠ `client` free text (any string becomes a target) | |
| `POST /email/send`, `/schedule` | auth + `EMAIL_USER` + 10/15 min | 1 account | ✅ recipients regex, subject, body, `sendAt` ≥ now + 60 s | |
| `GET /email/scheduled`, `DELETE /scheduled/:id` | auth + `EMAIL_USER` | 1 account | ❌ `:id` not checked as an ObjectId → CastError → **process crash** (REL-01) | scoped by `createdByEmail` ✅ (no IDOR) |

- **Privilege escalation:** none found. A manager calling admin or email routes directly gets 403, because the checks are server-side.
- **IDOR:** scheduled emails are filtered by `createdByEmail`. There are no other per-user resources.
- **Mass assignment:** `Target` is built from named fields only ✅. `User` comes from the Google payload only ✅.
- **NoSQL injection:** operator keys are stripped by `mongoSanitize`. Array query values (`?client=a&client=b`) reach Mongo equality matches without effect. Low risk.
- **XSS:**
  - Server responses are JSON.
  - React escapes all rendered data, including sheet-sourced labels and AI text.
  - The one `dangerouslySetInnerHTML` (`EmailComposer.jsx:436`) renders the sender's own composition and static templates. That is self-XSS only.
  - Outgoing email HTML is the authorised sender's own content.
- **SSRF:** the only server-side fetch is keep-alive to `RENDER_EXTERNAL_URL` (fixed). Drive and Gmail are fixed Google endpoints.
- **Unsafe redirects:** every redirect targets `env.clientOrigin`. There are no user-supplied redirect targets ✅.
- **Malicious spreadsheet input:** workbooks come from a Drive the admin controls. `xlsx` 0.18.5 has known prototype-pollution and ReDoS advisories, so a crafted file from anyone with edit access to the folder is the realistic vector (SEC-09).

### SEC-05 · P2 · Large bodies before authentication

`app.use('/api/email', express.json({ limit: '20mb' }))` is mounted **before** the routers, so an unauthenticated client can make the server buffer and parse 20 MB per request (300 requests per 15 min per IP). **Fix:** mount the 20 MB parser inside `email.routes.js` after `requireAuth` and `requireEmail`.

### SEC-10 · P3 · Unauthenticated socket

`sockets/index.js` accepts any connection and broadcasts `sync:completed` (status, row counts, tab names) to every connection. **Fix:** verify the session cookie in `io.use()`.

### SEC-11 · P3 · Information leakage

- Error text reaches the client in: `sync.controller` (`detail: err.message`), `insights.controller` (`detail`), `email.controller` (`Failed to send email: ${err.message}`).
- `SyncLog.issues` exposes Drive folder IDs to every manager.
- There are no stack traces (the global handler returns a generic 500).

### SEC-13 · P3 · No CSP on the client

Helmet covers only the API's responses. `vercel.json` sets no headers. Add a CSP (`default-src 'self'`; `connect-src` the API origin and `wss:`; `img-src` Google avatars and `data:`), plus `X-Frame-Options` / `frame-ancestors`.

---

## 5. Dependencies (`npm audit --omit=dev`, 13 Sep 2026)

| Package | Severity | Direct | Fix |
|---|---|---|---|
| `xlsx` 0.18.5 | **high**: prototype pollution (GHSA-4r6h-8v6p-xvw6), ReDoS (GHSA-5pgg-2g8v-p4x9) | yes | **None on npm.** Install SheetJS ≥ 0.20.3 from `https://cdn.sheetjs.com` (tarball URL in `package.json`). Re-run all checkers afterwards. |
| `nodemailer` | **high** | yes | `npm audit fix` (only `MailComposer` is used, but upgrade anyway) |
| `express`, `body-parser`, `qs` | moderate | yes/no | `npm audit fix` (stays on Express 4) |
| `googleapis` / `googleapis-common` / `gaxios` / `uuid` | moderate | yes | googleapis 180 (breaking; test Drive and Gmail) |
| `node-cron` | moderate (via uuid) | yes | node-cron 4 (breaking API: `schedule` options changed; test) |

The client reports 0 vulnerabilities. Unused dependencies that widen the surface: server `axios`, `nodemon`.

---

## 6. Privacy

| Data | Where | Minimum necessary? |
|---|---|---|
| Staff Google name, email, avatar, Google ID | `User` | ✅ needed for sessions. Kept forever with no deletion path. |
| Admin/connector email | `GoogleToken.connectedByEmail`; shown on Settings and in `/sync/status` to **every** user | ⚠ restrict to admins |
| Refresh tokens (Drive read-only, Gmail send) | `GoogleToken`, AES-256-GCM | ✅ Never sent to the client. Never logged (only `err.message` is logged on failure). |
| Report recipients, email bodies | `ScheduledEmail`, kept forever | ⚠ Add a TTL on sent/cancelled documents (e.g. 90 days) |
| Manpower | Aggregate counts per category; **no names** | ✅ |
| Client names and tonnage | Everywhere; sent to Gemini | ⚠ Business-confidential. Gemini receives the summary JSON with `store:false`. Confirm the Gemini API terms on the key's project allow this data. |
| Logs | `console.*` on Render | ✅ No tokens, JWTs or email bodies logged; scheduled-email IDs and error messages only |

- Drive access is read-only ✅.
- The Gmail scope is send-only ✅.
- No credentials reach the frontend ✅.

**Local-environment hazard.** The local `server/.env` sets `CLIENT_ORIGIN` to the **production** Vercel URL (with a trailing slash, which would also break CORS). If its `MONGODB_URI` is also the production cluster, then `npm run dev` on a laptop runs a second copy of every cron against production. That means duplicate syncs (REL-02) and **duplicate scheduled emails** (REL-04). Keep a separate development database.
