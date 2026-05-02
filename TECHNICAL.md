# Technical Document — Portfolio Dashboard

This document accompanies the codebase and explains the design choices,
the technical challenges encountered, and how each one was solved.

## 1. High-level architecture

```
                  ┌────────────────────────────┐
   Browser  ◄───► │  Next.js (App Router)      │
   /dashboard     │                            │
                  │  ┌──────────────────────┐  │
                  │  │ Client (React)       │  │
                  │  │  React Query polling │  │
                  │  │  TanStack Table      │  │
                  │  │  Tailwind UI         │  │
                  │  └─────────┬────────────┘  │
                  │            │ JSON (no-store)
                  │  ┌─────────▼────────────┐  │
                  │  │ /api/portfolio (Node)│  │
                  │  │  - aggregator        │  │
                  │  │  - in-memory cache   │  │
                  │  │  - allSettled join   │  │
                  │  └─────┬───────┬────────┘  │
                  └────────┼───────┼───────────┘
                           ▼       ▼
              Yahoo Finance     Google Finance
              (yahoo-finance2)  (HTML scrape via
                                 axios + cheerio)
```

The split is deliberate:

- **All third-party calls happen on the Node runtime.** The browser only
  speaks to our own `/api/portfolio` endpoint, which means we can rotate
  scraping logic, swap providers, or add API keys later without exposing
  anything to the client.
- **The aggregator is a single endpoint.** The UI deals with one fetch,
  one cache key, one error path. Adding sectors, totals, or warnings is a
  pure server transformation.
- **Pure functions live in `src/lib/portfolio.ts`.** This makes every
  business calculation (investment, present value, gain/loss, sector
  roll-ups, portfolio %) trivial to unit-test and decouples them from
  framework concerns.

## 2. Key challenges and how they were addressed

### 2.1 No official Yahoo / Google Finance APIs

Both providers are unofficial; the brief explicitly asks the candidate to
"acknowledge this and propose solutions". The decision tree below captures
the options I evaluated and what shipped.

#### Yahoo Finance (CMP) — options considered

| Strategy | Status | Why I chose / rejected it |
|---|---|---|
| `yahoo-finance2` library wrapping the **v7 quote** endpoint | ❌ Rejected | Requires a CSRF "crumb" fetched via Yahoo's GDPR consent redirect chain (`guce.yahoo.com`). The redirect doesn't fire from Indian IPs - we observed every quote call returning empty from this machine. |
| Direct **v8 chart** endpoint (`query1.finance.yahoo.com/v8/finance/chart/<SYM>`) | ✅ Shipped | Public, no crumb, no consent flow, sub-second latency. Returns `regularMarketPrice` cleanly. Works for all NSE tickers (`*.NS`). |
| **v7 spark** batch endpoint | Considered | Single request, multi-symbol, no crumb. Slightly less metadata than chart; would be a fine optimisation if call volume grew. |
| **v10 quoteSummary** | ❌ Rejected | Same crumb requirement as v7 quote. |
| **NSE official India API** (`nseindia.com/api/quote-equity`) | Future option | Requires session cookies + headers; aggressively rate-limited; only NSE. Worth adding as a second NSE fallback if Yahoo coverage degrades further. |
| **BSE official India API** (`api.bseindia.com`) | Future option | Useful for the BSE numeric codes Yahoo doesn't index. Currently we cover those via Google's scraper, which is good enough. |

#### Google Finance (P/E + Latest Earnings) — options considered

| Strategy | Status | Why I chose / rejected it |
|---|---|---|
| Official Google Finance API | ❌ Not available | Google retired its developer Finance API years ago. |
| HTML scrape of `google.com/finance/quote/<SYMBOL>:<EX>` with **CSS-class selectors** | ❌ Rejected | Google ships obfuscated class names (`dO6ijd`, `YMlKec`, …) that change without notice. |
| HTML scrape with **label-based selectors** (find visible text "P/E ratio", "EPS", "Earnings per share" and read the adjacent value) | ✅ Shipped | Survives most layout churn; the labels are user-facing and rarely change. Same parser also extracts the price text as a CMP fallback for BSE codes Yahoo lacks. |

#### Effective data-source matrix at runtime

```
                 Yahoo v8 chart          Google Finance scrape
  CMP          : primary  ──── if missing ───►  fallback
  P/E ratio    :     —                          primary
  Latest EPS   :     —                          primary
```

A dedicated `pickCmp()` sanity check in `src/app/api/portfolio/route.ts`
guards against Yahoo occasionally returning the *market cap* in the
`regularMarketPrice` field for thinly-traded BSE symbols (we observed
Fine Organic / 541557.BO returning ₹10.6 billion). The check rejects
prices > ₹10,00,000 absolute, > 1000× the holder's purchase price, or
> 5× different from Google's price — and prefers the saner provider.

#### General mitigations

| Risk | Mitigation |
|---|---|
| Library / endpoint breakage | Each provider lives behind a single thin file (`src/lib/yahoo.ts`, `src/lib/google.ts`). Swapping endpoints is a one-file change. |
| Google HTML structure change | Label-based parsing; the parser tolerates missing fields and returns `null` rather than throwing. |
| Rate limiting / blocks | Two-layer caching (server TTL + React Query) and bounded concurrency (Yahoo 6, Google 4). |
| Inaccurate / missing fields | Every numeric field is `number \| null`. The UI renders `—` for nulls. Bogus values are filtered by `pickCmp()`. |
| Cost of fan-out per refresh | 26 holdings × 15 s polling = at most 26 Yahoo + 26 Google calls per 15 s with cold caches. With caches hot, the browser hits one local endpoint and the server makes zero upstream calls. |

### 2.2 Asynchronous fan-out with partial failure tolerance

`/api/portfolio` issues two parallel calls (Yahoo, Google) using
`Promise.allSettled`. If either one rejects, the other still wins; the
response includes a `warnings: string[]` array which the UI renders in an
amber banner instead of a fatal error. This means a Google outage degrades
the table to "no P/E + no earnings" rather than blanking out the screen.

Inside the Google client we use a mini worker-pool pattern (4 concurrent
in-flight requests) so we never burst-fire 12 simultaneous scrapes at
Google. Empirically that's the threshold above which Google starts
returning HTTP 429 / 302 to the consent page.

### 2.3 Real-time-ish updates without hammering upstream

- The browser polls `/api/portfolio` every 15 s via React Query
  (`refetchInterval`). React Query handles request de-duplication and
  background refresh.
- The server caches Yahoo results for 15 s and Google results for 15 min
  (P/E and EPS rarely change intraday). So even if a hundred users hit
  the dashboard, Yahoo sees at most one batch call per 15 s and Google
  sees at most one call per symbol per 15 min.
- `cacheFetch` supports `staleOnError`: if the loader throws, it returns
  the previous value rather than failing — the UI shows the slightly old
  number instead of blanking.
- Polling is paused when the tab is hidden
  (`refetchIntervalInBackground: false`) to avoid wasted work and quota.

### 2.4 Performance

- React Query memoises the response by query key, so Tailwind's hover
  styles and the table do not trigger network refetches.
- TanStack Table uses memoised column defs (`useMemo`) so re-renders
  only diff the data.
- The bar chart re-uses the same `data` reference between renders if
  the sector totals don't change.
- Heavy work (HTML parsing, Yahoo SDK init) lives on the server and is
  cached.

### 2.5 Error handling

- **Network errors** in `usePortfolio` surface a red banner with the
  error message and the StatusBar dot turns red.
- **Schema/parse errors** in providers degrade silently — the field is
  set to `null` and rendered as `—`. The aggregator pushes a textual
  warning so the user knows part of the data is missing.
- **Validation**: Google symbols are validated against a regex
  (`^[A-Z0-9.\-]{1,20}:[A-Z]{2,6}$`) before being interpolated into a
  URL. This is an SSRF defence — the symbol comes from our own static
  holdings, but if the data source ever moves to user input the
  protection is already in place.

### 2.6 Security

The repository does not ship with any secrets or API keys; both provider
endpoints are unauthenticated. Defensive measures still in place:

- `next.config.mjs` sets `Content-Security-Policy` (`default-src 'self'`),
  `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy`, and HSTS headers.
- The Google client builds its URL via `new URL(encodeURIComponent(symbol), BASE_URL)`
  with a fixed base, validates the symbol shape, **disables redirects**
  (`maxRedirects: 0`), and enforces an 8 s timeout — all SSRF and DoS
  countermeasures.
- The aggregator route is `runtime: 'nodejs'` and explicitly `no-store`
  so no intermediate proxy caches per-user data.
- `.gitignore` excludes `.env*` files (the example file uses
  `.env.example`, which is safe to commit — no secrets in it).

### 2.7 Type safety

The whole codebase compiles under TypeScript `strict: true`. Domain
shapes live in `src/types/portfolio.ts` and are reused by the API route,
the aggregator, the React hook, and the components. There is no `any`
in the production code paths.

## 3. Trade-offs and known limitations

- **Holdings come from an Excel workbook on disk.** The loader in
  `src/data/portfolio.ts` reads the first `.xlsx` in `src/data/`,
  detects sector headers, skips the post-grand-total "Sold" section,
  and routes NSE tickers vs BSE numeric codes to the correct provider
  symbols (`HDFCBANK.NS` / `HDFCBANK:NSE` vs `532174.BO` / `532174:BOM`).
  The parsed list is memoised for the lifetime of the Node process; edit
  the workbook and restart the server to refresh. Swapping this for a
  database query is a single-file change — the rest of the app only
  depends on the `Holding[]` shape returned by `getHoldings()`.
- **In-memory cache only.** Fine for `next dev`/`next start` and any
  single-instance deployment. For Vercel's serverless functions or a
  multi-replica deployment the cache fragments per process; swap the
  three functions in `src/lib/cache.ts` for a Redis client behind the
  same interface.
- **No WebSocket push.** The brief lists WebSockets as optional. Polling
  every 15 s is enough for this UX and keeps the architecture simple
  (no socket server, no reconnect logic, no per-tab fanout).
- **No persistent test suite ships.** The pure functions in
  `src/lib/portfolio.ts` and `src/lib/google.ts` (parser) are written to
  be easy to test — adding `vitest` would be a 10-line PR — but it was
  out of scope for the case study.
- **Google parser is best-effort.** The regex/label approach handles the
  current public Google Finance markup. If Google changes the labels we
  lose P/E / EPS but the table keeps rendering — and the warning banner
  tells the user.

## 4. How to extend

| Want to…                                | Edit                                          |
|-----------------------------------------|-----------------------------------------------|
| Add / remove holdings                   | Edit the `.xlsx` in `src/data/` and restart   |
| Change the Excel parsing rules          | `src/data/portfolio.ts`                       |
| Change the polling interval             | `NEXT_PUBLIC_REFRESH_INTERVAL_MS` env         |
| Change cache TTLs                       | `YAHOO_CACHE_TTL_SECONDS`, `GOOGLE_CACHE_TTL_SECONDS` |
| Swap Yahoo for another provider         | Replace `src/lib/yahoo.ts` (same return shape) |
| Replace in-memory cache with Redis      | Re-implement `src/lib/cache.ts`               |
| Add new columns                         | Extend `Holding` / `PortfolioRow` types and `buildColumns` in `PortfolioTable.tsx` |
| Persist holdings in a DB                | Replace the `HOLDINGS` import in `route.ts`   |

## 5. Evaluation checklist (mapped to the brief)

- ✅ **Functionality** — Holdings table with all required columns, sector
  grouping, sector summaries, color-coded gain/loss, 15s auto-refresh,
  manual refresh.
- ✅ **Code quality** — Strict TS, separated concerns (types / lib / data
  / hooks / components / app), pure aggregation logic, ESLint clean.
- ✅ **Performance** — Two-layer caching (server TTL + React Query),
  bounded concurrency, memoised columns, no N+1 fetches.
- ✅ **Error handling** — `Promise.allSettled` over providers, soft-fail
  per field, warning banner, retry-once on the client.
- ✅ **API strategy** — Server-only third-party calls, allow-listed
  symbol shape, redirects disabled, request timeouts, stale-on-error.
- ✅ **UI** — Tailwind, responsive grid, loading skeleton, status pill,
  totals card, sector chart, accessible table semantics
  (`scope="col"`, `aria-label`, semantic `<section>` per group).
- ✅ **Problem solving** — Trade-offs, mitigations and assumptions
  documented above.
