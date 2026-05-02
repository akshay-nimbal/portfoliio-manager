"use client";

import { useQueryClient } from "@tanstack/react-query";

import { PortfolioTable } from "@/components/PortfolioTable";
import { PortfolioTotalsCard } from "@/components/PortfolioTotalsCard";
import { SectorAllocationChart } from "@/components/SectorAllocationChart";
import { StatusBar } from "@/components/StatusBar";
import {
  REFRESH_INTERVAL_SECONDS,
  usePortfolio,
} from "@/hooks/usePortfolio";

export default function HomePage() {
  const queryClient = useQueryClient();
  const { data, error, isError, isFetching, isPending, dataUpdatedAt } =
    usePortfolio();

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["portfolio"] });
  };

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-6 flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 sm:text-3xl">
          Portfolio Dashboard
        </h1>
        <p className="text-sm text-slate-500">
          Live CMP from Yahoo Finance · P/E and earnings from Google Finance ·
          auto-refresh every {REFRESH_INTERVAL_SECONDS}s
        </p>
      </header>

      <div className="mb-4">
        <StatusBar
          isFetching={isFetching}
          isError={isError}
          errorMessage={error?.message}
          warnings={data?.warnings ?? []}
          dataUpdatedAt={dataUpdatedAt}
          refreshIntervalSeconds={REFRESH_INTERVAL_SECONDS}
          onRefresh={handleRefresh}
        />
      </div>

      {isPending && !data ? (
        <LoadingState />
      ) : data ? (
        <div className="space-y-6">
          <PortfolioTotalsCard totals={data.totals} />
          <SectorAllocationChart sectors={data.sectors} />
          <PortfolioTable sectors={data.sectors} />
          <Footer generatedAt={data.generatedAt} />
        </div>
      ) : (
        <p className="rounded-lg border border-loss bg-loss-bg p-4 text-sm text-loss">
          Could not load portfolio data.{" "}
          {error?.message ?? "Please try again."}
        </p>
      )}
    </main>
  );
}

function LoadingState() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, idx) => (
          <div
            key={idx}
            className="h-24 animate-pulse rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-800"
          />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-800" />
      <div className="h-96 animate-pulse rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-800" />
    </div>
  );
}

function Footer({ generatedAt }: { generatedAt: string }) {
  return (
    <footer className="pt-4 text-center text-xs text-slate-400">
      Snapshot generated at{" "}
      {new Date(generatedAt).toLocaleString("en-IN", {
        dateStyle: "medium",
        timeStyle: "medium",
      })}
      . Data is illustrative and may be inaccurate due to unofficial scraping
      sources. Not investment advice.
    </footer>
  );
}
