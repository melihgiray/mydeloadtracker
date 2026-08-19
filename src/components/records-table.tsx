import type { PersonalRecord } from "@/lib/analytics/records";
import type { Units } from "@/lib/types";

export function RecordsTable({
  records,
  units,
}: {
  records: PersonalRecord[];
  units: Units;
}) {
  if (records.length === 0) {
    return <p className="text-sm text-muted">Log some sets to start setting records.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
            <th className="pb-2 pr-3 font-medium">Exercise</th>
            <th className="pb-2 pr-3 font-medium">Best e1RM</th>
            <th className="pb-2 pr-3 font-medium">From</th>
            <th className="pb-2 font-medium">Top set</th>
          </tr>
        </thead>
        <tbody>
          {records.map((r) => (
            <tr key={r.exerciseId} className="border-b border-border/60 last:border-0">
              <td className="py-2.5 pr-3">
                <span className="font-medium">{r.exerciseName}</span>
                {r.isMajor && (
                  <span className="ml-2 rounded bg-brand/15 px-1.5 py-0.5 text-[10px] font-medium text-brand">
                    MAJOR
                  </span>
                )}
                <div className="text-xs text-muted">{r.muscleGroup}</div>
              </td>
              <td className="whitespace-nowrap py-2.5 pr-3 font-semibold tabular-nums">
                {r.bestE1RM} <span className="text-xs font-normal text-muted">{units}</span>
              </td>
              <td className="whitespace-nowrap py-2.5 pr-3 tabular-nums text-muted">
                {r.bestE1RMWeight}×{r.bestE1RMReps}
              </td>
              <td className="whitespace-nowrap py-2.5 tabular-nums text-muted">
                {r.maxWeight} {units}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
