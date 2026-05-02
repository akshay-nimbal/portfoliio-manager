import { NextResponse } from "next/server";

import { getHoldings } from "@/data/portfolio";
import { fetchGoogleQuotes } from "@/lib/google";
import { buildPortfolio } from "@/lib/portfolio";
import { fetchYahooQuotes } from "@/lib/yahoo";
import type { Quote } from "@/types/portfolio";

// GET /api/portfolio - the server-side aggregator.
//
// Pulls quotes from Yahoo + Google in parallel, joins them with the
// holdings list, and returns the sector-grouped JSON the UI expects.
// Everything sits behind the route so the browser only ever sees our own
// origin (and so we can swap providers without touching the client).

// `force-dynamic` because we want fresh quotes on every request - the per-
// provider TTL caches do the actual rate-limiting.
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

  // allSettled so a Google outage doesn't blank out the table - we'd just
  // lose P/E + earnings for that tick.
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

    // CMP: prefer Yahoo, fall through to Google's scraped price when Yahoo
    // doesn't have the symbol (most BSE numeric codes). Done silently -
    // it's the normal case, not a warning.
    const cmp = pickCmp(y?.cmp, g?.cmp, holding.purchasePrice);

    // P/E + Earnings always come from Google. The Yahoo v8 chart endpoint
    // doesn't carry them, and the v7 quote endpoint that does is gated
    // behind that consent flow we can't get past.
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
      // No intermediate caching - we have our own TTL on the server and
      // React Query on the client.
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

// Pick the more trustworthy of the two CMPs.
//
// Yahoo's v8 chart sometimes returns the market cap in `regularMarketPrice`
// for thinly-traded BSE symbols. Caught this on Fine Organic (541557.BO)
// returning ₹10,603,328,500. Three cheap guards:
//   1. abs cap     - even MRF, the priciest Indian stock, only trades at
//                    ~₹1.4 lakh; anything above ₹10 lakh is bogus.
//   2. cost ratio  - >1000x the user's purchase price (or 1/1000th of it)
//                    is almost certainly the wrong field.
//   3. cross-check - if both providers have a price but disagree by >5x,
//                    trust Google.
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
    if (ratio > 5) return googleCmp;
    return yahooCmp;
  }
  if (yahooSane) return yahooCmp;
  if (typeof googleCmp === "number" && googleCmp > 0) return googleCmp;
  return null;
}
