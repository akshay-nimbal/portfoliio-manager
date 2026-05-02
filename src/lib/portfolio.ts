/**
 * Pure functions that turn raw holdings + live quotes into the response
 * shape consumed by the UI.
 *
 * Keeping this side-effect free makes it trivial to unit-test and lets us
 * reuse the same aggregator on the client (e.g. for optimistic updates).
 */

import type {
  Holding,
  PortfolioResponse,
  PortfolioRow,
  Quote,
  SectorGroup,
  SectorSummary,
} from "@/types/portfolio";

interface BuildArgs {
  holdings: Holding[];
  /** Map keyed by holding.id -> quote. Missing entries become null fields. */
  quotes: Map<string, Quote>;
  warnings: string[];
}

/** Round to 2 decimal places without introducing FP noise in JSON output. */
const round2 = (n: number): number => Math.round(n * 100) / 100;

function safe<T>(value: T | null | undefined): T | null {
  return value === undefined || value === null ? null : value;
}

function rowFor(holding: Holding, quote: Quote | undefined): PortfolioRow {
  const cmp = safe(quote?.cmp);
  const peRatio = safe(quote?.peRatio);
  const latestEarnings = safe(quote?.latestEarnings);

  const investment = round2(holding.purchasePrice * holding.quantity);
  const presentValue = cmp === null ? null : round2(cmp * holding.quantity);
  const gainLoss = presentValue === null ? null : round2(presentValue - investment);
  const gainLossPercent =
    presentValue === null || investment === 0
      ? null
      : round2(((presentValue - investment) / investment) * 100);

  return {
    ...holding,
    cmp,
    peRatio,
    latestEarnings,
    investment,
    presentValue,
    gainLoss,
    gainLossPercent,
    // portfolioPercent gets filled in by the caller once it knows the total.
    portfolioPercent: 0,
  };
}

function sectorSummaryFor(rows: PortfolioRow[], sector: string): SectorSummary {
  const totalInvestment = rows.reduce((acc, r) => acc + r.investment, 0);
  const totalPresentValue = rows.reduce(
    (acc, r) => acc + (r.presentValue ?? 0),
    0,
  );
  const totalGainLoss = round2(totalPresentValue - totalInvestment);
  const totalGainLossPercent =
    totalInvestment === 0
      ? 0
      : round2((totalGainLoss / totalInvestment) * 100);

  return {
    sector,
    totalInvestment: round2(totalInvestment),
    totalPresentValue: round2(totalPresentValue),
    totalGainLoss,
    totalGainLossPercent,
    rowCount: rows.length,
  };
}

export function buildPortfolio({
  holdings,
  quotes,
  warnings,
}: BuildArgs): PortfolioResponse {
  // 1. Convert each holding into an enriched row.
  const rows = holdings.map((h) => rowFor(h, quotes.get(h.id)));

  // 2. Compute portfolio total investment and back-fill weight %.
  const totalInvestment = rows.reduce((acc, r) => acc + r.investment, 0);
  for (const row of rows) {
    row.portfolioPercent =
      totalInvestment === 0
        ? 0
        : round2((row.investment / totalInvestment) * 100);
  }

  // 3. Group by sector preserving the order of first appearance.
  const sectorOrder: string[] = [];
  const bySector = new Map<string, PortfolioRow[]>();
  for (const row of rows) {
    if (!bySector.has(row.sector)) {
      sectorOrder.push(row.sector);
      bySector.set(row.sector, []);
    }
    bySector.get(row.sector)!.push(row);
  }

  const sectors: SectorGroup[] = sectorOrder.map((sector) => {
    const sectorRows = bySector.get(sector)!;
    return {
      sector,
      rows: sectorRows,
      summary: sectorSummaryFor(sectorRows, sector),
    };
  });

  // 4. Roll up portfolio-wide totals.
  const totalPresentValue = rows.reduce(
    (acc, r) => acc + (r.presentValue ?? 0),
    0,
  );
  const totalGainLoss = round2(totalPresentValue - totalInvestment);
  const totalGainLossPercent =
    totalInvestment === 0
      ? 0
      : round2((totalGainLoss / totalInvestment) * 100);

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      investment: round2(totalInvestment),
      presentValue: round2(totalPresentValue),
      gainLoss: totalGainLoss,
      gainLossPercent: totalGainLossPercent,
    },
    sectors,
    warnings,
  };
}
