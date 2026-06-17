"use client";

import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { weekLabel } from "@/lib/analytics/dates";
import type { WeeklyExercisePoint } from "@/lib/analytics/progress";

export function ExerciseTrend({ weeks }: { weeks: WeeklyExercisePoint[] }) {
  // Recharts skips nulls, leaving gaps for weeks with no data.
  const data = weeks.map((w) => ({
    label: weekLabel(w.week),
    e1rm: w.bestE1RM > 0 ? w.bestE1RM : null,
  }));

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
          domain={["dataMin - 5", "dataMax + 5"]}
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
          stroke="hsl(152 62% 45%)"
          strokeWidth={2}
          dot={{ r: 3, fill: "hsl(152 62% 45%)" }}
          connectNulls
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
