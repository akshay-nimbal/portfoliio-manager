"use client";

import { useEffect, useState } from "react";

interface Props {
  isFetching: boolean;
  isError: boolean;
  errorMessage?: string;
  warnings: string[];
  dataUpdatedAt: number;
  refreshIntervalSeconds: number;
  onRefresh: () => void;
}

// Pill + countdown + manual refresh button. Also where non-fatal warnings
// (e.g. Google scraper failed) get surfaced.
export function StatusBar({
  isFetching,
  isError,
  errorMessage,
  warnings,
  dataUpdatedAt,
  refreshIntervalSeconds,
  onRefresh,
}: Props) {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const secondsSinceUpdate = dataUpdatedAt
    ? Math.max(0, Math.floor((now - dataUpdatedAt) / 1000))
    : null;

  const secondsUntilNext =
    dataUpdatedAt && refreshIntervalSeconds
      ? Math.max(0, refreshIntervalSeconds - (secondsSinceUpdate ?? 0))
      : null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-3">
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              isError
                ? "bg-loss"
                : isFetching
                  ? "animate-pulse bg-amber-400"
                  : "bg-gain"
            }`}
            aria-hidden
          />
          <span className="text-slate-600 dark:text-slate-300">
            {isError
              ? "Update failed"
              : isFetching
                ? "Refreshing…"
                : "Live"}
          </span>
          {secondsSinceUpdate !== null && (
            <span className="text-slate-400">
              · updated {secondsSinceUpdate}s ago
            </span>
          )}
          {secondsUntilNext !== null && !isFetching && !isError && (
            <span className="text-slate-400">
              · next refresh in {secondsUntilNext}s
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={onRefresh}
          disabled={isFetching}
          className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          {isFetching ? "Refreshing…" : "Refresh now"}
        </button>
      </div>

      {isError && errorMessage && (
        <div className="rounded-lg border border-loss bg-loss-bg px-4 py-2 text-sm text-loss">
          {errorMessage}
        </div>
      )}

      {warnings.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          {warnings.map((w) => (
            <li key={w}>• {w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
