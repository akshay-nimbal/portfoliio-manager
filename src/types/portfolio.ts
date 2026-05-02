/**
 * Domain types for the portfolio dashboard.
 * Kept framework-agnostic so they can be reused by API handlers and React components.
 */

export type Exchange = "NSE" | "BSE";

/**
 * A single holding as defined statically in the portfolio (the "input" side).
 * The fields here are entered by the investor and never change at runtime.
 */
export interface Holding {
  /** Unique id for React keys (kept stable). */
  id: string;
  /** Display name (e.g. "HDFC Bank"). */
  name: string;
  /** Exchange ticker symbol (e.g. "HDFCBANK"). */
  symbol: string;
  /** Yahoo Finance symbol (NSE symbols are usually `<SYMBOL>.NS`). */
  yahooSymbol: string;
  /** Google Finance symbol path (e.g. "HDFCBANK:NSE"). */
  googleSymbol: string;
  /** Exchange where it is listed. */
  exchange: Exchange;
  /** Sector bucket used for grouping (e.g. "Financials"). */
  sector: string;
  /** Average purchase price in INR. */
  purchasePrice: number;
  /** Number of shares held. */
  quantity: number;
}

/**
 * Live quote returned from the upstream finance providers.
 * `null` fields indicate a soft failure - the row should still render with
 * a clear "—" placeholder rather than crashing the whole table.
 */
export interface Quote {
  /** Current Market Price (Yahoo Finance). */
  cmp: number | null;
  /** Trailing P/E (Google Finance, falls back to Yahoo). */
  peRatio: number | null;
  /** Latest reported earnings (EPS string from Google Finance). */
  latestEarnings: string | null;
  /** Provider that satisfied the request, useful for debugging in dev. */
  source?: "yahoo" | "google" | "mixed" | "stale-cache";
}

/**
 * A holding enriched with live market data and derived analytics.
 * This is the row shape consumed by the table component.
 */
export interface PortfolioRow extends Holding {
  cmp: number | null;
  peRatio: number | null;
  latestEarnings: string | null;
  investment: number;
  presentValue: number | null;
  gainLoss: number | null;
  gainLossPercent: number | null;
  /** Weight of this holding in the overall portfolio (0-100). */
  portfolioPercent: number;
}

/** Aggregated metrics for a single sector. */
export interface SectorSummary {
  sector: string;
  totalInvestment: number;
  totalPresentValue: number;
  totalGainLoss: number;
  totalGainLossPercent: number;
  rowCount: number;
}

/** A sector bucket with its rows and roll-up totals. */
export interface SectorGroup {
  sector: string;
  rows: PortfolioRow[];
  summary: SectorSummary;
}

/** Top-level response shape returned by `/api/portfolio`. */
export interface PortfolioResponse {
  generatedAt: string;
  totals: {
    investment: number;
    presentValue: number;
    gainLoss: number;
    gainLossPercent: number;
  };
  sectors: SectorGroup[];
  /** Non-fatal warnings (e.g. partial provider failures). */
  warnings: string[];
}
