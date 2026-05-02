// Yahoo Finance CMP client.
//
// Originally tried `yahoo-finance2` (wraps the v7 quote API). It needs a
// CSRF "crumb" which you only get after Yahoo's GDPR consent redirect, and
// that whole dance never completes from an Indian IP - every call returned
// empty. The v8 chart endpoint below is the public fallback: no crumb, no
// consent, just `regularMarketPrice` in the meta block. Less metadata than
// v7 quote, but P/E + EPS come from Google anyway so we don't need it.
//
// Coverage caveat: NSE tickers (HDFCBANK.NS) work fine; BSE numeric codes
// (532174.BO) are hit-and-miss. We return null on a miss and let the API
// route cascade to Google.

import axios from "axios";

import { cacheFetch } from "@/lib/cache";

const BASE_URL = "https://query1.finance.yahoo.com/v8/finance/chart/";
const TTL = Number(process.env.YAHOO_CACHE_TTL_SECONDS ?? 15);
const REQUEST_TIMEOUT_MS = 8000;
const MAX_CONCURRENCY = 6; // any higher and Yahoo starts throttling

// e.g. HDFCBANK.NS, 532174.BO
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
        maxRedirects: 0, // v8 chart never redirects; refuse to be bounced elsewhere
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

// Batch fetch via a tiny worker pool. Returned map is keyed by the symbol
// the caller asked for, so they can correlate back to their holdings.
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
        // soft-fail: caller will fall back to Google
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
