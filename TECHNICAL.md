# Technical Document

## 1. Challenges encountered & how each was solved

### Challenge 1 — Neither provider has an official API

**What happened:** the brief explicitly says "no official APIs exist". and how to keep them stable?

**Solution — Yahoo Finance (CMP):** I evaluated four endpoints before
landing on the public **v8 chart endpoint**.

| Endpoint | Verdict | Reason |
|---|---|---|
| `yahoo-finance2` library wrapping the **v7 quote** endpoint | ❌ Rejected | Requires a CSRF fetched via Yahoo's GDPR consent redirect chain (`guce.yahoo.com`). The redirect doesn't fire from Indian IPs — every quote call returned empty from this machine. |
| **v10 quoteSummary** | ❌ Rejected | Same requirement. |
| **v7 spark** batch endpoint | Considered | One request, multi-symbol, no crumb. Lower metadata than chart. Worth swapping in if call volume grows. |

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
the parser resilient.

The same parser also reads the price text as a CMP fallback for the
BSE numeric codes that Yahoo doesn't index.

### Challenge 2 — Some BSE codes have no Yahoo coverage at all

**What happened:** even after the fix above, ~25 BSE symbols returned
*Not Found* from Yahoo. The original implementation surfaced an amber
banner ("Yahoo did not return CMP for 25 symbol(s); used Google as
fallback"), which the user (correctly) called out as noise — fallback
is the *normal* operating mode for those tickers, not an error.

**Solution:**

- The aggregator quietly cascades Yahoo → Google for CMP via the helper.
- The warning was removed. The status pill stays green; the row
  populates from Google's price text.
- Per-row provenance is still tracked internally (`source: "yahoo" |
  "google" | "mixed"`) so we can debug if needed without spamming the UI.

### Challenge 3 — Asynchronous fan-out where partial failure is normal

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

### Challenge 4 — Real-time updates without hammering upstream

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

### Challenge 5 — Dev mode showed an empty page (CSP too strict)

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

### Challenge 6 — Reading holdings from a real Excel workbook

**What happened:** the case-study Excel sheet is not a simple table.
It has:

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


---
