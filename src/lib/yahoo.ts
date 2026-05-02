/**
 * Yahoo Finance client (v8 chart endpoint - no auth required).
 *
 * Background:
 *   The widely used `yahoo-finance2` library wraps Yahoo's v7 quote API,
 *   which - since 2023 - requires a "crumb" (CSRF) token. Fetching that
 *   crumb relies on a consent-cookie flow that frequently breaks for
 *   non-EU/non-US clients (e.g. India), causing the whole quote call to
 *   fail silently. We hit that exact issue from this machine.
 *
 *   Yahoo's v8 chart endpoint (`/v8/finance/chart/<SYMBOL>`) is public,
 *   needs no crumb, and returns the regular-market price in its `meta`
 *   block. It's slightly less rich (no `trailingPE` / `epsTtm`) but for
 *   CMP it is far more reliable, and we already source P/E + EPS from
 *   Google Finance.
 *
 * Coverage notes:
 *   - NSE tickers like `HDFCBANK.NS` work everywhere.
 *   - BSE numeric codes (`<code>.BO`) are sparsely covered on Yahoo. When
 *     a `.BO` symbol returns "Not Found" we leave CMP as null here and
 *     let the API route fall back to the Google scraper.
 */

import axios from "axios";

import { cacheFetch } from "@/lib/cache";

const BASE_URL = "https://query1.finance.yahoo.com/v8/finance/chart/";
const TTL = Number(process.env.YAHOO_CACHE_TTL_SECONDS ?? 15);
const REQUEST_TIMEOUT_MS = 8000;
const MAX_CONCURRENCY = 6;

// Allow-list: <ALPHANUM-WITH-DOT-DASH>.<EXCH-SUFFIX> e.g. HDFCBANK.NS, 532174.BO.
const SYMBOL_RE = /^[A-Z0-9.\-]{1,25}$/;

export interface YahooQuote {
  cmp: number | null;
}

function assertValidSymbol(symbol: string): asserts symbol is string {
  if (!SYMBOL_RE.test(symbol)) {
    throw new Error(`Invalid Yahoo symbol: ${symbol}`);
  }
}

interface ChartResponse {
  chart?: {
    result?: Array<{
      meta?: {
        symbol?: string;
        regularMarketPrice?: number;
      };
    }> | null;
    error?: { code?: string; description?: string } | null;
  };
}

async function fetchOne(symbol: string): Promise<YahooQuote> {
  assertValidSymbol(symbol);

  return cacheFetch<YahooQuote>(
    `yahoo:${symbol}`,
    TTL,
    async () => {
      const url = new URL(encodeURIComponent(symbol), BASE_URL);
      url.searchParams.set("interval", "1d");
      url.searchParams.set("range", "1d");

      const res = await axios.get<ChartResponse>(url.toString(), {
        timeout: REQUEST_TIMEOUT_MS,
        // Yahoo never redirects this endpoint; refuse redirects so we can't
        // be tricked into hitting an unintended host (SSRF defence).
        maxRedirects: 0,
        responseType: "json",
        validateStatus: (s) => s >= 200 && s < 500, // accept 404 so we can read its body
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          Accept: "application/json,text/plain,*/*",
        },
      });

      const meta = res.data?.chart?.result?.[0]?.meta;
      const price = typeof meta?.regularMarketPrice === "number"
        ? meta.regularMarketPrice
        : null;

      return { cmp: price };
    },
    { staleOnError: true },
  );
}

/**
 * Batch fetch quotes for many symbols. Returns a Map keyed by the
 * requested symbol so callers can correlate results back to their holdings.
 *
 * Bounded concurrency keeps us from issuing 26+ parallel requests on every
 * 15s tick - Yahoo will throttle that aggressively.
 */
export async function fetchYahooQuotes(
  symbols: string[],
): Promise<Map<string, YahooQuote>> {
  const result = new Map<string, YahooQuote>();
  const queue = [...symbols];

  async function worker() {
    while (queue.length > 0) {
      const symbol = queue.shift();
      if (!symbol) return;
      try {
        result.set(symbol, await fetchOne(symbol));
      } catch {
        // Soft fail: leave CMP as null. The Google scraper acts as the
        // fallback in the API aggregator.
        result.set(symbol, { cmp: null });
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(MAX_CONCURRENCY, symbols.length) },
      () => worker(),
    ),
  );
  return result;
}
