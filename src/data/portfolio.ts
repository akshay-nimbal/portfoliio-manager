import fs from "node:fs";
import path from "node:path";

import * as XLSX from "xlsx";

import type { Exchange, Holding } from "@/types/portfolio";

/**
 * Portfolio data source.
 *
 * The investor maintains their holdings in an Excel sheet (kept under
 * `src/data/*.xlsx`). At the first request we open the workbook, parse out
 * the holdings rows from the first sheet and cache the result for the
 * lifetime of the Node process. The xlsx file is read from disk - no user
 * upload path - so we trust its contents.
 *
 * Recognised sheet shape (matches the format used by the case study):
 *
 *   Row 0:  Top-level group headers ("Core Fundamentals", "Growth …")
 *   Row 1:  Column headers ("No", "Particulars", "Purchase Price", "Qty",
 *           "Investment", "Portfolio (%)", "NSE/BSE", "CMP", …)
 *   Row 2+: Either a sector header row (No empty, Particulars set, Investment set)
 *           or a holding row (No is a positive integer, Particulars set).
 *           A blank row terminates the active portfolio (anything after - the
 *           "Sold Price" section in the sample - is intentionally ignored).
 *
 * Symbol routing: the NSE/BSE column may contain either an NSE ticker
 * (alphabetic, e.g. "HDFCBANK") or a BSE numeric code (e.g. "532174"). The
 * loader detects which and builds the right Yahoo (`*.NS` / `*.BO`) and
 * Google (`*:NSE` / `*:BOM`) symbols.
 */

const DATA_DIR = path.join(process.cwd(), "src", "data");

/** Column indices we care about (0-based, matching the sheet's row 1 header). */
const COL = {
  NO: 0,
  PARTICULARS: 1,
  PURCHASE_PRICE: 2,
  QTY: 3,
  INVESTMENT: 4,
  PORTFOLIO_PCT: 5,
  EXCHANGE: 6,
} as const;

const NSE_TICKER_RE = /^[A-Z][A-Z0-9&-]{1,15}$/;
const BSE_CODE_RE = /^\d{5,7}$/;

let cache: Holding[] | null = null;

/** Find the first .xlsx in src/data (case-insensitive). */
function locateWorkbook(): string | null {
  if (!fs.existsSync(DATA_DIR)) return null;
  const file = fs
    .readdirSync(DATA_DIR)
    .find((f) => f.toLowerCase().endsWith(".xlsx"));
  return file ? path.join(DATA_DIR, file) : null;
}

function asString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[, ]/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Strip "Sector"/"Sectors" suffix and clean up whitespace. */
function normaliseSectorName(raw: string): string {
  return raw.replace(/\s*sectors?\s*$/i, "").trim() || "Uncategorised";
}

/**
 * Make a stable, URL-safe id from a stock name. Used as React key + cache key.
 * We don't use the symbol directly because BSE codes can collide with each
 * other across exchanges and pure-numeric ids look weird in dev tools.
 */
function makeId(name: string, symbol: string): string {
  return `${name}-${symbol}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

interface Routed {
  exchange: Exchange;
  yahooSymbol: string;
  googleSymbol: string;
  symbol: string;
}

/** Decide whether the cell holds an NSE ticker or a BSE numeric code. */
function routeSymbol(rawCell: unknown): Routed | null {
  const cell = asString(rawCell).toUpperCase();
  if (!cell) return null;

  if (NSE_TICKER_RE.test(cell)) {
    return {
      exchange: "NSE",
      symbol: cell,
      yahooSymbol: `${cell}.NS`,
      googleSymbol: `${cell}:NSE`,
    };
  }
  if (BSE_CODE_RE.test(cell)) {
    return {
      exchange: "BSE",
      symbol: cell,
      yahooSymbol: `${cell}.BO`,
      googleSymbol: `${cell}:BOM`,
    };
  }
  // Anything else (e.g. "#N/A", whitespace, blank) is unusable.
  return null;
}

interface RawRow {
  no: unknown;
  name: string;
  purchasePrice: number | null;
  qty: number | null;
  investment: number | null;
  exchangeCell: unknown;
}

function readRow(row: unknown[]): RawRow {
  return {
    no: row[COL.NO],
    name: asString(row[COL.PARTICULARS]),
    purchasePrice: asNumber(row[COL.PURCHASE_PRICE]),
    qty: asNumber(row[COL.QTY]),
    investment: asNumber(row[COL.INVESTMENT]),
    exchangeCell: row[COL.EXCHANGE],
  };
}

/** True if the row is the grand-total summary row (no name, only investment). */
function isGrandTotal(r: RawRow): boolean {
  return (
    asString(r.no) === "" &&
    r.name === "" &&
    r.investment !== null &&
    r.investment > 0
  );
}

/** True if the row is a sector header (no row number, has a name and a total). */
function isSectorHeader(r: RawRow): boolean {
  return (
    asString(r.no) === "" &&
    r.name !== "" &&
    r.purchasePrice === null &&
    r.qty === null &&
    r.investment !== null
  );
}

/** True if the row is a real stock holding. */
function isStockRow(r: RawRow): boolean {
  return (
    asNumber(r.no) !== null &&
    r.name !== "" &&
    r.purchasePrice !== null &&
    r.qty !== null
  );
}

function parseWorkbook(file: string): Holding[] {
  const wb = XLSX.readFile(file, { cellDates: false, raw: true });
  const firstSheet = wb.SheetNames[0];
  if (!firstSheet) throw new Error(`Workbook ${file} has no sheets`);

  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[firstSheet], {
    header: 1,
    defval: "",
    raw: true,
    blankrows: true,
  });

  const holdings: Holding[] = [];
  let currentSector = "Uncategorised";
  let consecutiveBlanks = 0;

  // Skip the two header rows (R0 group headers, R1 column labels).
  for (let i = 2; i < rows.length; i++) {
    const parsed = readRow(rows[i]);

    // A blank row likely marks the end of the active portfolio. Two in a row
    // is the unambiguous terminator (the file may have a single blank gap
    // before the grand total in some templates).
    const isBlank =
      asString(parsed.no) === "" &&
      parsed.name === "" &&
      parsed.investment === null;

    if (isBlank) {
      if (++consecutiveBlanks >= 1) break;
      continue;
    }
    consecutiveBlanks = 0;

    if (isGrandTotal(parsed)) {
      // Everything after the grand total (e.g. the "Sold Price" section)
      // is intentionally ignored - those positions are no longer held.
      break;
    }

    if (isSectorHeader(parsed)) {
      currentSector = normaliseSectorName(parsed.name);
      continue;
    }

    if (!isStockRow(parsed)) {
      // Unknown row layout - skip rather than crash.
      continue;
    }

    const routed = routeSymbol(parsed.exchangeCell);
    if (!routed) {
      // Stocks without a usable exchange symbol cannot be priced; skip them
      // so the table doesn't end up with a row that's permanently "—".
      continue;
    }

    holdings.push({
      id: makeId(parsed.name, routed.symbol),
      name: parsed.name,
      symbol: routed.symbol,
      yahooSymbol: routed.yahooSymbol,
      googleSymbol: routed.googleSymbol,
      exchange: routed.exchange,
      sector: currentSector,
      purchasePrice: parsed.purchasePrice as number,
      quantity: parsed.qty as number,
    });
  }

  return holdings;
}

/**
 * Public accessor. Lazily reads & caches the workbook on first call.
 *
 * If no .xlsx is found in `src/data/` we fall back to an empty list and log
 * a warning - this lets the dashboard render a clear "no holdings" state
 * instead of crashing.
 */
export function getHoldings(): Holding[] {
  if (cache !== null) return cache;

  const file = locateWorkbook();
  if (!file) {
    console.warn(
      "[portfolio] No .xlsx found in src/data/. Add one to load holdings.",
    );
    cache = [];
    return cache;
  }

  try {
    cache = parseWorkbook(file);
    console.info(
      `[portfolio] Loaded ${cache.length} holdings from ${path.basename(file)}.`,
    );
  } catch (err) {
    console.error(`[portfolio] Failed to parse ${file}:`, err);
    cache = [];
  }

  return cache;
}

/** Test/debug hook: drop the cache so the next read re-parses the file. */
export function _resetHoldingsCache(): void {
  cache = null;
}
