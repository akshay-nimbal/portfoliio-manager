import { NextResponse } from "next/server";

import { getHoldings } from "@/data/portfolio";
import { fetchGoogleQuotes } from "@/lib/google";
import { buildPortfolio } from "@/lib/portfolio";
import { fetchYahooQuotes } from "@/lib/yahoo";
import type { Quote } from "@/types/portfolio";

/**
 * GET /api/portfolio
 *
 * Server-side aggregator: pulls live quotes from Yahoo Finance + Google
 * Finance, joins them with the static holdings file, and returns the
 * sector-grouped response shape expected by the dashboard.
 *
 * Why server-side?
 *  - We must not expose third-party endpoints (or any future API keys) to
 *    the browser.
 *  - All caching, rate-limiting and HTML scraping happen here so the client
 *    only deals with clean JSON.
 */

// Always run dynamically - we want fresh quotes (subject to the in-memory
// cache TTLs in the Yahoo/Google clients) on every request.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const warnings: string[] = [];
  const holdings = getHoldings();

  if (holdings.length === 0) {
    warnings.push(
      "No holdings loaded. Add an .xlsx file to src/data/ and restart.",
    );
  }

  const yahooSymbols = holdings.map((h) => h.yahooSymbol);
  const googleSymbols = holdings.map((h) => h.googleSymbol);

  // Run the two providers in parallel. `allSettled` so a Google outage does
  // not blank out the whole table - we just lose P/E + earnings for that
  // refresh tick and surface a warning.
  const [yahooSettled, googleSettled] = await Promise.allSettled([
    fetchYahooQuotes(yahooSymbols),
    fetchGoogleQuotes(googleSymbols),
  ]);

  const yahooMap =
    yahooSettled.status === "fulfilled" ? yahooSettled.value : new Map();
  const googleMap =
    googleSettled.status === "fulfilled" ? googleSettled.value : new Map();

  if (yahooSettled.status === "rejected") {
    warnings.push("Yahoo Finance lookup failed - CMP unavailable.");
  }
  if (googleSettled.status === "rejected") {
    warnings.push(
      "Google Finance lookup failed - P/E and earnings unavailable.",
    );
  }

  const quotes = new Map<string, Quote>();

  for (const holding of holdings) {
    const y = yahooMap.get(holding.yahooSymbol);
    const g = googleMap.get(holding.googleSymbol);

    // CMP: prefer Yahoo (dedicated quote endpoint, sub-second latency) but
    // fall through to Google's scraped price for symbols Yahoo doesn't
    // index - chiefly BSE numeric codes like `532174.BO`. The cascade is
    // silent: missing-on-one-provider is the normal case here, not a fault
    // worth surfacing in the UI.
    const cmp = pickCmp(y?.cmp, g?.cmp, holding.purchasePrice);

    // P/E and Latest Earnings: per the assignment spec these come from
    // Google Finance. We do not synthesise a P/E from Yahoo because the v8
    // chart endpoint we use does not expose it (the v7 quote endpoint that
    // does is broken behind Yahoo's consent flow from many regions).
    const peRatio = g?.peRatio ?? null;
    const latestEarnings = g?.latestEarnings ?? null;

    let source: Quote["source"];
    if (y?.cmp != null && g) source = "mixed";
    else if (g) source = "google";
    else if (y?.cmp != null) source = "yahoo";
    else source = "stale-cache";

    quotes.set(holding.id, { cmp, peRatio, latestEarnings, source });
  }

  const payload = buildPortfolio({ holdings, quotes, warnings });

  return NextResponse.json(payload, {
    headers: {
      // Disable any intermediate caching - the client polls on its own
      // schedule and the server has its own TTL cache.
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

/**
 * Choose the most trustworthy CMP between the two providers.
 *
 * Yahoo's v8 chart endpoint occasionally returns the *market cap* in the
 * `regularMarketPrice` field for thinly-traded BSE symbols (we observed
 * Fine Organic / 541557.BO returning ₹10,603,328,500). Two cheap heuristics
 * catch this:
 *
 *   1. Absolute bound: no Indian equity trades above ₹10,00,000.
 *      MRF (the highest-priced one) is around ₹1.4 lakh.
 *   2. Cross-check: if Google has a price and Yahoo's is more than 5x
 *      different in either direction, prefer Google.
 *   3. Sanity: if Yahoo's price is more than 1000x the holder's purchase
 *      price (or 1/1000th of it), it is almost certainly the wrong field.
 */
function pickCmp(
  yahooCmp: number | null | undefined,
  googleCmp: number | null | undefined,
  purchasePrice: number,
): number | null {
  const ABS_MAX = 1_000_000;

  const yahooSane =
    typeof yahooCmp === "number" &&
    yahooCmp > 0 &&
    yahooCmp < ABS_MAX &&
    (purchasePrice <= 0 ||
      (yahooCmp / purchasePrice < 1000 && purchasePrice / yahooCmp < 1000));

  if (yahooSane && typeof googleCmp === "number" && googleCmp > 0) {
    const ratio = Math.max(yahooCmp / googleCmp, googleCmp / yahooCmp);
    if (ratio > 5) return googleCmp; // disagreement too wide - trust Google
    return yahooCmp;
  }
  if (yahooSane) return yahooCmp;
  if (typeof googleCmp === "number" && googleCmp > 0) return googleCmp;
  return null;
}
