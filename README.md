# Portfolio Dashboard

Dynamic portfolio dashboard that displays a basket of Indian equities with
live data from **Yahoo Finance** (Current Market Price) and **Google
Finance** (P/E ratio + latest earnings). Built with **Next.js 14 (App
Router)**, **TypeScript**, **Tailwind CSS**, **TanStack Query**,
**TanStack Table** and **Recharts**.

> Built for the Octa Byte AI case study. See [`TECHNICAL.md`](./TECHNICAL.md)
> for the design write-up — the challenges hit during development and the
> solutions that shipped.

## Features

- Sector-grouped holdings table with per-sector roll-up totals.
- Columns: **Particulars, Purchase Price, Qty, Investment, Portfolio %,
  Exchange (NSE/BSE), CMP, Present Value, Gain/Loss, P/E, Latest
  Earnings**.
- Auto-refresh every 15 seconds (configurable) with a manual refresh button.
- Color-coded Gain / Loss (green / red), including in the sector chart.
- Top-of-page totals card and a sector allocation bar chart (Invested vs
  Current).
- Holdings loaded directly from an Excel workbook on disk — drop your
  `.xlsx` into `src/data/` and restart.
- Server-side aggregation: all third-party calls happen on the Node
  runtime, so the browser only ever sees clean JSON from `/api/portfolio`.
- Two-layer caching (server TTL + React Query) and bounded provider
  concurrency to keep within unofficial-API rate limits.
- Strict TypeScript, ESLint clean, environment-aware Content-Security-
  Policy (relaxed in `dev`, tight in `production`).

## Tech stack

| Concern        | Choice                                          |
|----------------|-------------------------------------------------|
| Framework      | Next.js 14 (App Router, Node runtime)           |
| Language       | TypeScript (`strict: true`)                     |
| Styling        | Tailwind CSS                                    |
| Data fetching  | `axios` (server-side), `fetch` (browser)        |
| Yahoo Finance  | Direct call to public **v8 chart endpoint** (`query1.finance.yahoo.com/v8/finance/chart`) — no library, no auth, no consent flow |
| Google Finance | `axios` + `cheerio` HTML scrape (label-based parser) |
| Table          | `@tanstack/react-table` v8 (the current name for `react-table`) |
| Client cache / polling | `@tanstack/react-query` v5             |
| Charts         | `recharts`                                      |
| Excel parsing  | `xlsx` (SheetJS) — reads holdings from disk     |

## Prerequisites

- **Node.js ≥ 18.18.0** (required by Next.js 14)
- **npm 9+** (or pnpm / yarn — the repo ships only a `package.json`)
- Outbound HTTPS access to `query1.finance.yahoo.com` and `www.google.com`

## Setup

```bash
# 1. Clone and enter
git clone https://github.com/akshay-nimbal/portfoliio-manager.git portfolio-dashboard
cd portfolio-dashboard

# 2. Install dependencies
npm install

# 3. (optional) tweak environment variables
cp .env.example .env.local
```

That's it — no API keys, no database, no extra services.

## Running

### Development

```bash
ulimit -n 10240   # macOS only: silences "EMFILE" file-watcher noise
npm run dev
```

Open <http://localhost:3000>. The first paint shows a loading skeleton
while the server contacts Yahoo + Google; subsequent refreshes are
served from the in-memory cache and feel instant.

### Production

```bash
npm run build
npm start              # serves on http://localhost:3000
PORT=4000 npm start    # …or pick a different port
```

### Available scripts

| Script               | What it does                                     |
|----------------------|--------------------------------------------------|
| `npm run dev`        | Next.js dev server with hot reload               |
| `npm run build`      | Production build                                 |
| `npm start`          | Run the production build                         |
| `npm run lint`       | ESLint via `next lint`                           |
| `npm run type-check` | `tsc --noEmit` — fail on any TypeScript error    |

### Environment variables

All variables are optional — sensible defaults are baked in. Copy
`.env.example` to `.env.local` to override.

| Variable                          | Default | Purpose                                  |
|-----------------------------------|---------|------------------------------------------|
| `NEXT_PUBLIC_REFRESH_INTERVAL_MS` | 15000   | Browser polling interval (ms)            |
| `YAHOO_CACHE_TTL_SECONDS`         | 15      | Server-side cache TTL for Yahoo quotes   |
| `GOOGLE_CACHE_TTL_SECONDS`        | 900     | Server-side cache TTL for Google scrapes |

There are **no API keys** for either provider. Both endpoints are unofficial.

## Loading your own portfolio

Holdings are read from the **first `.xlsx` file in `src/data/`** at first
request and memoised for the lifetime of the Node process. To switch
portfolios, drop a new workbook in and restart the server.

### Expected workbook layout

The loader matches the format used by the case study:

| Row     | Contents                                                       |
|---------|----------------------------------------------------------------|
| Row 0   | Top-level group headers (e.g. "Core Fundamentals", "Growth …") — ignored |
| Row 1   | Column headers — `No`, `Particulars`, `Purchase Price`, `Qty`, `Investment`, `Portfolio (%)`, `NSE/BSE`, … |
| Row 2+  | Either a **sector header** (no row number, only Particulars + Investment) or a **holding row** (row number + price + qty + exchange code) |
| End     | Anything after a blank row or the grand-total row (e.g. a "Sold" section) is ignored |

The `NSE/BSE` cell can be either:

- an **NSE ticker** (alphabetic — e.g. `HDFCBANK`) → fetched via
  `HDFCBANK.NS` (Yahoo) and `HDFCBANK:NSE` (Google), or
- a **BSE numeric code** (e.g. `532174`) → fetched via `532174.BO`
  (Yahoo) and `532174:BOM` (Google).

Rows whose exchange cell is empty or unrecognised (`#N/A`, etc.) are
skipped so the dashboard never displays a permanently-blank row.

## Project structure

```
src/
├── app/
│   ├── api/portfolio/route.ts   # Aggregator endpoint (Node runtime)
│   ├── globals.css              # Tailwind layers + theme tokens
│   ├── layout.tsx               # HTML shell + providers
│   ├── page.tsx                 # Dashboard page (client component)
│   └── providers.tsx            # React Query QueryClientProvider
├── components/
│   ├── PortfolioTable.tsx       # Per-sector tables (TanStack Table)
│   ├── PortfolioTotalsCard.tsx  # Top metric tiles
│   ├── SectorAllocationChart.tsx# Recharts bar chart (red bar on loss)
│   └── StatusBar.tsx            # Live status, countdown, refresh button
├── data/
│   ├── *.xlsx                   # Your portfolio workbook (any name)
│   └── portfolio.ts             # Loader: parses the .xlsx → Holding[]
├── hooks/
│   └── usePortfolio.ts          # React Query hook + polling interval
├── lib/
│   ├── cache.ts                 # In-memory TTL cache helpers
│   ├── format.ts                # Intl-based formatters (INR / %)
│   ├── google.ts                # Google Finance scraper
│   ├── portfolio.ts             # Pure aggregation / sector grouping
│   └── yahoo.ts                 # Yahoo v8 chart endpoint client
└── types/
    └── portfolio.ts             # Shared domain types
```

## Troubleshooting

### Page loads but the table never populates

Hard-refresh the browser (**Cmd / Ctrl + Shift + R**) to bypass any cached
strict CSP headers from an earlier build. The dev CSP allows
`'unsafe-eval'` and WebSockets so React Query can run; if you previously
hit the page during a misconfigured build, the browser may still be
honouring the old policy.

### Pages return 404 in dev

A leftover `.next/` directory from a previous `npm run build` can
confuse `npm run dev`. Wipe it:

```bash
rm -rf .next && npm run dev
```

### Terminal floods with `Watchpack Error: EMFILE: too many open files`

macOS's default per-process file-descriptor limit is too small for
Next.js's watcher when `node_modules` is large. Raise it for the shell
session:

```bash
ulimit -n 10240
npm run dev
```

To make it persistent, add the same line to `~/.zshrc`.

### `Yahoo did not return CMP for X symbols`

Expected. Yahoo's coverage of BSE numeric codes is sparse (`532174.BO`,
`544252.BO`, etc. typically return *Not Found*). The dashboard
transparently falls back to scraping the price from Google Finance for
those symbols — no manual action required.

## Deploying

Any Node-friendly host (Vercel, Render, Fly.io, a self-hosted Docker box)
works. Vercel is the path of least resistance:

```bash
npm i -g vercel
vercel deploy
```

The in-memory cache is per-process. On serverless platforms (cold starts,
multiple instances) the cache hit rate drops; for production traffic
swap the `cacheGet` / `cacheSet` / `cacheFetch` implementation in
`src/lib/cache.ts` for Redis or Upstash without touching call sites.

## Disclaimer

Numbers are illustrative. The dashboard relies on unofficial Yahoo and
Google endpoints that can change without notice. **Do not use this for
investment decisions.**
