<div align="center">

<img src="client/public/salasar-bg.png" alt="Salasar Techno Engineering Ltd." height="70" />

# Salasar HSD Plant Management Dashboard

**A live production, dispatch, and manpower dashboard — built to replace manual, error-prone Excel reporting with one real-time source of truth.**

[![Live Demo](https://img.shields.io/badge/demo-live-brightgreen)](https://salasar-techno-engg.vercel.app/)
![MERN](https://img.shields.io/badge/stack-MERN-6e56cf)
![React](https://img.shields.io/badge/frontend-React%20%2B%20Vite-61dafb)
![Node](https://img.shields.io/badge/backend-Node%20%2B%20Express-339933)

</div>

---

## The problem

Plant heads and coordinators were tracking production, dispatch, and manpower across a sprawling, manually-updated Excel sheet — checking numbers by scrolling through dozens of columns, compiling weekly performance emails by hand, and having no single, trustworthy view of "where do things actually stand today." Small parsing mistakes or stale copies routinely led to wrong numbers reaching leadership.

This app turns that same spreadsheet into a **live, visual dashboard** — no change in how the team already enters data, but a completely different experience for everyone who needs to read it.

## What it does

- **Reads the department's existing Google Sheet automatically** — no new data-entry habit for the team, no duplicate systems to keep in sync.
- **Turns it into real-time, role-aware dashboards** for both HSD and Bhilai units — production by process stage, dispatch by client, manpower by category and shift — all filterable by date range, updating live over Socket.IO.
- **Builds and sends weekly performance report emails** from inside the dashboard: drag-and-drop images, editable report text, per-client templates (Zetwerk, CNC, COW, Ramboll, and more), and scheduled sending — what used to be a manual, error-prone email-writing task becomes a five-minute job.
- **Keeps access controlled** — Google OAuth login, admin vs. manager roles, and a dedicated Process Coordinator view.

## Why it helps

| Before | With this dashboard |
|---|---|
| Manually scanning a huge spreadsheet for today's numbers | One glance at charts, filtered to any date range |
| Weekly report emails written and formatted by hand | Pre-built templates, ready to review and send in minutes |
| No visibility into shift-wise manpower or per-client dispatch trends | Dedicated charts for every breakdown that matters |
| Numbers only as current as the last time someone checked the sheet | Synced automatically on a schedule, pushed live to everyone viewing |

## Screenshots

![Dashboard overview](docs/screenshots/dashboard.png)
_Live manpower, dispatch, and completion stats with filterable date-range charts._

<!-- Add more screenshots to docs/screenshots/ and reference them the same way, e.g. -->
<!-- ![Email composer](docs/screenshots/email.png) -->

## Tech stack

**Frontend:** React (Vite), Tailwind CSS v4, Recharts, TanStack Query
**Backend:** Node.js, Express, MongoDB (Atlas), Socket.IO, node-cron
**Integrations:** Google OAuth, Google Drive API (spreadsheet sync), Gmail API (report sending)
**Deployed on:** Vercel (client) + Render (server)

## Getting started

```bash
# install
cd server && npm install
cd ../client && npm install

# configure
cp server/.env.example server/.env   # fill in your own credentials

# run
cd server && npm run dev   # http://localhost:5001
cd client && npm run dev   # http://localhost:5173
```

Sign in with Google, then (as an admin) connect Google Drive from **Settings** to start syncing.

---

<div align="center">
<sub>Built for Salasar Techno Engineering Ltd. — Heavy Structure Division</sub>
</div>
