import fs from "node:fs";
import path from "node:path";

import * as XLSX from "xlsx";

import type { Exchange, Holding } from "@/types/portfolio";

// Reads holdings out of the investor's Excel sheet (drop one into src/data/).
// The sheet layout the case study ships with is annoyingly non-tabular:
// group banners, sector header rows mixed in with stock rows, a grand-total
// row, then a "Sold Price" section we have to ignore. So no nice
// sheet_to_json - we walk row by row.

const DATA_DIR = path.join(process.cwd(), "src", "data");

// 0-based, matches the column header row.
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

// First .xlsx wins - lets the user drop a workbook in without renaming it.
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

// "Financial Sector" -> "Financial", trim and default if blank.
function normaliseSectorName(raw: string): string {
  return raw.replace(/\s*sectors?\s*$/i, "").trim() || "Uncategorised";
}

// React key + cache key. Plain symbol won't do - bare BSE codes look
// like garbage in dev tools and could collide across exchanges.
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

// Alphabetic -> NSE ticker, numeric -> BSE code, anything else (#N/A, blank...) -> drop.
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

// Grand-total row: no name, just an Investment number.
function isGrandTotal(r: RawRow): boolean {
  return (
    asString(r.no) === "" &&
    r.name === "" &&
    r.investment !== null &&
    r.investment > 0
  );
}

// Sector header: name + total, but no row number / price / qty.
function isSectorHeader(r: RawRow): boolean {
  return (
    asString(r.no) === "" &&
    r.name !== "" &&
    r.purchasePrice === null &&
    r.qty === null &&
    r.investment !== null
  );
}

// A real holding has a row number, a name, a price and a quantity.
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

  // R0 = group banners, R1 = column headers, real data starts at R2.
  for (let i = 2; i < rows.length; i++) {
    const parsed = readRow(rows[i]);

    const isBlank =
      asString(parsed.no) === "" &&
      parsed.name === "" &&
      parsed.investment === null;

    if (isBlank) {
      // First blank ends the active portfolio. Anything below is the
      // "Sold Price" block, which we don't want.
      if (++consecutiveBlanks >= 1) break;
      continue;
    }
    consecutiveBlanks = 0;

    if (isGrandTotal(parsed)) break; // same reason - "Sold" lives below this

    if (isSectorHeader(parsed)) {
      currentSector = normaliseSectorName(parsed.name);
      continue;
    }

    if (!isStockRow(parsed)) continue; // weird row, skip rather than crash

    const routed = routeSymbol(parsed.exchangeCell);
    if (!routed) continue; // no usable symbol -> would render forever as "—"

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

// Lazy + memoised. Restart the dev/prod server to pick up workbook edits.
// On a missing/broken xlsx we fall back to [] and log so the UI can show
// an empty state instead of crashing.
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

// Used by tests to force a re-parse.
export function _resetHoldingsCache(): void {
  cache = null;
}
