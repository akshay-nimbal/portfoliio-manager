"use client";

import { formatCurrency, formatPercent } from "@/lib/format";
import type { PortfolioResponse } from "@/types/portfolio";

interface Props {
  totals: PortfolioResponse["totals"];
}

function metricTone(value: number): string {
  if (value > 0) return "text-gain";
  if (value < 0) return "text-loss";
  return "text-slate-500";
}

export function PortfolioTotalsCard({ totals }: Props) {
  const tone = metricTone(totals.gainLoss);

  return (
    <section
      aria-label="Portfolio totals"
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
    >
      <Card label="Total Investment" value={formatCurrency(totals.investment)} />
      <Card label="Present Value" value={formatCurrency(totals.presentValue)} />
      <Card
        label="Gain / Loss"
        value={formatCurrency(totals.gainLoss)}
        valueClassName={tone}
      />
      <Card
        label="Return %"
        value={formatPercent(totals.gainLossPercent)}
        valueClassName={tone}
      />
    </section>
  );
}

interface CardProps {
  label: string;
  value: string;
  valueClassName?: string;
}

function Card({ label, value, valueClassName = "" }: CardProps) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <p
        className={`mt-2 text-2xl font-semibold tabular-nums ${valueClassName}`}
      >
        {value}
      </p>
    </div>
  );
}
