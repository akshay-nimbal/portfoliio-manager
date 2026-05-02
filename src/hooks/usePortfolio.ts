"use client";

import { useQuery } from "@tanstack/react-query";

import type { PortfolioResponse } from "@/types/portfolio";

/**
 * Refresh interval used by the portfolio dashboard.
 *
 * The assignment asks for "regular intervals (e.g., every 15 seconds)" so we
 * default to 15s. This is overridable via NEXT_PUBLIC_REFRESH_INTERVAL_MS so
 * it can be tuned without a code change in different environments.
 */
const REFRESH_INTERVAL_MS = (() => {
  const raw = Number(process.env.NEXT_PUBLIC_REFRESH_INTERVAL_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 15_000;
})();

async function fetchPortfolio(): Promise<PortfolioResponse> {
  const res = await fetch("/api/portfolio", {
    // Bypass any browser cache; the server route also sets no-store.
    cache: "no-store",
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    throw new Error(
      `Portfolio request failed (${res.status} ${res.statusText})`,
    );
  }
  return (await res.json()) as PortfolioResponse;
}

/**
 * Single source of truth for the dashboard's live data. React Query handles:
 *  - polling on REFRESH_INTERVAL_MS (also when the tab is hidden -> we keep
 *    the previous data on screen so users don't see flicker on focus).
 *  - request de-duplication.
 *  - exposing isFetching/isError/dataUpdatedAt so we can render a status bar.
 */
export function usePortfolio() {
  return useQuery<PortfolioResponse, Error>({
    queryKey: ["portfolio"],
    queryFn: fetchPortfolio,
    refetchInterval: REFRESH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });
}

export const REFRESH_INTERVAL_SECONDS = Math.round(REFRESH_INTERVAL_MS / 1000);
