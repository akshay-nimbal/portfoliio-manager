"use client";

import { useQuery } from "@tanstack/react-query";

import type { PortfolioResponse } from "@/types/portfolio";

// Default 15s per the assignment, overridable via env so we can dial it
// down in slow environments (or up if Yahoo gets cranky).
const REFRESH_INTERVAL_MS = (() => {
  const raw = Number(process.env.NEXT_PUBLIC_REFRESH_INTERVAL_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 15_000;
})();

async function fetchPortfolio(): Promise<PortfolioResponse> {
  const res = await fetch("/api/portfolio", {
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

// Single source of truth for the dashboard's live data. React Query handles
// polling, de-duplication, and exposes the isFetching/isError flags the
// status bar reads.
export function usePortfolio() {
  return useQuery<PortfolioResponse, Error>({
    queryKey: ["portfolio"],
    queryFn: fetchPortfolio,
    refetchInterval: REFRESH_INTERVAL_MS,
    // Pause polling when the tab is in the background - no point burning
    // through the rate limit for a tab the user isn't looking at.
    refetchIntervalInBackground: false,
  });
}

export const REFRESH_INTERVAL_SECONDS = Math.round(REFRESH_INTERVAL_MS / 1000);
