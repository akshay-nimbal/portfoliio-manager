# Portfolio Dashboard

Dynamic portfolio dashboard that displays a basket of Indian equities with
live data from Yahoo Finance (Current Market Price) and Google Finance
(P/E ratio + latest earnings). Built with **Next.js 14 (App Router)**,
**TypeScript**, **Tailwind CSS**, **TanStack Query**, **TanStack Table** and
**Recharts**.

> Built for the Octa Byte AI case study — see [`TECHNICAL.md`](./TECHNICAL.md)
> for the design write-up, trade-offs and known limitations.

## Features

- Sector-grouped holdings table with per-sector roll-up totals.
- Columns: Particulars, Purchase Price, Qty, Investment, Portfolio %,
  Exchange (NSE/BSE), CMP, Present Value, Gain/Loss, P/E, Latest Earnings.
- Auto-refresh every 15 seconds (configurable) with a manual refresh button.
- Color-coded Gain/Loss (green / red).
- Top-of-page totals card and a sector allocation bar chart.
- Server-side aggregation: all third-party calls happen on the Node runtime,
  the browser only ever sees JSON from `/api/portfolio`.
- In-memory TTL cache (15s for Yahoo, 15min for Google) with stale-on-error
  fallback so a transient upstream outage doesn't blank the dashboard.
- Strict TypeScript, ESLint, security headers, and CSP locked to `self`.

## Tech stack

| Concern        | Choice                                          |
|----------------|-------------------------------------------------|
| Framework      | Next.js 14 (App Router, Node runtime)           |
| Language       | TypeScript (strict mode)                        |
| Styling        | Tailwind CSS                                    |
| Data fetching  | `axios` (server), `fetch` (browser)             |
| Yahoo Finance  | [`yahoo-finance2`](https://www.npmjs.com/package/yahoo-finance2) |
| Google Finance | `axios` + `cheerio` HTML scraping               |
| Table          | `@tanstack/react-table` v8                      |
| Client cache   | `@tanstack/react-query` v5                      |
| Charts         | `recharts`                                      |
| Excel parsing  | `xlsx` (SheetJS) — reads holdings from disk     |

## Prerequisites

- **Node.js ≥ 18.18.0** (required by Next.js 14)
- npm 9+ (or pnpm/yarn — the repo ships only a `package.json`)

## Getting started

```bash
# 1. Install dependencies
npm install

# 2. Optional: copy the example env file and tweak values
cp .env.example .env.local

# 3. Start the dev server
npm run dev
```

The dashboard will be available at <http://localhost:3000>. The first paint
shows a skeleton while the server contacts Yahoo + Google; subsequent
refreshes are served from the in-memory cache and feel instant.

### Available scripts

| Script               | What it does                                             |
|----------------------|----------------------------------------------------------|
| `npm run dev`        | Start the Next.js dev server with hot reload             |
| `npm run build`      | Production build                                         |
| `npm start`          | Run the production build                                 |
| `npm run type-check` | `tsc --noEmit` — fail on any TypeScript error            |
| `npm run lint`       | ESLint via `next lint`                                   |

### Environment variables

All variables are optional — sensible defaults are baked in. Copy
`.env.example` to `.env.local` to customise.

| Variable                          | Default | Purpose                                  |
|-----------------------------------|---------|------------------------------------------|
| `NEXT_PUBLIC_REFRESH_INTERVAL_MS` | 15000   | Browser polling interval (ms)            |
| `YAHOO_CACHE_TTL_SECONDS`         | 15      | Server-side cache TTL for Yahoo quotes   |
| `GOOGLE_CACHE_TTL_SECONDS`        | 900     | Server-side cache TTL for Google scrapes |

There are **no API keys** for either provider. Both endpoints are unofficial.

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
│   ├── SectorAllocationChart.tsx# Recharts bar chart
│   └── StatusBar.tsx            # Live status, countdown, refresh button
├── data/
│   └── portfolio.ts             # Static holdings (sample data)
├── hooks/
│   └── usePortfolio.ts          # React Query hook + polling interval
├── lib/
│   ├── cache.ts                 # In-memory TTL cache helpers
│   ├── format.ts                # Intl-based formatters (INR / %)
│   ├── google.ts                # Google Finance HTML scraper
│   ├── portfolio.ts             # Pure aggregation/grouping logic
│   └── yahoo.ts                 # yahoo-finance2 wrapper
└── types/
    └── portfolio.ts             # Shared domain types
```

## Editing the holdings

Holdings are loaded from the **first `.xlsx` file in `src/data/`** at first
request and cached for the lifetime of the Node process. Edit the workbook,
restart the server (`npm run dev` / `npm start`) and the dashboard reflects
the new positions.

### Expected workbook layout

The loader matches the format used by the case study:

| Row     | Contents                                                       |
|---------|----------------------------------------------------------------|
| Row 0   | Top-level group headers (e.g. "Core Fundamentals", "Growth …") — ignored |
| Row 1   | Column headers — `No`, `Particulars`, `Purchase Price`, `Qty`, `Investment`, `Portfolio (%)`, `NSE/BSE`, … |
| Row 2+  | Either a sector header (no row number, only Particulars + Investment) or a holding row (row number + price + qty + exchange code) |
| End     | Anything after a blank row or the grand-total row (e.g. a "Sold" section) is ignored |

The `NSE/BSE` cell can be either:
- an **NSE ticker** (alphabetic — e.g. `HDFCBANK`) → fetched via `HDFCBANK.NS` (Yahoo) and `HDFCBANK:NSE` (Google), or
- a **BSE numeric code** (e.g. `532174`) → fetched via `532174.BO` (Yahoo) and `532174:BOM` (Google).

Rows whose exchange cell is empty or unrecognised (`#N/A`, etc.) are
skipped so the dashboard never displays a permanently-blank row.

## Deploying

Any Node-friendly host (Vercel, Render, Fly.io, a self-hosted Docker box)
works. Vercel is the path of least resistance:

```bash
npm i -g vercel
vercel deploy
```

The in-memory cache is per-process. On serverless platforms (cold starts,
multiple instances) the cache hit rate goes down; for production traffic
swap the `cacheGet`/`cacheSet`/`cacheFetch` implementation in
`src/lib/cache.ts` for Redis or Upstash without touching call sites.

## Disclaimer

Numbers are illustrative. The dashboard relies on unofficial Yahoo and
Google endpoints that can change without notice. Do not use this for
investment decisions.
