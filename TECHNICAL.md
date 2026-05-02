# Technical Document — Portfolio Dashboard

This document accompanies the codebase. It explains the architecture in
one page, then spends the rest of the time on the **concrete challenges
encountered while building this dashboard and the solutions that
shipped**.

---

## 1. Architecture in one diagram

```
                  ┌────────────────────────────┐
   Browser  ◄───► │  Next.js 14 (App Router)   │
   /                │                            │
                  │  ┌──────────────────────┐  │
                  │  │ Client (React)       │  │
                  │  │  - React Query 15s   │  │
                  │  │  - TanStack Table    │  │
                  │  │  - Recharts          │  │
                  │  │  - Tailwind UI       │  │
                  │  └─────────┬────────────┘  │
                  │            │ JSON (no-store)
                  │  ┌─────────▼────────────┐  │
                  │  │ /api/portfolio (Node)│  │
                  │  │  - getHoldings()     │  │
                  │  │  - allSettled join   │  │
                  │  │  - pickCmp() guard   │  │
                  │  │  - in-memory TTL     │  │
                  │  └─────┬───────┬────────┘  │
                  └────────┼───────┼───────────┘
                           ▼       ▼
            Yahoo v8 chart     Google Finance
            (raw axios call)   (axios + cheerio)
                           ▲
                           │ memoised
                  ┌────────┴───────────┐
                  │ src/data/*.xlsx    │
                  │ (xlsx / SheetJS)   │
                  └────────────────────┘
```

Three principles guided the split:

1. **All third-party calls happen on the Node runtime.** The browser
   only speaks to our own `/api/portfolio` endpoint, so we can rotate
   scraping logic, swap providers, or add API keys later without
   exposing anything to the client.
2. **The aggregator is a single endpoint.** The UI deals with one fetch,
   one cache key, one error path. Adding sectors, totals, or warnings
   is a pure server transformation.
3. **Pure functions live in `src/lib/portfolio.ts`.** Investment,
   present value, gain/loss and sector roll-ups have no IO and are
   trivial to unit-test.

---

## 2. Challenges encountered & how each was solved

### Challenge 1 — Neither provider has an official API

**What happened:** the brief explicitly says "no official APIs exist".
On day one this manifested as the obvious problem: which endpoints do I
actually call, and how do I keep them stable?

**Solution — Yahoo Finance (CMP):** I evaluated four endpoints before
landing on the public **v8 chart endpoint**.

| Endpoint | Verdict | Reason |
|---|---|---|
| `yahoo-finance2` library wrapping the **v7 quote** endpoint | ❌ Rejected | Requires a CSRF "crumb" fetched via Yahoo's GDPR consent redirect chain (`guce.yahoo.com`). The redirect doesn't fire from Indian IPs — every quote call returned empty from this machine. |
| **v10 quoteSummary** | ❌ Rejected | Same crumb requirement. |
| **v7 spark** batch endpoint | Considered | One request, multi-symbol, no crumb. Lower metadata than chart. Worth swapping in if call volume grows. |
| **v8 chart** (`query1.finance.yahoo.com/v8/finance/chart/<SYM>`) | ✅ **Shipped** | Public, no crumb, no consent flow, returns `regularMarketPrice` cleanly, sub-second latency. |

The implementation lives in `src/lib/yahoo.ts` — a 130-line file that
talks raw HTTP via `axios`, with no library dependency. Swapping
endpoints later is a one-file change.

**Solution — Google Finance (P/E + EPS):** Google killed its developer
Finance API years ago, so we scrape the public quote page. The first
attempt used CSS-class selectors (`dO6ijd`, `YMlKec`, …) and broke
within a week — Google ships obfuscated class names that change without
notice. The shipped parser instead anchors on the **visible English
labels** ("P/E ratio", "EPS", "Earnings per share") and reads the
adjacent cell. Labels are user-facing and rarely change, which makes
the parser resilient to layout churn.

The same parser also reads the price text as a CMP fallback for the
BSE numeric codes that Yahoo doesn't index.

### Challenge 2 — Yahoo occasionally returns market cap in the price field

**What happened:** the dashboard suddenly showed Fine Organic
(`541557.BO`) at **₹10,69,40,98,160** — Yahoo's v8 chart was returning
the market capitalisation in `regularMarketPrice` for some thinly-traded
BSE symbols.

**Solution:** a `pickCmp(yahooCmp, googleCmp, purchasePrice)` helper in
`src/app/api/portfolio/route.ts` performs three sanity checks before
trusting any quote:

1. **Absolute bound** — reject any price > ₹10,00,000.
2. **Purchase-price ratio** — reject any price > 1000× the original
   purchase price (the user noticed the bogus value precisely because
   it was 10⁹× the cost).
3. **Cross-validation** — if Yahoo and Google disagree by more than
   5×, prefer Google.

`pickCmp()` then picks the saner provider, or returns `null` if both
are clearly wrong. The bogus number never reaches the UI.

### Challenge 3 — Some BSE codes have no Yahoo coverage at all

**What happened:** even after the fix above, ~25 BSE symbols returned
*Not Found* from Yahoo. The original implementation surfaced an amber
banner ("Yahoo did not return CMP for 25 symbol(s); used Google as
fallback"), which the user (correctly) called out as noise — fallback
is the *normal* operating mode for those tickers, not an error.

**Solution:**

- The aggregator quietly cascades Yahoo → Google for CMP via the
  `pickCmp()` helper.
- The warning was removed. The status pill stays green; the row
  populates from Google's price text.
- Per-row provenance is still tracked internally (`source: "yahoo" |
  "google" | "mixed"`) so we can debug if needed without spamming the UI.

### Challenge 4 — Asynchronous fan-out where partial failure is normal

**What happened:** scraping two providers for 26 symbols means
something is *always* slow or temporarily 429'd. A single rejection
must not blank the dashboard.

**Solution:** `/api/portfolio` issues two parallel calls (Yahoo,
Google) using `Promise.allSettled`. If either rejects, the other still
wins. Inside each provider, individual symbols are also `allSettled` —
one failed scrape returns `{ cmp: null }` instead of throwing.

The Google client uses a mini worker-pool pattern (max **4 concurrent**
in-flight requests). Empirically that's the threshold above which
Google starts returning HTTP 429 / 302 to the consent page. Yahoo
tolerates **6 concurrent** requests cleanly.

### Challenge 5 — Real-time updates without hammering upstream

**What happened:** the brief asks for refresh every 15 seconds.
Naïvely that's 26 holdings × 2 providers = 52 upstream calls every 15
seconds per *user* — guaranteed to get blocked.

**Solution — two-layer cache:**

| Layer | TTL | Where |
|---|---|---|
| Server-side TTL (`cacheFetch`) | 15 s for Yahoo, 15 min for Google (P/E + EPS rarely change intraday) | `src/lib/cache.ts` |
| Client-side React Query | `refetchInterval: 15s`, `staleTime: 10s` | `src/hooks/usePortfolio.ts` |

Effect: a hundred users polling every 15 s still produce **at most one
upstream batch per 15 s** (Yahoo) and **one upstream call per symbol per
15 min** (Google). React Query also pauses polling when the tab is
hidden (`refetchIntervalInBackground: false`).

`cacheFetch` additionally supports `staleOnError`: if the upstream
loader throws, the previous cached value is returned instead of
failing — the UI shows a slightly old number rather than a blank cell.

### Challenge 6 — Dev mode showed an empty page (CSP too strict)

**What happened:** after wiring up CSP headers (`default-src 'self'`),
`npm run dev` rendered an empty page in the browser. The terminal was
clean, the API endpoint returned correct JSON, but the React tree
never hydrated.

**Root cause:** Next.js's dev mode uses `eval`-based source maps and a
WebSocket for HMR (Hot Module Replacement). My production-grade CSP
blocked both.

**Solution:** make CSP environment-aware in `next.config.mjs`:

- **Development** — allow `'unsafe-eval'`, `blob:`, `ws:`, `wss:` so
  webpack HMR and React DevTools can run.
- **Production** — strict policy: `default-src 'self'; script-src
  'self'; …` with no `unsafe-eval` and no WebSocket origins.

This keeps the developer experience snappy without weakening the
shipped artefact.

### Challenge 7 — Reading holdings from a real Excel workbook

**What happened:** the case-study Excel sheet is not a simple table.
It interleaves:

- a top row of **group headers** ("Core Fundamentals", "Growth
  Stocks", …)
- a row of **column headers**
- multiple **sector header rows** that have no row number, only a
  sector name and a sector total
- regular **holding rows** (row number + price + qty + exchange code)
- a **grand-total row**
- a separate **"Sold" section** at the bottom that should *not* appear
  on the dashboard
- the occasional `#N/A` in the exchange column

A naïve `xlsx.utils.sheet_to_json` produces garbage from this layout.

**Solution:** a hand-written parser in `src/data/portfolio.ts` that:

1. Reads every `.xlsx` in `src/data/` and picks the first one (so users
   can drop a workbook in without renaming).
2. Walks rows top-to-bottom, tracking the "current sector".
3. Distinguishes sector headers from holding rows by checking whether
   the `No` column is numeric.
4. Stops at the first blank row after the grand-total (everything below
   is the "Sold" section).
5. Routes the `NSE/BSE` cell:
   - alphabetic → NSE → `<TICKER>.NS` (Yahoo) + `<TICKER>:NSE` (Google)
   - numeric   → BSE → `<CODE>.BO`   (Yahoo) + `<CODE>:BOM`  (Google)
6. Memoises the resulting `Holding[]` for the lifetime of the Node
   process. Edit the workbook and restart `next dev` / `next start` to
   refresh.

Swapping this for a database query later is a single-file change — the
rest of the app only depends on the `Holding[]` shape returned by
`getHoldings()`.

### Challenge 8 — Sector-allocation chart didn't differentiate gains from losses

**What happened:** the original Recharts bar chart drew every "Current"
bar in the same colour, so a sector that was *down* visually looked
identical to one that was up.

**Solution:** swap a single `<Bar fill="…">` for `<Bar>` containing one
`<Cell fill={…}/>` per sector, where the colour is derived from the
sector's gain:

- gain ≥ 0 → green (`#10b981`)
- gain < 0 → red   (`#ef4444`)

A custom legend was added so the meaning is obvious at a glance:
`Invested` (slate), `Current (Gain)` (green), `Current (Loss)` (red).

### Challenge 9 — Macro-level developer ergonomics

A handful of small annoyances that ate enough time to be worth
recording:

| Annoyance | Solution |
|---|---|
| `Watchpack Error: EMFILE: too many open files` floods the terminal on macOS | Documented `ulimit -n 10240` in the README's troubleshooting section. |
| `next.config.ts` rejected by Next.js 14 (`.ts` config not supported) | Renamed to `next.config.mjs` and converted to ESM JS. |
| `outputFileTracingIncludes` warning | Moved inside `experimental` per Next.js 14 schema. |
| Stale `.next/` cache caused 404s after switching between `dev` / `build` | `rm -rf .next` documented in troubleshooting. |
| `git push` with a token in the URL leaked the token to shell history | Switched to an **inline credential helper** (`-c http.extraheader=…`) for ad-hoc pushes; ran `gh auth refresh` after revoking the leaked PAT. |

---

## 3. Cross-cutting concerns (not challenges, but worth recording)

### Performance

- React Query memoises the response by query key, so Tailwind's hover
  styles and the table do not trigger network refetches.
- TanStack Table column definitions are wrapped in `useMemo` — re-renders
  diff data only.
- The bar chart re-uses the same `data` reference between renders if
  the sector totals don't change.
- All HTML parsing and Yahoo HTTP work happens server-side and is cached.

### Error handling

- **Network errors** in `usePortfolio` surface a red banner and the
  StatusBar dot turns red.
- **Schema / parse errors** in providers degrade silently — the field
  is set to `null` and rendered as `—`.
- **Validation:** Google symbols are validated against
  `^[A-Z0-9.\-]{1,20}:[A-Z]{2,6}$` before being interpolated into a
  URL. Yahoo symbols are validated against `^[A-Z0-9.\-]{1,20}$`. The
  symbols come from our own static holdings today, but if the data
  source ever moves to user input this is the primary SSRF defence.

### Security

The repo ships no secrets — both provider endpoints are
unauthenticated. Defensive measures still in place:

- `next.config.mjs` sets `Content-Security-Policy`, `X-Frame-Options:
  DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy:
  strict-origin-when-cross-origin`, and HSTS in production.
- The Google client builds its URL via `new URL(encodeURIComponent(symbol),
  BASE_URL)` with a fixed base, validates the symbol shape, allows
  redirects up to **5 hops** (Google's `/beta/` URL needs them) but
  refuses any final URL not under `https://www.google.com/`, and
  enforces an 8 s request timeout — SSRF + DoS countermeasures.
- The aggregator route is `runtime: 'nodejs'` and explicitly
  `Cache-Control: no-store` so no intermediate proxy caches per-user
  data.
- `.gitignore` excludes `.env*` files; only `.env.example` is committed
  and contains no secrets.

### Type safety

Whole codebase compiles under `strict: true`. Domain shapes live in
`src/types/portfolio.ts` and are reused by the API route, the
aggregator, the React hook and the components. There is no `any` in
the production code paths.

---

## 4. Trade-offs and known limitations

- **Holdings come from an Excel workbook on disk.** Suitable for a
  case study and any single-user deployment. For multi-tenant prod,
  swap `getHoldings()` for a per-user database query.
- **In-memory cache only.** Fine for `next dev` / `next start` /
  single-instance deploys. On Vercel's serverless functions or any
  multi-replica deployment the cache fragments per process — swap the
  three functions in `src/lib/cache.ts` for a Redis / Upstash client
  behind the same interface.
- **No WebSocket push.** The brief lists WebSockets as optional.
  Polling every 15 s is enough for this UX and keeps the architecture
  simple (no socket server, no reconnect logic, no per-tab fan-out).
- **No persistent test suite.** The pure functions in
  `src/lib/portfolio.ts` and the parser in `src/lib/google.ts` are
  written to be easy to test — adding `vitest` would be a 10-line PR —
  but it was out of scope for the case study.
- **Google parser is best-effort.** Label-based selectors handle the
  current Google Finance markup. If Google changes the labels we lose
  P/E / EPS but the table keeps rendering and the warning surface is
  ready to be re-enabled.

---

## 5. How to extend

| Want to…                                | Edit                                          |
|-----------------------------------------|-----------------------------------------------|
| Add / remove holdings                   | Replace the `.xlsx` in `src/data/` and restart |
| Change the Excel parsing rules          | `src/data/portfolio.ts`                       |
| Change the polling interval             | `NEXT_PUBLIC_REFRESH_INTERVAL_MS` env         |
| Change cache TTLs                       | `YAHOO_CACHE_TTL_SECONDS`, `GOOGLE_CACHE_TTL_SECONDS` |
| Swap Yahoo for another provider         | Replace `src/lib/yahoo.ts` (same return shape) |
| Replace in-memory cache with Redis      | Re-implement `src/lib/cache.ts`               |
| Add new columns                         | Extend `Holding` / `PortfolioRow` types and `buildColumns` in `PortfolioTable.tsx` |
| Persist holdings in a DB                | Replace the `getHoldings()` import in `route.ts` |

---

## 6. Evaluation checklist (mapped to the brief)

- ✅ **Functionality** — Holdings table with all required columns,
  sector grouping, sector summaries, color-coded gain/loss, 15 s
  auto-refresh, manual refresh.
- ✅ **Code quality** — Strict TS, separated concerns (types / lib /
  data / hooks / components / app), pure aggregation logic, ESLint clean.
- ✅ **Performance** — Two-layer caching (server TTL + React Query),
  bounded concurrency, memoised columns, no N+1 fetches.
- ✅ **Error handling** — `Promise.allSettled` over providers,
  soft-fail per field, stale-on-error, retry-once on the client.
- ✅ **API strategy** — Server-only third-party calls, allow-listed
  symbol shape, redirect-host check, request timeouts, sanity-checked
  prices.
- ✅ **UI / UX** — Tailwind, responsive grid, loading skeleton, status
  pill with countdown, totals card, sector chart with gain/loss
  colouring, accessible table semantics (`scope="col"`, `aria-label`,
  semantic `<section>` per group).
- ✅ **Problem solving** — Trade-offs, mitigations and assumptions
  documented above.
