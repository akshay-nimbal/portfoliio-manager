"use client";

import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { useMemo } from "react";

import {
  formatCurrency,
  formatNumber,
  formatPercent,
  formatPlain,
} from "@/lib/format";
import type { PortfolioRow, SectorGroup } from "@/types/portfolio";

interface Props {
  sectors: SectorGroup[];
}

// green for gains, red for losses, slate for zero/null. Used by row cells
// and by the sector summary in the header.
function tone(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "text-slate-500";
  }
  if (value > 0) return "text-gain";
  if (value < 0) return "text-loss";
  return "text-slate-500";
}

// Defined outside the row loop so react-table's memoisation actually works.
function buildColumns(): ColumnDef<PortfolioRow>[] {
  return [
    {
      header: "Particulars",
      accessorKey: "name",
      cell: ({ row }) => (
        <div className="min-w-[180px]">
          <div className="font-medium text-slate-900 dark:text-slate-100">
            {row.original.name}
          </div>
          <div className="text-xs text-slate-500">{row.original.symbol}</div>
        </div>
      ),
    },
    {
      header: "Purchase ₹",
      accessorKey: "purchasePrice",
      cell: ({ getValue }) => (
        <span className="numeric-cell">
          {formatCurrency(getValue<number>())}
        </span>
      ),
    },
    {
      header: "Qty",
      accessorKey: "quantity",
      cell: ({ getValue }) => (
        <span className="numeric-cell">{formatPlain(getValue<number>())}</span>
      ),
    },
    {
      header: "Investment",
      accessorKey: "investment",
      cell: ({ getValue }) => (
        <span className="numeric-cell">
          {formatCurrency(getValue<number>())}
        </span>
      ),
    },
    {
      header: "Portfolio %",
      accessorKey: "portfolioPercent",
      cell: ({ getValue }) => (
        <span className="numeric-cell">{formatPercent(getValue<number>())}</span>
      ),
    },
    {
      header: "Exchange",
      accessorKey: "exchange",
      cell: ({ getValue }) => (
        <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200">
          {getValue<string>()}
        </span>
      ),
    },
    {
      header: "CMP",
      accessorKey: "cmp",
      cell: ({ getValue }) => (
        <span className="numeric-cell">
          {formatCurrency(getValue<number | null>())}
        </span>
      ),
    },
    {
      header: "Present Value",
      accessorKey: "presentValue",
      cell: ({ getValue }) => (
        <span className="numeric-cell">
          {formatCurrency(getValue<number | null>())}
        </span>
      ),
    },
    {
      header: "Gain / Loss",
      accessorKey: "gainLoss",
      cell: ({ row }) => {
        const value = row.original.gainLoss;
        const pct = row.original.gainLossPercent;
        return (
          <div className={`numeric-cell font-medium ${tone(value)}`}>
            <div>{formatCurrency(value)}</div>
            <div className="text-xs font-normal opacity-80">
              {formatPercent(pct)}
            </div>
          </div>
        );
      },
    },
    {
      header: "P/E",
      accessorKey: "peRatio",
      cell: ({ getValue }) => (
        <span className="numeric-cell">
          {formatNumber(getValue<number | null>(), 2)}
        </span>
      ),
    },
    {
      header: "Latest Earnings",
      accessorKey: "latestEarnings",
      cell: ({ getValue }) => {
        const value = getValue<string | null>();
        return (
          <span className="numeric-cell">{value ?? "—"}</span>
        );
      },
    },
  ];
}

// One table per sector, with the sector's roll-up totals in the header.
function SectorTable({ group }: { group: SectorGroup }) {
  const columns = useMemo(buildColumns, []);

  const table = useReactTable({
    data: group.rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const summaryTone = tone(group.summary.totalGainLoss);

  return (
    <section
      aria-label={`${group.sector} holdings`}
      className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
          {group.sector}
          <span className="ml-2 text-xs font-normal text-slate-500">
            {group.summary.rowCount} holdings
          </span>
        </h3>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <span className="text-slate-500">
            Invested:{" "}
            <span className="font-medium text-slate-900 dark:text-slate-100">
              {formatCurrency(group.summary.totalInvestment)}
            </span>
          </span>
          <span className="text-slate-500">
            Current:{" "}
            <span className="font-medium text-slate-900 dark:text-slate-100">
              {formatCurrency(group.summary.totalPresentValue)}
            </span>
          </span>
          <span className="text-slate-500">
            P/L:{" "}
            <span className={`font-semibold ${summaryTone}`}>
              {formatCurrency(group.summary.totalGainLoss)}{" "}
              ({formatPercent(group.summary.totalGainLossPercent)})
            </span>
          </span>
        </div>
      </header>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-950 dark:text-slate-400">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header, idx) => (
                  <th
                    key={header.id}
                    scope="col"
                    className={`px-4 py-2 ${idx === 0 ? "text-left" : "text-right"}`}
                  >
                    {flexRender(
                      header.column.columnDef.header,
                      header.getContext(),
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className="transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50"
              >
                {row.getVisibleCells().map((cell, idx) => (
                  <td
                    key={cell.id}
                    className={`px-4 py-2 align-top ${idx === 0 ? "text-left" : "text-right"}`}
                  >
                    {flexRender(
                      cell.column.columnDef.cell,
                      cell.getContext(),
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function PortfolioTable({ sectors }: Props) {
  if (sectors.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
        No holdings yet.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {sectors.map((group) => (
        <SectorTable key={group.sector} group={group} />
      ))}
    </div>
  );
}
