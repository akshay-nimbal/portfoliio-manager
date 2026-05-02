// Google Finance scraper.
//
// No public API. We scrape https://www.google.com/finance/quote/<T>:<EX>.
// First attempt used CSS class selectors (dO6ijd, YMlKec, ...) and broke
// within a week - Google ships obfuscated class names and reshuffles them
// often. Switched to label-driven parsing: find the visible English text
// ("P/E ratio", "EPS") and read the adjacent value. The labels are
// user-facing so they change rarely.
//
// CMP is the first ₹-only text node in document order - Google repeats the
// price wrapper for previous close, 52-week range, etc., but the first one
// is the live price.
//
// Long server TTL (15 min default) because P/E and EPS basically never
// change intraday.

import axios from "axios";
import * as cheerio from "cheerio";

import { cacheFetch } from "@/lib/cache";

const BASE_URL = "https://www.google.com/finance/quote/";
const TTL = Number(process.env.GOOGLE_CACHE_TTL_SECONDS ?? 900);
const REQUEST_TIMEOUT_MS = 8000;
const MAX_CONCURRENCY = 4; // beyond this Google starts 429-ing / 302-ing to consent

// TICKER:EXCHANGE - alphanumeric ticker (or numeric BSE code), short uppercase exchange
const SYMBOL_RE = /^[A-Z0-9.\-]{1,20}:[A-Z]{2,6}$/;

export interface GoogleQuote {
  cmp: number | null;
  peRatio: number | null;
  // free-form earnings text (e.g. "₹65.21") - left as a string so we render it as-is
  latestEarnings: string | null;
}

function assertValidSymbol(symbol: string): asserts symbol is string {
  if (!SYMBOL_RE.test(symbol)) {
    throw new Error(`Invalid Google symbol: ${symbol}`);
  }
}

// axios stashes the final URL on req.res.responseUrl on Node, but it isn't
// in the public types. Narrow defensively rather than `as any`-casting.
function extractFinalUrl(request: unknown): string | undefined {
  if (!request || typeof request !== "object") return undefined;
  const res = (request as { res?: unknown }).res;
  if (!res || typeof res !== "object") return undefined;
  const url = (res as { responseUrl?: unknown }).responseUrl;
  return typeof url === "string" ? url : undefined;
}

// "12.34" / "1,234.56" / "₹65.21" -> number, or null
function parseNumeric(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^0-9.\-]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

// Kept pure so it's easy to spin up a unit test against a saved HTML fixture.
function parseGoogleHtml(html: string): GoogleQuote {
  const $ = cheerio.load(html);

  // CMP: first ₹-only text node in document order.
  let cmp: number | null = null;
  $("div").each((_, el) => {
    if (cmp !== null) return;
    const $el = $(el);
    // own text only, no descendants
    const own = $el
      .contents()
      .filter((__, n) => n.type === "text")
      .text()
      .trim();
    if (/^₹\s?[0-9][0-9,]*(\.[0-9]+)?$/.test(own)) {
      cmp = parseNumeric(own);
    }
  });

  // P/E + EPS: find the label, read the next sibling.
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
    // Sometimes the "next" element echoes the label itself - skip those.
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
        // Google now 302s the canonical URL to /beta/quote/... on the same
        // host. Allow a few hops but cap them so we can't be redirected
        // somewhere weird.
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

      // Belt-and-braces SSRF check: confirm we ended up on google.com.
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
        // soft-fail - row still renders with "—"
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
