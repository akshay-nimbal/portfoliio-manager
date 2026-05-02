"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { SectorGroup } from "@/types/portfolio";

interface Props {
  sectors: SectorGroup[];
}

interface ChartDatum {
  sector: string;
  invested: number;
  current: number;
  gain: number;
}

const fmtINRCompact = new Intl.NumberFormat("en-IN", {
  notation: "compact",
  maximumFractionDigits: 1,
  style: "currency",
  currency: "INR",
});

// Keep these in sync with `gain`/`loss` in tailwind.config.ts.
const GAIN = "#10b981";
const LOSS = "#ef4444";
const INVESTED = "#94a3b8";

// Invested vs. current value, side by side per sector. Quick glance answer
// to "which sector is dragging?" - red bar = loss.
export function SectorAllocationChart({ sectors }: Props) {
  const data: ChartDatum[] = sectors.map((s) => ({
    sector: s.sector,
    invested: s.summary.totalInvestment,
    current: s.summary.totalPresentValue,
    gain: s.summary.totalGainLoss,
  }));

  return (
    <section
      aria-label="Sector allocation chart"
      className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"
    >
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Sector Allocation
      </h2>
      <div className="mt-3 h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="sector" tick={{ fontSize: 12 }} />
            <YAxis
              tick={{ fontSize: 12 }}
              tickFormatter={(v: number) => fmtINRCompact.format(v)}
            />
            <Tooltip
              formatter={(value: number) =>
                new Intl.NumberFormat("en-IN", {
                  style: "currency",
                  currency: "INR",
                  maximumFractionDigits: 0,
                }).format(value)
              }
            />
            <Legend
              iconType="circle"
              wrapperStyle={{ fontSize: 12 }}
              payload={[
                { value: "Invested", type: "circle", color: INVESTED },
                { value: "Current (Gain)", type: "circle", color: GAIN },
                { value: "Current (Loss)", type: "circle", color: LOSS },
              ]}
            />
            <Bar dataKey="invested" name="Invested" fill={INVESTED} radius={[4, 4, 0, 0]} />
            <Bar dataKey="current" name="Current" radius={[4, 4, 0, 0]}>
              {data.map((d) => (
                <Cell key={d.sector} fill={d.gain >= 0 ? GAIN : LOSS} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
