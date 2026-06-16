"use client";

import { useEffect, useMemo, useState } from "react";
import { Trophy } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { toKg } from "@/lib/units";
import type { Sex, Units } from "@/lib/types";
import {
  classifyLift,
  overallStrength,
  cadenceFor,
  isStandardLift,
  type StrengthLevelId,
} from "@/lib/analytics/standards";

const BW_KEY = "mdt_bodyweight";
const SEX_KEY = "mdt_sex";

// Ascending achievement palette for the five bands (HSL channels).
const LEVEL_HSL: Record<StrengthLevelId, string> = {
  beginner: "215 14% 58%",
  novice: "199 89% 55%",
  intermediate: "152 62% 45%",
  advanced: "38 92% 55%",
  elite: "270 75% 65%",
};

const solid = (id: StrengthLevelId) => `hsl(${LEVEL_HSL[id]})`;
const tint = (id: StrengthLevelId) => `hsl(${LEVEL_HSL[id]} / 0.15)`;

function LevelBadge({ id, label }: { id: StrengthLevelId; label: string }) {
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={{ color: solid(id), backgroundColor: tint(id) }}
    >
      {label}
    </span>
  );
}

export function StrengthStandards({
  lifts,
  units,
  initialBodyweight,
  initialSex,
}: {
  lifts: { name: string; e1rm: number }[];
  units: Units;
  initialBodyweight: number | null;
  initialSex: Sex | null;
}) {
  const [bodyweight, setBodyweight] = useState(
    initialBodyweight != null ? String(initialBodyweight) : "",
  );
  const [sex, setSex] = useState<Sex | null>(initialSex);

  // Hydrate from localStorage only for fields the server didn't already provide,
  // so the feature works before the DB migration is applied. Runs post-mount to
  // avoid an SSR/CSR mismatch.
  useEffect(() => {
    if (initialBodyweight == null) {
      const v = localStorage.getItem(BW_KEY);
      if (v) setBodyweight(v);
    }
    if (initialSex == null) {
      const v = localStorage.getItem(SEX_KEY);
      if (v === "male" || v === "female") setSex(v);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When the server-provided bodyweight changes (e.g. the athlete flipped the
  // unit toggle and the page re-rendered with a converted value), follow it.
  useEffect(() => {
    if (initialBodyweight != null) setBodyweight(String(initialBodyweight));
  }, [initialBodyweight]);

  async function persist(bw: string, s: Sex | null) {
    if (bw) localStorage.setItem(BW_KEY, bw);
    if (s) localStorage.setItem(SEX_KEY, s);
    // Best-effort server save; silently ignored if the migration adding these
    // columns hasn't been applied yet.
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const n = Number(bw);
      await supabase
        .from("profiles")
        .update({ bodyweight: Number.isFinite(n) && n > 0 ? toKg(n, units) : null, sex: s })
        .eq("id", user.id);
    } catch {
      /* no-op: localStorage already holds the value */
    }
  }

  const bwNum = Number(bodyweight);
  const ready = Number.isFinite(bwNum) && bwNum > 0 && sex != null;

  const e1rmByLift = useMemo(
    () => new Map(lifts.filter((l) => isStandardLift(l.name)).map((l) => [l.name, l.e1rm])),
    [lifts],
  );

  const overall = ready ? overallStrength(e1rmByLift, bwNum, sex) : null;
  const cadence = cadenceFor(overall?.level.id);

  const perLift = useMemo(() => {
    if (!ready) return [];
    return lifts
      .filter((l) => isStandardLift(l.name) && l.e1rm > 0)
      .map((l) => classifyLift(l.name as Parameters<typeof classifyLift>[0], l.e1rm, bwNum, sex!))
      .filter((x): x is NonNullable<typeof x> => x != null)
      .sort((a, b) => b.level.rank - a.level.rank || b.ratio - a.ratio);
  }, [lifts, ready, bwNum, sex]);

  return (
    <div className="card">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Trophy className="h-4 w-4 text-brand" />
          <h2 className="font-semibold">Strength standards</h2>
        </div>
        <span className="text-xs text-muted">vs lifter population</span>
      </div>

      {/* Bodyweight + sex inputs */}
      <div className="grid grid-cols-[1fr_auto] gap-3">
        <div>
          <label className="label">Bodyweight ({units})</label>
          <input
            type="number"
            inputMode="decimal"
            className="input"
            placeholder={units === "kg" ? "80" : "176"}
            value={bodyweight}
            onChange={(e) => {
              setBodyweight(e.target.value);
              if (e.target.value) localStorage.setItem(BW_KEY, e.target.value);
            }}
            onBlur={() => persist(bodyweight, sex)}
          />
        </div>
        <div>
          <label className="label">Sex</label>
          <div className="inline-flex rounded-xl border border-border p-1">
            {(["male", "female"] as Sex[]).map((s) => (
              <button
                key={s}
                onClick={() => {
                  setSex(s);
                  persist(bodyweight, s);
                }}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium capitalize transition-colors ${
                  sex === s ? "bg-brand text-brand-foreground" : "text-muted hover:text-foreground"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!ready ? (
        <p className="mt-4 text-sm text-muted">
          Enter your bodyweight and sex to see how each main lift stacks up, Beginner through
          Elite, and to tune deload timing to your experience level.
        </p>
      ) : (
        <>
          {/* Overall level + cadence */}
          {overall && (
            <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-background/60 p-3 text-sm">
              <span className="text-muted">Overall:</span>
              <LevelBadge id={overall.level.id} label={overall.level.label} />
              <span className="text-muted">
                · deloads {cadence.note}.
              </span>
            </div>
          )}

          {perLift.length === 0 ? (
            <p className="mt-4 text-sm text-muted">
              Log one of the main barbell lifts (squat, bench, deadlift, press, row, front squat)
              to see your standard.
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {perLift.map((s) => {
                const color = solid(s.level.id);
                return (
                  <li key={s.lift}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{s.lift}</span>
                      <span className="flex items-center gap-2">
                        <span className="tabular-nums text-muted">{s.ratio}×</span>
                        <LevelBadge id={s.level.id} label={s.level.label} />
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-border">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${Math.round(s.progressToNext * 100)}%`, background: color }}
                      />
                    </div>
                    <p className="mt-1 text-[11px] text-muted">
                      {s.nextLevel
                        ? `${Math.round(s.progressToNext * 100)}% to ${s.nextLevel.label} · ~${s.nextLevelE1RM} ${units} e1RM`
                        : "Top band, Elite"}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
