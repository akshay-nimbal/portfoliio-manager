// Domain types shared by the API route, the aggregator and the React tree.

export type Exchange = "NSE" | "BSE";

// What the investor entered (purchase side). These never change at runtime.
export interface Holding {
  id: string;
  name: string;
  symbol: string;
  // e.g. HDFCBANK.NS / 532174.BO
  yahooSymbol: string;
  // e.g. HDFCBANK:NSE / 532174:BOM
  googleSymbol: string;
  exchange: Exchange;
  sector: string;
  purchasePrice: number;
  quantity: number;
}

// Live quote from upstream. Nullable everywhere because either provider can
// fail per-symbol and we don't want to crash the row.
export interface Quote {
  cmp: number | null;
  peRatio: number | null;
  // EPS comes back as a free-form string (e.g. "₹65.21") - kept as-is for display.
  latestEarnings: string | null;
  // Useful when debugging which provider populated this row.
  source?: "yahoo" | "google" | "mixed" | "stale-cache";
}

// Holding + quote + derived analytics. This is what the table renders.
export interface PortfolioRow extends Holding {
  cmp: number | null;
  peRatio: number | null;
  latestEarnings: string | null;
  investment: number;
  presentValue: number | null;
  gainLoss: number | null;
  gainLossPercent: number | null;
  // 0..100
  portfolioPercent: number;
}

export interface SectorSummary {
  sector: string;
  totalInvestment: number;
  totalPresentValue: number;
  totalGainLoss: number;
  totalGainLossPercent: number;
  rowCount: number;
}

export interface SectorGroup {
  sector: string;
  rows: PortfolioRow[];
  summary: SectorSummary;
}

// What /api/portfolio returns.
export interface PortfolioResponse {
  generatedAt: string;
  totals: {
    investment: number;
    presentValue: number;
    gainLoss: number;
    gainLossPercent: number;
  };
  sectors: SectorGroup[];
  // non-fatal stuff (e.g. "Yahoo Finance lookup failed")
  warnings: string[];
}
