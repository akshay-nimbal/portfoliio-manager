/**
 * Google Finance scraper.
 *
 * Google has no public API for quotes - we scrape the public page at
 * `https://www.google.com/finance/quote/<TICKER>:<EXCHANGE>`. The HTML
 * structure is not contractual, so the parser uses two resilient
 * strategies:
 *
 *   1. CMP    - first DOM element whose text is exactly a `₹X` price
 *               (Google's price wrapper is repeated for previous close,
 *               52-week range etc., but the first occurrence is the
 *               live price).
 *   2. P/E,
 *      EPS   - locate the visible label text ("P/E ratio", "EPS",
 *               "Earnings per share") and read the adjacent value.
 *
 * Hardening notes:
 *  - Symbols are validated against a strict regex (SSRF defence).
 *  - Fixed base URL, redirects bounded to a small number (Google's main
 *    URL now 302s to a `/beta/` URL on the same host).
 *  - Tight per-request timeout + bounded concurrency to avoid rate-limits.
 *  - Long server-side TTL because P/E and EPS rarely change intraday.
 */

import axios from "axios";
import * as cheerio from "cheerio";

import { cacheFetch } from "@/lib/cache";

const BASE_URL = "https://www.google.com/finance/quote/";
const TTL = Number(process.env.GOOGLE_CACHE_TTL_SECONDS ?? 900);
const REQUEST_TIMEOUT_MS = 8000;
const MAX_CONCURRENCY = 4;

// Allow-list: TICKER:EXCHANGE. Tickers can be alphanumeric (NSE) or numeric
// (BSE codes). Exchanges are short uppercase codes (NSE, BOM, etc.).
const SYMBOL_RE = /^[A-Z0-9.\-]{1,20}:[A-Z]{2,6}$/;

export interface GoogleQuote {
  cmp: number | null;
  peRatio: number | null;
  /** Free-form earnings text (e.g. "₹65.21") - kept as a string for display. */
  latestEarnings: string | null;
}

function assertValidSymbol(symbol: string): asserts symbol is string {
  if (!SYMBOL_RE.test(symbol)) {
    throw new Error(`Invalid Google symbol: ${symbol}`);
  }
}

/**
 * Pull the final URL out of axios's underlying Node request object.
 * Returns undefined if the structure isn't what we expect (e.g. running
 * in a different runtime). The narrow-and-check pattern keeps us off
 * `any` and keeps ESLint happy.
 */
function extractFinalUrl(request: unknown): string | undefined {
  if (!request || typeof request !== "object") return undefined;
  const res = (request as { res?: unknown }).res;
  if (!res || typeof res !== "object") return undefined;
  const url = (res as { responseUrl?: unknown }).responseUrl;
  return typeof url === "string" ? url : undefined;
}

/** Convert "12.34" / "1,234.56" / "₹65.21" into a number, or null. */
function parseNumeric(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^0-9.\-]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/** Pure, easily-testable HTML parser. */
function parseGoogleHtml(html: string): GoogleQuote {
  const $ = cheerio.load(html);

  // ----- 1. CMP: first ₹-only text node in document order ----------------
  let cmp: number | null = null;
  $("div").each((_, el) => {
    if (cmp !== null) return;
    const $el = $(el);
    // Look at this element's own text only (not descendants), trimmed.
    const own = $el
      .contents()
      .filter((__, n) => n.type === "text")
      .text()
      .trim();
    if (/^₹\s?[0-9][0-9,]*(\.[0-9]+)?$/.test(own)) {
      cmp = parseNumeric(own);
    }
  });

  // ----- 2. P/E + EPS via label-based extraction --------------------------
  const stats: Record<string, string> = {};
  $("div").each((_, el) => {
    const $el = $(el);
    const text = $el.text().trim();
    if (!text || text.length > 40) return;

    const lower = text.toLowerCase();
    if (
      lower !== "p/e ratio" &&
      lower !== "eps" &&
      lower !== "earnings per share" &&
      lower !== "diluted eps"
    ) {
      return;
    }

    let value = $el.next().text().trim();
    if (!value) value = $el.parent().children().last().text().trim();
    // Skip cases where the "next" element is just the label itself echoed.
    if (value && value !== text) {
      stats[lower] = value;
    }
  });

  return {
    cmp,
    peRatio: parseNumeric(stats["p/e ratio"]),
    latestEarnings:
      stats["eps"] ??
      stats["earnings per share"] ??
      stats["diluted eps"] ??
      null,
  };
}

async function fetchOne(symbol: string): Promise<GoogleQuote> {
  assertValidSymbol(symbol);

  return cacheFetch<GoogleQuote>(
    `google:${symbol}`,
    TTL,
    async () => {
      const url = new URL(encodeURIComponent(symbol), BASE_URL).toString();

      const res = await axios.get<string>(url, {
        timeout: REQUEST_TIMEOUT_MS,
        // Google's canonical URL redirects to /beta/quote/... on the same
        // host. Allow a small number of redirects but cap so we can't be
        // bounced through arbitrary destinations (defence in depth).
        maxRedirects: 5,
        responseType: "text",
        validateStatus: (s) => s >= 200 && s < 300,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          "Accept-Language": "en-US,en;q=0.9",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });

      // Verify we never got bounced off-host (axios reports the final URL
      // via res.request.res.responseUrl on Node). The shape isn't part of
      // axios's public types, so we narrow it manually.
      const finalUrl = extractFinalUrl(res.request);
      if (finalUrl && !finalUrl.startsWith("https://www.google.com/")) {
        throw new Error(`Unexpected redirect target: ${finalUrl}`);
      }

      return parseGoogleHtml(res.data);
    },
    { staleOnError: true },
  );
}

export async function fetchGoogleQuotes(
  symbols: string[],
): Promise<Map<string, GoogleQuote>> {
  const result = new Map<string, GoogleQuote>();
  const queue = [...symbols];

  async function worker() {
    while (queue.length > 0) {
      const symbol = queue.shift();
      if (!symbol) return;
      try {
        result.set(symbol, await fetchOne(symbol));
      } catch {
        // Soft fail - leave the symbol out of the map so the row still
        // renders (with "—" placeholders).
        result.set(symbol, {
          cmp: null,
          peRatio: null,
          latestEarnings: null,
        });
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
