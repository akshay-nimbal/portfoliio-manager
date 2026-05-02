# Portfolio Dashboard

Dynamic portfolio dashboard that displays a basket of Indian equities with
live data from **Yahoo Finance** (Current Market Price) and **Google
Finance** (P/E ratio + latest earnings). Built with **Next.js 14 (App
Router)**, **TypeScript**, **Tailwind CSS**, **TanStack Query**,
**TanStack Table** and **Recharts**.

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

## Setup

```bash
# 1. Clone and enter
git clone https://github.com/akshay-nimbal/portfoliio-manager.git portfolio-dashboard
cd portfolio-dashboard

# 2. Install dependencies
npm install

```

## Running

### Development

```bash
npm run dev
```

Open <http://localhost:3000>. The first paint shows a loading skeleton
while the server contacts Yahoo + Google; subsequent refreshes are
served from the in-memory cache and feel instant.


### Environment variables

All variables are optional — sensible defaults are baked in. Copy
`.env.example` to `.env.local` to override.

| Variable                          | Default | Purpose                                  |
|-----------------------------------|---------|------------------------------------------|
| `NEXT_PUBLIC_REFRESH_INTERVAL_MS` | 15000   | Browser polling interval (ms)            |
| `YAHOO_CACHE_TTL_SECONDS`         | 15      | Server-side cache TTL for Yahoo quotes   |
| `GOOGLE_CACHE_TTL_SECONDS`        | 900     | Server-side cache TTL for Google scrapes |




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


