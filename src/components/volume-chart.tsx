"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

// A fixed, readable palette cycled across muscle groups.
const COLORS = [
  "#34d399",
  "#60a5fa",
  "#f59e0b",
  "#f472b6",
  "#a78bfa",
  "#22d3ee",
  "#fb7185",
  "#facc15",
  "#4ade80",
  "#818cf8",
];

// Structural prop: works for both the tonnage report and the set-volume report,
// since both expose `rows` (with a `label`) and `muscleGroups`.
interface ChartReport {
  rows: Array<{ label: string } & Record<string, number | string>>;
  muscleGroups: string[];
}

export function VolumeChart({
  report,
  unit,
  height = 300,
  showLegend = true,
}: {
  report: ChartReport;
  /** Appended in the tooltip, e.g. "sets" or "kg". */
  unit?: string;
  height?: number;
  showLegend?: boolean;
}) {
  if (report.muscleGroups.length === 0) {
    return (
      <div className="grid place-items-center text-sm text-muted" style={{ height }}>
        Nothing logged in this window yet.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={report.rows} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(222 16% 20%)" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fill: "hsl(215 14% 58%)", fontSize: 12 }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tick={{ fill: "hsl(215 14% 58%)", fontSize: 12 }}
          tickLine={false}
          axisLine={false}
          width={56}
        />
        <Tooltip
          contentStyle={{
            background: "hsl(222 20% 11%)",
            border: "1px solid hsl(222 16% 20%)",
            borderRadius: 12,
            fontSize: 12,
          }}
          labelStyle={{ color: "hsl(210 20% 96%)" }}
          cursor={{ fill: "hsl(222 18% 15% / 0.5)" }}
          formatter={(value) => (unit ? `${value} ${unit}` : `${value}`)}
        />
        {showLegend && <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />}
        {report.muscleGroups.map((mg, i) => (
          <Bar
            key={mg}
            dataKey={mg}
            stackId="vol"
            fill={COLORS[i % COLORS.length]}
            radius={i === report.muscleGroups.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
