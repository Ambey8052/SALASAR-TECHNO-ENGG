# Salasar HSD Plant Management Dashboard

A real-time production/manpower dashboard for the Heavy Structure Division (HSD),
sourced automatically from the department's Google Sheet
(`HSD Projects Progress Sheet-2026`) instead of manual reporting.

MERN stack: MongoDB (Atlas), Express, React (Vite) + Tailwind CSS v4, Node.js.
Google OAuth login, background Google Sheets sync via `node-cron`, and
Socket.IO push so the dashboard updates without a page refresh after each sync.

## What's implemented right now

- **Google OAuth login**, open to any Google account. The first account whose
  email is listed in `ADMIN_EMAILS` becomes an admin; everyone else is a manager.
- **Manpower tab sync**: fully parsed and dashboarded (trend + category breakdown).
- **Production progress** (Adani / L&T MHI / RIL tabs): parsed and dashboarded —
  cutting/fit-up/welding/visual/blasting/final-coat pieces per client, per day.
- **Target, Pending, and Dispatch** are stubbed in the UI ("awaiting data source")
  — the sheet's Daily Dispatch / order-BOQ tabs weren't confirmed yet. Once you
  share those column headers, `server/src/services/parsers/` and
  `dashboard.controller.js` are the two places to extend.

## First-time setup

### 1. Install dependencies

```bash
cd server && npm install
cd ../client && npm install
```

### 2. Configure environment

Copy `server/.env.example` to `server/.env` and fill in the values (a working
`.env` with the credentials you already provided is present but **not** committed
to git — see Security note below).

### 3. Run both apps

```bash
# terminal 1
cd server && npm run dev      # http://localhost:5001

# terminal 2
cd client && npm run dev      # http://localhost:5173 (proxies /api and /socket.io to 5001)
```

Open `http://localhost:5173` and sign in with any Google account.

### 4. Connect Google Drive (one-time, admin only)

The background sync needs its own Google authorization, separate from login,
because it has to run unattended:

1. Sign in as an admin (an email listed in `ADMIN_EMAILS`).
2. Go to **Settings** → click **Connect** next to "Drive not connected".
3. Approve the Google consent screen (requests read-only Sheets access).

This stores an encrypted refresh token in MongoDB (`GoogleToken` collection) that
the cron job (every `SYNC_INTERVAL_MINUTES`, default 10) and the manual
**Sync now** button both use.

**Google Cloud Console note:** the OAuth client's *Authorized redirect URIs*
must include `http://localhost:5001/api/auth/google/callback` and
`http://localhost:5001/api/auth/google/connect-drive/callback` (and
`http://localhost:5173` under *Authorized JavaScript origins*), or Google will
reject the request with `redirect_uri_mismatch`. This is configured in Google
Cloud Console, not in this codebase.

## Project structure

```
server/   Express API, Mongoose models, Sheets sync engine, Socket.IO, cron
client/   React (Vite) + Tailwind dashboard
```

See `server/src/services/parsers/` for the sheet-parsing logic — it's built to
tolerate the sheet's shifting column layout (see "Known limitations" below)
rather than assuming one fixed shape.

## Known limitations / what to verify

- **Manpower parser** was built against an AI-summarized preview of the sheet,
  not a raw dump — after the first real sync, spot-check a few `ManpowerRecord`
  documents in Atlas against the actual sheet for a known date/category.
- **Target / Pending / Dispatch** are not wired to a real data source yet.
- The dashboard currently covers **HSD only**, by design — other departments
  (COW, CNC, Solar, Zetwerk, Octapole, GI, Accessories, Ramboll) would reuse the
  same sync/dashboard pattern once their sheets are shared.

## Security note

`GOOGLE_CLIENT_SECRET` and the MongoDB connection string (with embedded password)
were shared in plain text during setup. Recommend rotating the MongoDB user's
password and the Google OAuth client secret once the app is stable, and never
committing `server/.env` (already gitignored).
