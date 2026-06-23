"use client";

import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { weekLabel } from "@/lib/analytics/dates";
import type { WeeklyExercisePoint } from "@/lib/analytics/progress";

const LINE = "#6f9bff";

export function ExerciseTrend({ weeks }: { weeks: WeeklyExercisePoint[] }) {
  // Recharts skips nulls, leaving gaps for weeks with no data.
  const data = weeks.map((w) => ({
    label: weekLabel(w.week),
    e1rm: w.bestE1RM > 0 ? w.bestE1RM : null,
  }));

  // Compute the axis domain ourselves. A string domain like "dataMin - 5" breaks
  // when every point is null (recharts then renders a garbage axis value).
  const vals = data.map((d) => d.e1rm).filter((v): v is number => v != null);
  if (vals.length === 0) {
    return (
      <div className="grid h-[120px] place-items-center text-xs text-muted">
        Not enough data to chart yet.
      </div>
    );
  }
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const pad = Math.max(2, Math.round((max - min) * 0.2));
  const lo = Math.max(0, Math.floor(min - pad));
  const hi = Math.ceil(max + pad);

  return (
    <ResponsiveContainer width="100%" height={120}>
      <LineChart data={data} margin={{ top: 6, right: 6, left: -2, bottom: 0 }}>
        <XAxis
          dataKey="label"
          tick={{ fill: "hsl(215 14% 58%)", fontSize: 11 }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          domain={[lo, hi]}
          allowDecimals={false}
          tick={{ fill: "hsl(215 14% 58%)", fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={52}
        />
        <Tooltip
          contentStyle={{
            background: "hsl(222 20% 11%)",
            border: "1px solid hsl(222 16% 20%)",
            borderRadius: 12,
            fontSize: 12,
          }}
          labelStyle={{ color: "hsl(210 20% 96%)" }}
          formatter={(v: number) => [`${v}`, "e1RM"]}
        />
        <Line
          type="monotone"
          dataKey="e1rm"
          stroke={LINE}
          strokeWidth={2.5}
          dot={{ r: 3, fill: LINE }}
          connectNulls
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
